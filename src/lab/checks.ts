import type { CablePath, CircuitLoad, LabDesign, LabIssue, LabItem, LabMeters, LabReport, Severity, SocketLoad } from './model';
import { CHANNELS, DOOR_EXTINGUISHER_M, ELECTRICAL_SAFE, EXTINGUISHERS, MAX_LOOSE_M, PERSON_HEAT_W, RISK_EXTINGUISHER_M, RULES, SOCKET_LIMIT_W, VOLTS, WALKWAY_M, aircon, material } from './rules';
import { distance, footprint, routeCables, type Box, type Point } from './route';

export { footprint } from './route';

const EPS = 1e-9;
const CELL = 0.1;
const GOAL_REACH_M = 0.3;
const SAMPLE_M = 0.05;
const FREE_START_M = 0.6;
const HEAVY_SOCKET = 0.8;

const fmt = (value: number) => Math.round(value).toLocaleString('en-GB');
const safeNames = ELECTRICAL_SAFE.map(type => EXTINGUISHERS[type].name).join(' or ');

function issue(rule: string, message: string, itemIds: string[], severity: Severity = 'error'): LabIssue {
  return { rule: RULES[rule].id, severity, message, itemIds };
}

class MinHeap {
  private keys: number[] = [];
  private values: number[] = [];

  get size() { return this.keys.length; }

  private before(a: number, b: number) {
    return this.keys[a] < this.keys[b] || (this.keys[a] === this.keys[b] && this.values[a] < this.values[b]);
  }

  private swap(a: number, b: number) {
    [this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]];
    [this.values[a], this.values[b]] = [this.values[b], this.values[a]];
  }

  push(key: number, value: number) {
    this.keys.push(key);
    this.values.push(value);
    let at = this.keys.length - 1;
    while (at > 0 && this.before(at, (at - 1) >> 1)) {
      this.swap(at, (at - 1) >> 1);
      at = (at - 1) >> 1;
    }
  }

  pop(): [number, number] {
    const top: [number, number] = [this.keys[0], this.values[0]];
    const lastKey = this.keys.pop() as number;
    const lastValue = this.values.pop() as number;
    if (this.keys.length) {
      this.keys[0] = lastKey;
      this.values[0] = lastValue;
      this.sink();
    }
    return top;
  }

  private sink() {
    let at = 0;
    for (;;) {
      const left = at * 2 + 1;
      const right = left + 1;
      let next = at;
      if (left < this.keys.length && this.before(left, next)) next = left;
      if (right < this.keys.length && this.before(right, next)) next = right;
      if (next === at) return;
      this.swap(at, next);
      at = next;
    }
  }
}

export function shortestPaths(size: number, sources: number[], edges: (from: number, visit: (to: number, cost: number) => void) => void) {
  const dist = new Float64Array(size).fill(Infinity);
  const prev = new Int32Array(size).fill(-1);
  const heap = new MinHeap();
  for (const source of sources) {
    dist[source] = 0;
    heap.push(0, source);
  }
  while (heap.size) {
    const [d, from] = heap.pop();
    if (d > dist[from]) continue;
    edges(from, (to, cost) => {
      if (d + cost < dist[to]) {
        dist[to] = d + cost;
        prev[to] = from;
        heap.push(d + cost, to);
      }
    });
  }
  return { dist, prev };
}

const gapToBox = (box: Box, x: number, z: number) => Math.hypot(Math.max(box.minX - x, 0, x - box.maxX), Math.max(box.minZ - z, 0, z - box.maxZ));

