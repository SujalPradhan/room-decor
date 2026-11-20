import type { Facing, Opening, Rect, Room, RoomKind, Tower, Unit, UnitStatus, UnitType } from './model';

const SQFT_PER_M2 = 10.764;
const BASE_RATE_INR = 9800;
const FACADE_U = 17;
const FACADE_V = 11;
const FLOORS = 18;

type RoomSpec = [id: string, kind: RoomKind, name: string, u0: number, v0: number, u1: number, v1: number];
type HallSpec = [id: string, u0: number, v0: number, u1: number, v1: number];
type DoorSpec = [a: string, b: string, t: number, width: number];
type WindowSpec = [a: string, b: string, t: number, width: number];
interface Template {
  rooms: RoomSpec[];
  halls: HallSpec[];
  doors: DoorSpec[];
  windows: WindowSpec[];
  entry: { u: number; v: number; axis: 'x' | 'y'; width: number };
}
interface Frame { sx: 1 | -1; sy: 1 | -1 }
interface Box { u0: number; v0: number; u1: number; v1: number }

const THREE_BHK: Template = {
  rooms: [
    ['living', 'living', 'Living and dining', 0, 4.5, 8, 9.4],
    ['balcony', 'balcony', 'Balcony', 0, 9.4, 8, 11],
    ['kitchen', 'kitchen', 'Kitchen', 8, 8.2, 10.6, 11],
    ['mbath', 'bath', 'Master bath', 10.6, 8.6, 12.6, 11],
    ['master', 'master', 'Master bedroom', 12.6, 5.6, 17, 11],
    ['bed2', 'bedroom', 'Bedroom 2', 10.4, 1.9, 17, 5.6],
    ['bed3', 'bedroom', 'Bedroom 3', 10.4, -1.4, 17, 1.9],
    ['bath', 'bath', 'Bath', 5.5, -1.4, 7.7, 1.0],
  ],
  halls: [
    ['ha', 5.5, 1.0, 10.4, 4.5],
    ['hd', 8, 4.5, 10.4, 8.2],
    ['hc', 10.4, 5.6, 12.6, 8.2],
    ['hg', 7.7, -1.4, 10.4, 1.0],
  ],
  doors: [
    ['living', 'ha', 0.5, 1.0],
    ['living', 'kitchen', 0.5, 1.0],
    ['living', 'balcony', 0.3, 1.2],
    ['kitchen', 'hd', 0.5, 0.9],
    ['master', 'hc', 0.5, 0.9],
    ['master', 'mbath', 0.5, 0.8],
    ['bed2', 'ha', 0.5, 0.9],
    ['bed3', 'hg', 0.5, 0.9],
    ['bath', 'ha', 0.5, 0.8],
  ],
  windows: [['living', 'balcony', 0.72, 2.0]],
  entry: { u: 5.5, v: 2.75, axis: 'y', width: 1.0 },
};

const TWO_BHK: Template = {
  rooms: [
    ['living', 'living', 'Living and dining', 0, 4.5, 7.4, 9.4],
    ['balcony', 'balcony', 'Balcony', 0, 9.4, 7.4, 11],
    ['kitchen', 'kitchen', 'Kitchen', 7.4, 8.2, 10.4, 11],
    ['mbath', 'bath', 'Master bath', 10.4, 8.6, 12.4, 11],
    ['master', 'master', 'Master bedroom', 12.4, 5.4, 17, 11],
    ['bed2', 'bedroom', 'Bedroom 2', 12.4, 0.6, 17, 5.4],
    ['bath', 'bath', 'Bath', 5.5, 0, 7.7, 2.4],
  ],
  halls: [
    ['ha', 5.5, 2.4, 12.4, 4.5],
    ['hd', 7.4, 4.5, 12.4, 8.2],
  ],
  doors: [
    ['living', 'hd', 0.4, 1.0],
    ['living', 'kitchen', 0.5, 1.0],
    ['living', 'balcony', 0.3, 1.2],
    ['kitchen', 'hd', 0.5, 0.9],
    ['master', 'hd', 0.5, 0.9],
    ['master', 'mbath', 0.5, 0.8],
    ['bed2', 'ha', 0.5, 0.9],
    ['bath', 'ha', 0.5, 0.8],
  ],
  windows: [['living', 'balcony', 0.72, 2.0]],
  entry: { u: 2.5, v: 4.5, axis: 'x', width: 1.0 },
};

