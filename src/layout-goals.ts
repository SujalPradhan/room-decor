import { distanceToPolygon, getFootprint, usageFootprint } from './domain';
import type { LayoutGoal } from './layout-agent-prompt';
import type { FurnitureItem, ItemKind, Layout, Position, RoomSpec, SpaceType } from './types';

export { LAYOUT_GOALS, type LayoutGoal } from './layout-agent-prompt';
export interface StoreMeasures {
  aisle: number;
  displays: number;
  displayArea: number;
  reachable: number;
  walkable: number;
  walkToDisplay: number;
  onRoute: number;
  walkToCheckout: number;
  queueSpace: number;
}
export interface GoalDetail { label: string; heading: string; note: string }

const PRODUCT_KINDS: ItemKind[] = ['shelf', 'wall-display', 'display-table', 'fragrance-tower', 'hero-plinth', 'testing-bar', 'gift-station'];
const AISLE = 1.2, WHEELCHAIR_AISLE = 1.5, CELL = .2, STAND = .6, GLANCE = 1.5, QUEUE = 3;

export const GOALS: Record<LayoutGoal, GoalDetail> = {
  sales: { label: 'For sales', heading: 'Toward more sales', note: 'Sales measures here are layout signs a floor manager watches (displays on the way to checkout, displays within reach, walk to products, display count). They are not a sales forecast.' },
  browse: { label: 'For browsing', heading: 'Toward easier browsing', note: 'Browsing is measured as walkable aisle floor and displays a shopper can reach from the door through a 1.2 m aisle.' },
  find: { label: 'For finding products', heading: 'Toward finding products faster', note: 'Finding products is measured as the average walk from the door to each display a shopper can reach.' },
  stock: { label: 'For stock', heading: 'Toward holding more stock', note: 'Stock is measured as product fixtures and the floor they stand on, a proxy for capacity rather than a unit count.' },
  checkout: { label: 'For checkout', heading: 'Toward a quicker checkout', note: 'Checkout is measured as the walk from the door to the counter and the clear floor within 3 m of it where a queue can stand. Queue times are not measured.' },
  access: { label: 'For access', heading: 'Toward step-free access', note: 'Access is measured with a 1.5 m aisle, room for a wheelchair or pram, from the door. It is not a building code check.' },
};
const ASKED: [LayoutGoal, RegExp][] = [
  ['sales', /\b(sales?|sell|selling|revenue|conversion|convert|basket|spend|profit\w*|buy more|purchases?)\b/],
  ['browse', /\b(browse|browsing|freely|flow|circulation|aisles?|move around|walk around)\b/],
  ['find', /\b(find|finding|locate|locating|wayfinding|navigat\w*|time to (find|reach)|lost)\b/],
  ['stock', /\b(inventory|stock|capacity|hold more|more (products|merchandise|items|skus?)|assortment)\b/],
  ['checkout', /\b(queues?|queuing|queueing|checkouts?|check-out|tills?|pay (faster|quicker|sooner)|waiting to pay)\b/],
  ['access', /\b(wheelchairs?|accessib\w*|mobility|prams?|strollers?|buggy|buggies|disabled|disabilit\w*|ada|step-free)\b/],
];
const LIMITS: [RegExp, string][] = [
  [/\b(theft|shoplift\w*|shrink\w*|security|sightlines?|cctv|cameras?)\b/, 'Theft and staff sightlines are not measured: the plan has no staff or camera positions.'],
  [/\b(premium|luxur\w*|vibe|mood|brand\w*|aesthetic\w*|beautiful|stylish|elegant|instagram\w*)\b/, 'How the store feels is a judgement, not a measure, so changes are explained only by what can be measured.'],
  [/\b(footfall|foot traffic|visitor (data|counts?)|heat ?maps?|traffic data)\b/, 'Footfall data is not connected, so every route assumes a shopper walks in at the door and takes the shortest way.'],
  [/\b(skus?|sell-?through|stock levels?|inventory (data|system|levels?|counts?))\b/, 'Inventory data is not connected, so stock is estimated from display fixtures, not units.'],
  [/\b(sales (data|figures|numbers)|forecast\w*|predict\w*|by how much|roi)\b|\d+ ?(%|percent)/, 'No sales figures are connected, so no change in sales numbers is forecast.'],
  [/\b(dwell|stay longer|time (spent|in store))\b/, 'Time spent in the store is not measured; the closest measure is how many displays sit on the way to checkout.'],
  [/\b(staff\w*|employees?|associates?|rota)\b/, 'Staffing is outside the floor plan.'],
  [/\b(lighting|lights?|music|sound|scent|smell|temperature|air ?con\w*)\b/, 'Lighting, sound, scent and temperature are not part of the plan.'],
  [/\b(prices?|pricing|discounts?|promotions?|promos?|sale price)\b/, 'Prices and promotions are outside the floor plan.'],
  [/\b(fire|evacuat\w*|emergency|building code|regulations?|complian\w*|legal)\b/, 'Fire and building code compliance is not checked; only 1.2 m aisles and the door clearance are.'],
  [/^(?!.*\b(paint\w*|colou?r\w*)\b).*\b(walls?|mezzanine|second floor|upstairs|extension|knock through)\b/, 'Walls and the building itself cannot change; only fixtures move.'],
];
const OTHER_AIMS = /\b(space|spacious|room|clutter\w*|cramped|crowded|open|airy|events?|launch\w*|workshops?|discover\w*|journey|guided|test\w*|try|trial|sample|consult\w*|advice|appointments?|original|reset|paint|colou?rs?)\b/;