export function walkGrid(design: LabDesign) {
  const { width, depth } = design.room;
  const cols = Math.round(width / CELL);
  const rows = Math.round(depth / CELL);
  const reach = WALKWAY_M / 2;
  const boxes = design.items.filter(item => item.kind !== 'chair' && item.kind !== 'extinguisher').map(footprint);
  const centre = (index: number): [number, number] => [-width / 2 + ((index % cols) + 0.5) * CELL, -depth / 2 + (Math.floor(index / cols) + 0.5) * CELL];
  const toCell = (x: number, z: number) => {
    const col = Math.floor((x + width / 2) / CELL);
    const row = Math.floor((z + depth / 2) / CELL);
    return col < 0 || row < 0 || col >= cols || row >= rows ? -1 : row * cols + col;
  };
  const free = new Uint8Array(cols * rows);
  for (let index = 0; index < free.length; index++) {
    const [x, z] = centre(index);
    const inside = Math.abs(x) <= width / 2 - reach + EPS && Math.abs(z) <= depth / 2 - reach + EPS;
    free[index] = inside && boxes.every(box => gapToBox(box, x, z) >= reach - EPS) ? 1 : 0;
  }
  return { cell: CELL, cols, rows, free, toCell, centre };
}

type Grid = ReturnType<typeof walkGrid>;
interface DoorField { grid: Grid; dist: Float64Array; prev: Int32Array; door: Point }

function entryCells(design: LabDesign, grid: Grid): number[] {
  const { room } = design;
  const row = Math.floor(grid.toCell(room.door.x, room.depth / 2 - WALKWAY_M / 2) / grid.cols) * grid.cols;
  const cells: number[] = [];
  for (let col = 0; col < grid.cols; col++) {
    const index = row + col;
    const [x] = grid.centre(index);
    if (grid.free[index] && Math.abs(x - room.door.x) <= room.door.width / 2) cells.push(index);
  }
  return cells;
}

const NEIGHBOURS: [number, number, number][] = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];

function doorField(design: LabDesign): DoorField {
  const grid = walkGrid(design);
  const { cols, rows, free } = grid;
  const { dist, prev } = shortestPaths(cols * rows, entryCells(design, grid), (from, visit) => {
    const col = from % cols;
    const row = Math.floor(from / cols);
    for (const [dc, dr, cost] of NEIGHBOURS) {
      const c = col + dc;
      const r = row + dr;
      if (c >= 0 && r >= 0 && c < cols && r < rows && free[r * cols + c]) visit(r * cols + c, cost * CELL);
    }
  });
  return { grid, dist, prev, door: [design.room.door.x, design.room.depth / 2] };
}

function routeTo(field: DoorField, item: LabItem): Point[] | null {
  const box = footprint(item);
  let goal = -1;
  for (let index = 0; index < field.dist.length; index++) {
    const [x, z] = field.grid.centre(index);
    if (field.dist[index] < Infinity && gapToBox(box, x, z) <= GOAL_REACH_M && (goal < 0 || field.dist[index] < field.dist[goal])) goal = index;
  }
  if (goal < 0) return null;
  const cells: number[] = [];
  for (let at = goal; at >= 0; at = field.prev[at]) cells.push(at);
  return [field.door, ...cells.reverse().map(index => field.grid.centre(index))];
}

export function routeFromDoor(design: LabDesign, itemId: string): [number, number][] | null {
  const item = design.items.find(each => each.id === itemId);
  return item ? routeTo(doorField(design), item) : null;
}

function socketLoads(design: LabDesign): SocketLoad[] {
  return design.sockets.map(socket => {
    const users = design.items.filter(item => item.socketId === socket.id && item.watts > 0);
    return { socketId: socket.id, name: socket.name, watts: users.reduce((sum, item) => sum + item.watts, 0), limitW: SOCKET_LIMIT_W, itemIds: users.map(item => item.id) };
  });
}

function circuitLoads(design: LabDesign, sockets: SocketLoad[]): CircuitLoad[] {
  return design.circuits.map(circuit => {
    const watts = design.sockets.filter(socket => socket.circuitId === circuit.id).reduce((sum, socket) => sum + (sockets.find(load => load.socketId === socket.id)?.watts ?? 0), 0);
    return { circuitId: circuit.id, name: circuit.name, watts, limitW: circuit.breakerA * VOLTS };
  });
}

