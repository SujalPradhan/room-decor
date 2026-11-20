import type { Brief, FurnishIssue, FurnishResult, FurnitureKind, Opening, Piece, Rect, Room, RoomKind, Style, Unit } from './model';
import { formatINR } from './tower';

type Rot = 0 | 90 | 180 | 270;
type Wall = 'S' | 'E' | 'N' | 'W';
interface B { x0: number; y0: number; x1: number; y1: number }

interface CatalogEntry {
  name: string;
  w: number;
  d: number;
  h: number;
  priceByStyle: Record<Style, number>;
  colorByStyle: Record<Style, string>;
  rooms: RoomKind[];
}

const STYLES: Style[] = ['warm-minimal', 'scandi', 'indian-modern', 'industrial'];
const STYLE_PRICE: Record<Style, number> = { 'warm-minimal': 1, scandi: 1.12, 'indian-modern': 1.3, industrial: 0.92 };
const PALETTE: Record<Style, Record<'fabric' | 'wood' | 'accent' | 'dark' | 'light' | 'metal' | 'green', string>> = {
  'warm-minimal': { fabric: '#c8b8a2', wood: '#b8946a', accent: '#d9a46b', dark: '#5c4b3c', light: '#efe6d8', metal: '#a39a8c', green: '#6f8f5f' },
  scandi: { fabric: '#cfd6d9', wood: '#d9bf94', accent: '#7f9aa8', dark: '#4a5560', light: '#f4f4f1', metal: '#b9bec2', green: '#7ba06c' },
  'indian-modern': { fabric: '#b4543c', wood: '#7a4a2a', accent: '#c9973f', dark: '#3c2a20', light: '#f0e2c8', metal: '#b08d3c', green: '#5f8a4f' },
  industrial: { fabric: '#6e7378', wood: '#8a6b4a', accent: '#c46a2f', dark: '#2c2f33', light: '#c9ccce', metal: '#3c4045', green: '#5c7d52' },
};
type Tone = keyof (typeof PALETTE)[Style];

const priceOf = (base: number): Record<Style, number> =>
  Object.fromEntries(STYLES.map((s) => [s, Math.round((base * STYLE_PRICE[s]) / 500) * 500])) as Record<Style, number>;
const colorsOf = (tone: Tone): Record<Style, string> => Object.fromEntries(STYLES.map((s) => [s, PALETTE[s][tone]])) as Record<Style, string>;
const entry = (name: string, w: number, d: number, h: number, base: number, tone: Tone, rooms: RoomKind[]): CatalogEntry => ({
  name,
  w,
  d,
  h,
  priceByStyle: priceOf(base),
  colorByStyle: colorsOf(tone),
  rooms,
});

export const CATALOG: Record<FurnitureKind, CatalogEntry> = {
  sofa: entry('Sofa', 2.1, 0.95, 0.8, 62000, 'fabric', ['living']),
  armchair: entry('Armchair', 0.85, 0.85, 0.85, 18000, 'accent', ['living', 'master', 'bedroom']),
  'coffee-table': entry('Coffee table', 1.0, 0.6, 0.4, 12000, 'wood', ['living']),
  'tv-unit': entry('TV unit', 1.6, 0.45, 0.5, 24000, 'wood', ['living', 'master']),
  rug: entry('Rug', 2.4, 1.7, 0.02, 14000, 'light', ['living', 'master', 'bedroom']),
  'dining-table': entry('Dining table', 1.5, 0.85, 0.75, 28000, 'wood', ['living']),
  'dining-chair': entry('Dining chair', 0.45, 0.5, 0.9, 4500, 'dark', ['living']),
  'bed-double': entry('Double bed', 1.5, 2.0, 0.9, 38000, 'fabric', ['master', 'bedroom']),
  'bed-queen': entry('Queen bed', 1.7, 2.1, 0.95, 46000, 'fabric', ['master', 'bedroom']),
  'bed-single': entry('Single bed', 1.0, 2.0, 0.7, 22000, 'fabric', ['bedroom', 'master', 'study']),
  wardrobe: entry('Wardrobe', 1.8, 0.6, 2.1, 42000, 'wood', ['master', 'bedroom']),
  'side-table': entry('Side table', 0.45, 0.4, 0.5, 5500, 'wood', ['master', 'bedroom', 'living']),
  desk: entry('Desk', 1.3, 0.65, 0.75, 16000, 'wood', ['study', 'bedroom', 'master', 'living']),
  'office-chair': entry('Office chair', 0.55, 0.55, 1.0, 9000, 'dark', ['study', 'bedroom', 'master', 'living']),
  bookshelf: entry('Bookshelf', 0.9, 0.35, 1.8, 14000, 'wood', ['study', 'bedroom', 'master', 'living']),
  plant: entry('Plant', 0.4, 0.4, 1.2, 2500, 'green', ['living', 'balcony', 'master', 'bedroom', 'study']),
  'floor-lamp': entry('Floor lamp', 0.35, 0.35, 1.6, 6000, 'metal', ['living', 'master', 'bedroom', 'study']),
  'cat-tree': entry('Cat tree', 0.5, 0.5, 1.3, 7500, 'light', ['living', 'bedroom', 'master', 'study']),
  crib: entry('Crib', 0.7, 1.3, 0.9, 16000, 'light', ['master', 'bedroom']),
  'bean-bag': entry('Bean bag', 0.8, 0.8, 0.6, 4500, 'accent', ['living', 'bedroom', 'master', 'study', 'balcony']),
  'shoe-rack': entry('Shoe rack', 0.8, 0.3, 1.0, 7000, 'wood', ['living']),
};

export const FURNITURE_KINDS = Object.keys(CATALOG) as FurnitureKind[];

const DEFAULT_BRIEF: Brief = { occupants: 2, budgetINR: 600000, style: 'warm-minimal', wfh: 0, kids: 0, pets: [], notes: '' };

export function parseBriefDefaults(partial: Partial<Brief> | null | undefined): Brief {
  const p = partial ?? {};
  const int = (v: unknown, lo: number, hi: number, fallback: number) => {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : fallback;
  };
  const occupants = int(p.occupants, 1, 8, DEFAULT_BRIEF.occupants);
  const pets = Array.isArray(p.pets)
    ? [...new Set(p.pets.filter((x): x is string => typeof x === 'string').map((x) => x.trim().toLowerCase().slice(0, 20)).filter(Boolean))].slice(0, 3)
    : [];
  return {
    occupants,
    budgetINR: int(p.budgetINR, 50000, 50000000, DEFAULT_BRIEF.budgetINR),
    style: STYLES.includes(p.style as Style) ? (p.style as Style) : DEFAULT_BRIEF.style,
    wfh: int(p.wfh, 0, occupants, 0),
    kids: int(p.kids, 0, Math.max(0, occupants - 1), 0),
    pets,
    notes: typeof p.notes === 'string' ? p.notes.slice(0, 400) : '',
  };
}

