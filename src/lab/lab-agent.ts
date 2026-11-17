import type { Channel, LabDesign, LabIssue, LabItem, LabKind, LabReport, LabSocket, MaterialGroup, Rotation } from './model';
import { evaluate, footprint } from './checks';
import { cheapestWithin, lowestCarbon } from './optimise';
import { ELECTRICAL_SAFE, EXTINGUISHERS, AIRCONS, MATERIALS, RULES, SOCKET_LIMIT_W, VOLTS, aircon, material } from './rules';
import { piece } from './scenario';
import {
  LAB_NAMED_PROBLEMS, LabAgentError, MAX_CHANGES, MAX_LAB_ITEMS, WHY_WORDS, labSituation, readLabProposal,
  type AddKind, type LabChange, type LabGoal, type LabPrevious, type LabProposal, type LabSituation,
} from './lab-agent-prompt';

export type LabLayer = 'space' | 'power' | 'cables' | 'cooling' | 'materials' | 'fire';
export interface LabStep { id: string; title: string; why: string; numbers: string[]; rule?: string; tradeOff?: string; layer: LabLayer; itemIds: string[]; design: LabDesign }
export interface LabAgentRun {
  source: 'agent' | 'rules'; reply: string; steps: LabStep[]; attempts: number; rejected: string[][]; goals: string[]; limits: string[];
  provider?: string; model?: string; elapsedMs: number; note?: string; final: LabDesign; outcome: 'changed' | 'none' | 'declined';
}
export interface LabAgentOptions { signal?: AbortSignal; onAttempt?(attempt: number): void; fetcher?: typeof fetch }

export const MAX_ATTEMPTS = 3, DEADLINE_MS = 30_000, CALL_SHARE_MS = 18_000, CALL_WINDOW_MS = 8_000;

export const GOAL_RULES: Record<LabGoal, string[]> = {
  power: ['socket-load', 'circuit-load', 'socket-reach'],
  cooling: ['heat-balance'],
  cables: ['walkway-cable', 'loose-length', 'data-separation'],
  fire: ['extinguisher-type', 'extinguisher-reach', 'extinguisher-exit', 'egress'],
  cost: [],
  carbon: [],
  space: ['overlap', 'walkway-clear', 'shelf-load'],
};

const fmt = (value: number) => Math.round(value).toLocaleString('en-GB');
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const dist = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz);
const lower = (name: string) => /\d/.test(name) || /[A-Z]/.test(name.slice(1)) ? name : `the ${name.charAt(0).toLowerCase()}${name.slice(1)}`;
const words = (text: string) => text.trim().split(/\s+/).length;
const short = (text: string) => words(text) <= WHY_WORDS ? text : `${text.trim().split(/\s+/).slice(0, WHY_WORDS).join(' ').replace(/[,;:\s]+$/, '')}…`;
const errorsOf = (report: LabReport) => report.issues.filter(issue => issue.severity === 'error');

const NEW_PIECE: Record<AddKind, { id: string; name: string }> = {
  extinguisher: { id: 'ext', name: 'Extinguisher' }, heater: { id: 'heater', name: 'Heater' }, shelf: { id: 'shelf', name: 'Shelf' },
  fridge: { id: 'fridge', name: 'Fridge' }, printer: { id: 'printer', name: 'Printer' }, coffee: { id: 'coffee', name: 'Coffee machine' },
};

function nextPiece(design: LabDesign, kind: AddKind) {
  const base = NEW_PIECE[kind];
  let n = design.items.filter(item => item.kind === kind).length + 1;
  while (design.items.some(item => item.id === `${base.id}-${n}`)) n++;
  return { id: `${base.id}-${n}`, name: `${base.name} ${n}` };
}

function loadsWithout(design: LabDesign, itemId: string) {
  const bySocket = new Map<string, number>();
  for (const item of design.items) if (item.id !== itemId && item.socketId && item.watts > 0) bySocket.set(item.socketId, (bySocket.get(item.socketId) ?? 0) + item.watts);
  const byCircuit = new Map<string, number>();
  for (const socket of design.sockets) byCircuit.set(socket.circuitId, (byCircuit.get(socket.circuitId) ?? 0) + (bySocket.get(socket.id) ?? 0));
  return { bySocket, byCircuit };
}

export function pickSocket(design: LabDesign, itemId: string, watts: number, x: number, z: number): LabSocket | undefined {
  const { bySocket, byCircuit } = loadsWithout(design, itemId);
  return design.sockets
    .filter(socket => {
      const limit = (design.circuits.find(circuit => circuit.id === socket.circuitId)?.breakerA ?? 0) * VOLTS;
      return (bySocket.get(socket.id) ?? 0) + watts <= SOCKET_LIMIT_W && (byCircuit.get(socket.circuitId) ?? 0) + watts <= limit;
    })
    .map(socket => ({ socket, soft: (bySocket.get(socket.id) ?? 0) + watts <= 0.8 * SOCKET_LIMIT_W ? 0 : 1, gap: dist(socket.x, socket.z, x, z) }))
    .sort((a, b) => a.soft - b.soft || a.gap - b.gap)[0]?.socket;
}

