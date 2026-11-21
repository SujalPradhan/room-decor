import { openFloorArea } from './layout-explainer';
import { createFurnitureItem, distanceToPolygon, getFootprint, KINDS, kindsForSpace, MAX_ITEMS, spaceOf, usageFootprint, validateLayout } from './domain';
import { placeOf, type AgentAnswer, type AgentPrevious, type AgentSituation, type FurnitureBrief, type Proposal } from './layout-agent-prompt';
import type { FurnitureItem, ItemKind, Layout, PlacementIssue, Project, SpaceType } from './types';
import type { LayoutAgentResult } from './layout-agent-types';

/** The agent loop and every check it runs. This runs in the browser; the server only relays model calls. */
/** A piece the settling step carried far from where the model put it, which the person should hear about. */
interface Settled { id: string; note: string }
type Outcome = ({ action: 'rearrange'; layout: Layout; reasons: Record<string, string>; shorts: Record<string, string>; reply: string } | { action: 'use_layout'; layoutId: string; reply: string } | { action: 'decline'; reply: string }) & { goals?: Proposal['goals']; limits?: string };
/** What the checks make of one proposal: a result for the person, or the problems to send back to the model. */
export type Verdict = { outcome: Outcome; problems?: undefined } | { outcome?: undefined; problems: string[] };

/**
 * Milliseconds. The whole request ends within DEADLINE_MS, a demo-friendly wait. Each call is cut off at CALL_SHARE_MS
 * or the deadline, whichever comes first, so a hung call still leaves time for a retry, and no new attempt starts with less than CALL_WINDOW_MS left.
 */