const EPS = 0.005;
const FACE: Record<Rot, [number, number]> = { 0: [0, 1], 90: [1, 0], 180: [0, -1], 270: [-1, 0] };
const WALL_ROT: Record<Wall, Rot> = { S: 0, W: 90, N: 180, E: 270 };
const OPP: Record<Wall, Wall> = { S: 'N', N: 'S', E: 'W', W: 'E' };
const ROOM_BOX = (r: Rect): B => ({ x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.d });
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);
const swapped = (rot: Rot) => rot === 90 || rot === 270;
const turn = (rot: Rot, by: number) => (((rot + by) % 360) as Rot);
const rotOfVec = (dx: number, dy: number): Rot => (Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 90 : 270) : dy > 0 ? 0 : 180);

function boxOf(p: { x: number; y: number; w: number; d: number; rotation: Rot }): B {
  const hw = (swapped(p.rotation) ? p.d : p.w) / 2;
  const hd = (swapped(p.rotation) ? p.w : p.d) / 2;
  return { x0: p.x - hw, y0: p.y - hd, x1: p.x + hw, y1: p.y + hd };
}
const inter = (a: B, b: B, e = EPS) => a.x0 < b.x1 - e && b.x0 < a.x1 - e && a.y0 < b.y1 - e && b.y0 < a.y1 - e;
const within = (a: B, o: B, e = 0.01) => a.x0 >= o.x0 - e && a.y0 >= o.y0 - e && a.x1 <= o.x1 + e && a.y1 <= o.y1 + e;
const grow = (b: B, g: number): B => ({ x0: b.x0 - g, y0: b.y0 - g, x1: b.x1 + g, y1: b.y1 + g });
function distToBox(px: number, py: number, b: B) {
  return Math.hypot(Math.max(b.x0 - px, 0, px - b.x1), Math.max(b.y0 - py, 0, py - b.y1));
}
function frontBox(b: B, rot: Rot, depth: number): B {
  if (rot === 0) return { x0: b.x0, x1: b.x1, y0: b.y1, y1: b.y1 + depth };
  if (rot === 180) return { x0: b.x0, x1: b.x1, y0: b.y0 - depth, y1: b.y0 };
  if (rot === 90) return { y0: b.y0, y1: b.y1, x0: b.x1, x1: b.x1 + depth };
  return { y0: b.y0, y1: b.y1, x0: b.x0 - depth, x1: b.x0 };
}
const isFlat = (k: FurnitureKind) => k === 'rug';

interface DoorInfo { o: Opening; wall: Wall; along: number; pt: [number, number]; inward: [number, number]; other: Room | null }
interface WinInfo { o: Opening; wall: Wall; along: number }
interface RoomInfo { doors: DoorInfo[]; windows: WinInfo[] }

function wallOn(r: Rect, x: number, y: number): Wall | null {
  const t = 0.03;
  const inX = x >= r.x - t && x <= r.x + r.w + t;
  const inY = y >= r.y - t && y <= r.y + r.d + t;
  if (inX && Math.abs(y - r.y) < t) return 'S';
  if (inX && Math.abs(y - (r.y + r.d)) < t) return 'N';
  if (inY && Math.abs(x - r.x) < t) return 'W';
  if (inY && Math.abs(x - (r.x + r.w)) < t) return 'E';
  return null;
}

const infoCache = new WeakMap<Unit, Map<string, RoomInfo>>();
function infoOf(unit: Unit, room: Room): RoomInfo {
  let m = infoCache.get(unit);
  if (!m) infoCache.set(unit, (m = new Map()));
  const hit = m.get(room.id);
  if (hit) return hit;
  const info: RoomInfo = { doors: [], windows: [] };
  for (const o of unit.openings) {
    const wall = wallOn(room.rect, o.x, o.y);
    if (!wall) continue;
    const along = wall === 'S' || wall === 'N' ? o.x : o.y;
    if (o.kind === 'window') {
      info.windows.push({ o, wall, along });
      continue;
    }
    const n: Record<Wall, [number, number]> = { S: [0, 1], N: [0, -1], W: [1, 0], E: [-1, 0] };
    const [nx, ny] = n[wall];
    const out = unit.rooms.find((q) => q.id !== room.id && within({ x0: o.x - nx * 0.3, y0: o.y - ny * 0.3, x1: o.x - nx * 0.3, y1: o.y - ny * 0.3 }, ROOM_BOX(q.rect), 0.001)) ?? null;
    info.doors.push({ o, wall, along, pt: [o.x, o.y], inward: [o.x + nx * 0.45, o.y + ny * 0.45], other: out });
  }
  m.set(room.id, info);
  return info;
}

const clearCache = new WeakMap<Unit, B[]>();
function doorClearances(unit: Unit): B[] {
  const hit = clearCache.get(unit);
  if (hit) return hit;
  const out: B[] = [];
  for (const o of unit.openings) {
    if (o.kind === 'window') continue;
    const cw = Math.max(0.9, o.width);
    if (o.axis === 'x') {
      out.push({ x0: o.x - cw / 2, x1: o.x + cw / 2, y0: o.y, y1: o.y + 0.9 }, { x0: o.x - cw / 2, x1: o.x + cw / 2, y0: o.y - 0.9, y1: o.y });
    } else {
      out.push({ y0: o.y - cw / 2, y1: o.y + cw / 2, x0: o.x, x1: o.x + 0.9 }, { y0: o.y - cw / 2, y1: o.y + cw / 2, x0: o.x - 0.9, x1: o.x });
    }
  }
  clearCache.set(unit, out);
  return out;
}

const windowCache = new WeakMap<Unit, B[]>();
function windowSpans(unit: Unit): B[] {
  const hit = windowCache.get(unit);
  if (hit) return hit;
  const out = unit.openings
    .filter((o) => o.kind === 'window')
    .map((o): B => (o.axis === 'x' ? { x0: o.x - o.width / 2, x1: o.x + o.width / 2, y0: o.y - 0.05, y1: o.y + 0.05 } : { y0: o.y - o.width / 2, y1: o.y + o.width / 2, x0: o.x - 0.05, x1: o.x + 0.05 }));
  windowCache.set(unit, out);
  return out;
}

