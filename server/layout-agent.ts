import { createFurnitureItem, KINDS, kindsForSpace, MAX_ITEMS } from '../src/domain';
import { LayoutAgentError, parseProposal, placeOf, readProposal, SYSTEM, userMessage, type AgentAnswer, type AgentPrevious, type AgentSituation, type FurnitureBrief, type Proposal, type SavedLayoutBrief } from '../src/layout-agent-prompt';
import type { ItemKind, SpaceType } from '../src/types';

/**
 * A thin, budgeted model gateway. The browser runs the agent loop and every layout check;
 * this module validates the compact situation, rebuilds the prompt from it and relays one model call.
 */
export { LayoutAgentError };
export interface LayoutAgentConfig { foundryToken?: string; aipipeToken?: string; foundryModel?: string; aipipeModel?: string }
/** preferBackup: an earlier attempt of this request already fell back, so skip the primary provider's wait. */
export interface LayoutAgentInput { request: string; situation: AgentSituation; previous?: AgentPrevious; preferBackup?: true }
interface Completion { text: string; provider: string; model: string }
type Provider = (system: string, user: string, signal: AbortSignal) => Promise<Completion>;

/**
 * One request never outlives the browser's share of its 30 s deadline, failover included.
 * With a backup configured, the primary gets PRIMARY_SHARE of that time and the backup the rest.
 */
export const REQUEST_DEADLINE_MS = 18_000, PRIMARY_SHARE = .6;
/** Bounds on what one call may carry: the app caps a project at 80 pieces and 12 layouts. */
const MAX_FURNITURE = 80, MAX_LAYOUTS = 12, MAX_PROBLEMS = 12, PROBLEM_CHARS = 240, REQUEST_CHARS = 200;
const COLOR = /^#[a-f\d]{6}$/i;
const bearer = (token: string) => token.replace(/^Bearer\s+/i, '').trim();

function invalid(message: string): never { throw new LayoutAgentError('INVALID_INPUT', message); }
function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${label} must be an object.`);
  return value as Record<string, unknown>;
}
function list(value: unknown, label: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) invalid(`${label} must be a list of at most ${max}.`);
  return value;
}
function finite(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) invalid(`${label} must be a number from ${min} to ${max}.`);
  return value;
}
function text(value: unknown, label: string, max: number, min = 1): string {
  if (typeof value !== 'string' || value.length < min || value.length > max) invalid(`${label} must be text of at most ${max} characters.`);
  return value;
}
function flag(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') invalid(`${label} must be true or false.`);
  return value;
}
function colour(value: unknown, label: string): string {
  if (typeof value !== 'string' || !COLOR.test(value)) invalid(`${label} must be #rrggbb.`);
  return value;
}