const ONE_BHK: Template = {
  rooms: [
    ['living', 'living', 'Living and dining', 5.5, 4.5, 11.4, 9.2],
    ['balcony', 'balcony', 'Balcony', 5.5, 9.2, 11.4, 11],
    ['kitchen', 'kitchen', 'Kitchen', 11.4, 8.0, 14.2, 11],
    ['balcony2', 'balcony', 'Balcony 2', 14.2, 8.0, 17, 11],
    ['bath', 'bath', 'Bath', 11.4, 5.6, 13, 8.0],
    ['master', 'master', 'Bedroom', 13, 2.6, 17, 8.0],
  ],
  halls: [
    ['hf', 5.5, 1.4, 13, 4.5],
    ['hd', 11.4, 2.6, 13, 5.6],
  ],
  doors: [
    ['living', 'hf', 0.25, 1.0],
    ['living', 'kitchen', 0.5, 1.0],
    ['living', 'balcony', 0.3, 1.2],
    ['master', 'hd', 0.5, 0.9],
    ['bath', 'hd', 0.5, 0.8],
    ['master', 'balcony2', 0.5, 1.2],
  ],
  windows: [['living', 'balcony', 0.72, 2.0]],
  entry: { u: 5.5, v: 3.0, axis: 'y', width: 1.0 },
};

const SLOTS: { slot: Unit['slot']; type: UnitType; facing: Facing; template: Template; frame: Frame }[] = [
  { slot: 'A', type: '3BHK', facing: 'NE', template: THREE_BHK, frame: { sx: 1, sy: 1 } },
  { slot: 'B', type: '2BHK', facing: 'NW', template: TWO_BHK, frame: { sx: -1, sy: 1 } },
  { slot: 'C', type: '2BHK', facing: 'SW', template: TWO_BHK, frame: { sx: -1, sy: -1 } },
  { slot: 'D', type: '1BHK', facing: 'SE', template: ONE_BHK, frame: { sx: 1, sy: -1 } },
];

const FACING_FACTOR: Record<Facing, number> = { N: 1.02, NE: 1.04, E: 1.04, SE: 1, S: 1, SW: 1, W: 1, NW: 1 };
const SUN_BASE: Record<Facing, number> = { N: 3.4, NE: 6.2, E: 6.4, SE: 7.1, S: 7.4, SW: 6.9, W: 6.5, NW: 5.2 };

const round = (n: number, step = 0.01) => Math.round(Math.round(n / step) * step * 1000) / 1000;