export function applyChange(design: LabDesign, change: LabChange): LabDesign {
  const edit = (itemId: string, patch: Partial<LabItem>): LabDesign => design.items.some(item => item.id === itemId) ? { ...design, items: design.items.map(item => item.id === itemId ? { ...item, ...patch } : item) } : design;
  switch (change.type) {
    case 'move': return edit(change.itemId, { x: change.x, z: change.z, ...(change.rotation !== undefined ? { rotation: change.rotation } : {}) });
    case 'plug': return design.sockets.some(socket => socket.id === change.socketId) ? edit(change.itemId, { socketId: change.socketId }) : design;
    case 'channel': return edit(change.itemId, change.cable === 'power' ? { channel: change.channel } : { dataChannel: change.channel });
    case 'material': return material(change.materialId)?.group === change.group ? { ...design, materials: { ...design.materials, [change.group]: change.materialId } } : design;
    case 'aircon': return aircon(change.acId) ? { ...design, acId: change.acId } : design;
    case 'extinguisher': return edit(change.itemId, { extinguisher: change.extinguisher });
    case 'remove': return { ...design, items: design.items.filter(item => item.id !== change.itemId) };
    case 'add': {
      const { id, name } = nextPiece(design, change.kind);
      const fresh = piece({ id, name, kind: change.kind, x: change.x, z: change.z, ...(change.rotation !== undefined ? { rotation: change.rotation } : {}), ...(change.kind === 'extinguisher' ? { extinguisher: change.extinguisher ?? 'co2' } : {}) });
      const chosen = change.socketId && design.sockets.some(socket => socket.id === change.socketId) ? change.socketId : fresh.watts > 0 ? pickSocket(design, id, fresh.watts, fresh.x, fresh.z)?.id ?? null : null;
      return { ...design, items: [...design.items, { ...fresh, socketId: chosen }] };
    }
  }
}

const BLOCKED_REMOVAL: LabKind[] = ['desk', 'chair', 'ac'];

function structural(design: LabDesign, change: LabChange): string[] {
  const item = 'itemId' in change ? design.items.find(each => each.id === change.itemId) : undefined;
  const missing = 'itemId' in change && !item ? ['A change names a piece that is not in the office.'] : [];
  if (missing.length) return missing;
  if (item?.locked) return [`${item.name}${LAB_NAMED_PROBLEMS.locked}`];
  const { width, depth } = design.room;
  const inside = (box: { minX: number; maxX: number; minZ: number; maxZ: number }) => box.minX >= -width / 2 && box.maxX <= width / 2 && box.minZ >= -depth / 2 && box.maxZ <= depth / 2;
  switch (change.type) {
    case 'move': return inside(footprint({ ...item!, x: change.x, z: change.z, rotation: change.rotation ?? item!.rotation })) ? [] : [`${item!.name}${LAB_NAMED_PROBLEMS.outside}`];
    case 'plug': return [...(item!.watts > 0 ? [] : [`${item!.name}${LAB_NAMED_PROBLEMS.unpowered}`]), ...(design.sockets.some(socket => socket.id === change.socketId) ? [] : ['A change names a socket that is not in the office.'])];
    case 'channel': return change.cable === 'data' ? (item!.data ? [] : [`${item!.name}${LAB_NAMED_PROBLEMS.noData}`]) : (item!.watts > 0 || item!.kind === 'router' ? [] : [`${item!.name}${LAB_NAMED_PROBLEMS.unpowered}`]);
    case 'material': { const found = material(change.materialId); return !found ? ['A change names a material that is not in the catalogue.'] : found.group === change.group ? [] : ['A material does not belong to the group it was set for.']; }
    case 'aircon': return aircon(change.acId) ? [] : ['A change names an air conditioner that is not in the catalogue.'];
    case 'extinguisher': return item!.kind === 'extinguisher' ? [] : [`${item!.name}${LAB_NAMED_PROBLEMS.notExtinguisher}`];
    case 'remove': return BLOCKED_REMOVAL.includes(item!.kind) ? ['Desks, chairs and the air conditioner cannot be removed.'] : [];
    case 'add': {
      if (design.items.length >= MAX_LAB_ITEMS) return ['The office holds at most 60 pieces.'];
      const fresh = piece({ id: 'new', name: 'new', kind: change.kind, x: change.x, z: change.z, ...(change.rotation !== undefined ? { rotation: change.rotation } : {}) });
      return [...(inside(footprint(fresh)) ? [] : ['A new piece would be outside the room.']), ...(change.socketId && !design.sockets.some(socket => socket.id === change.socketId) ? ['A change names a socket that is not in the office.'] : [])];
    }
  }
}