function routeBlocker(unit: Unit, room: Room, pieces: { id?: string; kind: FurnitureKind; roomId: string; x: number; y: number; w: number; d: number; rotation: Rot }[]): { blocker: string | null } | null {
  const doors = infoOf(unit, room).doors;
  if (doors.length < 2) return null;
  const solids = pieces.filter((p) => p.roomId === room.id && !isFlat(p.kind)).map((p) => ({ id: p.id ?? '', box: boxOf(p) }));
  const res = 0.1;
  const r = room.rect;
  const nx = Math.max(1, Math.round(r.w / res));
  const ny = Math.max(1, Math.round(r.d / res));
  const cell = (i: number, j: number): [number, number] => [r.x + (i + 0.5) * (r.w / nx), r.y + (j + 0.5) * (r.d / ny)];
  const idx = (px: number, py: number): [number, number] => [
    Math.min(nx - 1, Math.max(0, Math.floor(((px - r.x) / r.w) * nx))),
    Math.min(ny - 1, Math.max(0, Math.floor(((py - r.y) / r.d) * ny))),
  ];
  const free = (i: number, j: number) => {
    const [px, py] = cell(i, j);
    for (const d of doors) if (dist(px, py, d.inward[0], d.inward[1]) < 0.3) return true;
    if (px - r.x < 0.3 || r.x + r.w - px < 0.3 || py - r.y < 0.3 || r.y + r.d - py < 0.3) return false;
    for (const s of solids) if (distToBox(px, py, s.box) < 0.375) return false;
    return true;
  };
  const seen = new Uint8Array(nx * ny);
  const [si, sj] = idx(doors[0].inward[0], doors[0].inward[1]);
  const stack = [si + sj * nx];
  seen[si + sj * nx] = 1;
  while (stack.length) {
    const c = stack.pop()!;
    const i = c % nx;
    const j = (c - i) / nx;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di;
      const b = j + dj;
      if (a < 0 || b < 0 || a >= nx || b >= ny || seen[a + b * nx] || !free(a, b)) continue;
      seen[a + b * nx] = 1;
      stack.push(a + b * nx);
    }
  }
  for (let k = 1; k < doors.length; k++) {
    const [ti, tj] = idx(doors[k].inward[0], doors[k].inward[1]);
    if (seen[ti + tj * nx]) continue;
    const mx = (doors[0].inward[0] + doors[k].inward[0]) / 2;
    const my = (doors[0].inward[1] + doors[k].inward[1]) / 2;
    let best: string | null = null;
    let bd = Infinity;
    for (const s of solids) {
      const d = distToBox(mx, my, s.box);
      if (d < bd) {
        bd = d;
        best = s.id || null;
      }
    }
    return { blocker: best };
  }
  return null;
}

const itemName = (k: FurnitureKind) => CATALOG[k].name;
const sleepCapacity = (k: FurnitureKind, brief: Brief) => (k === 'bed-double' || k === 'bed-queen' ? 2 : k === 'bed-single' ? 1 : k === 'crib' && brief.kids > 0 ? 1 : 0);

export function checkLayout(unit: Unit, pieces: Piece[], brief: Brief): FurnishIssue[] {
  const issues: FurnishIssue[] = [];
  const rooms = new Map(unit.rooms.map((r) => [r.id, r]));
  for (const p of pieces) {
    const room = rooms.get(p.roomId);
    if (!room) {
      issues.push({ pieceId: p.id, kind: 'outside-room', message: `${itemName(p.kind)} is not in any room of flat ${unit.id}.` });
      continue;
    }
    if (!within(boxOf(p), ROOM_BOX(room.rect))) issues.push({ pieceId: p.id, roomId: room.id, kind: 'outside-room', message: `${itemName(p.kind)} sticks out of the ${room.name}.` });
    else if (!CATALOG[p.kind].rooms.includes(room.kind)) issues.push({ pieceId: p.id, roomId: room.id, kind: 'outside-room', message: `${itemName(p.kind)} does not belong in the ${room.name}.` });
  }
  const solid = pieces.filter((p) => !isFlat(p.kind));
  for (let i = 0; i < solid.length; i++) {
    for (let j = i + 1; j < solid.length; j++) {
      if (inter(boxOf(solid[i]), boxOf(solid[j]))) {
        issues.push({ pieceId: solid[i].id, roomId: solid[i].roomId, kind: 'overlap', message: `${itemName(solid[i].kind)} overlaps ${itemName(solid[j].kind)} (${solid[j].id}).` });
      }
    }
  }
  const clears = doorClearances(unit);
  for (const p of solid) {
    const b = boxOf(p);
    if (clears.some((c) => inter(b, c))) issues.push({ pieceId: p.id, roomId: p.roomId, kind: 'blocks-door', message: `${itemName(p.kind)} blocks the 0.9 m clear space in front of a door.` });
  }
  for (const room of unit.rooms) {
    const blocked = routeBlocker(unit, room, pieces);
    if (blocked) issues.push({ pieceId: blocked.blocker ?? undefined, roomId: room.id, kind: 'tight-walkway', message: `The walkway between the doors of the ${room.name} is narrower than 0.75 m.` });
  }
  const cost = pieces.reduce((s, p) => s + p.priceINR, 0);
  if (cost > brief.budgetINR) issues.push({ kind: 'over-budget', message: `Pieces cost ${formatINR(cost)} against a budget of ${formatINR(brief.budgetINR)}.` });
  const desks = pieces.filter((p) => p.kind === 'desk').length;
  if (desks < brief.wfh) issues.push({ kind: 'missing-need', message: `${brief.wfh} people work from home but there ${desks === 1 ? 'is' : 'are'} ${desks} desk${desks === 1 ? '' : 's'}.` });
  const beds = pieces.reduce((s, p) => s + sleepCapacity(p.kind, brief), 0);
  if (beds < brief.occupants) issues.push({ kind: 'missing-need', message: `Beds sleep ${beds} but ${brief.occupants} people live here.` });
  if (brief.pets.includes('cat') && !pieces.some((p) => p.kind === 'cat-tree')) issues.push({ kind: 'missing-need', message: 'The brief has a cat but there is no cat tree.' });
  if (brief.pets.includes('dog') && !pieces.some((p) => p.kind === 'bean-bag')) issues.push({ kind: 'missing-need', message: 'The brief has a dog but there is no dog bed (bean bag).' });
  return issues;
}

interface Opts { maxRank: number; smallBed: boolean; minChairs: boolean }
interface Ctx { unit: Unit; brief: Brief; pieces: Piece[]; opts: Opts; counter: Map<FurnitureKind, number> }
interface Raw { kind: FurnitureKind; roomId: string; x: number; y: number; rotation: Rot; w: number; d: number; h: number; fc?: number }
interface Cand { x: number; y: number; rotation: Rot; wall: Wall; along: number; len: number; ext: number; corner: number }
interface Group { items: Raw[]; score: number; clear?: B[] }

const want = (ctx: Ctx, rank: number) => rank <= ctx.opts.maxRank;

function raw(kind: FurnitureKind, room: Room, x: number, y: number, rotation: Rot, fc?: number): Raw {
  const c = CATALOG[kind];
  return { kind, roomId: room.id, x: r3(x), y: r3(y), rotation, w: c.w, d: c.d, h: c.h, fc };
}

