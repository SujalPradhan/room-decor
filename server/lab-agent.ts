import { AIRCONS, DOOR_EXTINGUISHER_M, MATERIALS, MAX_LOOSE_M, PERSON_HEAT_W, RISK_EXTINGUISHER_M, RULES, WALKWAY_M } from '../src/lab/rules';
import {
  LAB_FIXED_PROBLEMS, LAB_NAMED_PROBLEMS, LAB_SYSTEM, LabAgentError, labUserMessage, parseLabProposal, readLabProposal, MAX_LAB_ITEMS,
  type LabAnswer, type LabIssueBrief, type LabItemBrief, type LabPrevious, type LabSituation, type LabSocketBrief,
} from '../src/lab/lab-agent-prompt';
import { LayoutAgentError, PRIMARY_SHARE, REQUEST_DEADLINE_MS, layoutProviders, type Provider } from './layout-agent';

export { LabAgentError, layoutProviders as labProviders };
export interface LabAgentInput { request: string; situation: LabSituation; previous?: LabPrevious }

const MAX_SOCKETS = 30, MAX_CIRCUITS = 10, MAX_ISSUES = 40, MAX_PROBLEMS = 12, PROBLEM_CHARS = 240, REQUEST_CHARS = 300, ID_CHARS = 64;
const KINDS = ['desk', 'chair', 'pc', 'printer', 'coffee', 'heater', 'fridge', 'shelf', 'router', 'ac', 'extinguisher'] as const;
const WALLS = ['back', 'left', 'right', 'front'] as const;
const CHANNELS = ['wall', 'floor', 'loose'] as const;
const ROTATIONS = [0, 90, 180, 270] as const;
const EXTINGUISHERS = ['co2', 'water', 'foam', 'powder'] as const;

function invalid(message: string): never { throw new LabAgentError('INVALID_INPUT', message); }
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
function pick<T extends string | number>(value: unknown, options: readonly T[], label: string): T {
  if (!options.includes(value as T)) invalid(`${label} is not a known value.`);
  return value as T;
}

