import type { Brief, FurnishResult, Style, Unit } from './model';
import { CATALOG, applyPlan, furnish } from './furnish';
import { formatINR } from './tower';
import { BRIEF_LIMITS, TOWER_NOT_JSON, TowerAgentError, planOf, readTowerProposal, towerProblems, type PlanEntry, type TowerProposal } from './tower-agent-prompt';

export interface TowerStep {
  n: number;
  source: 'agent' | 'rules';
  brief: Brief;
  result: FurnishResult;
  problems: string[];
  whys: string[];
}
export interface TowerRun {
  steps: TowerStep[];
  brief: Brief;
  result: FurnishResult;
  reply: string;
  source: 'agent' | 'rules';
  model?: string;
  elapsedMs: number;
}
export interface TowerAgentOptions { signal?: AbortSignal; onStep?(step: TowerStep): void; fetcher?: typeof fetch }

export const MAX_ATTEMPTS = 3, DEADLINE_MS = 35_000, CALL_SHARE_MS = 14_000, CALL_WINDOW_MS = 5_000;

class BadReply extends Error {}
export class TowerHttpError extends Error { constructor(public status: number, public code: string | undefined) { super(`The tower agent endpoint answered ${status}.`); this.name = 'TowerHttpError'; } }

const stopped = (signal?: AbortSignal) => { if (signal?.aborted) throw signal.reason ?? new DOMException('Stopped.', 'AbortError'); };
const numbersIn = (text: string): number[] => (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map(n => Number(n.replace(/,/g, ''))).filter(Number.isFinite);

export const DEFAULT_BRIEF: Brief = { occupants: 2, budgetINR: 500_000, style: 'warm-minimal', wfh: 0, kids: 0, pets: [], notes: '' };

export const rupees = (text: string): string =>
  text.replace(/(₹|Rs\.?\s?|INR\s?)?\b(\d{1,3}(?:,\d{2,3})+|\d{4,})\b/g, (_m, _cur, n: string) => formatINR(Number(n.replace(/,/g, ''))));

export function groundedWhys(whys: string[], unit: Unit, result: FurnishResult): string[] {
  const { brief, pieces } = result, known: number[] = [
    result.costINR, brief.budgetINR, brief.occupants, brief.wfh, brief.kids, brief.pets.length, pieces.length, unit.carpetSqft, unit.priceINR, unit.floor, unit.sunHours, unit.rooms.length,
    ...numbersIn(`${unit.id} ${unit.type} ${unit.rooms.map(r => `${r.id} ${r.name}`).join(' ')}`),
    ...pieces.flatMap(p => [p.priceINR, p.w, p.d, p.h, p.w * p.d]),
    ...unit.rooms.flatMap(r => [r.rect.w, r.rect.d, r.rect.w * r.rect.d, pieces.filter(p => p.roomId === r.id).length, pieces.filter(p => p.roomId === r.id).reduce((s, p) => s + p.priceINR, 0)]),
    ...Object.values(CATALOG).map(c => c.priceByStyle[brief.style]),
    brief.budgetINR ? (result.costINR / brief.budgetINR) * 100 : 0, brief.budgetINR - result.costINR,
  ];
  const scales = [1, 1e-3, 1e-5, 1e-7, 100, 10.764];
  const matches = (n: number) => known.some(k => scales.some(s => Math.abs(k * s - n) <= Math.max(0.06, Math.abs(k * s) * 0.012)));
  const kept = whys.filter(w => numbersIn(w).every(matches));
  return kept.length ? kept : ruleWhys(unit, result);
}

export function ruleWhys(unit: Unit, result: FurnishResult): string[] {
  const { brief, pieces, costINR } = result, out: string[] = [];
  out.push(`${pieces.length} pieces for ${brief.occupants} ${brief.occupants === 1 ? 'person' : 'people'} in ${unit.id} cost ${formatINR(costINR)}${brief.budgetINR ? ` against your ${formatINR(brief.budgetINR)} budget` : ''}.`);
  if (brief.wfh) out.push(`${brief.wfh} desk${brief.wfh === 1 ? '' : 's'} with chairs cover the ${brief.wfh} of you working from home.`);
  if (brief.pets.length) out.push(`A ${brief.pets[0]} gets its own corner, kept clear of the doors.`);
  const beds = pieces.filter(p => p.kind.startsWith('bed') || p.kind === 'crib').length;
  out.push(`${beds} bed${beds === 1 ? '' : 's'} for ${brief.occupants} ${brief.occupants === 1 ? 'person' : 'people'} fit the ${unit.type} bedrooms.`);
  return out.slice(0, 4);
}

async function askEndpoint(fetcher: typeof fetch, unit: Unit, request: string, brief: Brief, previous: { problems: string[]; plan?: PlanEntry[] } | undefined, signal: AbortSignal) {
  const response = await fetcher('/api/tower-agent', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request, unitId: unit.id, brief, ...(previous ? { previous } : {}) }), signal });
  const data: unknown = await response.json().catch(() => null), body = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  if (!response.ok) {
    const code = body.error && typeof body.error === 'object' ? (body.error as Record<string, unknown>).code : undefined;
    if (code === 'TOWER_AGENT_BAD_REPLY') throw new BadReply();
    throw new TowerHttpError(response.status, typeof code === 'string' ? code : undefined);
  }
  if (typeof body.provider !== 'string' || typeof body.model !== 'string') throw new TowerAgentError('INVALID_RESPONSE', 'Unreadable agent answer.');
  try { return { proposal: readTowerProposal(body.proposal, unit, brief), model: body.model.slice(0, 80) }; } catch { throw new BadReply(); }
}