export function goalsOf(request: string | undefined, space: SpaceType | undefined): LayoutGoal[] {
  if (space !== 'retail' || !request) return [];
  const text = request.toLowerCase();
  return ASKED.filter(([, words]) => words.test(text)).map(([goal]) => goal);
}
export function limitsOf(request: string | undefined, space: SpaceType | undefined, goals: LayoutGoal[] = goalsOf(request, space)): string[] {
  if (space !== 'retail' || !request) return [];
  const text = request.toLowerCase(), limits = LIMITS.filter(([words]) => words.test(text)).map(([, limit]) => limit);
  if (!goals.length && !limits.length && !OTHER_AIMS.test(text) && /\b(better|improve\w*|optimi[sz]e\w*|nicer|best|good|work)\b/.test(text)) limits.push('No single measure fits a general request. Name what should improve: sales, browsing, finding products, stock, checkout queues or wheelchair access.');
  return limits;
}
export const aisleFor = (goal: LayoutGoal) => goal === 'access' ? WHEELCHAIR_AISLE : AISLE;

function pushHeap(heap: number[][], entry: number[]) {
  heap.push(entry);
  for (let i = heap.length - 1; i > 0;) { const parent = (i - 1) >> 1; if (heap[parent][0] <= heap[i][0]) break; [heap[parent], heap[i]] = [heap[i], heap[parent]]; i = parent; }
}
function popHeap(heap: number[][]): number[] {
  const top = heap[0], last = heap.pop()!;
  if (heap.length) {
    heap[0] = last;
    for (let i = 0; ;) {
      const left = i * 2 + 1, right = left + 1;
      let small = i;
      if (left < heap.length && heap[left][0] < heap[small][0]) small = left;
      if (right < heap.length && heap[right][0] < heap[small][0]) small = right;
      if (small === i) break;
      [heap[small], heap[i]] = [heap[i], heap[small]]; i = small;
    }
  }
  return top;
}