/** Rebuilds the situation from known keys only, so extra fields never reach the model. */
function readSituation(value: unknown): AgentSituation {
  const s = record(value, 'situation'), r = record(s.room, 'room');
  if (s.space !== 'room' && s.space !== 'retail') invalid('space must be room or retail.');
  const space = s.space as SpaceType, allowed = kindsForSpace(space);
  const kind = (value: unknown, label: string) => { if (!allowed.includes(value as ItemKind)) invalid(`${label} is not a ${space} kind.`); return value as ItemKind; };
  const kinds = list(s.catalogueKinds, 'catalogueKinds', allowed.length).map((value, index) => kind(value, `catalogueKinds[${index}]`));
  if (new Set(kinds).size !== kinds.length) invalid('catalogueKinds must not repeat.');
  const furniture = list(s.furniture, 'furniture', MAX_FURNITURE).map((value, index): FurnitureBrief => {
    const f = record(value, `furniture[${index}]`), at = `furniture[${index}]`;
    return { id: text(f.id, `${at}.id`, 128), name: text(f.name, `${at}.name`, 80), kind: kind(f.kind, `${at}.kind`), width: finite(f.width, `${at}.width`, .05, 20), depth: finite(f.depth, `${at}.depth`, .05, 20), x: finite(f.x, `${at}.x`, -50, 50), z: finite(f.z, `${at}.z`, -50, 50), rotationDegrees: finite(f.rotationDegrees, `${at}.rotationDegrees`, -36_000, 36_000), color: colour(f.color, `${at}.color`), locked: flag(f.locked, `${at}.locked`), visible: flag(f.visible, `${at}.visible`) };
  });
  const savedLayouts = list(s.savedLayouts, 'savedLayouts', MAX_LAYOUTS).map((value, index): SavedLayoutBrief => {
    const l = record(value, `savedLayouts[${index}]`), at = `savedLayouts[${index}]`;
    return { id: text(l.id, `${at}.id`, 128), name: text(l.name, `${at}.name`, 80), description: text(l.description, `${at}.description`, 240, 0), largestOpenFloorM2: finite(l.largestOpenFloorM2, `${at}.largestOpenFloorM2`, 0, 900), active: flag(l.active, `${at}.active`) };
  });
  if (savedLayouts.filter(layout => layout.active).length !== 1) invalid('Exactly one saved layout must be active.');
  return {
    space, room: { width: finite(r.width, 'room.width', 2, 30), depth: finite(r.depth, 'room.depth', 2, 30), doorCentreX: finite(r.doorCentreX, 'room.doorCentreX', -15, 15), doorWidth: finite(r.doorWidth, 'room.doorWidth', .6, 6) },
    activeLayout: text(s.activeLayout, 'activeLayout', 80), wallColor: colour(s.wallColor, 'wallColor'), accentColor: colour(s.accentColor, 'accentColor'),
    catalogueKinds: kinds, largestOpenFloorM2: finite(s.largestOpenFloorM2, 'largestOpenFloorM2', 0, 900), furniture, savedLayouts,
  };
}
/** Lower-cased names a check may mention: the pieces in the situation and the catalogue name of each kind it may add. */
// Built on first use: createFurnitureItem draws a random id, which Workers forbid at module load.
let kindNames: Map<string, string> | undefined;
const kindName = (kind: string) => (kindNames ??= new Map(KINDS.map(each => [each, createFurnitureItem(each).name]))).get(kind)!;
function namesOf(situation: AgentSituation): Set<string> {
  return new Set([...situation.furniture.map(piece => piece.name), ...situation.catalogueKinds.map(kindName)].map(name => name.toLowerCase()));
}
/** True when some split of text at sep leaves a known name on both sides. */
function twoNames(text: string, sep: string, known: Set<string>): boolean {
  for (let at = text.indexOf(sep); at > 0; at = text.indexOf(sep, at + 1)) if (known.has(text.slice(0, at).toLowerCase()) && known.has(text.slice(at + sep.length).toLowerCase())) return true;
  return false;
}
/**
 * Only the problems the browser checks write, so this field cannot carry other text to the model.
 * Keep in step with reviewMoves, judgeProposal and validateLayout; a test runs them against this list.
 */