const STYLE_WORDS: [RegExp, Style][] = [[/scandi/i, 'scandi'], [/industrial/i, 'industrial'], [/indian|ethnic|traditional/i, 'indian-modern'], [/minimal|warm/i, 'warm-minimal']];

export function briefFromText(text: string, base: Brief): Brief {
  const t = text.toLowerCase(), brief: Brief = { ...base, pets: [...base.pets] };
  const budget = /(?:₹|rs\.?\s*|inr\s*)?(\d+(?:\.\d+)?)\s*(crore|cr|lakhs?|lacs?|l|k)\b/.exec(t);
  if (budget) brief.budgetINR = Math.round(Number(budget[1]) * ({ crore: 1e7, cr: 1e7, l: 1e5, k: 1e3 }[budget[2]] ?? 1e5));
  if (/\b(?:couple|two of us)\b/.test(t)) brief.occupants = 2;
  if (/\b(?:solo|single person|live alone|just me)\b/.test(t)) brief.occupants = 1;
  const family = /\b(?:family of|(\d+)\s*(?:people|persons|adults))\s*(\d+)?/.exec(t);
  if (family) brief.occupants = Math.min(8, Number(family[1] ?? family[2]) || brief.occupants);
  const kids = /(\d+|one|two|three)\s*(?:kids?|child(?:ren)?)/.exec(t);
  if (kids) brief.kids = ({ one: 1, two: 2, three: 3 } as Record<string, number>)[kids[1]] ?? Number(kids[1]);
  else if (/\b(?:kid|child|baby|toddler)\b/.test(t)) brief.kids = Math.max(1, brief.kids);
  if (brief.kids) brief.occupants = Math.max(brief.occupants, brief.kids + 1);
  if (/\b(?:both|all)\b[^.,]*\b(?:wfh|work(?:ing)? from home)/.test(t)) brief.wfh = Math.min(brief.occupants, Math.max(2, brief.wfh));
  else if (/\bwfh\b|work(?:s|ing)? from home/.test(t)) brief.wfh = Math.max(1, brief.wfh);
  brief.wfh = Math.min(brief.wfh, brief.occupants);
  for (const pet of ['cat', 'dog']) if (new RegExp(`\\b${pet}s?\\b`).test(t) && !brief.pets.includes(pet)) brief.pets.push(pet);
  brief.style = STYLE_WORDS.find(([re]) => re.test(t))?.[1] ?? brief.style;
  brief.budgetINR = Math.min(BRIEF_LIMITS.budgetINR[1], brief.budgetINR);
  return brief;
}