function commitRaw(ctx: Ctx, g: Raw): Piece {
  const c = CATALOG[g.kind];
  const n = (ctx.counter.get(g.kind) ?? 0) + 1;
  ctx.counter.set(g.kind, n);
  const piece: Piece = {
    id: `${ctx.unit.id}-${g.kind}-${n}`,
    kind: g.kind,
    roomId: g.roomId,
    x: g.x,
    y: g.y,
    rotation: g.rotation,
    w: g.w,
    d: g.d,
    h: g.h,
    priceINR: c.priceByStyle[ctx.brief.style],
    color: c.colorByStyle[ctx.brief.style],
  };
  ctx.pieces.push(piece);
  return piece;
}

function validItems(ctx: Ctx, room: Room, items: Raw[], clear?: B[]): boolean {
  const rb = ROOM_BOX(room.rect);
  const placed: { kind: FurnitureKind; box: B }[] = ctx.pieces.filter((p) => p.roomId === room.id).map((p) => ({ kind: p.kind, box: boxOf(p) }));
  const clears = doorClearances(ctx.unit);
  const wins = windowSpans(ctx.unit);
  for (const it of items) {
    const b = boxOf(it);
    if (!within(b, rb)) return false;
    if (!isFlat(it.kind)) {
      if (placed.some((q) => !isFlat(q.kind) && inter(b, q.box))) return false;
      if (clears.some((c) => inter(b, c))) return false;
      if (it.h >= 1.2 && wins.some((w) => inter(b, w, 0.0))) return false;
      if (it.fc && placed.some((q) => !isFlat(q.kind) && inter(frontBox(b, it.rotation, it.fc!), q.box, 0.02))) return false;
    }
    placed.push({ kind: it.kind, box: b });
  }
  if (clear) {
    const solids = ctx.pieces.filter((p) => p.roomId === room.id && !isFlat(p.kind)).map(boxOf);
    if (clear.some((c) => solids.some((s) => inter(c, s)) || clears.some((d) => inter(c, d)))) return false;
  }
  return true;
}

function commitBest(ctx: Ctx, room: Room, groups: Group[]): Piece[] | null {
  const ok = groups.filter((g) => validItems(ctx, room, g.items, g.clear)).sort((a, b) => b.score - a.score);
  for (const g of ok.slice(0, 30)) {
    const trial = ctx.pieces.concat(g.items.map((i) => ({ ...i, id: '', priceINR: 0, color: '' }) as Piece));
    if (routeBlocker(ctx.unit, room, trial)) continue;
    return g.items.map((i) => commitRaw(ctx, i));
  }
  return null;
}

function wallSpots(r: Rect, w: number, d: number, step = 0.1): Cand[] {
  const out: Cand[] = [];
  const run = (len: number, ext: number) => {
    const lo = ext / 2;
    const hi = len - ext / 2;
    if (hi < lo - 1e-9) return [];
    const ts: number[] = [];
    for (let t = lo; t < hi - 1e-9; t += step) ts.push(t);
    ts.push(hi);
    return ts;
  };
  for (const t of run(r.w, w)) {
    const corner = Math.min(t - w / 2, r.w - t - w / 2);
    out.push({ wall: 'S', x: r.x + t, y: r.y + d / 2, rotation: 0, along: t, len: r.w, ext: w, corner });
    out.push({ wall: 'N', x: r.x + t, y: r.y + r.d - d / 2, rotation: 180, along: t, len: r.w, ext: w, corner });
  }
  for (const t of run(r.d, w)) {
    const corner = Math.min(t - w / 2, r.d - t - w / 2);
    out.push({ wall: 'W', x: r.x + d / 2, y: r.y + t, rotation: 90, along: t, len: r.d, ext: w, corner });
    out.push({ wall: 'E', x: r.x + r.w - d / 2, y: r.y + t, rotation: 270, along: t, len: r.d, ext: w, corner });
  }
  return out;
}

const worldAlong = (c: Cand) => (c.wall === 'S' || c.wall === 'N' ? c.x : c.y);
function hits(list: { wall: Wall; along: number; o: Opening }[], c: Cand, ext: number) {
  let n = 0;
  for (const i of list) if (i.wall === c.wall && Math.abs(i.along - worldAlong(c)) < i.o.width / 2 + ext / 2 - 0.02) n++;
  return n;
}
function nearestWindow(info: RoomInfo, x: number, y: number) {
  let best = Infinity;
  for (const w of info.windows) best = Math.min(best, dist(x, y, w.o.x, w.o.y));
  return best;
}
function neighbourAnchor(info: RoomInfo, kind: RoomKind): [number, number] | null {
  const d = info.doors.find((x) => x.other?.kind === kind);
  return d ? d.pt : null;
}

function placeSeating(ctx: Ctx, room: Room): Piece | null {
  const r = room.rect;
  const info = infoOf(ctx.unit, room);
  const tv = CATALOG['tv-unit'];
  const sofa = CATALOG.sofa;
  const anchor = neighbourAnchor(info, 'kitchen');
  const groups: Group[] = [];
  for (const c of wallSpots(r, tv.w, tv.d, 0.2)) {
    const f = FACE[c.rotation];
    const perp = c.wall === 'S' || c.wall === 'N' ? r.d : r.w;
    const back = perp - tv.d - sofa.d <= 4.2;
    const reach = back ? perp - tv.d / 2 - sofa.d / 2 : tv.d / 2 + 2.8 + sofa.d / 2;
    const sx = c.x + f[0] * reach;
    const sy = c.y + f[1] * reach;
    const gap = back ? perp - tv.d - sofa.d : 2.8;
    let score = (back ? 3 : -4) - Math.abs(gap - 3.2);
    if (anchor) score += 0.2 * dist(sx, sy, anchor[0], anchor[1]);
    score -= 6 * hits(info.doors, c, tv.w) + 3 * hits(info.windows, c, tv.w);
    score -= 0.15 * Math.abs(c.along - c.len / 2);
    groups.push({ items: [raw('tv-unit', room, c.x, c.y, c.rotation), raw('sofa', room, sx, sy, turn(c.rotation, 180))], score });
  }
  const placed = commitBest(ctx, room, groups);
  return placed ? placed[1] : null;
}

function front(p: Piece, by: number): [number, number] {
  const f = FACE[p.rotation];
  return [p.x + f[0] * by, p.y + f[1] * by];
}

function placeCoffeeAndRug(ctx: Ctx, room: Room, sofa: Piece) {
  const ct = CATALOG['coffee-table'];
  let table: Piece | null = null;
  if (want(ctx, 1)) {
    for (const gap of [0.45, 0.35, 0.3]) {
      const [x, y] = front(sofa, sofa.d / 2 + gap + ct.d / 2);
      const it = raw('coffee-table', room, x, y, sofa.rotation);
      if (validItems(ctx, room, [it]) && !routeBlocker(ctx.unit, room, ctx.pieces.concat({ ...it, id: '', priceINR: 0, color: '' } as Piece))) {
        table = commitRaw(ctx, it);
        break;
      }
    }
  }
  if (want(ctx, 2)) {
    const [x, y] = table ? [table.x, table.y] : front(sofa, sofa.d / 2 + 0.8);
    const it = raw('rug', room, x, y, sofa.rotation);
    if (validItems(ctx, room, [it])) commitRaw(ctx, it);
  }
}