export function goalsFor(request: string): LabGoal[] {
  const q = request.toLowerCase(), goals = new Set<LabGoal>();
  if (/power|socket|circuit|overload|plug|trip|breaker|extension|watt|amp\b/.test(q)) goals.add('power');
  if (/cool|heat|hot|warm|air.?con|\bac\b|temperature/.test(q)) goals.add('cooling');
  if (/cable|wire|\blead|trailing|loose|trunking|trip/.test(q)) goals.add('cables');
  if (/fire|extinguish|smoke|escape|exit/.test(q)) goals.add('fire');
  if (/cost|cheap|budget|price|save|afford|£/.test(q)) goals.add('cost');
  if (/carbon|co2|green|sustainab|emission|\beco/.test(q)) goals.add('carbon');
  if (/\bspace\b(?! heater)|layout|overlap|walkway|walking|clear|shelf|move|room/.test(q)) goals.add('space');
  if (/\b(everything|safe|safely|safety|fix|errors?|problems?|issues?|all)\b/.test(q)) for (const goal of ['power', 'cooling', 'cables', 'fire', 'space'] as LabGoal[]) goals.add(goal);
  return [...goals];
}

const LIMIT_TEXT: [RegExp, string][] = [
  [/fire (code|regulation|rating|certificate|safe|safety)|complian|regulation|legal|certif|building (code|control)|\bcode\b|approved|is it safe/, 'Fire code compliance cannot be judged here. The checks are simplified rules, not a fire risk assessment.'],
  [/nois|loud|acoustic|decibel|\bsound/, 'Noise is not modelled, so it cannot be judged here.'],
  [/(real|actual|current|market|exact) prices?|quotes?|supplier|pricing/, 'Prices are typical illustrative figures, not quotes.'],
  [/load.?bearing|structural|structure|ceiling|partition|wall strength/, 'Structure and load-bearing walls are not modelled.'],
  [/\blight(ing|s)?\b|lux|daylight|window|glare/, 'Lighting and windows are not modelled.'],
];
const isQuestion = (request: string) => /\?\s*$/.test(request.trim()) || /^\s*(is|are|does|do|can|could|how|what|why|will|would|should)\b/i.test(request);
export const limitsFor = (request: string): string[] => LIMIT_TEXT.filter(([pattern]) => pattern.test(request.toLowerCase())).map(([, text]) => text);

export interface Review { problems: string[]; design: LabDesign }

export function reviewProposal(design: LabDesign, proposal: LabProposal, before: LabReport = evaluate(design)): Review {
  const problems: string[] = [];
  if (proposal.changes.length > MAX_CHANGES) problems.push('Use at most 10 changes.');
  let current = design;
  for (const change of proposal.changes.slice(0, MAX_CHANGES)) {
    const found = structural(current, change);
    if (found.length) problems.push(...found); else current = applyChange(current, change);
  }
  if (same(current, design)) { if (!problems.length) problems.push('That changes nothing in the office.'); return { problems: [...new Set(problems)], design: current }; }
  const after = evaluate(current);
  const covered = new Set(proposal.goals.flatMap(goal => GOAL_RULES[goal])), was = errorsOf(before), now = errorsOf(after);
  for (const rule of new Set(now.map(issue => issue.rule))) {
    const left = now.filter(issue => issue.rule === rule), had = was.filter(issue => issue.rule === rule);
    if (covered.has(rule)) problems.push(...left.map(issue => issue.message));
    else if (left.length > had.length) {
      const fresh = left.filter(issue => !had.some(old => old.message === issue.message));
      problems.push(...(fresh.length ? fresh : left.slice(had.length)).map(issue => issue.message));
    }
  }
  return { problems: [...new Set(problems)], design: current };
}

const fmtOne = (value: number) => value.toFixed(1);
const countBy = (report: LabReport) => { const counts = new Map<string, number>(); for (const issue of report.issues) counts.set(issue.rule, (counts.get(issue.rule) ?? 0) + 1); return counts; };

export function labNumbers(before: LabReport, after: LabReport): string[] {
  const lines: string[] = [];
  for (const socket of after.meters.sockets) {
    const old = before.meters.sockets.find(each => each.socketId === socket.socketId);
    if (old && Math.round(old.watts) !== Math.round(socket.watts)) lines.push(`${socket.name}: ${fmt(old.watts)} → ${fmt(socket.watts)} W`);
  }
  for (const circuit of after.meters.circuits) {
    const old = before.meters.circuits.find(each => each.circuitId === circuit.circuitId);
    if (old && Math.round(old.watts) !== Math.round(circuit.watts)) lines.push(`${circuit.name}: ${fmt(old.watts)} → ${fmt(circuit.watts)} W`);
  }
  if (Math.round(before.meters.heatW) !== Math.round(after.meters.heatW)) lines.push(`Heat: ${fmt(before.meters.heatW)} → ${fmt(after.meters.heatW)} W`);
  if (Math.round(before.meters.coolingW) !== Math.round(after.meters.coolingW)) lines.push(`Cooling capacity: ${fmt(before.meters.coolingW)} → ${fmt(after.meters.coolingW)} W`);
  if (fmtOne(before.meters.looseM) !== fmtOne(after.meters.looseM)) lines.push(`Loose cable: ${fmtOne(before.meters.looseM)} → ${fmtOne(after.meters.looseM)} m`);
  const was = countBy(before), now = countBy(after);
  for (const rule of new Set([...was.keys(), ...now.keys()])) {
    const a = was.get(rule) ?? 0, b = now.get(rule) ?? 0;
    if (a !== b) lines.push(`${RULES[rule]?.title ?? rule} issues: ${a} → ${b}`);
  }
  if (Math.round(before.meters.costGBP) !== Math.round(after.meters.costGBP)) lines.push(`Cost: £${fmt(before.meters.costGBP)} → £${fmt(after.meters.costGBP)}`);
  if (Math.round(before.meters.carbonKg) !== Math.round(after.meters.carbonKg)) lines.push(`Carbon: ${fmt(before.meters.carbonKg)} → ${fmt(after.meters.carbonKg)} kg`);
  return lines;
}

