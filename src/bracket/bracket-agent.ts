import type { BracketDesign, MaterialId, Verification } from './model';
import { MATERIALS, MAX_STRAIN_PCT } from './spec';
import { clampDesign, optimise, verify } from './engine';
import { BRACKET_NOT_JSON, BracketAgentError, bracketProblems, readBracketProposal, type BracketProposal } from './bracket-agent-prompt';

export interface FailedCheck { id: string; clause: string; title: string; value: string; limit: string }
export interface Iteration {
  n: number;
  source: 'agent' | 'optimiser';
  design: BracketDesign;
  verification: Verification;
  failed: FailedCheck[];
  whys: string[];
}
export interface BracketRun {
  iterations: Iteration[];
  design: BracketDesign;
  verification: Verification;
  reply: string;
  limits: string;
  source: 'agent' | 'optimiser';
  model?: string;
  elapsedMs: number;
}
export interface BracketAgentOptions { signal?: AbortSignal; onIteration?(iteration: Iteration): void; fetcher?: typeof fetch }

export const MAX_ATTEMPTS = 4, DEADLINE_MS = 40_000, CALL_SHARE_MS = 20_000, CALL_WINDOW_MS = 5_000;

class BadReply extends Error {}
export class BracketHttpError extends Error { constructor(public status: number, public code: string | undefined) { super(`The bracket agent endpoint answered ${status}.`); this.name = 'BracketHttpError'; } }

const failedOf = (verification: Verification): FailedCheck[] =>
  verification.checks.filter(check => check.status === 'fail').map(({ id, clause, title, value, limit }) => ({ id, clause, title, value, limit }));
const stopped = (signal?: AbortSignal) => { if (signal?.aborted) throw signal.reason ?? new DOMException('Stopped.', 'AbortError'); };
const n0 = (value: number) => Math.round(value).toLocaleString('en-US');
const n1 = (value: number) => (Math.round(value * 10) / 10).toLocaleString('en-US');

const numbersIn = (text: string): number[] => (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => Number(n.replace(/,/g, ''))).filter(Number.isFinite);

export function groundedWhys(whys: string[], v: Verification): string[] {
  const mat = MATERIALS[v.design.material];
  const known = [
    ...Object.values(v.design).filter((x): x is number => typeof x === 'number'),
    ...v.checks.flatMap((c) => numbersIn(`${c.value} ${c.limit}`)),
    mat.yieldMPa, mat.utsMPa, mat.elongationPct, mat.modulus, mat.density,
    v.derived.massG, v.derived.unitCostUSD, v.derived.frequencyHz, v.derived.kickCapacityN,
  ];
  const matches = (n: number) => known.some((k) => Math.abs(k - n) <= Math.max(0.05, Math.abs(k) * 0.01) || Math.abs(k * 100 - n) <= 0.5);
  const kept = whys.filter((w) => numbersIn(w).every(matches));
  return kept.length ? kept : optimiserWhys(v);
}

export function optimiserWhys(v: Verification): string[] {
  const { design: d, derived: x } = v, material = MATERIALS[d.material];
  return [
    `${material.name} at ${d.thickness} mm thick, printed ${d.orientation} and ${d.finish}.`,
    `Foot kick collapses at ${n0(x.kickCapacityN)} N and the first mode is ${n1(x.frequencyHz)} Hz.`,
    `It weighs ${n0(x.massG)} g each with ${Math.round(d.cutout * 100)}% wall cut-outs, the lightest design that clears every check.`,
  ];
}

async function askEndpoint(fetcher: typeof fetch, request: string, current: BracketDesign, problems: string[] | undefined, signal: AbortSignal) {
  const response = await fetcher('/api/bracket-agent', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request, current, ...(problems ? { previous: { problems } } : {}) }), signal });
  const data: unknown = await response.json().catch(() => null), body = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  if (!response.ok) {
    const code = body.error && typeof body.error === 'object' ? (body.error as Record<string, unknown>).code : undefined;
    if (code === 'BRACKET_AGENT_BAD_REPLY') throw new BadReply();
    throw new BracketHttpError(response.status, typeof code === 'string' ? code : undefined);
  }
  if (typeof body.provider !== 'string' || typeof body.model !== 'string') throw new BracketAgentError('INVALID_RESPONSE', 'Unreadable agent answer.');
  try { return { proposal: readBracketProposal(body.proposal), model: body.model.slice(0, 80) }; } catch { throw new BadReply(); }
}