function hashString(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rand01(s: string) {
  let t = (hashString(s) + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function toRect(frame: Frame, b: Box): Rect {
  const xa = frame.sx * b.u0;
  const xb = frame.sx * b.u1;
  const ya = frame.sy * b.v0;
  const yb = frame.sy * b.v1;
  return { x: round(Math.min(xa, xb)), y: round(Math.min(ya, yb)), w: round(Math.abs(b.u1 - b.u0)), d: round(Math.abs(b.v1 - b.v0)) };
}

function shared(a: Box, b: Box): { axis: 'x' | 'y'; line: number; lo: number; hi: number } | null {
  const eps = 1e-6;
  const vlo = Math.max(a.v0, b.v0);
  const vhi = Math.min(a.v1, b.v1);
  const ulo = Math.max(a.u0, b.u0);
  const uhi = Math.min(a.u1, b.u1);
  if (vhi - vlo > 0.3) {
    if (Math.abs(a.u1 - b.u0) < eps) return { axis: 'y', line: a.u1, lo: vlo, hi: vhi };
    if (Math.abs(b.u1 - a.u0) < eps) return { axis: 'y', line: a.u0, lo: vlo, hi: vhi };
  }
  if (uhi - ulo > 0.3) {
    if (Math.abs(a.v1 - b.v0) < eps) return { axis: 'x', line: a.v1, lo: ulo, hi: uhi };
    if (Math.abs(b.v1 - a.v0) < eps) return { axis: 'x', line: a.v0, lo: ulo, hi: uhi };
  }
  return null;
}

function openingAt(frame: Frame, kind: Opening['kind'], axis: 'x' | 'y', line: number, along: number, width: number): Opening {
  const u = axis === 'y' ? line : along;
  const v = axis === 'y' ? along : line;
  return { kind, x: round(frame.sx * u), y: round(frame.sy * v), width: round(width), axis };
}

function placeOnShared(seg: NonNullable<ReturnType<typeof shared>>, t: number, width: number) {
  const len = seg.hi - seg.lo;
  const w = Math.min(width, len - 0.2);
  const half = w / 2 + 0.1;
  const along = seg.lo + Math.min(Math.max(t * len, half), len - half);
  return { along, w };
}

function buildUnit(floor: number, spec: (typeof SLOTS)[number]): Unit {
  const { template, frame } = spec;
  const id = `${floor}${spec.slot}`;
  const boxes = new Map<string, Box>();
  const rooms: Room[] = template.rooms.map(([rid, kind, name, u0, v0, u1, v1]) => {
    const box = { u0, v0, u1, v1 };
    boxes.set(rid, box);
    return { id: `${id}-${rid}`, kind, name, rect: toRect(frame, box) };
  });
  for (const [hid, u0, v0, u1, v1] of template.halls) boxes.set(hid, { u0, v0, u1, v1 });

  const openings: Opening[] = [];
  const e = template.entry;
  openings.push(openingAt(frame, 'entry', e.axis, e.axis === 'y' ? e.u : e.v, e.axis === 'y' ? e.v : e.u, e.width));

  for (const [a, b, t, width] of template.doors) {
    const seg = shared(boxes.get(a)!, boxes.get(b)!);
    if (!seg) throw new Error(`no shared wall ${a} ${b}`);
    const { along, w } = placeOnShared(seg, t, width);
    openings.push(openingAt(frame, 'door', seg.axis, seg.line, along, w));
  }
  for (const [a, b, t, width] of template.windows) {
    const seg = shared(boxes.get(a)!, boxes.get(b)!);
    if (!seg) throw new Error(`no shared wall ${a} ${b}`);
    const { along, w } = placeOnShared(seg, t, width);
    openings.push(openingAt(frame, 'window', seg.axis, seg.line, along, w));
  }
  for (const [, kind, , u0, v0, u1, v1] of template.rooms) {
    if (kind === 'balcony') continue;
    const widthFor = (len: number) => {
      const preferred = kind === 'bath' ? 0.6 : kind === 'kitchen' ? 1.2 : 1.8;
      return Math.max(0.5, Math.min(preferred, len - (len < 1.6 ? 0.4 : 1.0)));
    };
    if (Math.abs(u1 - FACADE_U) < 1e-6) openings.push(openingAt(frame, 'window', 'y', FACADE_U, (v0 + v1) / 2, widthFor(v1 - v0)));
    if (Math.abs(v1 - FACADE_V) < 1e-6) openings.push(openingAt(frame, 'window', 'x', FACADE_V, (u0 + u1) / 2, widthFor(u1 - u0)));
  }

  const minX = Math.min(...rooms.map((r) => r.rect.x));
  const minY = Math.min(...rooms.map((r) => r.rect.y));
  const maxX = Math.max(...rooms.map((r) => r.rect.x + r.rect.w));
  const maxY = Math.max(...rooms.map((r) => r.rect.y + r.rect.d));
  const carpetM2 = rooms.filter((r) => r.kind !== 'balcony').reduce((s, r) => s + r.rect.w * r.rect.d, 0);
  const carpetSqft = Math.round(carpetM2 * SQFT_PER_M2);

  const north = spec.facing === 'NE' || spec.facing === 'NW';
  let view: string;
  let viewScore: number;
  if (floor <= 5) {
    view = 'Garden';
    viewScore = floor <= 2 ? 1 : 2;
  } else if (floor <= 12) {
    view = north ? 'Park and lake' : 'City';
    viewScore = (north ? 3 : 2) + (floor >= 9 ? 1 : 0);
  } else {
    view = 'Skyline';
    viewScore = 4 + (floor >= 16 ? 1 : 0);
  }
  const viewFactor = 1 + 0.01 * (viewScore - 3);
  const priceINR = Math.round((carpetSqft * BASE_RATE_INR * (1 + 0.012 * (floor - 1)) * FACING_FACTOR[spec.facing] * viewFactor) / 1000) * 1000;
  const sunHours = round(SUN_BASE[spec.facing] + (floor <= 4 ? -0.8 : floor >= 14 ? 0.4 : 0), 0.1);

  const soldP = 0.3 + 0.012 * (floor - 9.5);
  const r = rand01(`status:${id}`);
  const status: UnitStatus = r < soldP ? 'sold' : r < soldP + 0.15 ? 'reserved' : 'available';

  return {
    id,
    floor,
    slot: spec.slot,
    type: spec.type,
    carpetSqft,
    facing: spec.facing,
    status,
    priceINR,
    sunHours,
    view,
    viewScore,
    origin: { x: round(minX), y: round(minY) },
    size: { w: round(maxX - minX), d: round(maxY - minY) },
    rooms,
    openings,
  };
}

function buildTower(): Tower {
  const units: Unit[] = [];
  for (let floor = 1; floor <= FLOORS; floor++) for (const spec of SLOTS) units.push(buildUnit(floor, spec));
  return { name: 'Aster Residences', city: 'Bengaluru (illustrative)', floors: FLOORS, floorHeight: 3.2, footprint: { w: 34, d: 22 }, units };
}

export const TOWER: Tower = buildTower();

export const CORE = { w: 8, d: 6 } as const;
export const SQFT_PER_SQM = SQFT_PER_M2;

const BY_ID = new Map(TOWER.units.map((u) => [u.id, u]));

export function unitById(id: string): Unit | undefined {
  return BY_ID.get(id);
}

export function unitsOnFloor(floor: number): Unit[] {
  return TOWER.units.filter((u) => u.floor === floor);
}

export function formatINR(n: number): string {
  const v = Math.round(n);
  if (Math.abs(v) >= 1e5) {
    const lakh = Math.round((Math.abs(v) / 1e5) * 10) / 10;
    const sign = v < 0 ? '-' : '';
    if (lakh >= 100) return `${sign}₹${(Math.abs(v) / 1e7).toFixed(2).replace(/\.?0+$/, '')} Cr`;
    return `${sign}₹${lakh.toFixed(1).replace(/\.0$/, '')} L`;
  }
  return `₹${v.toLocaleString('en-IN')}`;
}