function placeDining(ctx: Ctx, room: Room, sofaAt: [number, number] | null) {
  if (!want(ctx, 1)) return;
  const r = room.rect;
  const info = infoOf(ctx.unit, room);
  const anchor = neighbourAnchor(info, 'kitchen');
  const table = CATALOG['dining-table'];
  const chair = CATALOG['dining-chair'];
  let n = Math.min(6, Math.max(2, ctx.brief.occupants));
  if (ctx.opts.minChairs || !want(ctx, 3)) n = Math.min(n, 2);
  for (; n >= 2; n--) {
    const groups: Group[] = [];
    const k1 = Math.ceil(n / 2);
    const k2 = Math.floor(n / 2);
    for (const trot of [0, 90] as Rot[]) {
      for (let cx = r.x + 0.6; cx <= r.x + r.w - 0.6 + 1e-9; cx += 0.2) {
        for (let cy = r.y + 0.6; cy <= r.y + r.d - 0.6 + 1e-9; cy += 0.2) {
          const items: Raw[] = [raw('dining-table', room, cx, cy, trot)];
          const lat: [number, number] = trot === 0 ? [1, 0] : [0, 1];
          const nrm: [number, number] = trot === 0 ? [0, 1] : [1, 0];
          const sides: [number, number, Rot][] = [[-1, k1, trot === 0 ? 0 : 90], [1, k2, trot === 0 ? 180 : 270]];
          for (const [sgn, k, rot] of sides) {
            for (let i = 0; i < k; i++) {
              const off = (i - (k - 1) / 2) * (table.w / Math.max(k, 2)) * (k === 1 ? 0 : 1);
              const dd = table.d / 2 + 0.02 + chair.d / 2;
              items.push(raw('dining-chair', room, cx + lat[0] * off + nrm[0] * sgn * dd, cy + lat[1] * off + nrm[1] * sgn * dd, rot));
            }
          }
          const bs = items.map(boxOf);
          const outer: B = { x0: Math.min(...bs.map((b) => b.x0)), y0: Math.min(...bs.map((b) => b.y0)), x1: Math.max(...bs.map((b) => b.x1)), y1: Math.max(...bs.map((b) => b.y1)) };
          let score = -0.02 * Math.abs(cx - (r.x + r.w / 2)) - 0.02 * Math.abs(cy - (r.y + r.d / 2));
          if (anchor) score -= dist(cx, cy, anchor[0], anchor[1]);
          if (sofaAt) score += 0.3 * dist(cx, cy, sofaAt[0], sofaAt[1]);
          groups.push({ items, score, clear: [grow(outer, 0.35)] });
        }
      }
    }
    const placed = commitBest(ctx, room, groups);
    if (placed) return;
  }
}

function bedGroups(ctx: Ctx, room: Room, kind: FurnitureKind): Group[] {
  const r = room.rect;
  const info = infoOf(ctx.unit, room);
  const c0 = CATALOG[kind];
  const main = info.doors.find((d) => d.other && d.other.kind !== 'balcony' && d.other.kind !== 'bath') ?? info.doors[0];
  const groups: Group[] = [];
  for (const c of wallSpots(r, c0.w, c0.d, 0.1)) {
    const perp = c.wall === 'S' || c.wall === 'N' ? r.d : r.w;
    let score = 0;
    if (main && c.wall === OPP[main.wall]) score += 4;
    score -= 2.5 * hits(info.windows, c, c0.w);
    if (perp - c0.d < 0.7) score -= 6;
    score -= 0.4 * Math.abs(c.along - c.len / 2);
    groups.push({ items: [raw(kind, room, c.x, c.y, c.rotation)], score });
  }
  return groups;
}

function placeBed(ctx: Ctx, room: Room, kind: FurnitureKind): Piece | null {
  const placed = commitBest(ctx, room, bedGroups(ctx, room, kind));
  if (placed) return placed[0];
  if (kind === 'bed-queen') {
    const alt = commitBest(ctx, room, bedGroups(ctx, room, 'bed-double'));
    return alt ? alt[0] : null;
  }
  return null;
}

function placeSideTables(ctx: Ctx, room: Room, bed: Piece) {
  const st = CATALOG['side-table'];
  const f = FACE[bed.rotation];
  const right: [number, number] = [f[1], -f[0]];
  for (const s of [-1, 1]) {
    const off = bed.w / 2 + 0.02 + st.w / 2;
    const back = bed.d / 2 - st.d / 2;
    const it = raw('side-table', room, bed.x + right[0] * s * off - f[0] * back, bed.y + right[1] * s * off - f[1] * back, bed.rotation);
    if (validItems(ctx, room, [it])) commitRaw(ctx, it);
  }
}

function placeWardrobe(ctx: Ctx, room: Room): Piece | null {
  const info = infoOf(ctx.unit, room);
  const w = CATALOG.wardrobe;
  const groups: Group[] = [];
  for (const c of wallSpots(room.rect, w.w, w.d, 0.1)) {
    let score = -0.8 * c.corner;
    score -= 6 * hits(info.doors, c, w.w) + 4 * hits(info.windows, c, w.w);
    if (info.doors.some((d) => d.wall === c.wall)) score += 1;
    groups.push({ items: [raw('wardrobe', room, c.x, c.y, c.rotation, 0.75)], score });
  }
  const placed = commitBest(ctx, room, groups);
  return placed ? placed[0] : null;
}

function placeDesk(ctx: Ctx, room: Room, withChair = true): Piece | null {
  const info = infoOf(ctx.unit, room);
  const dk = CATALOG.desk;
  const ch = CATALOG['office-chair'];
  const groups: Group[] = [];
  for (const c of wallSpots(room.rect, dk.w, dk.d, 0.1)) {
    let score = info.windows.length ? -nearestWindow(info, c.x, c.y) : -0.3 * c.corner;
    score -= 6 * hits(info.doors, c, dk.w);
    const f = FACE[c.rotation];
    const items = [raw('desk', room, c.x, c.y, c.rotation, 0.85)];
    if (withChair) items.push(raw('office-chair', room, c.x + f[0] * (dk.d / 2 + 0.02 + ch.d / 2), c.y + f[1] * (dk.d / 2 + 0.02 + ch.d / 2), turn(c.rotation, 180)));
    groups.push({ items, score });
  }
  const placed = commitBest(ctx, room, groups);
  return placed ? placed[0] : null;
}