export function measureStore(layout: Layout, room: RoomSpec, aisle = AISLE): StoreMeasures {
  const columns = Math.round(room.width / CELL), rows = Math.round(room.depth / CELL), body = aisle / 2, clear = body - CELL / 2;
  const cellX = (column: number) => -room.width / 2 + (column + .5) * CELL, cellZ = (row: number) => -room.depth / 2 + (row + .5) * CELL;
  const columnAt = (x: number) => Math.max(0, Math.min(columns - 1, Math.floor((x + room.width / 2) / CELL))), rowAt = (z: number) => Math.max(0, Math.min(rows - 1, Math.floor((z + room.depth / 2) / CELL)));
  const around = (polygon: Position[], reach: number, visit: (cell: number, distance: number) => void) => {
    const xs = polygon.map(point => point.x), zs = polygon.map(point => point.z);
    for (let row = rowAt(Math.min(...zs) - reach); row <= rowAt(Math.max(...zs) + reach); row++) for (let column = columnAt(Math.min(...xs) - reach); column <= columnAt(Math.max(...xs) + reach); column++) visit(row * columns + column, distanceToPolygon({ x: cellX(column), z: cellZ(row) }, polygon));
  };
  const blocked = new Uint8Array(columns * rows);
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) if (Math.abs(cellX(column)) > room.width / 2 - clear + 1e-9 || Math.abs(cellZ(row)) > room.depth / 2 - clear + 1e-9) blocked[row * columns + column] = 1;
  const pieces = layout.items.filter(item => item.visible);
  for (const item of pieces) around(getFootprint(item), clear, (cell, distance) => { if (distance < clear) blocked[cell] = 1; });
  const distance = new Float64Array(columns * rows).fill(Infinity), from = new Int32Array(columns * rows).fill(-1), heap: number[][] = [];
  const doorRow = Math.floor((room.depth - clear) / CELL - .5 + 1e-9);
  for (let column = columnAt(room.door.offset - room.door.width / 2); column <= columnAt(room.door.offset + room.door.width / 2); column++) {
    const cell = doorRow * columns + column;
    const offset = Math.abs(cellX(column) - room.door.offset);
    if (!blocked[cell]) { distance[cell] = offset; pushHeap(heap, [offset, cell]); }
  }
  const steps = [[-1, 0, 1], [1, 0, 1], [0, -1, 1], [0, 1, 1], [-1, -1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [1, 1, Math.SQRT2]];
  while (heap.length) {
    const [d, cell] = popHeap(heap);
    if (d > distance[cell]) continue;
    const column = cell % columns, row = (cell - column) / columns;
    for (const [dx, dz, cost] of steps) {
      const c = column + dx, r = row + dz;
      if (c < 0 || c >= columns || r < 0 || r >= rows) continue;
      const next = r * columns + c;
      if (blocked[next] || (dx && dz && (blocked[row * columns + c] || blocked[r * columns + column]))) continue;
      const nd = d + cost * CELL;
      if (nd < distance[next]) { distance[next] = nd; from[next] = cell; pushHeap(heap, [nd, next]); }
    }
  }
  let walkableCells = 0;
  for (const d of distance) if (d < Infinity) walkableCells++;
  const nearest = (item: FurnitureItem) => {
    let best = -1;
    const zone = usageFootprint(item);
    const visit = (cell: number, gap: number, reach: number) => { if (gap <= reach && distance[cell] < Infinity && (best < 0 || distance[cell] < distance[best])) best = cell; };
    if (zone) around(zone, body, (cell, gap) => visit(cell, gap, body));
    else around(getFootprint(item), body + STAND, (cell, gap) => visit(cell, gap, body + STAND));
    return best;
  };
  const displays = pieces.filter(item => PRODUCT_KINDS.includes(item.kind)), reach = displays.map(nearest).filter(cell => cell >= 0);
  const counters = pieces.filter(item => item.kind === 'checkout-counter'), checkout = counters.map(nearest).filter(cell => cell >= 0).sort((a, b) => distance[a] - distance[b])[0];
  let queueSpace = NaN;
  if (counters.length) {
    const queue = new Set<number>();
    for (const counter of counters) around(usageFootprint(counter)!, QUEUE, (cell, gap) => { if (gap <= QUEUE && distance[cell] < Infinity) queue.add(cell); });
    queueSpace = queue.size * CELL * CELL;
  }
  let onRoute = NaN;
  if (checkout !== undefined) {
    const route: Position[] = [];
    for (let cell = checkout; cell >= 0; cell = from[cell]) route.push({ x: cellX(cell % columns), z: cellZ(Math.floor(cell / columns)) });
    onRoute = displays.filter(item => { const footprint = getFootprint(item); return route.some(point => distanceToPolygon(point, footprint) <= GLANCE); }).length;
  }
  return {
    aisle,
    displays: displays.length,
    displayArea: displays.reduce((sum, item) => sum + item.dimensions.width * item.dimensions.depth, 0),
    reachable: reach.length,
    walkable: walkableCells * CELL * CELL,
    walkToDisplay: reach.length ? reach.reduce((sum, cell) => sum + distance[cell], 0) / reach.length : NaN,
    onRoute,
    walkToCheckout: checkout === undefined ? NaN : distance[checkout],
    queueSpace,
  };
}