const CABLE_WORD: Record<Channel, string> = { wall: 'in wall trunking', floor: 'under floor cover', loose: 'loose on the floor' };

function describe(design: LabDesign, change: LabChange, next: LabDesign): { title: string; layer: LabLayer; itemIds: string[] } {
  const named = (id: string) => lower((next.items.find(item => item.id === id) ?? design.items.find(item => item.id === id))?.name ?? id);
  switch (change.type) {
    case 'move': return { title: `Moved ${named(change.itemId)}`, layer: 'space', itemIds: [change.itemId] };
    case 'plug': return { title: `Moved ${named(change.itemId)} to ${design.sockets.find(socket => socket.id === change.socketId)?.name ?? change.socketId}`, layer: 'power', itemIds: [change.itemId] };
    case 'channel': return { title: `Ran ${named(change.itemId)}'s ${change.cable} cable ${CABLE_WORD[change.channel]}`, layer: 'cables', itemIds: [change.itemId] };
    case 'material': return { title: `Changed the ${change.group} material to ${material(change.materialId)?.name ?? change.materialId}`, layer: 'materials', itemIds: design.items.filter(item => item.kind === (change.group === 'desk' ? 'desk' : change.group === 'shelf' ? 'shelf' : '')).map(item => item.id) };
    case 'aircon': return { title: `Changed the air conditioner to the ${aircon(change.acId)?.name ?? change.acId}`, layer: 'cooling', itemIds: design.items.filter(item => item.kind === 'ac').map(item => item.id) };
    case 'extinguisher': return { title: `Changed ${named(change.itemId)} to ${EXTINGUISHERS[change.extinguisher].name}`, layer: 'fire', itemIds: [change.itemId] };
    case 'remove': return { title: `Removed ${named(change.itemId)}`, layer: 'space', itemIds: [change.itemId] };
    case 'add': {
      const added = next.items.find(item => !design.items.some(old => old.id === item.id));
      const plugged = added?.socketId ? `, plugged into ${next.sockets.find(socket => socket.id === added.socketId)?.name}` : '';
      return { title: `Added ${lower(added?.name ?? change.kind)}${plugged}`, layer: change.kind === 'extinguisher' ? 'fire' : 'space', itemIds: added ? [added.id] : [] };
    }
  }
}

export function buildSteps(design: LabDesign, changes: LabChange[]): { steps: LabStep[]; final: LabDesign } {
  const steps: LabStep[] = [];
  let current = design, report = evaluate(design);
  for (const change of changes) {
    const next = applyChange(current, change);
    if (same(next, current)) continue;
    const after = evaluate(next), was = countBy(report), now = countBy(after);
    const fixed = [...was.keys()].map(rule => ({ rule, gain: (was.get(rule) ?? 0) - (now.get(rule) ?? 0) })).filter(each => each.gain > 0).sort((a, b) => b.gain - a.gain)[0];
    const dCost = Math.round(after.meters.costGBP) - Math.round(report.meters.costGBP), dCarbon = Math.round(after.meters.carbonKg) - Math.round(report.meters.carbonKg);
    const described = describe(current, change, next);
    const tradeOff = [...(dCost > 0 ? [`+£${fmt(dCost)}`] : []), ...(dCarbon > 0 ? [`+${fmt(dCarbon)} kg carbon`] : [])].join(', ');
    steps.push({ id: `step-${steps.length + 1}`, title: described.title, why: change.why || `${described.title}.`, numbers: labNumbers(report, after), ...(fixed ? { rule: fixed.rule } : {}), ...(tradeOff ? { tradeOff } : {}), layer: described.layer, itemIds: described.itemIds, design: next });
    current = next; report = after;
  }
  return { steps, final: current };
}