function placeCornered(ctx: Ctx, room: Room, kind: FurnitureKind, opts: { nearWindow?: boolean; near?: [number, number]; fc?: number; farFromDoor?: boolean } = {}): Piece | null {
  const info = infoOf(ctx.unit, room);
  const c0 = CATALOG[kind];
  const groups: Group[] = [];
  for (const c of wallSpots(room.rect, c0.w, c0.d, 0.1)) {
    let score = -0.5 * c.corner - 5 * hits(info.doors, c, c0.w);
    if (opts.nearWindow && info.windows.length) score -= nearestWindow(info, c.x, c.y);
    if (opts.near) score -= dist(c.x, c.y, opts.near[0], opts.near[1]);
    if (opts.farFromDoor) for (const d of info.doors) score += 0.2 * Math.min(4, dist(c.x, c.y, d.pt[0], d.pt[1]));
    groups.push({ items: [raw(kind, room, c.x, c.y, c.rotation, opts.fc)], score });
  }
  const placed = commitBest(ctx, room, groups);
  return placed ? placed[0] : null;
}

function placeBedRug(ctx: Ctx, room: Room, bed: Piece) {
  const [x, y] = front(bed, bed.d / 2 - 0.5);
  const it = raw('rug', room, x, y, bed.rotation);
  if (validItems(ctx, room, [it])) commitRaw(ctx, it);
}

function placeArmchair(ctx: Ctx, room: Room, table: Piece | null, sofa: Piece) {
  const ac = CATALOG.armchair;
  const [cx, cy] = table ? [table.x, table.y] : front(sofa, sofa.d / 2 + 0.9);
  const f = FACE[sofa.rotation];
  const right: [number, number] = [f[1], -f[0]];
  const half = table ? (swapped(table.rotation) ? table.d : table.w) / 2 : 0.5;
  const groups: Group[] = [];
  for (const s of [-1, 1]) {
    for (const extra of [0.2, 0.45, 0.7]) {
      const off = half + extra + ac.w / 2;
      const x = cx + right[0] * s * off;
      const y = cy + right[1] * s * off;
      groups.push({ items: [raw('armchair', room, x, y, rotOfVec(-right[0] * s, -right[1] * s))], score: -extra - (s === 1 ? 0.01 : 0) });
    }
  }
  commitBest(ctx, room, groups);
}

function nextToSofa(sofa: Piece | null, room: Room): [number, number] {
  return sofa ? [sofa.x, sofa.y] : [room.rect.x + room.rect.w / 2, room.rect.y + room.rect.d / 2];
}

function furnishLiving(ctx: Ctx, room: Room) {
  const info = infoOf(ctx.unit, room);
  const sofa = placeSeating(ctx, room);
  if (sofa) placeCoffeeAndRug(ctx, room, sofa);
  const table = ctx.pieces.find((p) => p.roomId === room.id && p.kind === 'coffee-table') ?? null;
  const petCat = ctx.brief.pets.includes('cat');
  const petDog = ctx.brief.pets.includes('dog');
  if (petCat) placeCornered(ctx, room, 'cat-tree', { nearWindow: true });
  if (petDog) placeCornered(ctx, room, 'bean-bag', { farFromDoor: true });
  placeDining(ctx, room, sofa ? [sofa.x, sofa.y] : null);
  if (sofa && want(ctx, 3)) placeArmchair(ctx, room, table, sofa);
  if (want(ctx, 3)) placeCornered(ctx, room, 'floor-lamp', { near: nextToSofa(sofa, room) });
  if (want(ctx, 4) && ctx.brief.style !== 'industrial') placeCornered(ctx, room, 'plant', { nearWindow: true });
  if (want(ctx, 4) && info.doors.some((d) => d.o.kind === 'entry')) {
    const entry = info.doors.find((d) => d.o.kind === 'entry')!;
    placeCornered(ctx, room, 'shoe-rack', { near: entry.pt, fc: 0.6 });
  }
}

interface Allocation { sleepers: Map<string, FurnitureKind[]>; crib: boolean }

function allocateSleepers(unit: Unit, brief: Brief): Allocation {
  const sleepers = new Map<string, FurnitureKind[]>();
  const crib = brief.kids > 0 && /\b(infant|baby|newborn|toddler|crib)\b/i.test(brief.notes);
  const master = unit.rooms.find((r) => r.kind === 'master');
  let left = brief.occupants;
  if (master) {
    sleepers.set(master.id, [brief.occupants >= 2 ? 'bed-queen' : 'bed-double']);
    left -= Math.min(2, brief.occupants);
    if (crib && left > 0) left -= 1;
  }
  let kids = Math.max(0, brief.kids - (crib ? 1 : 0));
  for (const room of unit.rooms.filter((r) => r.kind === 'bedroom')) {
    if (left <= 0) break;
    if (kids > 0) {
      const n = Math.min(2, kids, left);
      sleepers.set(room.id, Array(n).fill('bed-single'));
      kids -= n;
      left -= n;
    } else if (left >= 2) {
      sleepers.set(room.id, ['bed-double']);
      left -= 2;
    } else {
      sleepers.set(room.id, ['bed-single']);
      left -= 1;
    }
  }
  return { sleepers, crib: crib && !!master };
}

function furnishUnit(ctx: Ctx) {
  const { unit, brief } = ctx;
  const alloc = allocateSleepers(unit, brief);
  const living = unit.rooms.filter((r) => r.kind === 'living');
  const bedrooms = unit.rooms.filter((r) => r.kind === 'master' || r.kind === 'bedroom');
  const studies = unit.rooms.filter((r) => r.kind === 'study');
  const spare = bedrooms.filter((r) => !alloc.sleepers.has(r.id));
  const sleeping = bedrooms.filter((r) => alloc.sleepers.has(r.id));
  const adultFirst = [...sleeping.filter((r) => r.kind === 'master'), ...sleeping.filter((r) => r.kind !== 'master')];
  const deskRooms = new Map<string, number>();
  let remaining = brief.wfh;
  const order: { room: Room; cap: number }[] = [...studies, ...spare].map((room) => ({ room, cap: 2 }));
  for (const pass of [1, 2]) {
    for (const room of [...adultFirst, ...living]) order.push({ room, cap: pass });
  }
  for (const { room, cap } of order) {
    if (remaining <= 0) break;
    const have = deskRooms.get(room.id) ?? 0;
    if (have >= cap) continue;
    deskRooms.set(room.id, have + 1);
    remaining--;
  }

  for (const room of living) furnishLiving(ctx, room);

  for (const room of bedrooms) {
    const beds = alloc.sleepers.get(room.id) ?? [];
    const placedBeds: Piece[] = [];
    for (const kind of beds) {
      const k = ctx.opts.smallBed && kind === 'bed-queen' ? 'bed-double' : kind;
      const b = placeBed(ctx, room, k);
      if (b) placedBeds.push(b);
    }
    if (!beds.length && want(ctx, 3) && !deskRooms.has(room.id)) {
      const b = placeBed(ctx, room, 'bed-single');
      if (b) placedBeds.push(b);
    }
    for (let i = 0; i < (deskRooms.get(room.id) ?? 0); i++) placeDesk(ctx, room);
    if (beds.length) placeWardrobe(ctx, room);
    const head = placedBeds[0];
    if (head && want(ctx, 2) && (head.kind === 'bed-double' || head.kind === 'bed-queen' || !beds.length)) placeSideTables(ctx, room, head);
    if (room.kind === 'master' && alloc.crib) placeCornered(ctx, room, 'crib', { near: head ? [head.x, head.y] : undefined, fc: 0.4 });
    if (room.kind === 'master' && head && want(ctx, 2)) placeBedRug(ctx, room, head);
    if (deskRooms.has(room.id) && !beds.length && want(ctx, 2)) placeCornered(ctx, room, 'bookshelf', { fc: 0.6 });
  }
  for (const room of studies) {
    for (let i = 0; i < (deskRooms.get(room.id) ?? 0); i++) placeDesk(ctx, room);
    if (want(ctx, 2)) placeCornered(ctx, room, 'bookshelf', { fc: 0.6 });
  }
  for (const room of living) {
    const n = deskRooms.get(room.id) ?? 0;
    for (let i = 0; i < n; i++) placeDesk(ctx, room);
  }
  if (want(ctx, 4)) {
    for (const room of unit.rooms.filter((r) => r.kind === 'balcony')) {
      for (let i = 0; i < 2; i++) placeCornered(ctx, room, 'plant', { farFromDoor: true });
    }
  }
}