export function isCheckProblem(problem: string, situation: AgentSituation): boolean {
  const place = placeOf(situation.space), known = namesOf(situation), kinds = new Set<string>(situation.catalogueKinds);
  const fixed = ['No changes were given.', 'Use at most 7 changes per list.', 'Wall colours must be #rrggbb.', 'The colour change needs a reason.', 'The previous response was not valid JSON.', 'The store needs a checkout counter unless the person asks to remove it.', 'The chair must stay at the desk.', 'The chair must sit on the room side of the desk, not between the desk and the wall.', `A ${place} holds at most ${MAX_ITEMS} pieces.`, `That changes nothing in the ${place}.`, 'No saved layout has the id "".'];
  if (fixed.includes(problem)) return true;
  if (/^Largest open floor would be \d+(\.\d+)? m², not more than the current \d+(\.\d+)? m²\.$/.test(problem)) return true;
  const named = problem.match(/^(.+?) (is locked and cannot change|was moved twice|was recoloured twice|needs a reason|needs a numeric position and a rotation of 0, 90, 180 or 270|cannot be both moved and removed|cannot be both recoloured and removed|needs a #rrggbb colour|is outside the (?:room|store)|extends outside the (?:room|store)|blocks the entrance door's opening space|cannot be reached from the door by a 1\.2 m wide aisle|must stay within 1 m of a consultation station)\.$/);
  if (named && known.has(named[1].toLowerCase())) return true;
  const added = problem.match(/^The new (.+) needs a (?:reason|numeric position and a rotation of 0, 90, 180 or 270)\.$/);
  if (added && kinds.has(added[1])) return true;
  if (problem.endsWith('.') && twoNames(problem.slice(0, -1), ' overlaps ', known)) return true;
  const access = problem.match(/^Leave room to use (.+) is in its access space\.$/);
  return Boolean(access && twoNames(access[1], '; ', known));
}
function readPrevious(value: unknown, situation: AgentSituation): AgentPrevious | undefined {
  if (value === undefined || value === null) return undefined;
  const p = record(value, 'previous');
  const problems = list(p.problems, 'previous.problems', MAX_PROBLEMS).map((problem, index) => text(problem, `previous.problems[${index}]`, PROBLEM_CHARS));
  if (!problems.length) invalid('previous.problems must name at least one problem.');
  // A problem the checks could not have written is dropped, not passed on.
  const checked = problems.filter(problem => isCheckProblem(problem, situation));
  const kept = checked.length ? checked : ['The previous proposal did not pass the checks.'];
  if (p.proposal === null) return { proposal: null, problems: kept };
  let proposal: Proposal;
  try { proposal = readProposal(p.proposal); } catch { invalid('previous.proposal must be a proposal.'); }
  return { proposal: fitProposal(proposal, situation), problems: kept };
}
/**
 * Keeps only what the app can act on: pieces in the situation, kinds in its catalogue and its saved layouts.
 * Lists and text were already capped by readProposal.
 */
export function fitProposal(proposal: Proposal, situation: AgentSituation): Proposal {
  const ids = new Set(situation.furniture.map(piece => piece.id)), kinds = new Set<string>(situation.catalogueKinds);
  return {
    ...proposal, layoutId: situation.savedLayouts.some(layout => layout.id === proposal.layoutId) ? proposal.layoutId : '',
    moves: proposal.moves.filter(move => ids.has(move.itemId)), removals: proposal.removals.filter(removal => ids.has(removal.itemId)),
    recolors: proposal.recolors.filter(recolor => ids.has(recolor.itemId)), additions: proposal.additions.filter(addition => kinds.has(addition.kind)),
  };
}
/** Strict checks on a request body. Anything outside the contract throws INVALID_INPUT. */
export function readLayoutAgentInput(data: unknown): LayoutAgentInput {
  const body = record(data, 'body');
  if (typeof body.request !== 'string' || !body.request.trim() || body.request.length > REQUEST_CHARS) throw new LayoutAgentError('INVALID_REQUEST', 'Describe what you want in up to 200 characters.');
  const situation = readSituation(body.situation), previous = readPrevious(body.previous, situation);
  // Only a retry may skip the primary provider: the browser asks for that after the backup has answered once.
  return { request: body.request.trim(), situation, ...(previous ? { previous, ...(body.preferBackup === true ? { preferBackup: true as const } : {}) } : {}) };
}

async function askFoundry(token: string, model: string, system: string, user: string, signal: AbortSignal, fetcher: typeof fetch): Promise<Completion> {
  const key = bearer(token), response = await fetcher(`https://llmfoundry.straivedemo.com/gemini/v1beta/models/${model}:generateContent`, { method: 'POST', redirect: 'manual', signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}${key.includes(':') ? '' : ':roomshift-studio'}` }, body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }], generationConfig: { temperature: .2, maxOutputTokens: 4000, responseMimeType: 'application/json', thinkingConfig: model.startsWith('gemini-2.5-') ? { thinkingBudget: 512 } : { thinkingLevel: 'low' } } }) });
  if (!response.ok) throw new LayoutAgentError('PROVIDER', `Foundry returned HTTP ${response.status}.`);
  const result = await response.json() as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] };
  return { text: result.candidates?.[0]?.content?.parts?.filter(part => !part.thought).map(part => part.text ?? '').join('') ?? '', provider: 'LLM Foundry', model };
}
async function askAiPipe(token: string, model: string, system: string, user: string, signal: AbortSignal, fetcher: typeof fetch): Promise<Completion> {
  const response = await fetcher('https://aipipe.org/openai/v1/chat/completions', { method: 'POST', redirect: 'manual', signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer(token)}` }, body: JSON.stringify({ model, response_format: { type: 'json_object' }, max_completion_tokens: 3000, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }) });
  if (!response.ok) throw new LayoutAgentError('PROVIDER', `AI Pipe returned HTTP ${response.status}.`);
  const result = await response.json() as { choices?: { message?: { content?: string } }[] };
  return { text: result.choices?.[0]?.message?.content ?? '', provider: 'AI Pipe', model };
}
/** The configured providers in failover order. Throws UNAVAILABLE when there are none, before any budget is spent. */
export function layoutProviders(config: LayoutAgentConfig, fetcher: typeof fetch = fetch): Provider[] {
  const providers: Provider[] = [
    ...(config.foundryToken ? [(system: string, user: string, signal: AbortSignal) => askFoundry(config.foundryToken!, config.foundryModel ?? 'gemini-3.5-flash', system, user, signal, fetcher)] : []),
    ...(config.aipipeToken ? [(system: string, user: string, signal: AbortSignal) => askAiPipe(config.aipipeToken!, config.aipipeModel ?? 'gpt-4o-mini', system, user, signal, fetcher)] : []),
  ];
  if (!providers.length) throw new LayoutAgentError('UNAVAILABLE', 'The room agent has no provider configured.');
  return providers;
}
/**
 * One model call with failover, ended by the request deadline or by signal (the browser giving up).
 * The answer is a parsed proposal trimmed to the situation, never the model's own text.
 * When no provider answered it throws PROVIDER_REFUSED if every provider turned the call down outright,
 * with an error status, which the caller may refund, or PROVIDER if one may already have spent tokens.
 */