const one = (value: number) => Number(value.toFixed(1)).toString();
const displaysWord = (n: number) => `${n} ${n === 1 ? 'display' : 'displays'}`;
type Lever = { change(before: StoreMeasures, after: StoreMeasures): string | undefined; line(before: StoreMeasures, after: StoreMeasures): [string, string] | undefined; name: string };
const counted = (key: 'onRoute' | 'reachable' | 'displays', name: string, more: string, fewer: string, line: string): Lever => ({
  name,
  change(before, after) {
    const a = before[key], b = after[key];
    if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return undefined;
    return `${b > a ? more.replace('#', displaysWord(b - a)) : fewer.replace('#', displaysWord(a - b))} (${a} → ${b}).`;
  },
  line(before, after) { const a = before[key], b = after[key]; return Number.isFinite(a) && Number.isFinite(b) ? [line, `${a} → ${b}`] : undefined; },
});
const LEVERS = {
  onRoute: counted('onRoute', 'displays on the way to checkout', 'Puts # more on the shortest walk from the door to checkout, so shoppers pass more products before they pay', 'Takes # off the shortest walk from the door to checkout, so shoppers pass fewer products before they pay', 'Displays on the way to checkout'),
  reachable: {
    name: 'displays within reach',
    change(before, after) {
      const a = before.reachable, b = after.reachable, wide = after.aisle >= WHEELCHAIR_AISLE;
      if (a === b) return undefined;
      return b > a ? `Opens a ${after.aisle} m aisle from the door to ${displaysWord(b - a)} more, so ${wide ? 'a wheelchair or pram can reach them' : 'shoppers can pick from them without squeezing past fixtures'} (${a} → ${b}).` : `Leaves ${displaysWord(a - b)} without a ${after.aisle} m aisle from the door, so ${wide ? 'a wheelchair or pram cannot reach them' : 'shoppers have to squeeze past fixtures to pick from them'} (${a} → ${b}).`;
    },
    line(before, after) { return [after.aisle >= WHEELCHAIR_AISLE ? `Displays within reach of a ${after.aisle} m aisle` : 'Displays within reach', `${before.reachable} → ${after.reachable}`]; },
  },
  displays: counted('displays', 'display count', 'Adds #, so the store holds and shows more products', 'Removes #, so the store holds and shows fewer products', 'Product displays'),
  walk: {
    name: 'walk to products',
    change(before, after) {
      const a = before.walkToDisplay, b = after.walkToDisplay;
      if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(b - a) < .2) return undefined;
      return b < a ? `Shortens the average walk from the door to a display from ${one(a)} to ${one(b)} m, so shoppers reach products sooner.` : `Lengthens the average walk from the door to a display from ${one(a)} to ${one(b)} m, so shoppers take longer to reach products.`;
    },
    line(before, after) { return Number.isFinite(before.walkToDisplay) && Number.isFinite(after.walkToDisplay) ? ['Average walk to a display', `${one(before.walkToDisplay)} → ${one(after.walkToDisplay)} m`] : undefined; },
  },
  walkable: {
    name: 'walkable aisle floor',
    change(before, after) {
      const a = before.walkable, b = after.walkable;
      if (Math.abs(b - a) < .5) return undefined;
      const who = after.aisle >= WHEELCHAIR_AISLE ? 'a wheelchair or pram can use' : 'a shopper can walk';
      return b > a ? `Adds ${one(b - a)} m² of aisle ${who} (${one(a)} → ${one(b)} m²), so people pass each other and stop to look without blocking the way.` : `Takes ${one(a - b)} m² from the aisles ${who} (${one(a)} → ${one(b)} m²), so people have less room to pass and stop to look.`;
    },
    line(before, after) { return [after.aisle >= WHEELCHAIR_AISLE ? `Aisle floor for a ${after.aisle} m aisle` : 'Walkable aisle floor', `${one(before.walkable)} → ${one(after.walkable)} m²`]; },
  },
  displayArea: {
    name: 'display floor',
    change(before, after) {
      const a = before.displayArea, b = after.displayArea;
      if (Math.abs(b - a) < .1 || before.displays !== after.displays) return undefined;
      return b > a ? `Gives products ${one(b - a)} m² more fixture floor (${one(a)} → ${one(b)} m²).` : `Gives products ${one(a - b)} m² less fixture floor (${one(a)} → ${one(b)} m²).`;
    },
    line(before, after) { return ['Display floor', `${one(before.displayArea)} → ${one(after.displayArea)} m²`]; },
  },
} satisfies Record<string, Lever>;
const LEVERS_EXTRA = {
  checkoutWalk: {
    name: 'walk to checkout',
    change(before, after) {
      const a = before.walkToCheckout, b = after.walkToCheckout;
      if (Number.isFinite(a) !== Number.isFinite(b)) return Number.isFinite(b) ? `Opens a ${after.aisle} m aisle from the door to the checkout, which had none.` : `Cuts the ${after.aisle} m aisle from the door to the checkout.`;
      if (!Number.isFinite(a) || Math.abs(b - a) < .2) return undefined;
      return b < a ? `Shortens the walk from the door to checkout from ${one(a)} to ${one(b)} m, so shoppers who are ready to pay get there sooner.` : `Lengthens the walk from the door to checkout from ${one(a)} to ${one(b)} m, so shoppers who are ready to pay walk further.`;
    },
    line(before, after) { return Number.isFinite(before.walkToCheckout) && Number.isFinite(after.walkToCheckout) ? ['Walk from the door to checkout', `${one(before.walkToCheckout)} → ${one(after.walkToCheckout)} m`] : undefined; },
  },
  queue: {
    name: 'queue space',
    change(before, after) {
      const a = before.queueSpace, b = after.queueSpace;
      if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(b - a) < .5) return undefined;
      return b > a ? `Gives the checkout queue ${one(b - a)} m² more clear floor (${one(a)} → ${one(b)} m²), so a line can form without blocking the aisle.` : `Leaves the checkout queue ${one(a - b)} m² less clear floor (${one(a)} → ${one(b)} m²), so a line is more likely to block the aisle.`;
    },
    line(before, after) { return Number.isFinite(before.queueSpace) && Number.isFinite(after.queueSpace) ? ['Clear floor for the queue', `${one(before.queueSpace)} → ${one(after.queueSpace)} m²`] : undefined; },
  },
} satisfies Record<string, Lever>;
const LEVERS_FOR: Record<LayoutGoal, Lever[]> = {
  checkout: [LEVERS_EXTRA.checkoutWalk, LEVERS_EXTRA.queue],
  access: [LEVERS.reachable, LEVERS.walkable],
  sales: [LEVERS.onRoute, LEVERS.reachable, LEVERS.walk, LEVERS.displays],
  browse: [LEVERS.walkable, LEVERS.reachable],
  find: [LEVERS.walk, LEVERS.reachable],
  stock: [LEVERS.displays, LEVERS.displayArea, LEVERS.reachable],
};
const list = (words: string[]) => words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;