function finalize(unit: Unit, brief: Brief, pieces: Piece[]): FurnishResult {
  const issues = checkLayout(unit, pieces, brief);
  return { unitId: unit.id, brief, pieces, costINR: pieces.reduce((s, p) => s + p.priceINR, 0), issues, ok: issues.length === 0 };
}

const LEVELS: Opts[] = [
  { maxRank: 4, smallBed: false, minChairs: false },
  { maxRank: 3, smallBed: false, minChairs: false },
  { maxRank: 2, smallBed: false, minChairs: false },
  { maxRank: 1, smallBed: false, minChairs: false },
  { maxRank: 1, smallBed: true, minChairs: true },
  { maxRank: 0, smallBed: true, minChairs: true },
];

export function furnish(unit: Unit, briefIn: Brief): FurnishResult {
  const brief = parseBriefDefaults(briefIn);
  let result: FurnishResult | null = null;
  for (const opts of LEVELS) {
    const ctx: Ctx = { unit, brief, pieces: [], opts, counter: new Map() };
    furnishUnit(ctx);
    result = finalize(unit, brief, ctx.pieces);
    if (result.costINR <= brief.budgetINR) return result;
  }
  return result!;
}

export interface PlanItem { roomId: string; kind: FurnitureKind; x?: number; y?: number; rotation?: number }

const normRot = (r: number | undefined): Rot | undefined => {
  if (typeof r !== 'number' || !Number.isFinite(r)) return undefined;
  const m = ((Math.round(r / 90) * 90) % 360 + 360) % 360;
  return m as Rot;
};

function snapToWall(room: Room, kind: FurnitureKind, x: number, y: number, rot: Rot | undefined) {
  const c = CATALOG[kind];
  const r = room.rect;
  const dists: [Wall, number][] = [['S', y - r.y], ['N', r.y + r.d - y], ['W', x - r.x], ['E', r.x + r.w - x]];
  dists.sort((a, b) => a[1] - b[1]);
  const [wall, dd] = dists[0];
  const rotation = rot ?? WALL_ROT[wall];
  const b = boxOf({ x, y, w: c.w, d: c.d, rotation });
  const hx = (b.x1 - b.x0) / 2;
  const hy = (b.y1 - b.y0) / 2;
  const gapOf: Record<Wall, number> = { S: b.y0 - r.y, N: r.y + r.d - b.y1, W: b.x0 - r.x, E: r.x + r.w - b.x1 };
  let nx = x;
  let ny = y;
  if (dd >= 0 && Math.abs(gapOf[wall]) < 0.12 + 1e-9) {
    if (wall === 'S') ny = r.y + hy;
    else if (wall === 'N') ny = r.y + r.d - hy;
    else if (wall === 'W') nx = r.x + hx;
    else nx = r.x + r.w - hx;
  }
  return { x: nx, y: ny, rotation };
}

