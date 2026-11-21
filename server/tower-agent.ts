import type { Brief, Unit } from '../src/tower/model';
import { unitById } from '../src/tower/tower';
import { FURNITURE_KINDS, STYLES, BRIEF_LIMITS, MAX_PETS, TOWER_FIXED_PROBLEMS, TOWER_SYSTEM, TowerAgentError, parseTowerProposal, readPlan, towerUserMessage, type PlanEntry, type TowerAnswer, type TowerPrevious } from '../src/tower/tower-agent-prompt';
import { LayoutAgentError, PRIMARY_SHARE, REQUEST_DEADLINE_MS, layoutProviders, type Provider } from './layout-agent';

export { TowerAgentError, layoutProviders as towerProviders };
export interface TowerAgentInput { request: string; unit: Unit; brief: Brief; previous?: TowerPrevious }

const MAX_PROBLEMS = 12, PROBLEM_CHARS = 200, REQUEST_CHARS = 300;
const BRIEF_KEYS = ['occupants', 'budgetINR', 'style', 'wfh', 'kids', 'pets', 'notes'];

function invalid(message: string): never { throw new TowerAgentError('INVALID_INPUT', message); }
function record(value: unknown, label: string, keys?: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${label} must be an object.`);
  const found = value as Record<string, unknown>;
  if (keys) {
    for (const key of Object.keys(found)) if (!keys.includes(key)) invalid(`${label} has an unknown field.`);
    for (const key of keys) if (!(key in found) && !optional.includes(key)) invalid(`${label} is missing a field.`);
  }
  return found;
}

function whole(value: unknown, label: string, [min, max]: readonly [number, number] | readonly number[]): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) invalid(`${label} must be a whole number from ${min} to ${max}.`);
  return value;
}

export function readTowerBrief(value: unknown): Brief {
  const b = record(value, 'brief', BRIEF_KEYS);
  const occupants = whole(b.occupants, 'brief.occupants', BRIEF_LIMITS.occupants);
  const wfh = whole(b.wfh, 'brief.wfh', BRIEF_LIMITS.wfh), kids = whole(b.kids, 'brief.kids', BRIEF_LIMITS.kids);
  if (wfh > occupants || kids > occupants) invalid('brief.wfh and brief.kids cannot exceed occupants.');
  if (!STYLES.includes(b.style as never)) invalid('brief.style is not a known style.');
  if (!Array.isArray(b.pets) || b.pets.length > MAX_PETS || b.pets.some(p => typeof p !== 'string' || !/^[a-z ]{1,20}$/.test(p))) invalid('brief.pets must be a short list of animal words.');
  if (typeof b.notes !== 'string' || b.notes.length > 160) invalid('brief.notes must be text up to 160 characters.');
  return { occupants, wfh, kids, pets: b.pets as string[], budgetINR: whole(b.budgetINR, 'brief.budgetINR', BRIEF_LIMITS.budgetINR), style: b.style as Brief['style'], notes: b.notes };
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function isTowerCheckProblem(problem: string, unit: Unit): boolean {
  if (TOWER_FIXED_PROBLEMS.includes(problem)) return true;
  if (problem.length > PROBLEM_CHARS) return false;
  if (/^Over budget: \d{1,9} against \d{1,9}\.$/.test(problem)) return true;
  const rooms = unit.rooms.map(r => escape(r.id)).join('|'), kinds = FURNITURE_KINDS.map(escape).join('|');
  return new RegExp(`^(?:Overlap|Blocks a door|Tight walkway|Outside room|Missing need)(?: in (?:${rooms}))?(?:, (?:${kinds}))?(?:, needs (?:${kinds}))?\\.$`).test(problem);
}

function readPrevious(value: unknown, unit: Unit): TowerPrevious | undefined {
  if (value === undefined || value === null) return undefined;
  const p = record(value, 'previous', ['problems', 'plan'], ['plan']);
  if (!Array.isArray(p.problems) || p.problems.length > MAX_PROBLEMS || !p.problems.length) invalid(`previous.problems must be a list of 1 to ${MAX_PROBLEMS}.`);
  const problems = p.problems.map((problem, index) => { if (typeof problem !== 'string') invalid(`previous.problems[${index}] must be text.`); return problem; }).filter(problem => isTowerCheckProblem(problem, unit));
  let plan: PlanEntry[] | undefined;
  if (p.plan !== undefined && p.plan !== null) {
    try { plan = readPlan(p.plan, unit); } catch { invalid('previous.plan is not a valid plan.'); }
  }
  return { problems: problems.length ? problems : [TOWER_FIXED_PROBLEMS[1]], ...(plan ? { plan } : {}) };
}

export function readTowerAgentInput(data: unknown): TowerAgentInput {
  const body = record(data, 'body', ['request', 'unitId', 'brief', 'previous'], ['previous']);
  if (typeof body.request !== 'string' || !body.request.trim() || body.request.length > REQUEST_CHARS) throw new TowerAgentError('INVALID_REQUEST', 'Describe what you want in up to 300 characters.');
  const unit = typeof body.unitId === 'string' && body.unitId.length <= 4 ? unitById(body.unitId) : undefined;
  if (!unit) invalid('unitId is not a unit in this tower.');
  const previous = readPrevious(body.previous, unit);
  return { request: body.request.trim(), unit, brief: readTowerBrief(body.brief), ...(previous ? { previous } : {}) };
}

export async function askTowerModel(input: TowerAgentInput, providers: Provider[], signal?: AbortSignal, deadlineMs = REQUEST_DEADLINE_MS): Promise<TowerAnswer> {
  const user = towerUserMessage(input.request, input.unit, input.brief, input.previous);
  const deadline = AbortSignal.timeout(deadlineMs), ends = signal ? AbortSignal.any([signal, deadline]) : deadline;
  let completion: Awaited<ReturnType<Provider>> | undefined, refused = true;
  for (const [index, provider] of providers.entries()) {
    if (ends.aborted) break;
    const share = index < providers.length - 1 ? AbortSignal.any([ends, AbortSignal.timeout(Math.round(deadlineMs * PRIMARY_SHARE))]) : ends;
    try { completion = await provider(TOWER_SYSTEM, user, share); break; }
    catch (error) { refused &&= error instanceof LayoutAgentError && error.code === 'PROVIDER' && !share.aborted; }
  }
  if (!completion) throw new TowerAgentError(refused ? 'PROVIDER_REFUSED' : 'PROVIDER', 'The agent provider could not be reached.');
  return { proposal: parseTowerProposal(completion.text, input.unit, input.brief), provider: completion.provider, model: completion.model };
}