function readItem(value: unknown, index: number): LabItemBrief {
  const f = record(value, `items[${index}]`), at = `items[${index}]`;
  return {
    id: text(f.id, `${at}.id`, ID_CHARS), name: text(f.name, `${at}.name`, 80), kind: pick(f.kind, KINDS, `${at}.kind`),
    x: finite(f.x, `${at}.x`, -50, 50), z: finite(f.z, `${at}.z`, -50, 50), w: finite(f.w, `${at}.w`, .05, 20), d: finite(f.d, `${at}.d`, .05, 20),
    rotation: pick(f.rotation, ROTATIONS, `${at}.rotation`), watts: finite(f.watts, `${at}.watts`, 0, 20_000), data: flag(f.data, `${at}.data`),
    socketId: f.socketId === null ? null : text(f.socketId, `${at}.socketId`, ID_CHARS), channel: pick(f.channel, CHANNELS, `${at}.channel`),
    ...(f.dataChannel === undefined ? {} : { dataChannel: pick(f.dataChannel, CHANNELS, `${at}.dataChannel`) }),
    ...(f.loadKg === undefined ? {} : { loadKg: finite(f.loadKg, `${at}.loadKg`, 0, 5000) }),
    ...(f.extinguisher === undefined ? {} : { extinguisher: pick(f.extinguisher, EXTINGUISHERS, `${at}.extinguisher`) }),
    locked: flag(f.locked, `${at}.locked`),
  };
}
function readSocket(value: unknown, index: number): LabSocketBrief {
  const s = record(value, `sockets[${index}]`), at = `sockets[${index}]`;
  return { id: text(s.id, `${at}.id`, ID_CHARS), name: text(s.name, `${at}.name`, 80), wall: pick(s.wall, WALLS, `${at}.wall`), x: finite(s.x, `${at}.x`, -50, 50), z: finite(s.z, `${at}.z`, -50, 50), circuit: text(s.circuit, `${at}.circuit`, ID_CHARS), breakerA: finite(s.breakerA, `${at}.breakerA`, 1, 100) };
}
function readLoad(value: unknown, label: string) {
  const l = record(value, label);
  return { id: text(l.id, `${label}.id`, ID_CHARS), name: text(l.name, `${label}.name`, 80), watts: finite(l.watts, `${label}.watts`, 0, 1_000_000), limitW: finite(l.limitW, `${label}.limitW`, 0, 1_000_000) };
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const NUM = '[\\d,]+';

function knownNames(situation: LabSituation): string[] {
  return [...situation.items.map(item => item.name), ...situation.sockets.map(socket => socket.name), ...situation.meters.circuits.map(circuit => circuit.name), ...situation.meters.sockets.map(socket => socket.name)];
}

export function isLabCheckProblem(problem: string, situation: LabSituation): boolean {
  if (LAB_FIXED_PROBLEMS.includes(problem) || problem.length > PROBLEM_CHARS) return true;
  const names = [...new Set(knownNames(situation))].sort((a, b) => b.length - a.length);
  if (!names.length) return false;
  const any = `(${names.map(escape).join('|')})`, loaded = `(${names.map(name => `${escape(name)} \\(over 80% loaded\\)`).join('|')}|${names.map(escape).join('|')})`;
  const materials = MATERIALS.map(material => escape(material.name)).join('|'), types = ['CO2', 'Water', 'Foam', 'Dry powder'].join('|');
  const patterns = [
    ...Object.values(LAB_NAMED_PROBLEMS).map(suffix => `${any}${escape(suffix)}`),
    `${any} sticks out of the room\\.`, `${any} overlaps ${any}\\.`,
    `${any} draws ${NUM} W but is not plugged into a socket\\.`, `${any} carries ${NUM} W, over its ${NUM} W limit\\.`, `${any} carries ${NUM} W, over its ${NUM} W breaker limit\\.`,
    `The room makes ${NUM} W of heat \\(devices plus \\d+ people at ${PERSON_HEAT_W} W\\), over the ${NUM} W the air conditioner removes\\.`,
    `${any} cannot be reached from the door by a ${escape(String(WALKWAY_M))} m wide route\\.`,
    `${any} has a loose (?:power|data) cable across a walking route to a seat\\.`,
    `${any} has a \\d+\\.\\d m loose (?:power|data) cable, over the ${escape(String(MAX_LOOSE_M))} m limit\\.`,
    `${any} runs power and data in the same under-floor cover\\.`,
    `${any} holds ${NUM} kg, over the \\d+ kg rating of (?:${materials})\\.`,
    `${any} is a (?:${types}) extinguisher \\d+\\.\\d m from ${loaded}\\. Use CO2 or Dry powder near live electrics\\.`,
    `${loaded} has no CO2 or Dry powder extinguisher within ${escape(String(RISK_EXTINGUISHER_M))} m\\.`,
    `No extinguisher within ${escape(String(DOOR_EXTINGUISHER_M))} m of the door\\.`,
  ];
  return patterns.some(pattern => new RegExp(`^${pattern}$`).test(problem));
}

function readSituation(value: unknown): LabSituation {
  const s = record(value, 'situation'), r = record(s.room, 'room'), m = record(s.meters, 'meters'), g = record(s.materials, 'materials');
  const items = list(s.items, 'items', MAX_LAB_ITEMS).map(readItem), sockets = list(s.sockets, 'sockets', MAX_SOCKETS).map(readSocket);
  if (new Set(items.map(item => item.id)).size !== items.length) invalid('items must not repeat ids.');
  if (new Set(sockets.map(socket => socket.id)).size !== sockets.length) invalid('sockets must not repeat ids.');
  const material = (value: unknown, group: string) => { const found = MATERIALS.find(each => each.id === value && each.group === group); if (!found) invalid(`materials.${group} is not a known material.`); return found.id; };
  if (!AIRCONS.some(each => each.id === s.acId)) invalid('acId is not a known air conditioner.');
  const meters = {
    sockets: list(m.sockets, 'meters.sockets', MAX_SOCKETS).map((load, index) => readLoad(load, `meters.sockets[${index}]`)),
    circuits: list(m.circuits, 'meters.circuits', MAX_CIRCUITS).map((load, index) => readLoad(load, `meters.circuits[${index}]`)),
    heatW: finite(m.heatW, 'meters.heatW', 0, 1_000_000), coolingW: finite(m.coolingW, 'meters.coolingW', 0, 1_000_000), people: finite(m.people, 'meters.people', 0, 1000),
    costGBP: finite(m.costGBP, 'meters.costGBP', 0, 100_000_000), carbonKg: finite(m.carbonKg, 'meters.carbonKg', 0, 100_000_000), cableM: finite(m.cableM, 'meters.cableM', 0, 100_000), looseM: finite(m.looseM, 'meters.looseM', 0, 100_000),
  };
  const situation: LabSituation = {
    room: { width: finite(r.width, 'room.width', 2, 30), depth: finite(r.depth, 'room.depth', 2, 30), height: finite(r.height, 'room.height', 1, 10), doorX: finite(r.doorX, 'room.doorX', -15, 15), doorWidth: finite(r.doorWidth, 'room.doorWidth', .6, 6) },
    sockets, items, materials: { desk: material(g.desk, 'desk'), shelf: material(g.shelf, 'shelf'), floor: material(g.floor, 'floor') }, acId: s.acId as string, meters, issues: [],
  };
  const ids = new Set(items.map(item => item.id));
  situation.issues = list(s.issues, 'issues', MAX_ISSUES).flatMap((value, index): LabIssueBrief[] => {
    const i = record(value, `issues[${index}]`), message = text(i.message, `issues[${index}].message`, PROBLEM_CHARS), rule = text(i.rule, `issues[${index}].rule`, 40);
    if (!RULES[rule] || !isLabCheckProblem(message, situation)) return [];
    return [{ rule, severity: pick(i.severity, ['error', 'warning'] as const, `issues[${index}].severity`), message, itemIds: list(i.itemIds, `issues[${index}].itemIds`, 20).map(id => text(id, `issues[${index}].itemIds[]`, ID_CHARS)).filter(id => ids.has(id)) }];
  });
  return situation;
}

function readPrevious(value: unknown, situation: LabSituation): LabPrevious | undefined {
  if (value === undefined || value === null) return undefined;
  const p = record(value, 'previous');
  const problems = list(p.problems, 'previous.problems', MAX_PROBLEMS).map((problem, index) => text(problem, `previous.problems[${index}]`, PROBLEM_CHARS));
  if (!problems.length) invalid('previous.problems must name at least one problem.');
  const checked = problems.filter(problem => isLabCheckProblem(problem, situation)), kept = checked.length ? checked : ['The previous proposal did not pass the checks.'];
  if (p.proposal === null) return { proposal: null, problems: kept };
  try { return { proposal: readLabProposal(p.proposal), problems: kept }; } catch { return invalid('previous.proposal must be a proposal.'); }
}

export function readLabAgentInput(data: unknown): LabAgentInput {
  const body = record(data, 'body');
  if (typeof body.request !== 'string' || !body.request.trim() || body.request.length > REQUEST_CHARS) throw new LabAgentError('INVALID_REQUEST', 'Describe what you want in up to 300 characters.');
  const situation = readSituation(body.situation), previous = readPrevious(body.previous, situation);
  return { request: body.request.trim(), situation, ...(previous ? { previous } : {}) };
}

export async function askLabModel(input: LabAgentInput, providers: Provider[], signal?: AbortSignal, deadlineMs = REQUEST_DEADLINE_MS): Promise<LabAnswer> {
  const user = labUserMessage(input.request, input.situation, input.previous);
  const deadline = AbortSignal.timeout(deadlineMs), ends = signal ? AbortSignal.any([signal, deadline]) : deadline;
  let completion: Awaited<ReturnType<Provider>> | undefined, refused = true;
  for (const [index, provider] of providers.entries()) {
    if (ends.aborted) break;
    const share = index < providers.length - 1 ? AbortSignal.any([ends, AbortSignal.timeout(Math.round(deadlineMs * PRIMARY_SHARE))]) : ends;
    try { completion = await provider(LAB_SYSTEM, user, share); break; }
    catch (error) { refused &&= error instanceof LayoutAgentError && error.code === 'PROVIDER' && !share.aborted; }
  }
  if (!completion) throw new LabAgentError(refused ? 'PROVIDER_REFUSED' : 'PROVIDER', 'The agent provider could not be reached.');
  return { proposal: parseLabProposal(completion.text), provider: completion.provider, model: completion.model };
}