function autoPlace(ctx: Ctx, room: Room, kind: FurnitureKind, rot: Rot | undefined): Piece | null {
  const inRoom = (k: FurnitureKind) => ctx.pieces.filter((p) => p.roomId === room.id && p.kind === k);
  const lastOf = (k: FurnitureKind) => inRoom(k).at(-1) ?? null;
  const sofa = lastOf('sofa');
  const tv = lastOf('tv-unit');
  const cx = room.rect.x + room.rect.w / 2;
  const cy = room.rect.y + room.rect.d / 2;
  const c0 = CATALOG[kind];
  const commitOne = (items: Raw[]) => {
    const placed = commitBest(ctx, room, [{ items, score: 0 }]);
    if (placed) return placed[0];
    if (validItems(ctx, room, items)) return commitRaw(ctx, items[0]);
    return null;
  };
  const wallPick = (score: (c: Cand) => number, fc?: number): Piece | null => {
    const info = infoOf(ctx.unit, room);
    const groups = wallSpots(room.rect, c0.w, c0.d, 0.1)
      .filter((c) => rot === undefined || c.rotation === rot)
      .map((c) => ({ items: [raw(kind, room, c.x, c.y, c.rotation, fc)], score: score(c) - 5 * hits(info.doors, c, c0.w) }));
    const placed = commitBest(ctx, room, groups);
    return placed ? placed[0] : null;
  };
  const facing = (c: Cand, px: number, py: number) => {
    const f = FACE[c.rotation];
    const len = dist(c.x, c.y, px, py) || 1;
    return (f[0] * (px - c.x) + f[1] * (py - c.y)) / len;
  };
  const longest = (c: Cand) => c.len * 0.2 - Math.abs(c.along - c.len / 2) * 0.3;

  switch (kind) {
    case 'tv-unit': {
      if (sofa) return wallPick((c) => -dist(c.x + FACE[c.rotation][0] * 2, c.y + FACE[c.rotation][1] * 2, sofa.x, sofa.y) - 0.1 * c.corner - 8 * (1 - facing(c, sofa.x, sofa.y)));
      return wallPick(longest);
    }
    case 'sofa': {
      if (tv) return wallPick((c) => -Math.abs(dist(c.x, c.y, tv.x, tv.y) - 3.2) - 0.1 * Math.abs(c.along - c.len / 2) - 8 * (1 - facing(c, tv.x, tv.y)), 0.4);
      return wallPick(longest, 0.4);
    }
    case 'coffee-table': {
      if (sofa) {
        for (const gap of [0.45, 0.35]) {
          const [x, y] = front(sofa, sofa.d / 2 + gap + c0.d / 2);
          const p = commitOne([raw(kind, room, x, y, sofa.rotation)]);
          if (p) return p;
        }
      }
      return commitOne([raw(kind, room, cx, cy, rot ?? 0)]);
    }
    case 'rug': {
      const anchor = lastOf('coffee-table') ?? lastOf('bed-queen') ?? lastOf('bed-double') ?? lastOf('bed-single') ?? sofa;
      const rr = anchor?.rotation ?? rot ?? 0;
      const [x, y] = anchor ? (anchor.kind === 'coffee-table' || anchor === sofa ? [anchor.x, anchor.y] : front(anchor, anchor.d / 2 - 0.5)) : [cx, cy];
      const rb = ROOM_BOX(room.rect);
      for (const rot2 of [rr, turn(rr, 90)]) {
        const hw = (swapped(rot2) ? c0.d : c0.w) / 2;
        const hd = (swapped(rot2) ? c0.w : c0.d) / 2;
        if (rb.x1 - rb.x0 < 2 * hw || rb.y1 - rb.y0 < 2 * hd) continue;
        const it = raw(kind, room, Math.min(rb.x1 - hw, Math.max(rb.x0 + hw, x)), Math.min(rb.y1 - hd, Math.max(rb.y0 + hd, y)), rot2);
        if (validItems(ctx, room, [it])) return commitRaw(ctx, it);
      }
      return null;
    }
    case 'dining-table': {
      for (const trot of rot !== undefined ? [rot] : ([0, 90] as Rot[])) {
        const groups: Group[] = [];
        for (let x = room.rect.x + 0.5; x <= room.rect.x + room.rect.w - 0.5 + 1e-9; x += 0.2) {
          for (let y = room.rect.y + 0.5; y <= room.rect.y + room.rect.d - 0.5 + 1e-9; y += 0.2) groups.push({ items: [raw(kind, room, x, y, trot)], score: -dist(x, y, cx, cy) });
        }
        const placed = commitBest(ctx, room, groups);
        if (placed) return placed[0];
      }
      return null;
    }
    case 'dining-chair': {
      const table = lastOf('dining-table');
      if (!table) return wallPick((c) => -c.corner);
      const tb = boxOf(table);
      const groups: Group[] = [];
      const tw = swapped(table.rotation) ? table.d : table.w;
      const td = swapped(table.rotation) ? table.w : table.d;
      for (const [sgn, axis] of [[-1, 'y'], [1, 'y'], [-1, 'x'], [1, 'x']] as [number, 'x' | 'y'][]) {
        const steps = axis === 'y' ? tw : td;
        for (let t = -steps / 2 + 0.25; t <= steps / 2 - 0.25 + 1e-9; t += 0.25) {
          const x = axis === 'y' ? (tb.x0 + tb.x1) / 2 + t : sgn < 0 ? tb.x0 - 0.02 - c0.d / 2 : tb.x1 + 0.02 + c0.d / 2;
          const y = axis === 'x' ? (tb.y0 + tb.y1) / 2 + t : sgn < 0 ? tb.y0 - 0.02 - c0.d / 2 : tb.y1 + 0.02 + c0.d / 2;
          const face = axis === 'y' ? (sgn < 0 ? 0 : 180) : sgn < 0 ? 90 : 270;
          groups.push({ items: [raw(kind, room, x, y, face as Rot)], score: -Math.abs(t) * 0.01 });
        }
      }
      const placed = commitBest(ctx, room, groups);
      return placed ? placed[0] : null;
    }
    case 'office-chair': {
      const desk = inRoom('desk').find((d) => !ctx.pieces.some((p) => p.kind === 'office-chair' && p.roomId === room.id && dist(p.x, p.y, d.x, d.y) < 1.0));
      if (desk) {
        const [x, y] = front(desk, desk.d / 2 + 0.02 + c0.d / 2);
        return commitOne([raw(kind, room, x, y, turn(desk.rotation, 180))]);
      }
      return wallPick((c) => -c.corner);
    }
    case 'side-table': {
      const bed = [...inRoom('bed-queen'), ...inRoom('bed-double'), ...inRoom('bed-single')].at(-1);
      if (bed) {
        const f = FACE[bed.rotation];
        const right: [number, number] = [f[1], -f[0]];
        for (const s of [-1, 1]) {
          const off = bed.w / 2 + 0.02 + c0.w / 2;
          const back = bed.d / 2 - c0.d / 2;
          const p = commitOne([raw(kind, room, bed.x + right[0] * s * off - f[0] * back, bed.y + right[1] * s * off - f[1] * back, bed.rotation)]);
          if (p) return p;
        }
      }
      return wallPick((c) => -c.corner);
    }
    case 'bed-double':
    case 'bed-queen':
    case 'bed-single': {
      const groups = bedGroups(ctx, room, kind).filter((g) => rot === undefined || g.items[0].rotation === rot);
      const placed = commitBest(ctx, room, groups);
      return placed ? placed[0] : null;
    }
    case 'desk': {
      const info = infoOf(ctx.unit, room);
      return wallPick((c) => (info.windows.length ? -nearestWindow(info, c.x, c.y) : -0.3 * c.corner), 0.85);
    }
    case 'wardrobe':
      return wallPick((c) => -0.8 * c.corner, 0.75);
    case 'plant':
    case 'floor-lamp':
    case 'cat-tree':
    case 'bean-bag':
    case 'armchair':
    case 'bookshelf':
    case 'shoe-rack':
    case 'crib':
    default:
      return wallPick((c) => -0.5 * c.corner, kind === 'bookshelf' || kind === 'shoe-rack' ? 0.5 : undefined);
  }
}

export function applyPlan(unit: Unit, briefIn: Brief, plan: PlanItem[]): FurnishResult {
  const brief = parseBriefDefaults(briefIn);
  const ctx: Ctx = { unit, brief, pieces: [], opts: { maxRank: 99, smallBed: false, minChairs: false }, counter: new Map() };
  const extra: FurnishIssue[] = [];
  for (const item of plan) {
    const room = unit.rooms.find((r) => r.id === item.roomId);
    const c = CATALOG[item.kind];
    if (!room || !c) {
      extra.push({ roomId: item.roomId, kind: 'outside-room', message: !room ? `Room ${item.roomId} does not exist in flat ${unit.id}.` : `Unknown furniture ${String(item.kind)}.` });
      continue;
    }
    const rot = normRot(item.rotation);
    if (typeof item.x === 'number' && typeof item.y === 'number' && Number.isFinite(item.x) && Number.isFinite(item.y)) {
      const s = snapToWall(room, item.kind, item.x, item.y, rot);
      commitRaw(ctx, raw(item.kind, room, s.x, s.y, s.rotation));
      continue;
    }
    const placed = autoPlace(ctx, room, item.kind, rot);
    if (!placed) extra.push({ roomId: room.id, kind: 'outside-room', message: `No free spot for ${c.name} in the ${room.name}.` });
  }
  const result = finalize(unit, brief, ctx.pieces);
  if (extra.length) {
    result.issues = [...extra, ...result.issues];
    result.ok = false;
  }
  return result;
}