function freeSpots(design: LabDesign, item: LabItem, around: [number, number], reach: number, rotation: Rotation = item.rotation, limit = 10): [number, number][] {
  const { width, depth } = design.room, others = design.items.filter(each => each.id !== item.id && each.kind !== 'ac' && each.kind !== 'router').map(footprint);
  const spots: [number, number, number][] = [];
  for (let x = -width / 2; x <= width / 2 + 1e-9; x += 0.25) for (let z = -depth / 2; z <= depth / 2 + 1e-9; z += 0.25) {
    const gap = dist(x, z, around[0], around[1]);
    if (gap > reach) continue;
    const box = footprint({ ...item, x, z, rotation });
    if (box.minX < -width / 2 || box.maxX > width / 2 || box.minZ < -depth / 2 || box.maxZ > depth / 2) continue;
    if (others.some(other => box.minX < other.maxX && other.minX < box.maxX && box.minZ < other.maxZ && other.minZ < box.maxZ)) continue;
    spots.push([x, z, gap]);
  }
  return spots.sort((a, b) => a[2] - b[2]).slice(0, limit).map(([x, z]) => [x, z]);
}

const wallRotation = (design: LabDesign, x: number, z: number): Rotation => {
  const edges: [number, Rotation][] = [[z + design.room.depth / 2, 0], [design.room.depth / 2 - z, 180], [x + design.room.width / 2, 90], [design.room.width / 2 - x, 270]];
  return edges.sort((a, b) => a[0] - b[0])[0][1];
};

const wasScoped = (report: LabReport, scope: Set<string>) => report.issues.filter(issue => scope.has(issue.rule)).length;
function improves(before: LabReport, after: LabReport, scope: Set<string>) {
  if (wasScoped(after, scope) >= wasScoped(before, scope)) return false;
  const was = countBy(errorCounts(before)), now = countBy(errorCounts(after));
  return [...now.entries()].every(([rule, count]) => scope.has(rule) || count <= (was.get(rule) ?? 0));
}
const errorCounts = (report: LabReport): LabReport => ({ ...report, issues: errorsOf(report) });

function socketAt(design: LabDesign, issue: LabIssue): [number, number] | undefined {
  const socket = design.sockets.find(each => issue.message.startsWith(`${each.name} (over`));
  if (socket) return [socket.x, socket.z];
  const item = design.items.find(each => each.id === issue.itemIds[0]);
  return item ? [item.x, item.z] : undefined;
}

function candidates(design: LabDesign, report: LabReport, issue: LabIssue): LabChange[] {
  const why = short(issue.message);
  const item = design.items.find(each => each.id === issue.itemIds[0]);
  switch (issue.rule) {
    case 'socket-load': case 'circuit-load': case 'socket-reach': {
      let users: LabItem[], excess = 0;
      if (issue.rule === 'socket-reach') users = item ? [item] : [];
      else if (issue.rule === 'socket-load') {
        const load = report.meters.sockets.find(each => issue.message.startsWith(`${each.name} `));
        users = design.items.filter(each => each.socketId === load?.socketId && each.watts > 0); excess = (load?.watts ?? 0) - (load?.limitW ?? 0);
      } else {
        const load = report.meters.circuits.find(each => issue.message.startsWith(`${each.name} `)), ids = new Set(design.sockets.filter(socket => socket.circuitId === load?.circuitId).map(socket => socket.id));
        users = design.items.filter(each => each.socketId && ids.has(each.socketId) && each.watts > 0); excess = (load?.watts ?? 0) - (load?.limitW ?? 0);
      }
      const order = [...users.filter(each => each.watts >= excess).sort((a, b) => a.watts - b.watts), ...users.filter(each => each.watts < excess).sort((a, b) => b.watts - a.watts)];
      return order.flatMap(each => { const socket = pickSocket(design, each.id, each.watts, each.x, each.z); return socket && socket.id !== each.socketId ? [{ type: 'plug' as const, itemId: each.id, socketId: socket.id, why: issue.rule === 'socket-reach' ? `${each.name} draws ${fmt(each.watts)} W with no socket, so it goes on ${socket.name}.` : why }] : []; });
    }
    case 'heat-balance': {
      const sorted = [...AIRCONS].sort((a, b) => a.coolingW - b.coolingW), pick = sorted.find(each => each.coolingW >= report.meters.heatW) ?? sorted[sorted.length - 1];
      return pick.id === design.acId ? [] : [{ type: 'aircon', acId: pick.id, why: `The room makes ${fmt(report.meters.heatW)} W of heat, over the ${fmt(report.meters.coolingW)} W cooling.` }];
    }
    case 'walkway-cable': case 'loose-length': {
      if (!item) return [];
      const cable = /data cable/.test(issue.message) ? 'data' : 'power';
      return (['wall', 'floor'] as Channel[]).map(channel => ({ type: 'channel' as const, itemId: item.id, cable, channel, why }));
    }
    case 'data-separation': return item ? [{ type: 'channel', itemId: item.id, cable: 'data', channel: 'wall', why }] : [];
    case 'shelf-load': {
      const need = Math.max(...design.items.filter(each => each.kind === 'shelf').map(each => each.loadKg ?? 0));
      return MATERIALS.filter(each => each.group === 'shelf' && (each.ratingKg ?? 0) >= need).sort((a, b) => a.costGBP - b.costGBP).map(each => ({ type: 'material' as const, group: 'shelf' as const, materialId: each.id, why }));
    }
    case 'extinguisher-type': return item ? [{ type: 'extinguisher', itemId: item.id, extinguisher: 'co2', why: `${item.name} is ${EXTINGUISHERS[item.extinguisher ?? 'co2'].name} near live electrics; CO2 is safe there.` }] : [];
    case 'extinguisher-reach': {
      const at = socketAt(design, issue);
      if (!at) return [];
      const swap = design.items.filter(each => each.kind === 'extinguisher' && !ELECTRICAL_SAFE.includes(each.extinguisher ?? 'co2') && dist(each.x, each.z, at[0], at[1]) <= 5).map(each => ({ type: 'extinguisher' as const, itemId: each.id, extinguisher: 'co2' as const, why }));
      const probe = piece({ id: 'probe', name: 'probe', kind: 'extinguisher', x: 0, z: 0 });
      return [...swap, ...freeSpots(design, probe, at, 4, 0).map(([x, z]) => ({ type: 'add' as const, kind: 'extinguisher' as const, x, z, rotation: wallRotation(design, x, z), extinguisher: 'co2' as const, why }))];
    }
    case 'extinguisher-exit': {
      const probe = piece({ id: 'probe', name: 'probe', kind: 'extinguisher', x: 0, z: 0 }), door: [number, number] = [design.room.door.x, design.room.depth / 2];
      return freeSpots(design, probe, door, 1.4, 0, 14).map(([x, z]) => ({ type: 'add' as const, kind: 'extinguisher' as const, x, z, rotation: wallRotation(design, x, z), extinguisher: 'co2' as const, why }));
    }
    case 'overlap': {
      const movable = issue.itemIds.map(id => design.items.find(each => each.id === id)).filter((each): each is LabItem => Boolean(each) && !each!.locked && each!.kind !== 'chair').reverse();
      return movable.flatMap(each => freeSpots(design, each, [each.x, each.z], 3.5).map(([x, z]) => ({ type: 'move' as const, itemId: each.id, x, z, why })));
    }
    default: return [];
  }
}

