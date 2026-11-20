import type { BracketDesign } from '../src/bracket/model';
import { verify } from '../src/bracket/engine';
import { BOUNDS, REQUIREMENTS } from '../src/bracket/spec';
import { BRACKET_FIXED_PROBLEMS, BRACKET_SYSTEM, BracketAgentError, FINISHES, MATERIAL_IDS, ORIENTATIONS, bracketUserMessage, parseBracketProposal, type BracketAnswer, type BracketPrevious } from '../src/bracket/bracket-agent-prompt';
import { LayoutAgentError, PRIMARY_SHARE, REQUEST_DEADLINE_MS, layoutProviders, type Provider } from './layout-agent';

export { BracketAgentError, layoutProviders as bracketProviders };
export interface BracketAgentInput { request: string; current: BracketDesign; previous?: BracketPrevious }

const MAX_PROBLEMS = 12, PROBLEM_CHARS = 240, REQUEST_CHARS = 300;
const NUMERIC_KEYS = Object.keys(BOUNDS) as (keyof typeof BOUNDS)[];
const DESIGN_KEYS = ['material', 'orientation', 'finish', ...NUMERIC_KEYS];

function invalid(message: string): never { throw new BracketAgentError('INVALID_INPUT', message); }
function record(value: unknown, label: string, keys?: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${label} must be an object.`);
  const found = value as Record<string, unknown>;
  if (keys) {
    for (const key of Object.keys(found)) if (!keys.includes(key)) invalid(`${label} has an unknown field.`);
    for (const key of keys) if (!(key in found) && !optional.includes(key)) invalid(`${label} is missing a field.`);
  }
  return found;
}

function readDesign(value: unknown, label: string): BracketDesign {
  const d = record(value, label, DESIGN_KEYS);
  if (!MATERIAL_IDS.includes(d.material as never)) invalid(`${label}.material is not a known material.`);
  if (!ORIENTATIONS.includes(d.orientation as never)) invalid(`${label}.orientation is not a known value.`);
  if (!FINISHES.includes(d.finish as never)) invalid(`${label}.finish is not a known value.`);
  for (const key of NUMERIC_KEYS) {
    const [min, max] = BOUNDS[key], n = d[key];
    if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max) invalid(`${label}.${key} must be a number from ${min} to ${max}.`);
  }
  return d as unknown as BracketDesign;
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const FIGURE_WORDS = 10;
const FIGURE = "([\\p{L}\\p{N} ,.×·°/+\\-−()≤≥<>=%±:$]{1,70})";

export function isBracketCheckProblem(problem: string): boolean {
  if (BRACKET_FIXED_PROBLEMS.includes(problem)) return true;
  if (problem.length > PROBLEM_CHARS) return false;
  const titles = REQUIREMENTS.map(requirement => escape(requirement.title)).join('|');
  const match = new RegExp(`^(?:${titles}) fails, ${FIGURE} against ${FIGURE}\\.$`, 'u').exec(problem);
  return !!match && match.slice(1).every(figure => figure.split(' ').length <= FIGURE_WORDS);
}

function readPrevious(value: unknown): BracketPrevious | undefined {
  if (value === undefined || value === null) return undefined;
  const p = record(value, 'previous', ['problems']);
  if (!Array.isArray(p.problems) || p.problems.length > MAX_PROBLEMS || !p.problems.length) invalid(`previous.problems must be a list of 1 to ${MAX_PROBLEMS}.`);
  const problems = p.problems.map((problem, index) => { if (typeof problem !== 'string') invalid(`previous.problems[${index}] must be text.`); return problem; }).filter(isBracketCheckProblem);
  return { problems: problems.length ? problems : [BRACKET_FIXED_PROBLEMS[1]] };
}

export function readBracketAgentInput(data: unknown): BracketAgentInput {
  const body = record(data, 'body', ['request', 'current', 'previous'], ['previous']);
  if (typeof body.request !== 'string' || !body.request.trim() || body.request.length > REQUEST_CHARS) throw new BracketAgentError('INVALID_REQUEST', 'Describe what you want in up to 300 characters.');
  const current = readDesign(body.current, 'current');
  const previous = readPrevious(body.previous);
  return { request: body.request.trim(), current, ...(previous ? { previous } : {}) };
}

export async function askBracketModel(input: BracketAgentInput, providers: Provider[], signal?: AbortSignal, deadlineMs = REQUEST_DEADLINE_MS): Promise<BracketAnswer> {
  const user = bracketUserMessage(input.request, verify(input.current), input.previous);
  const deadline = AbortSignal.timeout(deadlineMs), ends = signal ? AbortSignal.any([signal, deadline]) : deadline;
  let completion: Awaited<ReturnType<Provider>> | undefined, refused = true;
  for (const [index, provider] of providers.entries()) {
    if (ends.aborted) break;
    const share = index < providers.length - 1 ? AbortSignal.any([ends, AbortSignal.timeout(Math.round(deadlineMs * PRIMARY_SHARE))]) : ends;
    try { completion = await provider(BRACKET_SYSTEM, user, share); break; }
    catch (error) { refused &&= error instanceof LayoutAgentError && error.code === 'PROVIDER' && !share.aborted; }
  }
  if (!completion) throw new BracketAgentError(refused ? 'PROVIDER_REFUSED' : 'PROVIDER', 'The agent provider could not be reached.');
  return { proposal: parseBracketProposal(completion.text), provider: completion.provider, model: completion.model };
}