function overlapIssues(design: LabDesign): LabIssue[] {
  const { width, depth } = design.room;
  const issues: LabIssue[] = [];
  for (const item of design.items) {
    const box = footprint(item);
    if (box.minX < -width / 2 - EPS || box.maxX > width / 2 + EPS || box.minZ < -depth / 2 - EPS || box.maxZ > depth / 2 + EPS) issues.push(issue('overlap', `${item.name} sticks out of the room.`, [item.id]));
  }
  const onFloor = design.items.filter(item => item.kind !== 'ac' && item.kind !== 'router');
  onFloor.forEach((a, i) => onFloor.slice(i + 1).forEach(b => {
    const p = footprint(a);
    const q = footprint(b);
    if (p.minX < q.maxX - EPS && q.minX < p.maxX - EPS && p.minZ < q.maxZ - EPS && q.minZ < p.maxZ - EPS) issues.push(issue('overlap', `${a.name} overlaps ${b.name}.`, [a.id, b.id]));
  }));
  return issues;
}

function socketIssues(design: LabDesign, sockets: SocketLoad[], circuits: CircuitLoad[]): LabIssue[] {
  const unplugged = design.items.filter(item => item.watts > 0 && !design.sockets.some(socket => socket.id === item.socketId));
  return [
    ...unplugged.map(item => issue('socket-reach', `${item.name} draws ${fmt(item.watts)} W but is not plugged into a socket.`, [item.id])),
    ...sockets.filter(load => load.watts > load.limitW).map(load => issue('socket-load', `${load.name} carries ${fmt(load.watts)} W, over its ${fmt(load.limitW)} W limit.`, load.itemIds)),
    ...circuits.filter(load => load.watts > load.limitW).map(load => issue('circuit-load', `${load.name} carries ${fmt(load.watts)} W, over its ${fmt(load.limitW)} W breaker limit.`, [])),
  ];
}

function heatIssues(heatW: number, coolingW: number, people: number): LabIssue[] {
  if (heatW <= coolingW) return [];
  return [issue('heat-balance', `The room makes ${fmt(heatW)} W of heat (devices plus ${people} people at ${PERSON_HEAT_W} W), over the ${fmt(coolingW)} W the air conditioner removes.`, [])];
}

function lengthIssues(cables: CablePath[], design: LabDesign): LabIssue[] {
  const name = (id: string) => design.items.find(item => item.id === id)?.name ?? id;
  return cables.filter(each => each.channel === 'loose' && each.length > MAX_LOOSE_M)
    .map(each => issue('loose-length', `${name(each.itemId)} has a ${each.length.toFixed(1)} m loose ${each.kind} cable, over the ${MAX_LOOSE_M} m limit.`, [each.itemId], 'warning'));
}

function separationIssues(design: LabDesign, cables: CablePath[]): LabIssue[] {
  return design.items.filter(item => cables.some(each => each.itemId === item.id && each.kind === 'power' && each.channel === 'floor') && item.data && (item.dataChannel ?? 'wall') === 'floor')
    .map(item => issue('data-separation', `${item.name} runs power and data in the same under-floor cover.`, [item.id]));
}

function shelfIssues(design: LabDesign): LabIssue[] {
  const rating = material(design.materials.shelf);
  if (!rating?.ratingKg) return [];
  return design.items.filter(item => item.kind === 'shelf' && (item.loadKg ?? 0) > (rating.ratingKg as number))
    .map(item => issue('shelf-load', `${item.name} holds ${fmt(item.loadKg ?? 0)} kg, over the ${rating.ratingKg} kg rating of ${rating.name}.`, [item.id]));
}

interface Risk { label: string; at: Point; itemIds: string[] }