function fixScope(design: LabDesign, scope: Set<string>, max = 30): { design: LabDesign; changes: LabChange[] } {
  let current = design;
  const changes: LabChange[] = [], skipped = new Set<string>();
  for (let round = 0; round < max; round++) {
    const report = evaluate(current), target = report.issues.find(issue => scope.has(issue.rule) && !skipped.has(issue.message));
    if (!target) break;
    let done: { design: LabDesign; change: LabChange } | undefined;
    for (const change of candidates(current, report, target)) {
      const next = applyChange(current, change);
      if (!same(next, current) && improves(report, evaluate(next), scope)) { done = { design: next, change }; break; }
    }
    if (done) { current = done.design; changes.push(done.change); } else skipped.add(target.message);
  }
  return { design: current, changes };
}

const ADD_WORDS: [RegExp, AddKind][] = [[/space heater|heater/, 'heater'], [/printer/, 'printer'], [/coffee/, 'coffee'], [/fridge/, 'fridge'], [/shel(f|ves)/, 'shelf'], [/extinguisher/, 'extinguisher']];

function addPlan(design: LabDesign, request: string): LabChange | undefined {
  const q = request.toLowerCase(), kind = /\b(add|put|place|install|bring|get|need|want)\b/.test(q) ? ADD_WORDS.find(([pattern]) => pattern.test(q))?.[1] : undefined;
  if (!kind) return undefined;
  const { width, depth, door, vent } = design.room;
  const named = q.match(/\b(left|right|back|front)\b/)?.[1];
  const wallPoint: Record<string, [number, number]> = { left: [-width / 2, 0], right: [width / 2, 0], back: [0, -depth / 2], front: [door.x, depth / 2] };
  const around: [number, number] = named ? wallPoint[named] : /window/.test(q) ? (vent ? [vent.x, vent.z] : wallPoint.right) : /door/.test(q) ? wallPoint.front : [width / 2, 0];
  const base = piece({ id: 'probe', name: 'probe', kind, x: 0, z: 0 });
  const options: { x: number; z: number; rotation: Rotation; gap: number }[] = [];
  for (const rotation of [0, 90, 180, 270] as Rotation[]) {
    const half = footprint({ ...base, x: 0, z: 0, rotation }), hx = half.maxX, hz = half.maxZ;
    const spots: [number, number][] = [];
    for (let t = -width / 2; t <= width / 2; t += 0.25) { if (rotation === 0) spots.push([t, -depth / 2 + hz + 0.02]); if (rotation === 180) spots.push([t, depth / 2 - hz - 0.02]); }
    for (let t = -depth / 2; t <= depth / 2; t += 0.25) { if (rotation === 90) spots.push([-width / 2 + hx + 0.02, t]); if (rotation === 270) spots.push([width / 2 - hx - 0.02, t]); }
    for (const [x, z] of spots) options.push({ x, z, rotation, gap: dist(x, z, around[0], around[1]) });
  }
  const doorZone = (x: number, z: number) => Math.abs(x - door.x) < door.width / 2 + 0.4 && z > depth / 2 - 1.3;
  const before = evaluate(design), geometry = (report: LabReport) => report.issues.filter(issue => issue.rule === 'overlap' || issue.rule === 'walkway-clear').length;
  const roomy = options.filter(each => !doorZone(each.x, each.z)).sort((a, b) => a.gap - b.gap).filter(each => {
    const box = footprint({ ...base, x: each.x, z: each.z, rotation: each.rotation });
    return design.items.every(other => { if (other.kind === 'ac' || other.kind === 'router') return true; const o = footprint(other); return !(box.minX < o.maxX && o.minX < box.maxX && box.minZ < o.maxZ && o.minZ < box.maxZ); });
  });
  for (const each of roomy.slice(0, 12)) {
    const change: LabChange = { type: 'add', kind, x: each.x, z: each.z, rotation: each.rotation, ...(kind === 'extinguisher' ? { extinguisher: 'co2' as const } : {}), why: '' };
    const next = applyChange(design, change);
    if (geometry(evaluate(next)) > geometry(before)) continue;
    const added = next.items[next.items.length - 1], socket = next.sockets.find(each => each.id === added.socketId);
    return { ...change, why: short(`Adds the ${NEW_PIECE[kind].name.toLowerCase()} you asked for${socket ? `, on ${socket.name}` : ''}.`) };
  }
  return undefined;
}