export const MAX_ATTEMPTS = 3, DEADLINE_MS = 30_000, CALL_SHARE_MS = 18_000, CALL_WINDOW_MS = 8_000;
const MIN_FLOOR_GAIN = .05;
/** Search grid per space. Retail reaches twice as far at twice the step, so it costs the same as a bedroom. */
const SETTLE: Record<SpaceType, { reach: number; step: number }> = { room: { reach: 1.2, step: .1 }, retail: { reach: 2.4, step: .2 } };
/** Pairs further apart than this margin past their footprints and the reach cannot meet, even with an access zone. */
const SETTLE_MARGIN = 2;
/** Metres. The aisle a customer needs, the coarse flood-fill cell, how far a seat may sit from its station, and the settling distance worth telling the person about. */
const AISLE = 1.2, AISLE_CELL = .1, SEAT_REACH = 1, SETTLE_NOTE = 1;
const MUST_REACH: ItemKind[] = ['checkout-counter', 'testing-bar', 'consultation-station', 'service-cabin', 'skin-analyzer'];
const NO_CHECKOUT = /\b(check-?outs?|tills?|counters?|(remove|clear|delete|take out|get rid of)\s+(all|everything))\b/i;
const issueKey = (issue: PlacementIssue) => `${issue.code}:${issue.itemIds.join(':')}`;
const round = (value: number) => Math.round(value * 100) / 100;
const activeOf = (project: Project) => project.layouts.find(layout => layout.id === project.activeLayoutId)!;
function brief(item: FurnitureItem): FurnitureBrief {
  return { id: item.id, name: item.name, kind: item.kind, width: item.dimensions.width, depth: item.dimensions.depth, x: round(item.position.x), z: round(item.position.z), rotationDegrees: Math.round(item.rotation * 180 / Math.PI), color: item.color, locked: item.locked, visible: item.visible };
}
/** The situation the model sees, and the unrounded open floor of each layout for the fallback. */
export function prepareSituation(project: Project): { situation: AgentSituation; floors: Record<string, number> } {
  const active = activeOf(project), space = spaceOf(project), floors: Record<string, number> = {};
  for (const layout of project.layouts) floors[layout.id] = openFloorArea(layout, project.room);
  return { floors, situation: { space, room: { width: project.room.width, depth: project.room.depth, doorCentreX: project.room.door.offset, doorWidth: project.room.door.width }, activeLayout: active.name, wallColor: active.wallColor, accentColor: active.accentColor, catalogueKinds: kindsForSpace(space), largestOpenFloorM2: round(floors[active.id]), furniture: active.items.map(brief), savedLayouts: project.layouts.map(layout => ({ id: layout.id, name: layout.name, description: layout.description, largestOpenFloorM2: round(floors[layout.id]), active: layout.id === active.id })) } };
}
function applyChanges(active: Layout, proposal: Proposal, place: string): { layout: Layout; added: [string, string][] } {
  const added: [string, string][] = [];
  const items = active.items.filter(item => !proposal.removals.some(removal => removal.itemId === item.id)).map(item => {
    const move = proposal.moves.find(candidate => candidate.itemId === item.id), recolor = proposal.recolors.find(candidate => candidate.itemId === item.id);
    return { ...item, ...(move ? { position: { x: round(move.x), z: round(move.z) }, rotation: ((move.rotationDegrees % 360 + 360) % 360) * Math.PI / 180 } : {}), ...(recolor ? { color: recolor.color } : {}) };
  });
  for (const addition of proposal.additions) {
    const item = createFurnitureItem(addition.kind as ItemKind);
    items.push({ ...item, position: { x: round(addition.x), z: round(addition.z) }, rotation: ((addition.rotationDegrees % 360 + 360) % 360) * Math.PI / 180 });
    added.push([item.id, addition.reason]);
  }
  const layout = { ...structuredClone(active), id: `agent-${crypto.randomUUID()}`, name: proposal.name.trim().slice(0, 40) || 'Agent layout', description: proposal.description.trim().slice(0, 200) || `Arranged by the ${place} agent`, items, wallColor: proposal.wallColor || active.wallColor, accentColor: proposal.accentColor || active.accentColor };
  return { layout, added };
}
/** Offsets nearest first, so the search can stop at the first spot nothing further away could beat. order breaks score ties. */
function settleOffsets({ reach, step }: { reach: number; step: number }) {
  const offsets: { dx: number; dz: number; distance: number; order: number }[] = [];
  for (let dx = -reach; dx <= reach; dx += step) for (let dz = -reach; dz <= reach; dz += step) offsets.push({ dx, dz, distance: Math.hypot(dx, dz), order: offsets.length });
  return offsets.sort((a, b) => a.distance - b.distance);
}
const SETTLE_OFFSETS: Record<SpaceType, ReturnType<typeof settleOffsets>> = { room: settleOffsets(SETTLE.room), retail: settleOffsets(SETTLE.retail) };
/** Slides moved or added pieces to the nearest spot that adds no placement issue. The model estimates; the room decides. */
function settlePieces(layout: Layout, touched: string[], room: Project['room'], known: Set<string>, space: SpaceType): Layout {
  const fresh = (candidate: Layout) => validateLayout(candidate, room, space).filter(issue => !known.has(issueKey(issue)));
  const radius = (item: FurnitureItem) => Math.hypot(item.dimensions.width, item.dimensions.depth) / 2;
  const span = Math.hypot(SETTLE[space].reach, SETTLE[space].reach) + SETTLE_MARGIN;
  let settled = layout;
  for (const id of touched) {
    const issues = fresh(settled);
    if (!issues.some(issue => issue.itemIds.includes(id))) continue;
    const index = settled.items.findIndex(item => item.id === id), piece = settled.items[index], origin = piece.position;
    // Sliding this piece only changes issues that involve it, so only its neighbours are rechecked.
    const steady = issues.filter(issue => !issue.itemIds.includes(id)).length * 100;
    const nearby = settled.items.filter(item => Math.hypot(item.position.x - origin.x, item.position.z - origin.z) <= span + radius(item) + radius(piece));
    let best: FurnitureItem | null = null, bestScore = Infinity, bestOrder = Infinity;
    for (const { dx, dz, distance, order } of SETTLE_OFFSETS[space]) {
      if (steady + distance > bestScore) break;
      const moved = { ...piece, position: { x: round(origin.x + dx), z: round(origin.z + dz) } };
      const clashes = fresh({ ...settled, items: nearby.map(item => item.id === id ? moved : item) }).filter(issue => issue.itemIds.includes(id));
      const score = steady + clashes.length * 100 + distance;
      if (score < bestScore || (score === bestScore && order < bestOrder)) { best = moved; bestScore = score; bestOrder = order; }
    }
    if (best) settled = { ...settled, items: settled.items.map((item, i) => i === index ? best! : item) };
  }
  return settled;
}
/** Must-reach pieces a body AISLE wide cannot get to from the door, flooded on a grid that costs a few thousand cells. */
export function unreachable(layout: Layout, room: Project['room']): FurnitureItem[] {
  const body = AISLE / 2, columns = Math.round(room.width / AISLE_CELL), rows = Math.round(room.depth / AISLE_CELL);
  const cellX = (column: number) => -room.width / 2 + (column + .5) * AISLE_CELL, cellZ = (row: number) => -room.depth / 2 + (row + .5) * AISLE_CELL;
  const columnAt = (x: number) => Math.max(0, Math.min(columns - 1, Math.floor((x + room.width / 2) / AISLE_CELL))), rowAt = (z: number) => Math.max(0, Math.min(rows - 1, Math.floor((z + room.depth / 2) / AISLE_CELL)));
  /** Runs over the cells within the body's reach of a polygon. */
  const around = (polygon: { x: number; z: number }[], visit: (cell: number, distance: number) => void) => {
    const xs = polygon.map(point => point.x), zs = polygon.map(point => point.z);
    for (let row = rowAt(Math.min(...zs) - body); row <= rowAt(Math.max(...zs) + body); row++) for (let column = columnAt(Math.min(...xs) - body); column <= columnAt(Math.max(...xs) + body); column++) visit(row * columns + column, distanceToPolygon({ x: cellX(column), z: cellZ(row) }, polygon));
  };
  // Half a cell of slack means an aisle of exactly AISLE passes wherever the grid happens to fall.
  const clear = body - AISLE_CELL / 2, blocked = new Uint8Array(columns * rows), reached = new Uint8Array(columns * rows), queue: number[] = [];
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) if (Math.abs(cellX(column)) > room.width / 2 - clear + 1e-9 || Math.abs(cellZ(row)) > room.depth / 2 - clear + 1e-9) blocked[row * columns + column] = 1;
  const pieces = layout.items.filter(item => item.visible);
  for (const item of pieces) around(getFootprint(item), (cell, distance) => { if (distance < clear) blocked[cell] = 1; });
  // The frontmost row a body fits in, just inside the door.
  const doorRow = Math.floor((room.depth - clear) / AISLE_CELL - .5 + 1e-9);
  for (let column = columnAt(room.door.offset - room.door.width / 2); column <= columnAt(room.door.offset + room.door.width / 2); column++) {
    const cell = doorRow * columns + column;
    if (!blocked[cell]) { reached[cell] = 1; queue.push(cell); }
  }
  while (queue.length) {
    const cell = queue.pop()!, column = cell % columns;
    for (const next of [column > 0 ? cell - 1 : -1, column < columns - 1 ? cell + 1 : -1, cell - columns, cell + columns]) if (next >= 0 && next < reached.length && !blocked[next] && !reached[next]) { reached[next] = 1; queue.push(next); }
  }
  return pieces.filter(item => {
    if (!MUST_REACH.includes(item.kind)) return false;
    let reachable = false;
    // A body touching the access zone has arrived: a seat may fill the zone itself.
    around(usageFootprint(item)!, (cell, distance) => { reachable ||= Boolean(reached[cell]) && distance <= body; });
    return !reachable;
  });
}
const COLOR = /^#[a-f\d]{6}$/i;
const needsReason = (value: unknown) => typeof value !== 'string' || !value.trim();
/** Everything the agent proposes passes these checks; the model's own claims are not trusted. */
export function reviewMoves(project: Project, active: Layout, proposal: Proposal, request = ''): { layout: Layout; added: [string, string][]; problems: string[]; floor: number; settled: Settled[] } {
  const problems: string[] = [], { room } = project, space = spaceOf(project), place = placeOf(space), spaceKinds = kindsForSpace(space);
  const colourChange = Boolean(proposal.wallColor || proposal.accentColor);
  if (!proposal.moves.length && !proposal.removals.length && !proposal.recolors.length && !proposal.additions.length && !colourChange) problems.push('No changes were given.');
  if ([proposal.moves, proposal.removals, proposal.recolors, proposal.additions].some(changes => changes.length > 7)) problems.push('Use at most 7 changes per list.');
  const findItem = (id: unknown) => {
    const item = active.items.find(candidate => candidate.id === id);
    if (!item) problems.push(`Unknown piece "${String(id).slice(0, 40)}".`);
    else if (item.locked) problems.push(`${item.name} is locked and cannot change.`);
    return item;
  };
  const moved = new Set<string>(), removed = new Set<string>(), recoloured = new Set<string>();
  for (const move of proposal.moves) {
    const item = findItem(move?.itemId);
    if (!item) continue;
    if (moved.has(item.id)) problems.push(`${item.name} was moved twice.`);
    moved.add(item.id);
    if (![move.x, move.z].every(Number.isFinite) || ![0, 90, 180, 270].includes(move.rotationDegrees)) problems.push(`${item.name} needs a numeric position and a rotation of 0, 90, 180 or 270.`);
    if (needsReason(move.reason)) problems.push(`${item.name} needs a reason.`);
  }
  for (const removal of proposal.removals) {
    const item = findItem(removal?.itemId);
    if (!item) continue;
    if (moved.has(item.id)) problems.push(`${item.name} cannot be both moved and removed.`);
    removed.add(item.id);
    if (needsReason(removal.reason)) problems.push(`${item.name} needs a reason.`);
  }
  for (const recolor of proposal.recolors) {
    const item = findItem(recolor?.itemId);
    if (!item) continue;
    if (removed.has(item.id)) problems.push(`${item.name} cannot be both recoloured and removed.`);
    if (recoloured.has(item.id)) problems.push(`${item.name} was recoloured twice.`);
    recoloured.add(item.id);
    if (!COLOR.test(String(recolor.color))) problems.push(`${item.name} needs a #rrggbb colour.`);
    if (needsReason(recolor.reason)) problems.push(`${item.name} needs a reason.`);
  }
  for (const addition of proposal.additions) {
    if (!KINDS.includes(addition?.kind as ItemKind)) { problems.push(`"${String(addition?.kind).slice(0, 40)}" is not in the catalogue.`); continue; }
    if (!spaceKinds.includes(addition.kind as ItemKind)) { problems.push(`A ${addition.kind} does not belong in a ${place}. Use one of: ${spaceKinds.join(', ')}.`); continue; }
    if (![addition.x, addition.z].every(Number.isFinite) || ![0, 90, 180, 270].includes(addition.rotationDegrees)) problems.push(`The new ${addition.kind} needs a numeric position and a rotation of 0, 90, 180 or 270.`);
    if (needsReason(addition.reason)) problems.push(`The new ${addition.kind} needs a reason.`);
  }
  for (const value of [proposal.wallColor, proposal.accentColor]) if (value && !COLOR.test(value)) problems.push('Wall colours must be #rrggbb.');
  if (colourChange && !proposal.colorReason.trim()) problems.push('The colour change needs a reason.');
  if (problems.length) return { layout: active, added: [], problems, floor: openFloorArea(active, room), settled: [] };
  const known = new Set(validateLayout(active, room, space).map(issueKey)), applied = applyChanges(active, proposal, place), { added } = applied;
  const layout = settlePieces(applied.layout, [...moved, ...added.map(([id]) => id)], room, known, space), floor = openFloorArea(layout, room);
  if (layout.items.length > MAX_ITEMS) problems.push(`A ${place} holds at most ${MAX_ITEMS} pieces.`);
  const placed = new Set([...moved, ...added.map(([id]) => id)]);
  for (const item of layout.items) if (placed.has(item.id) && item.visible && getFootprint(item).some(point => Math.abs(point.x) > room.width / 2 || Math.abs(point.z) > room.depth / 2)) problems.push(`${item.name} is outside the ${place}.`);
  for (const issue of validateLayout(layout, room, space)) if (!known.has(issueKey(issue))) problems.push(issue.message);
  const settled: Settled[] = [];
  if (space === 'retail') {
    const stranded = new Set(unreachable(active, room).map(item => item.id));
    for (const item of unreachable(layout, room)) if (!stranded.has(item.id)) problems.push(`${item.name} cannot be reached from the door by a ${AISLE} m wide aisle.`);
    const stations = (items: FurnitureItem[]) => items.filter(item => item.kind === 'consultation-station'), apart = (a: FurnitureItem, b: FurnitureItem) => Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z);
    for (const seat of layout.items.filter(item => item.kind === 'chair' || item.kind === 'stool')) {
      const before = active.items.find(item => item.id === seat.id);
      if (!before || !(/consult/i.test(before.name) || stations(active.items).some(station => apart(station, before) <= SEAT_REACH))) continue;
      if ((placed.has(seat.id) || stations(layout.items).some(station => placed.has(station.id))) && !stations(layout.items).some(station => apart(station, seat) <= SEAT_REACH)) problems.push(`${seat.name} must stay within ${SEAT_REACH} m of a consultation station.`);
    }
    const counter = (items: FurnitureItem[]) => items.some(item => item.kind === 'checkout-counter' && item.visible);
    if (counter(active.items) && !counter(layout.items) && !NO_CHECKOUT.test(request)) problems.push('The store needs a checkout counter unless the person asks to remove it.');
    for (const item of layout.items) {
      const proposed = applied.layout.items.find(candidate => candidate.id === item.id);
      if (proposed && placed.has(item.id) && Math.hypot(item.position.x - proposed.position.x, item.position.z - proposed.position.z) > SETTLE_NOTE) settled.push({ id: item.id, note: `${item.name} landed ${Math.hypot(item.position.x - proposed.position.x, item.position.z - proposed.position.z).toFixed(1)} m from the planned spot to keep it clear.` });
    }
  }
  const gap = (item: FurnitureItem) => Math.min(room.width / 2 - Math.abs(item.position.x), room.depth / 2 - Math.abs(item.position.z));
  const desks = space === 'room' ? layout.items.filter(item => item.kind === 'desk') : [];
  for (const chair of layout.items.filter(item => item.kind === 'chair')) {
    if (!desks.length || (!placed.has(chair.id) && !desks.some(desk => placed.has(desk.id)))) continue;
    const distance = (desk: FurnitureItem) => Math.hypot(desk.position.x - chair.position.x, desk.position.z - chair.position.z);
    const desk = [...desks].sort((a, b) => distance(a) - distance(b))[0];
    if (distance(desk) > 1) problems.push('The chair must stay at the desk.');
    else if (gap(chair) < gap(desk)) problems.push('The chair must sit on the room side of the desk, not between the desk and the wall.');
  }
  if (JSON.stringify([layout.items, layout.wallColor, layout.accentColor]) === JSON.stringify([active.items, active.wallColor, active.accentColor])) problems.push(`That changes nothing in the ${place}.`);
  const start = openFloorArea(active, room);
  if (proposal.goal === 'more_open_floor' && floor < start + (proposal.removals.length ? 0 : MIN_FLOOR_GAIN)) problems.push(`Largest open floor would be ${round(floor)} m², not more than the current ${round(start)} m².`);
  return { layout, added, problems, floor, settled };
}