export async function askLayoutModel(input: LayoutAgentInput, providers: Provider[], signal?: AbortSignal, deadlineMs = REQUEST_DEADLINE_MS): Promise<AgentAnswer> {
  const system = SYSTEM[input.situation.space], user = userMessage(input.request, input.situation, input.previous);
  const deadline = AbortSignal.timeout(deadlineMs), ends = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const order = input.preferBackup ? [...providers].reverse() : providers;
  let completion: Completion | undefined, refused = true;
  for (const [index, provider] of order.entries()) {
    if (ends.aborted) break;
    const share = index < order.length - 1 ? AbortSignal.any([ends, AbortSignal.timeout(Math.round(deadlineMs * PRIMARY_SHARE))]) : ends;
    try { completion = await provider(system, user, share); break; }
    catch (error) {
      // Only an HTTP error status is a clean refusal; a timeout, an abort or an unreadable body may have cost tokens.
      refused &&= error instanceof LayoutAgentError && error.code === 'PROVIDER' && !share.aborted;
    }
  }
  if (!completion) throw new LayoutAgentError(refused ? 'PROVIDER_REFUSED' : 'PROVIDER', 'The agent provider could not be reached.');
  return { proposal: fitProposal(parseProposal(completion.text), input.situation), provider: completion.provider, model: completion.model };
}