function materialPlan(design: LabDesign, request: string): LabChange[] {
  const q = request.toLowerCase(), carbon = /carbon|co2|green|sustainab|emission|\beco/.test(q), cost = /cheap|cost|budget|save|afford|price/.test(q);
  if (!carbon && !cost) return [];
  const lowest = lowestCarbon(design), choice = carbon && cost ? cheapestWithin(design, lowest.carbonKg * 1.1) ?? lowest : carbon ? lowest : cheapestWithin(design, Infinity);
  if (!choice) return [];
  const changes: LabChange[] = [];
  let current = design;
  for (const group of ['desk', 'shelf', 'floor'] as MaterialGroup[]) {
    const id = choice.materials[group];
    if (id === current.materials[group]) continue;
    const next = applyChange(current, { type: 'material', group, materialId: id, why: '' }), a = evaluate(current).meters, b = evaluate(next).meters, name = material(id)?.name ?? id;
    const why = carbon ? (b.carbonKg < a.carbonKg ? `${name} ${group} cuts carbon by ${fmt(a.carbonKg - b.carbonKg)} kg.` : `${name} ${group} gives the lowest carbon with the shelf holding its load.`) : (b.costGBP < a.costGBP ? `${name} ${group} saves £${fmt(a.costGBP - b.costGBP)}.` : `${name} ${group} is the cheapest option that holds the shelf load.`);
    changes.push({ type: 'material', group, materialId: id, why: short(why) });
    current = next;
  }
  return changes;
}

export function rulesPlan(request: string, design: LabDesign): { changes: LabChange[]; goals: LabGoal[]; remaining: string[]; recognised: boolean } {
  const goals = goalsFor(request), changes: LabChange[] = [];
  let current = design;
  const add = addPlan(current, request);
  if (add) { changes.push(add); current = applyChange(current, add); }
  const materials = materialPlan(current, request);
  for (const change of materials) { changes.push(change); current = applyChange(current, change); }
  const scope = new Set((add ? (['power', 'cooling', 'cables', 'fire', 'space'] as LabGoal[]) : goals).flatMap(goal => GOAL_RULES[goal]));
  const fixed = fixScope(current, scope);
  changes.push(...fixed.changes);
  const remaining = evaluate(fixed.design).issues.filter(issue => scope.has(issue.rule) && issue.severity === 'error').map(issue => issue.message);
  return { changes, goals: add ? [...new Set<LabGoal>([...goals, 'power', 'cooling', 'fire'])] : goals, remaining, recognised: Boolean(add) || materials.length > 0 || goals.length > 0 };
}

export function runRules(request: string, design: LabDesign, began = Date.now(), extra: Partial<LabAgentRun> = {}): LabAgentRun {
  if (isQuestion(request)) {
    const found = evaluate(design).issues.filter(issue => issue.severity === 'error').map(issue => issue.message);
    const reply = found.length ? `The checks find ${found.length} ${found.length === 1 ? 'error' : 'errors'}: ${found.slice(0, 2).join(' ')} Ask me to fix them.` : 'The checks find no errors.';
    return { source: 'rules', reply, steps: [], attempts: 0, rejected: [], goals: goalsFor(request), limits: limitsFor(request), elapsedMs: Date.now() - began, final: design, outcome: 'declined', ...extra };
  }
  const plan = rulesPlan(request, design), { steps, final } = buildSteps(design, plan.changes), limits = limitsFor(request);
  const outcome: LabAgentRun['outcome'] = steps.length ? 'changed' : plan.recognised ? 'none' : 'declined';
  const tail = plan.remaining.length ? ` Still failing: ${plan.remaining.slice(0, 2).join(' ')}` : '';
  const reply = steps.length ? `Made ${steps.length} ${steps.length === 1 ? 'change' : 'changes'} with the built-in rules.${tail}` : plan.recognised ? 'The checks find nothing to change for that.' : 'The built-in rules can fix power, cooling, cables, fire and shelf errors, add a heater, printer, coffee machine, fridge, shelf or extinguisher, and switch materials for cost or carbon.';
  return { source: 'rules', reply, steps, attempts: 0, rejected: [], goals: plan.goals, limits, elapsedMs: Date.now() - began, final, outcome, ...extra };
}