/** Removals are always stated, even when the model's reply leaves them out. */
function withRemovals(proposal: Proposal, active: Layout): string {
  const names = active.items.filter(item => proposal.removals.some(removal => removal.itemId === item.id)).map(item => item.name);
  const unsaid = names.filter(name => !proposal.reply.toLowerCase().includes(name.toLowerCase().split(' ').pop()!));
  return unsaid.length ? `${proposal.reply} Removed: ${unsaid.join(', ')}.` : proposal.reply;
}
function agentReasons(proposal: Proposal, added: [string, string][], settled: Settled[] = []): Record<string, string> {
  const reasons: Record<string, string> = {};
  for (const [id, reason] of [...[...proposal.moves, ...proposal.recolors, ...proposal.removals].map(change => [change.itemId, change.reason]), ...added]) reasons[id] = `${reasons[id] ? `${reasons[id]} ` : ''}${reason.trim()}`.slice(0, 220);
  for (const { id, note } of settled) reasons[id] = `${(reasons[id] ?? '').slice(0, 219 - note.length)} ${note}`.trim();
  if (proposal.colorReason.trim()) reasons.finish = proposal.colorReason.trim().slice(0, 220);
  return reasons;
}
function agentShorts(proposal: Proposal, added: [string, string][]): Record<string, string> {
  const shorts: Record<string, string> = {};
  for (const change of [...proposal.moves, ...proposal.recolors, ...proposal.removals]) if (change.why && !shorts[change.itemId]) shorts[change.itemId] = change.why;
  proposal.additions.forEach((addition, index) => { if (addition.why && added[index]) shorts[added[index][0]] = addition.why; });
  if (proposal.colorWhy) shorts.finish = proposal.colorWhy;
  return shorts;
}
/** One attempt's checks. This is the only heavy step, so it is what a Web Worker runs. */
export function judgeProposal(project: Project, request: string, proposal: Proposal): Verdict {
  const reading = { goals: spaceOf(project) === 'retail' ? proposal.goals : [], limits: proposal.limits.trim() };
  if (proposal.action === 'decline') return { outcome: { action: 'decline', reply: proposal.reply, ...reading } };
  if (proposal.action === 'use_layout') return project.layouts.some(layout => layout.id === proposal.layoutId) ? { outcome: { action: 'use_layout', layoutId: proposal.layoutId, reply: proposal.reply, ...reading } } : { problems: [`No saved layout has the id "${proposal.layoutId.slice(0, 40)}".`] };
  const active = activeOf(project), review = reviewMoves(project, active, proposal, request);
  if (review.problems.length) return { problems: review.problems };
  return { outcome: { action: 'rearrange', layout: review.layout, reasons: agentReasons(proposal, review.added, review.settled), shorts: agentShorts(proposal, review.added), reply: [withRemovals(proposal, active), ...review.settled.map(({ note }) => note)].join(' '), ...reading } };
}