function fireRisks(design: LabDesign, sockets: SocketLoad[]): Risk[] {
  const devices = design.items.filter(item => item.kind === 'heater' || item.kind === 'coffee' || item.kind === 'printer')
    .map((item): Risk => ({ label: item.name, at: [item.x, item.z], itemIds: [item.id] }));
  const busy = sockets.filter(load => load.watts > HEAVY_SOCKET * SOCKET_LIMIT_W).flatMap(load => {
    const socket = design.sockets.find(each => each.id === load.socketId);
    return socket ? [{ label: `${load.name} (over ${HEAVY_SOCKET * 100}% loaded)`, at: [socket.x, socket.z] as Point, itemIds: load.itemIds }] : [];
  });
  return [...devices, ...busy];
}

function extinguisherIssues(design: LabDesign, risks: Risk[]): LabIssue[] {
  const all = design.items.filter(item => item.kind === 'extinguisher');
  const typeOf = (item: LabItem) => item.extinguisher ?? 'co2';
  const safe = all.filter(item => ELECTRICAL_SAFE.includes(typeOf(item)));
  const issues: LabIssue[] = [];
  for (const item of all.filter(each => !ELECTRICAL_SAFE.includes(typeOf(each)))) {
    const near = risks.filter(risk => distance([item.x, item.z], risk.at) <= RISK_EXTINGUISHER_M).sort((a, b) => distance([item.x, item.z], a.at) - distance([item.x, item.z], b.at))[0];
    if (near) issues.push(issue('extinguisher-type', `${item.name} is a ${EXTINGUISHERS[typeOf(item)].name} extinguisher ${distance([item.x, item.z], near.at).toFixed(1)} m from ${near.label}. Use ${safeNames} near live electrics.`, [item.id, ...near.itemIds]));
  }
  for (const risk of risks.filter(each => !safe.some(item => distance([item.x, item.z], each.at) <= RISK_EXTINGUISHER_M))) {
    issues.push(issue('extinguisher-reach', `${risk.label} has no ${safeNames} extinguisher within ${RISK_EXTINGUISHER_M} m.`, risk.itemIds));
  }
  const door: Point = [design.room.door.x, design.room.depth / 2];
  if (!all.some(item => distance([item.x, item.z], door) <= DOOR_EXTINGUISHER_M)) issues.push(issue('extinguisher-exit', `No extinguisher within ${DOOR_EXTINGUISHER_M} m of the door.`, [], 'warning'));
  return issues;
}

function walkIssues(design: LabDesign, cables: CablePath[]): LabIssue[] {
  const field = doorField(design);
  const chairs = design.items.filter(item => item.kind === 'chair');
  const routes = chairs.map(chair => ({ chair, route: routeTo(field, chair) }));
  const issues = routes.filter(each => !each.route).map(each => issue('walkway-clear', `${each.chair.name} cannot be reached from the door by a ${WALKWAY_M} m wide route.`, [each.chair.id]));
  const busy = new Set<number>();
  const { cols, rows } = field.grid;
  for (const { route } of routes) for (const [x, z] of route ?? []) {
    const index = field.grid.toCell(x, z);
    if (index < 0) continue;
    for (const [dc, dr] of [[0, 0], ...NEIGHBOURS]) {
      const c = (index % cols) + dc;
      const r = Math.floor(index / cols) + dr;
      if (c >= 0 && r >= 0 && c < cols && r < rows) busy.add(r * cols + c);
    }
  }
  const name = (id: string) => design.items.find(item => item.id === id)?.name ?? id;
  const onFloor = (one: CablePath): CablePath | null => one.channel === 'loose' ? one : one.channel === 'wall' ? { ...one, points: one.points.slice(0, 2) } : null;
  for (const each of cables.filter(one => { const part = onFloor(one); return part !== null && crosses(part, field.grid, busy); })) {
    issues.push(issue('walkway-cable', `${name(each.itemId)} has a loose ${each.kind} cable across a walking route to a seat.`, [each.itemId]));
  }
  return issues;
}