function requestedNote(request: string, result: FurnishResult): string {
  const t = request.toLowerCase(), { brief } = result;
  const notes: string[] = [];
  if (/\b(?:wfh|work from home|working from home)\b/.test(t) && result.pieces.filter(p => p.kind === 'desk').length < brief.wfh) notes.push(`There was no room for ${brief.wfh} desks in ${result.unitId}.`);
  const bad = result.issues.find(i => i.kind === 'over-budget');
  if (bad) notes.push(`${formatINR(result.costINR)} is the lowest this flat could be furnished to your needs, above your ${formatINR(brief.budgetINR)} budget.`);
  return notes.join(' ');
}

export async function runTowerAgent(request: string, unit: Unit, current: FurnishResult | null, opts: TowerAgentOptions = {}): Promise<TowerRun> {
  const { signal, onStep, fetcher = (input, init) => fetch(input, init) } = opts;
  const began = Date.now(), text = request.trim().slice(0, 300), timeout = AbortSignal.timeout(DEADLINE_MS);
  const steps: TowerStep[] = [];
  const startBrief = current?.brief ?? DEFAULT_BRIEF;
  let brief = startBrief, previous: { problems: string[]; plan?: PlanEntry[] } | undefined, last: { proposal: TowerProposal; model: string } | undefined, unavailable = false, agentBrief: Brief | undefined;
  if (current && current.issues.length) previous = { problems: towerProblems(current), plan: planOf(current) };
  const record = (step: Omit<TowerStep, 'n'>) => { const full = { ...step, n: steps.length + 1 }; steps.push(full); onStep?.(full); return full; };
  const finish = (reply: string, source: TowerRun['source']): TowerRun => {
    const final = steps[steps.length - 1];
    return { steps, brief: final.brief, result: final.result, reply, source, ...(last ? { model: last.model } : {}), elapsedMs: Date.now() - began };
  };

  for (let attempt = 1; attempt <= MAX_ATTEMPTS && Date.now() - began < DEADLINE_MS - CALL_WINDOW_MS; attempt++) {
    stopped(signal);
    const callTimeout = AbortSignal.timeout(Math.max(0, Math.min(CALL_SHARE_MS, DEADLINE_MS - (Date.now() - began))));
    const callSignal = AbortSignal.any([timeout, callTimeout, ...(signal ? [signal] : [])]);
    let answer: Awaited<ReturnType<typeof askEndpoint>>;
    try { answer = await askEndpoint(fetcher, unit, text, brief, previous, callSignal); }
    catch (error) {
      stopped(signal);
      if (error instanceof BadReply) { previous = { problems: [TOWER_NOT_JSON], ...(previous?.plan ? { plan: previous.plan } : {}) }; continue; }
      unavailable = true;
      break;
    }
    stopped(signal);
    last = answer;
    brief = agentBrief = answer.proposal.brief;
    let result: FurnishResult;
    try { result = applyPlan(unit, brief, answer.proposal.plan); } catch { previous = { problems: [TOWER_NOT_JSON] }; continue; }
    const problems = towerProblems(result);
    record({ source: 'agent', brief, result, problems, whys: groundedWhys(answer.proposal.whys, unit, result).map(rupees) });
    if (result.ok) return finish(answer.proposal.reply, 'agent');
    previous = { problems, plan: planOf(result) };
  }

  const fallbackBrief = agentBrief ?? briefFromText(text, startBrief);
  const result = furnish(unit, fallbackBrief);
  record({ source: 'rules', brief: fallbackBrief, result, problems: towerProblems(result), whys: ruleWhys(unit, result) });
  const extra = requestedNote(text, result);
  return finish((unavailable ? 'The tower agent was unavailable, so the built-in rules furnished the flat.' : 'The agent plans did not clear every check, so the built-in rules furnished the flat.') + (extra ? ` ${extra}` : ''), 'rules');
}