class BadReply extends Error {}
export class LabHttpError extends Error { constructor(public status: number, public code: string | undefined) { super(`The lab agent endpoint answered ${status}.`); this.name = 'LabHttpError'; } }

async function askEndpoint(fetcher: typeof fetch, request: string, situation: LabSituation, previous: LabPrevious | undefined, signal: AbortSignal) {
  const response = await fetcher('/api/lab-agent', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request, situation, ...(previous ? { previous } : {}) }), signal });
  const data: unknown = await response.json().catch(() => null), body = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  if (!response.ok) {
    const code = body.error && typeof body.error === 'object' ? (body.error as Record<string, unknown>).code : undefined;
    if (code === 'LAB_AGENT_BAD_REPLY') throw new BadReply();
    throw new LabHttpError(response.status, typeof code === 'string' ? code : undefined);
  }
  if (typeof body.provider !== 'string' || typeof body.model !== 'string') throw new LabAgentError('INVALID_RESPONSE', 'Unreadable agent answer.');
  try { return { proposal: readLabProposal(body.proposal), provider: body.provider.slice(0, 80), model: body.model.slice(0, 80) }; }
  catch { throw new BadReply(); }
}

const stopped = (signal?: AbortSignal) => { if (signal?.aborted) throw signal.reason ?? new DOMException('Stopped.', 'AbortError'); };

export async function runLabAgent(request: string, design: LabDesign, opts: LabAgentOptions = {}): Promise<LabAgentRun> {
  const { signal, onAttempt, fetcher = (input, init) => fetch(input, init) } = opts;
  const began = Date.now(), text = request.trim().slice(0, 300), before = evaluate(design), situation = labSituation(design, before), asked = goalsFor(text);
  const timeout = AbortSignal.timeout(DEADLINE_MS);
  let previous: LabPrevious | undefined, last: Awaited<ReturnType<typeof askEndpoint>> | undefined, attempt = 1, lastProblems: string[] = [];
  const rejected: string[][] = [];
  const fallBack = (note: string) => runRules(text, design, began, { attempts: Math.min(attempt, MAX_ATTEMPTS), rejected, note, ...(last ? { provider: last.provider, model: last.model } : {}) });
  for (; attempt <= MAX_ATTEMPTS && Date.now() - began < DEADLINE_MS - CALL_WINDOW_MS; attempt++) {
    stopped(signal);
    onAttempt?.(attempt);
    const callTimeout = AbortSignal.timeout(Math.max(0, Math.min(CALL_SHARE_MS, DEADLINE_MS - (Date.now() - began))));
    const callSignal = AbortSignal.any([timeout, callTimeout, ...(signal ? [signal] : [])]);
    try { last = await askEndpoint(fetcher, text, situation, previous, callSignal); }
    catch (error) {
      stopped(signal);
      if (error instanceof BadReply) { lastProblems = ['The previous response was not valid JSON.']; rejected.push(lastProblems); previous = { proposal: null, problems: lastProblems }; continue; }
      return fallBack(error instanceof LabHttpError ? `The lab agent was unavailable (${error.status}), so the built-in rules answered.` : 'The lab agent did not answer in time, so the built-in rules answered.');
    }
    stopped(signal);
    const { proposal } = last, meta = { provider: last.provider, model: last.model, attempts: attempt, rejected: [...rejected], elapsedMs: Date.now() - began };
    const limits = proposal.limits ? [proposal.limits] : limitsFor(text);
    if (!proposal.changes.length) return { source: 'agent', reply: proposal.reply, steps: [], goals: proposal.goals, limits, final: design, outcome: limits.length || !proposal.goals.length ? 'declined' : 'none', ...meta };
    const review = reviewProposal(design, { ...proposal, goals: [...new Set([...proposal.goals, ...asked])] }, before);
    if (!review.problems.length) {
      const { steps, final } = buildSteps(design, proposal.changes);
      return { source: 'agent', reply: proposal.reply, steps, goals: proposal.goals, limits, final, outcome: steps.length ? 'changed' : 'none', ...meta, elapsedMs: Date.now() - began };
    }
    lastProblems = review.problems;
    rejected.push(lastProblems.slice(0, 3));
    previous = { proposal, problems: lastProblems.slice(0, 12).map(problem => problem.slice(0, 240)) };
  }
  attempt = Math.min(attempt, MAX_ATTEMPTS);
  return fallBack('The agent proposals did not pass the checks, so the built-in rules answered.');
}