/** Thrown by ask when the model answered but its reply could not be read; that attempt is fed back, not failed over. */
export class AgentReplyError extends Error { constructor() { super('The model reply could not be read.'); this.name = 'AgentReplyError'; } }
export interface AgentLoop {
  /** One model call. The signal ends at Stop or the deadline. */
  ask(situation: AgentSituation, previous: AgentPrevious | undefined, signal: AbortSignal): Promise<AgentAnswer>;
  judge(proposal: Proposal): Verdict | Promise<Verdict>;
  signal?: AbortSignal;
  onAttempt?: (attempt: number) => void;
  deadlineMs?: number;
  /** No new attempt starts with less time than this left. */
  callWindowMs?: number;
  /** The longest one call may take. */
  callShareMs?: number;
}
const stopped = (signal?: AbortSignal) => { if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException('Stopped.', 'AbortError'); };
/** Asks, checks and feeds the problems back, up to MAX_ATTEMPTS. A more-open-floor request falls back to the roomiest saved layout. */
export async function runAgentLoop(request: string, project: Project, prepared: ReturnType<typeof prepareSituation>, loop: AgentLoop): Promise<LayoutAgentResult> {
  const { situation, floors } = prepared, active = activeOf(project), began = Date.now(), place = placeOf(spaceOf(project));
  const deadline = loop.deadlineMs ?? DEADLINE_MS, window = loop.callWindowMs ?? CALL_WINDOW_MS, share = loop.callShareMs ?? CALL_SHARE_MS, timeout = AbortSignal.timeout(deadline);
  let previous: AgentPrevious | undefined, last: AgentAnswer | undefined, lastProblems: string[] = [], wantsFloor = false, attempt = 1;
  const rejected: string[][] = [];
  for (; attempt <= MAX_ATTEMPTS && Date.now() - began < deadline - window; attempt++) {
    stopped(loop.signal);
    loop.onAttempt?.(attempt);
    const callTimeout = AbortSignal.timeout(Math.max(0, Math.min(share, deadline - (Date.now() - began))));
    const callSignal = AbortSignal.any([timeout, callTimeout, ...(loop.signal ? [loop.signal] : [])]);
    try { last = await loop.ask(situation, previous, callSignal); }
    catch (error) {
      stopped(loop.signal);
      if (error instanceof AgentReplyError) { lastProblems = ['The previous response was not valid JSON.']; rejected.push(lastProblems); previous = { proposal: null, problems: lastProblems }; continue; }
      // Out of time after the checks rejected a try: answer from what was learned. Any other failure, such as the
      // endpoint answering 429 or 5xx, goes back to the app, which answers with its rules in plain words.
      if ((timeout.aborted || callTimeout.aborted) && lastProblems.length) break;
      throw error;
    }
    stopped(loop.signal);
    const meta = { provider: last.provider, model: last.model, attempts: attempt, rejected: [...rejected] };
    wantsFloor ||= last.proposal.goal === 'more_open_floor';
    const verdict = await loop.judge(last.proposal);
    stopped(loop.signal);
    if (verdict.outcome) return { ...verdict.outcome, ...meta, elapsedMs: Date.now() - began };
    lastProblems = verdict.problems;
    rejected.push(lastProblems.slice(0, 3));
    previous = { proposal: last.proposal, problems: lastProblems.slice(0, 12).map(problem => problem.slice(0, 240)) };
  }
  const attempts = Math.min(attempt, MAX_ATTEMPTS), meta = { provider: last?.provider ?? 'none', model: last?.model ?? 'none', attempts, rejected, elapsedMs: Date.now() - began };
  const spacious = project.layouts.filter(layout => layout.id !== active.id).sort((a, b) => floors[b.id] - floors[a.id])[0];
  if (wantsFloor && spacious && floors[spacious.id] >= floors[active.id] + MIN_FLOOR_GAIN) return { action: 'use_layout', layoutId: spacious.id, reply: `${spacious.name} has the most open floor of your saved layouts: ${round(floors[spacious.id])} m².`, ...meta };
  return { action: 'decline', reply: `I could not find an arrangement that passes the ${place} checks. ${lastProblems[0] ?? ''}`.trim(), ...meta };
}