function requestedMaterial(text: string): MaterialId | null {
  const t = text.toLowerCase();
  if (/alumin|alsi10mg/.test(t)) return 'alsi10mg-lpbf';
  if (/stainless|316l/.test(t)) return 'ss316l-lpbf';
  if (/nylon|pa12|polymer|plastic/.test(t)) return 'pa12-sls';
  if (/titan|ti-?6al/.test(t)) return 'ti64-lpbf';
  return null;
}

export async function runBracketAgent(request: string, current: BracketDesign, opts: BracketAgentOptions = {}): Promise<BracketRun> {
  const { signal, onIteration, fetcher = (input, init) => fetch(input, init) } = opts;
  const began = Date.now(), text = request.trim().slice(0, 300), timeout = AbortSignal.timeout(DEADLINE_MS);
  const iterations: Iteration[] = [];
  let working = current, problems: string[] | undefined, last: { proposal: BracketProposal; model: string } | undefined, unavailable = false;
  const record = (iteration: Omit<Iteration, 'n' | 'failed'>) => {
    const full: Iteration = { ...iteration, n: iterations.length + 1, failed: failedOf(iteration.verification) };
    iterations.push(full);
    onIteration?.(full);
    return full;
  };
  const finish = (reply: string, limits: string, source: BracketRun['source']): BracketRun => {
    const final = iterations[iterations.length - 1];
    return { iterations, design: final?.design ?? working, verification: final?.verification ?? verify(working), reply, limits, source, ...(last ? { model: last.model } : {}), elapsedMs: Date.now() - began };
  };

  for (let attempt = 1; attempt <= MAX_ATTEMPTS && Date.now() - began < DEADLINE_MS - CALL_WINDOW_MS; attempt++) {
    stopped(signal);
    const callTimeout = AbortSignal.timeout(Math.max(0, Math.min(CALL_SHARE_MS, DEADLINE_MS - (Date.now() - began))));
    const callSignal = AbortSignal.any([timeout, callTimeout, ...(signal ? [signal] : [])]);
    let answer: Awaited<ReturnType<typeof askEndpoint>>;
    try { answer = await askEndpoint(fetcher, text, working, problems, callSignal); }
    catch (error) {
      stopped(signal);
      if (error instanceof BadReply) { problems = [BRACKET_NOT_JSON]; continue; }
      unavailable = true;
      break;
    }
    stopped(signal);
    last = answer;
    if (!answer.proposal.design) return finish(answer.proposal.reply, answer.proposal.limits, 'agent');
    const { why, ...proposed } = answer.proposal.design, design = clampDesign(proposed), verification = verify(design);
    working = design;
    const iteration = record({ source: 'agent', design, verification, whys: groundedWhys(why, verification) });
    if (!iteration.failed.length) return finish(answer.proposal.reply, answer.proposal.limits, 'agent');
    problems = bracketProblems(verification).slice(0, 12);
  }

  const best = optimise();
  const design = best?.design ?? working, verification = best ?? verify(working);
  record({ source: 'optimiser', design, verification, whys: best ? optimiserWhys(best) : [] });
  const asked = requestedMaterial(text);
  const askedNote = asked && best && best.design.material !== asked && !optimise(asked)
    ? ` No ${MATERIALS[asked].short} design in the search range clears every check${MATERIALS[asked].elongationPct <= MAX_STRAIN_PCT ? ` (it stretches only ${MATERIALS[asked].elongationPct}% before breaking, the CTS allows ${MAX_STRAIN_PCT}% plastic strain)` : ''}, so this uses ${MATERIALS[best.design.material].short}.`
    : '';
  const note = (unavailable ? 'The bracket agent was unavailable, so the built-in optimiser chose the lightest design that clears every check.' : 'The agent designs did not clear every check, so the built-in optimiser chose the lightest design that does.') + askedNote;
  return finish(note, 'The optimiser searches a coarse grid and ignores the wording of the request.', 'optimiser');
}