export function goalReason(goal: LayoutGoal, before: StoreMeasures, after: StoreMeasures): string {
  const levers = LEVERS_FOR[goal], said = levers.map(lever => lever.change(before, after)).filter((text): text is string => Boolean(text));
  return said.length ? said.join(' ') : `On its own this leaves the ${list(levers.map(lever => lever.name))} as they were; it is part of the full arrangement.`;
}
export function goalLines(goal: LayoutGoal, before: StoreMeasures, after: StoreMeasures): [string, string][] {
  return LEVERS_FOR[goal].map(lever => lever.line(before, after)).filter((line): line is [string, string] => Boolean(line));
}
export function goalScore(goal: LayoutGoal, measures: StoreMeasures): number[] {
  const walk = Number.isFinite(measures.walkToDisplay) ? -measures.walkToDisplay : -Infinity, route = Number.isFinite(measures.onRoute) ? measures.onRoute : -Infinity;
  if (goal === 'sales') return [route, measures.reachable, walk, measures.displays];
  if (goal === 'browse') return [measures.walkable, measures.reachable];
  if (goal === 'find') return [walk, measures.reachable];
  if (goal === 'checkout') return [measures.queueSpace, Number.isFinite(measures.walkToCheckout) ? -measures.walkToCheckout : -Infinity];
  if (goal === 'access') return [measures.reachable, measures.walkable];
  return [measures.displays, measures.displayArea, measures.reachable];
}

const HEADLINE: Record<LayoutGoal, (measures: StoreMeasures) => string> = {
  sales: measures => `${measures.onRoute} ${measures.onRoute === 1 ? 'display' : 'displays'} on the way from the door to checkout`,
  browse: measures => `${one(measures.walkable)} m² of walkable aisle`,
  find: measures => `an average walk of ${one(measures.walkToDisplay)} m from the door to a display`,
  stock: measures => `${displaysWord(measures.displays)} holding products`,
  checkout: measures => `${one(measures.queueSpace)} m² of clear floor for the checkout queue`,
  access: measures => `${displaysWord(measures.reachable)} within reach of a ${measures.aisle} m aisle`,
};
export function bestForGoal(goal: LayoutGoal, layouts: Layout[], room: RoomSpec): { layout: Layout; reason: string } | undefined {
  const beats = (a: number[], b: number[]) => { const i = a.findIndex((value, index) => value !== b[index]); return i >= 0 && a[i] > b[i]; };
  let best: { layout: Layout; measures: StoreMeasures; score: number[] } | undefined;
  for (const layout of layouts) {
    const measures = measureStore(layout, room, aisleFor(goal)), score = goalScore(goal, measures);
    if (!best || beats(score, best.score)) best = { layout, measures, score };
  }
  return best && { layout: best.layout, reason: `${GOALS[goal].heading}: of your saved layouts it has ${HEADLINE[goal](best.measures)}.` };
}