function crosses(cable: CablePath, grid: Grid, busy: Set<number>): boolean {
  let travelled = 0;
  for (let i = 1; i < cable.points.length; i++) {
    const [a, b] = [cable.points[i - 1], cable.points[i]];
    const run = distance(a, b);
    const steps = Math.max(1, Math.ceil(run / SAMPLE_M));
    for (let step = 0; step <= steps; step++) {
      if (travelled + (run * step) / steps < FREE_START_M) continue;
      const t = step / steps;
      if (busy.has(grid.toCell(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))) return true;
    }
    travelled += run;
  }
  return false;
}

function buildCost(design: LabDesign, cables: CablePath[]) {
  const count = (kind: string) => design.items.filter(item => item.kind === kind).length;
  const area = design.room.width * design.room.depth;
  const parts = [
    { quantity: count('desk'), unit: material(design.materials.desk) },
    { quantity: count('shelf'), unit: material(design.materials.shelf) },
    { quantity: area, unit: material(design.materials.floor) },
  ];
  let costGBP = parts.reduce((sum, part) => sum + part.quantity * (part.unit?.costGBP ?? 0), 0);
  let carbonKg = parts.reduce((sum, part) => sum + part.quantity * (part.unit?.carbonKg ?? 0), 0);
  const cooler = aircon(design.acId);
  costGBP += cooler?.costGBP ?? 0;
  carbonKg += cooler?.carbonKg ?? 0;
  for (const each of cables) {
    costGBP += each.length * CHANNELS[each.channel].costPerM;
    carbonKg += each.length * CHANNELS[each.channel].carbonPerM;
  }
  for (const item of design.items.filter(each => each.kind === 'extinguisher')) {
    const type = EXTINGUISHERS[item.extinguisher ?? 'co2'];
    costGBP += type.costGBP;
    carbonKg += type.carbonKg;
  }
  return { costGBP: Math.round(costGBP), carbonKg: Math.round(carbonKg) };
}

export function evaluate(design: LabDesign): LabReport {
  const cables = routeCables(design);
  const sockets = socketLoads(design);
  const circuits = circuitLoads(design, sockets);
  const people = design.items.reduce((sum, item) => sum + (item.seats ?? 0), 0);
  const heatW = design.items.reduce((sum, item) => sum + item.watts, 0) + PERSON_HEAT_W * people;
  const coolingW = aircon(design.acId)?.coolingW ?? 0;
  const meters: LabMeters = {
    sockets, circuits, heatW, coolingW, people,
    ...buildCost(design, cables),
    cableM: cables.reduce((sum, each) => sum + each.length, 0),
    looseM: cables.filter(each => each.channel === 'loose').reduce((sum, each) => sum + each.length, 0),
  };
  const issues = [
    ...overlapIssues(design),
    ...socketIssues(design, sockets, circuits),
    ...heatIssues(heatW, coolingW, people),
    ...walkIssues(design, cables),
    ...lengthIssues(cables, design),
    ...separationIssues(design, cables),
    ...shelfIssues(design),
    ...extinguisherIssues(design, fireRisks(design, sockets)),
  ];
  return { issues, meters, cables };
}

export function describe(report: LabReport): string[] {
  const { meters } = report;
  const short = (name: string) => name.replace(/\s*\(.*\)$/, '');
  return [
    ...meters.circuits.map(load => `${short(load.name)} ${fmt(load.watts)} / ${fmt(load.limitW)} W`),
    ...meters.sockets.map(load => `${short(load.name)} ${fmt(load.watts)} / ${fmt(load.limitW)} W`),
    `Heat ${fmt(meters.heatW)} / ${fmt(meters.coolingW)} W cooling`,
    `${meters.people} people`,
    `Cost £${fmt(meters.costGBP)}`,
    `Carbon ${fmt(meters.carbonKg)} kg`,
    `Cables ${meters.cableM.toFixed(1)} m, ${meters.looseM.toFixed(1)} m loose`,
  ];
}
