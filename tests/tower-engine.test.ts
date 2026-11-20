import { describe, expect, it } from 'vitest';
import type { Brief, FurnishResult, Piece, Rect, Unit } from '../src/tower/model';
import { TOWER, formatINR, unitById, unitsOnFloor } from '../src/tower/tower';
import { CATALOG, applyPlan, checkLayout, furnish, parseBriefDefaults } from '../src/tower/furnish';

const U = (id: string) => unitById(id)!;
const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w - 1e-6 && b.x < a.x + a.w - 1e-6 && a.y < b.y + b.d - 1e-6 && b.y < a.y + a.d - 1e-6;
const inside = (a: Rect, o: Rect) => a.x >= o.x - 1e-6 && a.y >= o.y - 1e-6 && a.x + a.w <= o.x + o.w + 1e-6 && a.y + a.d <= o.y + o.d + 1e-6;
const onBoundary = (r: Rect, x: number, y: number) => {
  const t = 0.03;
  const inX = x >= r.x - t && x <= r.x + r.w + t;
  const inY = y >= r.y - t && y <= r.y + r.d + t;
  return (inX && (Math.abs(y - r.y) < t || Math.abs(y - r.y - r.d) < t)) || (inY && (Math.abs(x - r.x) < t || Math.abs(x - r.x - r.w) < t));
};
const kinds = (r: { issues: { kind: string }[] }) => r.issues.map((i) => i.kind);
const brief = (b: Partial<Brief> = {}) => parseBriefDefaults(b);
const room = (u: Unit, kind: string, i = 0) => u.rooms.filter((r) => r.kind === kind)[i];
const piecesIn = (res: FurnishResult, roomId: string, kind: string) => res.pieces.filter((p) => p.roomId === roomId && p.kind === kind);
const backGap = (p: Piece, r: Rect) => {
  const sw = p.rotation === 90 || p.rotation === 270;
  const hw = (sw ? p.d : p.w) / 2;
  const hd = (sw ? p.w : p.d) / 2;
  if (p.rotation === 0) return p.y - hd - r.y;
  if (p.rotation === 180) return r.y + r.d - (p.y + hd);
  if (p.rotation === 90) return p.x - hw - r.x;
  return r.x + r.w - (p.x + hw);
};
const FACE: Record<number, [number, number]> = { 0: [0, 1], 90: [1, 0], 180: [0, -1], 270: [-1, 0] };

describe('tower', () => {
  it('has 72 units with ids 1A..18D and the contract header', () => {
    expect(TOWER.units).toHaveLength(72);
    expect(TOWER.name).toBe('Aster Residences');
    expect(TOWER.city).toBe('Bengaluru (illustrative)');
    expect(TOWER.floors).toBe(18);
    expect(TOWER.floorHeight).toBe(3.2);
    expect(TOWER.footprint).toEqual({ w: 34, d: 22 });
    for (let f = 1; f <= 18; f++) for (const s of 'ABCD') expect(unitById(`${f}${s}`)?.floor).toBe(f);
    expect(unitById('19A')).toBeUndefined();
    expect(unitsOnFloor(12).map((u) => u.id)).toEqual(['12A', '12B', '12C', '12D']);
    expect(['3BHK', '2BHK', '2BHK', '1BHK']).toEqual(unitsOnFloor(1).map((u) => u.type));
  });

  it('has a pinned deterministic status sequence', () => {
    expect(TOWER.units.slice(0, 8).map((u) => u.status)).toMatchInlineSnapshot(`
      [
        "available",
        "reserved",
        "available",
        "reserved",
        "reserved",
        "reserved",
        "sold",
        "available",
      ]
    `);
  });

  it('prices rise with floor for every slot and match the formula', () => {
    for (const s of 'ABCD') {
      const col = TOWER.units.filter((u) => u.slot === s);
      const base = col[0].priceINR / col[0].carpetSqft;
      expect(base).toBeGreaterThan(9000);
      expect(col[17].priceINR).toBeGreaterThan(col[0].priceINR * 1.15);
      for (let i = 1; i < 18; i++) expect(col[i].priceINR).toBeGreaterThanOrEqual(col[i - 1].priceINR * 0.995);
    }
    const u = U('10A');
    const expected = u.carpetSqft * 9800 * (1 + 0.012 * 9) * 1.04 * (1 + 0.01 * (u.viewScore - 3));
    expect(Math.abs(u.priceINR - expected)).toBeLessThanOrEqual(1000);
    expect(U('1A').priceINR).toBeGreaterThan(U('1B').priceINR);
  });

  it('has sensible carpet areas', () => {
    for (const u of TOWER.units) {
      const range = { '1BHK': [550, 700], '2BHK': [900, 1150], '3BHK': [1300, 1600] }[u.type];
      expect(u.carpetSqft).toBeGreaterThanOrEqual(range[0]);
      expect(u.carpetSqft).toBeLessThanOrEqual(range[1]);
      const sum = u.rooms.filter((r) => r.kind !== 'balcony').reduce((s, r) => s + r.rect.w * r.rect.d, 0) * 10.764;
      expect(Math.abs(u.carpetSqft - sum)).toBeLessThan(1);
    }
  });

  it('keeps every room inside its unit, off the core and off other rooms', () => {
    const core = { x: -4, y: -3, w: 8, d: 6 };
    const foot = { x: -17, y: -11, w: 34, d: 22 };
    for (const f of [1, 9, 18]) {
      const all = unitsOnFloor(f).flatMap((u) => u.rooms.map((r) => ({ u, r })));
      for (const { u, r } of all) {
        expect(inside(r.rect, { x: u.origin.x, y: u.origin.y, w: u.size.w, d: u.size.d })).toBe(true);
        expect(inside(r.rect, foot)).toBe(true);
        expect(overlap(r.rect, core)).toBe(false);
      }
      for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) expect(overlap(all[i].r.rect, all[j].r.rect)).toBe(false);
    }
    expect(new Set(TOWER.units.flatMap((u) => u.rooms.map((r) => r.id))).size).toBe(TOWER.units.flatMap((u) => u.rooms).length);
  });

  it('draws like an Indian flat: room proportions', () => {
    for (const u of TOWER.units) {
      for (const r of u.rooms) {
        const lo = Math.min(r.rect.w, r.rect.d);
        const hi = Math.max(r.rect.w, r.rect.d);
        if (r.kind === 'bedroom' || r.kind === 'master') {
          expect(lo).toBeGreaterThanOrEqual(3);
          expect(hi).toBeGreaterThanOrEqual(3.2);
        }
        if (r.kind === 'living') expect(lo).toBeGreaterThanOrEqual(3.6);
        if (r.kind === 'bath') {
          expect(lo).toBeGreaterThanOrEqual(1.6);
          expect(hi).toBeLessThanOrEqual(2.6);
        }
      }
      const counts = { bedrooms: u.rooms.filter((r) => r.kind === 'bedroom' || r.kind === 'master').length, baths: u.rooms.filter((r) => r.kind === 'bath').length };
      expect(counts.bedrooms).toBe({ '1BHK': 1, '2BHK': 2, '3BHK': 3 }[u.type]);
      expect(counts.baths).toBeGreaterThanOrEqual(u.type === '1BHK' ? 1 : 2);
      expect(u.rooms.some((r) => r.kind === 'balcony')).toBe(true);
      expect(u.rooms.some((r) => r.kind === 'kitchen')).toBe(true);
    }
  });

  it('puts doors on shared walls, the entry by the core and windows on facades', () => {
    for (const u of unitsOnFloor(7)) {
      const entry = u.openings.filter((o) => o.kind === 'entry');
      expect(entry).toHaveLength(1);
      expect(Math.abs(entry[0].x)).toBeLessThanOrEqual(5.5 + 1e-6);
      expect(Math.abs(entry[0].y)).toBeLessThanOrEqual(4.5 + 1e-6);
      expect(Math.abs(Math.abs(entry[0].x) - 5.5) < 1e-6 || Math.abs(Math.abs(entry[0].y) - 4.5) < 1e-6).toBe(true);
      for (const o of u.openings.filter((x) => x.kind === 'door')) {
        const touching = u.rooms.filter((r) => onBoundary(r.rect, o.x, o.y));
        expect(touching.length).toBeGreaterThanOrEqual(1);
        expect(touching.length).toBeLessThanOrEqual(2);
      }
      for (const r of u.rooms.filter((q) => q.kind === 'master' || q.kind === 'bedroom' || q.kind === 'kitchen')) {
        const facade = u.openings.some((o) => o.kind === 'window' && onBoundary(r.rect, o.x, o.y) && (Math.abs(Math.abs(o.x) - 17) < 1e-6 || Math.abs(Math.abs(o.y) - 11) < 1e-6));
        expect(facade).toBe(true);
      }
      for (const o of u.openings.filter((x) => x.kind === 'window')) expect(u.rooms.some((r) => onBoundary(r.rect, o.x, o.y))).toBe(true);
    }
  });

  it('has the status mix, facing, sun and view tables', () => {
    const n = (s: string) => TOWER.units.filter((u) => u.status === s).length;
    expect(n('available')).toBeGreaterThan(30);
    expect(n('available') + n('reserved') + n('sold')).toBe(72);
    expect(n('sold')).toBeGreaterThan(12);
    expect(n('reserved')).toBeGreaterThan(5);
    const sold = (a: number, b: number) => TOWER.units.filter((u) => u.floor >= a && u.floor <= b && u.status === 'sold').length;
    expect(sold(10, 18)).toBeGreaterThan(sold(1, 9));
    expect(['NE', 'NW', 'SW', 'SE']).toEqual(unitsOnFloor(3).map((u) => u.facing));
    expect(U('4A').sunHours).toBeGreaterThan(U('4B').sunHours);
    expect(U('2A').view).toBe('Garden');
    expect(U('9A').view).toBe('Park and lake');
    expect(U('9D').view).toBe('City');
    expect(U('17A').view).toBe('Skyline');
    for (const u of TOWER.units) {
      expect(u.viewScore).toBeGreaterThanOrEqual(1);
      expect(u.viewScore).toBeLessThanOrEqual(5);
    }
    expect(U('18A').viewScore).toBeGreaterThan(U('1A').viewScore);
  });

  it('formats rupees in Indian style', () => {
    expect(formatINR(14200000)).toBe('₹1.42 Cr');
    expect(formatINR(6530000)).toBe('₹65.3 L');
    expect(formatINR(650000)).toBe('₹6.5 L');
    expect(formatINR(600000)).toBe('₹6 L');
    expect(formatINR(45000)).toBe('₹45,000');
    expect(formatINR(1000)).toBe('₹1,000');
    expect(formatINR(10000000)).toBe('₹1 Cr');
    expect(formatINR(9996000)).toBe('₹1 Cr');
  });
});

describe('brief defaults', () => {
  it('fills and clamps', () => {
    expect(parseBriefDefaults({})).toEqual({ occupants: 2, budgetINR: 600000, style: 'warm-minimal', wfh: 0, kids: 0, pets: [], notes: '' });
    const b = parseBriefDefaults({ occupants: 99, wfh: 9, kids: 99, budgetINR: 5, style: 'bogus' as never, pets: ['Cat', 'cat', ' DOG ', 'a', 'b', 'c'] });
    expect(b.occupants).toBe(8);
    expect(b.wfh).toBe(8);
    expect(b.kids).toBe(7);
    expect(b.budgetINR).toBe(50000);
    expect(b.style).toBe('warm-minimal');
    expect(b.pets).toEqual(['cat', 'dog', 'a']);
    expect(parseBriefDefaults({ occupants: 1, kids: 3 }).kids).toBe(0);
    expect(parseBriefDefaults(null).occupants).toBe(2);
  });
});

describe('catalog', () => {
  it('has priced, coloured, sized entries for every style', () => {
    for (const [k, c] of Object.entries(CATALOG)) {
      expect(c.w, k).toBeGreaterThan(0.2);
      expect(c.rooms.length, k).toBeGreaterThan(0);
      for (const s of ['warm-minimal', 'scandi', 'indian-modern', 'industrial'] as const) {
        expect(c.priceByStyle[s], `${k} ${s}`).toBeGreaterThan(1000);
        expect(c.colorByStyle[s], `${k} ${s}`).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
    expect(CATALOG.sofa.priceByStyle['warm-minimal']).toBeGreaterThanOrEqual(45000);
    expect(Math.max(...Object.values(CATALOG.sofa.priceByStyle))).toBeLessThanOrEqual(120000);
  });
});

const SAMPLES: [string, Partial<Brief>][] = [
  ['12A', { occupants: 4, kids: 2, wfh: 1, budgetINR: 1200000 }],
  ['5D', { occupants: 1, wfh: 1, budgetINR: 300000 }],
  ['7B', { occupants: 2, wfh: 2, pets: ['cat'], budgetINR: 800000, style: 'scandi' }],
  ['3C', { occupants: 3, kids: 1, budgetINR: 700000, style: 'indian-modern' }],
  ['18A', { occupants: 2, wfh: 2, budgetINR: 1000000, style: 'industrial' }],
  ['9B', { occupants: 3, kids: 1, notes: 'we have a baby, need a crib', pets: ['dog'], budgetINR: 900000 }],
  ['1D', { occupants: 2, budgetINR: 400000 }],
  ['14C', { occupants: 4, kids: 2, budgetINR: 800000 }],
];

describe('furnish', () => {
  it.each(SAMPLES)('%s gives an ok layout with no issues', (id, b) => {
    const u = U(id);
    const r = furnish(u, brief(b));
    expect(r.issues).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.unitId).toBe(id);
    expect(r.costINR).toBe(r.pieces.reduce((s, p) => s + p.priceINR, 0));
    expect(r.costINR).toBeLessThanOrEqual(r.brief.budgetINR);
    expect(new Set(r.pieces.map((p) => p.id)).size).toBe(r.pieces.length);
    expect(checkLayout(u, r.pieces, r.brief)).toEqual([]);
  });

  it('is deterministic', () => {
    const a = furnish(U('12A'), brief(SAMPLES[0][1]));
    const b = furnish(U('12A'), brief(SAMPLES[0][1]));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('meets the brief needs', () => {
    const r = furnish(U('7B'), brief(SAMPLES[2][1]));
    expect(r.pieces.filter((p) => p.kind === 'desk').length).toBeGreaterThanOrEqual(2);
    expect(r.pieces.some((p) => p.kind === 'cat-tree')).toBe(true);
    const four = furnish(U('12A'), brief(SAMPLES[0][1]));
    expect(four.pieces.filter((p) => p.kind === 'bed-single').length).toBe(2);
    expect(four.pieces.some((p) => p.kind === 'bed-queen')).toBe(true);
    const baby = furnish(U('9B'), brief(SAMPLES[5][1]));
    expect(baby.pieces.some((p) => p.kind === 'crib')).toBe(true);
    expect(baby.pieces.some((p) => p.kind === 'bean-bag')).toBe(true);
    const wfhOne = furnish(U('5D'), brief(SAMPLES[1][1]));
    expect(wfhOne.pieces.filter((p) => p.kind === 'desk')).toHaveLength(1);
  });

  it('colours and prices pieces by style', () => {
    const w = furnish(U('12A'), brief({ occupants: 2, style: 'warm-minimal', budgetINR: 3000000 }));
    const i = furnish(U('12A'), brief({ occupants: 2, style: 'indian-modern', budgetINR: 3000000 }));
    expect(i.costINR).toBeGreaterThan(w.costINR);
    const sofa = i.pieces.find((p) => p.kind === 'sofa')!;
    expect(sofa.color).toBe(CATALOG.sofa.colorByStyle['indian-modern']);
    expect(sofa.priceINR).toBe(CATALOG.sofa.priceByStyle['indian-modern']);
  });

  it('lowering the budget lowers the cost and still fits when it can', () => {
    let last = Infinity;
    for (const budget of [3000000, 800000, 450000, 330000]) {
      const r = furnish(U('12A'), brief({ occupants: 2, budgetINR: budget }));
      expect(r.costINR).toBeLessThanOrEqual(last);
      expect(r.costINR).toBeLessThanOrEqual(budget);
      expect(r.ok).toBe(true);
      last = r.costINR;
    }
    const rich = furnish(U('12A'), brief({ occupants: 2, budgetINR: 3000000 }));
    const lean = furnish(U('12A'), brief({ occupants: 2, budgetINR: 330000 }));
    expect(lean.costINR).toBeLessThan(rich.costINR * 0.8);
    expect(lean.pieces.length).toBeLessThan(rich.pieces.length);
  });

  it('reports over-budget honestly when even the essentials do not fit', () => {
    const r = furnish(U('12A'), brief({ occupants: 2, budgetINR: 100000 }));
    expect(kinds(r)).toContain('over-budget');
    expect(r.ok).toBe(false);
    expect(r.pieces.some((p) => p.kind === 'sofa')).toBe(true);
  });

  it('reports missing beds when the flat is too small', () => {
    const r = furnish(U('5D'), brief({ occupants: 4, budgetINR: 800000 }));
    expect(kinds(r)).toContain('missing-need');
  });

  it('places like a designer: sofa back to a wall facing the TV, headboard on a wall, wardrobe clear of doors', () => {
    for (const [id, b] of SAMPLES) {
      const u = U(id);
      const r = furnish(u, brief({ ...b, budgetINR: 3000000 }));
      const living = room(u, 'living');
      const sofa = piecesIn(r, living.id, 'sofa')[0];
      const tv = piecesIn(r, living.id, 'tv-unit')[0];
      expect(sofa, id).toBeDefined();
      expect(tv, id).toBeDefined();
      expect(backGap(sofa, living.rect), id).toBeLessThan(0.05);
      expect(backGap(tv, living.rect), id).toBeLessThan(0.05);
      const f = FACE[sofa.rotation];
      const to = [tv.x - sofa.x, tv.y - sofa.y];
      const len = Math.hypot(to[0], to[1]);
      expect((f[0] * to[0] + f[1] * to[1]) / len, id).toBeGreaterThan(0.9);
      expect(len, id).toBeGreaterThan(2.2);
      expect(len, id).toBeLessThan(4.8);
      const master = room(u, 'master');
      const bed = r.pieces.find((p) => p.roomId === master.id && (p.kind === 'bed-queen' || p.kind === 'bed-double'))!;
      expect(bed, id).toBeDefined();
      expect(backGap(bed, master.rect), id).toBeLessThan(0.05);
      for (const w of r.pieces.filter((p) => p.kind === 'wardrobe')) expect(backGap(w, u.rooms.find((q) => q.id === w.roomId)!.rect), id).toBeLessThan(0.05);
      const dining = r.pieces.find((p) => p.kind === 'dining-table');
      if (dining) {
        const kitchen = room(u, 'kitchen').rect;
        const toKitchen = Math.hypot(dining.x - (kitchen.x + kitchen.w / 2), dining.y - (kitchen.y + kitchen.d / 2));
        expect(toKitchen, id).toBeLessThan(8);
      }
    }
  });

  it('puts desks near windows', () => {
    for (const [id, b] of SAMPLES.filter(([, x]) => (x.wfh ?? 0) > 0)) {
      const u = U(id);
      const r = furnish(u, brief(b));
      const wins = u.openings.filter((o) => o.kind === 'window');
      for (const d of r.pieces.filter((p) => p.kind === 'desk')) {
        const near = Math.min(...wins.map((w) => Math.hypot(w.x - d.x, w.y - d.y)));
        expect(near, `${id} ${d.id}`).toBeLessThan(4.5);
      }
    }
  });

  it('keeps pieces in rooms where they belong and flat items out of the overlap test', () => {
    for (const [id, b] of SAMPLES) {
      const r = furnish(U(id), brief(b));
      for (const p of r.pieces) {
        const rm = U(id).rooms.find((q) => q.id === p.roomId)!;
        expect(CATALOG[p.kind].rooms).toContain(rm.kind);
      }
    }
    const withRug = furnish(U('12A'), brief({ budgetINR: 3000000 }));
    expect(withRug.pieces.some((p) => p.kind === 'rug')).toBe(true);
    expect(withRug.ok).toBe(true);
  });

  it('furnishes a wide sample of units and briefs', () => {
    let ok = 0;
    let n = 0;
    for (const u of TOWER.units.filter((x) => x.floor % 4 === 2)) {
      for (const b of [{ occupants: 2 }, { occupants: u.type === '1BHK' ? 2 : 3, kids: u.type === '1BHK' ? 0 : 1, budgetINR: 900000 }, { occupants: 2, wfh: 2, pets: ['cat'], budgetINR: 700000, style: 'industrial' as const }]) {
        const r = furnish(u, brief(b));
        n++;
        if (r.ok) ok++;
      }
    }
    expect(ok).toBe(n);
  });
});

describe('checkLayout catches known-wrong layouts', () => {
  const u = U('12A');
  const b = brief({ occupants: 2, wfh: 1, budgetINR: 1500000 });
  const good = furnish(u, b);
  const living = room(u, 'living');
  const master = room(u, 'master');
  const clone = (p: Piece, patch: Partial<Piece>): Piece => ({ ...p, id: `${p.id}-x`, ...patch });

  it('control: the untouched layout is clean', () => {
    expect(good.ok).toBe(true);
    expect(checkLayout(u, good.pieces, b)).toEqual([]);
  });

  it('piece overlapping another piece', () => {
    const sofa = good.pieces.find((p) => p.kind === 'sofa')!;
    const issues = checkLayout(u, [...good.pieces, clone(sofa, {})], b);
    expect(issues.map((i) => i.kind)).toContain('overlap');
    const tv = good.pieces.find((p) => p.kind === 'tv-unit')!;
    expect(checkLayout(u, [...good.pieces, clone(sofa, { x: tv.x, y: tv.y + 0.1 })], b).map((i) => i.kind)).toContain('overlap');
  });

  it('flush pieces are not overlaps', () => {
    const wardrobe = good.pieces.find((p) => p.kind === 'wardrobe')!;
    const a = clone(wardrobe, { roomId: master.id, x: 14, y: 7.0, rotation: 0 });
    const c = clone(wardrobe, { id: 'second', roomId: master.id, x: 14 + 1.8, y: 7.0, rotation: 0 });
    const kindsFound = checkLayout(u, [a, c], brief({ occupants: 1, budgetINR: 9000000 })).map((i) => i.kind);
    expect(kindsFound).not.toContain('overlap');
  });

  it('sofa in a doorway', () => {
    const door = u.openings.find((o) => o.kind === 'door' && Math.abs(o.x - 8) < 0.01)!;
    const sofa = good.pieces.find((p) => p.kind === 'sofa')!;
    const moved = good.pieces.map((p) => (p.id === sofa.id ? { ...p, x: door.x - 0.7, y: door.y, rotation: 90 as const } : p));
    const issues = checkLayout(u, moved, b);
    expect(issues.some((i) => i.kind === 'blocks-door' && i.pieceId === sofa.id)).toBe(true);
    const entryDoor = u.openings.find((o) => o.kind === 'door' && o.axis === 'x' && o.y < 5 && o.y > 4)!;
    const blocked = good.pieces.map((p) => (p.id === sofa.id ? { ...p, x: entryDoor.x, y: entryDoor.y + 0.5, rotation: 0 as const } : p));
    expect(checkLayout(u, blocked, b).some((i) => i.kind === 'blocks-door')).toBe(true);
  });

  it('a piece just outside the 0.9 m square is allowed', () => {
    const door = u.openings.find((o) => o.kind === 'door' && Math.abs(o.x - 8) < 0.01)!;
    const plant = clone(good.pieces.find((p) => p.kind === 'plant')!, { roomId: living.id, x: door.x - 0.9 - 0.21, y: door.y, rotation: 0 });
    const kindsFound = checkLayout(u, [plant], brief({ occupants: 1, budgetINR: 9000000 })).map((i) => i.kind);
    expect(kindsFound).not.toContain('blocks-door');
    const near = { ...plant, x: door.x - 0.5 };
    expect(checkLayout(u, [near], brief({ occupants: 1, budgetINR: 9000000 })).map((i) => i.kind)).toContain('blocks-door');
  });

  it('bed outside its room', () => {
    const bed = good.pieces.find((p) => p.kind === 'bed-queen')!;
    const outside = good.pieces.map((p) => (p.id === bed.id ? { ...p, x: 30, y: 30 } : p));
    expect(checkLayout(u, outside, b).some((i) => i.kind === 'outside-room' && i.pieceId === bed.id)).toBe(true);
    const half = good.pieces.map((p) => (p.id === bed.id ? { ...p, x: master.rect.x + master.rect.w - 0.3 } : p));
    expect(checkLayout(u, half, b).some((i) => i.kind === 'outside-room' && i.pieceId === bed.id)).toBe(true);
    const wrongRoom = good.pieces.map((p) => (p.id === bed.id ? { ...p, roomId: room(u, 'bath').id, x: room(u, 'bath').rect.x + 1.1, y: room(u, 'bath').rect.y + 1.2 } : p));
    expect(checkLayout(u, wrongRoom, b).some((i) => i.kind === 'outside-room')).toBe(true);
    const ghost = good.pieces.map((p) => (p.id === bed.id ? { ...p, roomId: 'nowhere' } : p));
    expect(checkLayout(u, ghost, b).some((i) => i.kind === 'outside-room')).toBe(true);
  });

  it('over budget', () => {
    const issues = checkLayout(u, good.pieces, { ...b, budgetINR: good.costINR - 1 });
    expect(issues.map((i) => i.kind)).toContain('over-budget');
    expect(checkLayout(u, good.pieces, { ...b, budgetINR: good.costINR }).map((i) => i.kind)).not.toContain('over-budget');
  });

  it('missing wfh desk', () => {
    const noDesk = good.pieces.filter((p) => p.kind !== 'desk' && p.kind !== 'office-chair');
    expect(checkLayout(u, noDesk, b).some((i) => i.kind === 'missing-need' && /work from home/.test(i.message))).toBe(true);
    expect(checkLayout(u, good.pieces, { ...b, wfh: 2 }).some((i) => i.kind === 'missing-need')).toBe(true);
  });

  it('missing beds, cat tree and dog bed', () => {
    const noBeds = good.pieces.filter((p) => !p.kind.startsWith('bed-'));
    expect(checkLayout(u, noBeds, b).some((i) => i.kind === 'missing-need' && /Beds sleep/.test(i.message))).toBe(true);
    expect(checkLayout(u, good.pieces, { ...b, pets: ['cat'] }).some((i) => /cat tree/.test(i.message))).toBe(true);
    expect(checkLayout(u, good.pieces, { ...b, pets: ['dog'] }).some((i) => /dog/.test(i.message))).toBe(true);
    expect(checkLayout(u, good.pieces, { ...b, pets: ['fish'] })).toEqual([]);
  });

  it('a wall of wardrobes across the master walkway', () => {
    const w = good.pieces.find((p) => p.kind === 'wardrobe')!;
    const wall = [
      clone(w, { id: 'w1', roomId: master.id, x: 13.5, y: 8.4, rotation: 0 }),
      clone(w, { id: 'w2', roomId: master.id, x: 15.3, y: 8.4, rotation: 0 }),
      clone(w, { id: 'w3', roomId: master.id, x: 16.65, y: 8.4, rotation: 0, w: 0.5 }),
    ];
    const issues = checkLayout(u, wall, brief({ occupants: 1, budgetINR: 9000000 }));
    expect(issues.map((i) => i.kind)).toContain('tight-walkway');
    const open = [wall[0]];
    expect(checkLayout(u, open, brief({ occupants: 1, budgetINR: 9000000 })).map((i) => i.kind)).not.toContain('tight-walkway');
  });

  it('a piece in a 0.5 m gap beside a bed in the living room path', () => {
    const sofa = good.pieces.find((p) => p.kind === 'sofa')!;
    const chair = good.pieces.find((p) => p.kind === 'dining-chair')!;
    const items = [clone(sofa, { x: 4.0, y: 6.4, rotation: 0 }), clone(chair, { x: 4.0, y: 6.4 })];
    expect(checkLayout(u, items, brief({ occupants: 1, budgetINR: 9000000 })).map((i) => i.kind)).toContain('overlap');
  });
});

describe('applyPlan', () => {
  const u = U('12A');
  const b = brief({ occupants: 2, wfh: 1, budgetINR: 1500000 });
  const living = room(u, 'living').id;
  const master = room(u, 'master').id;
  const bed3 = u.rooms.find((r) => r.id.endsWith('bed3'))!.id;

  it('snaps to walls when x/y are omitted and checks the result', () => {
    const r = applyPlan(u, b, [
      { roomId: living, kind: 'tv-unit' },
      { roomId: living, kind: 'sofa' },
      { roomId: living, kind: 'coffee-table' },
      { roomId: master, kind: 'bed-queen' },
      { roomId: master, kind: 'wardrobe' },
      { roomId: master, kind: 'side-table' },
      { roomId: bed3, kind: 'desk' },
      { roomId: bed3, kind: 'office-chair' },
    ]);
    expect(r.pieces).toHaveLength(8);
    expect(r.issues).toEqual([]);
    const rl = room(u, 'living').rect;
    const sofa = r.pieces.find((p) => p.kind === 'sofa')!;
    const tv = r.pieces.find((p) => p.kind === 'tv-unit')!;
    expect(backGap(tv, rl)).toBeLessThan(0.05);
    expect(backGap(sofa, rl)).toBeLessThan(0.05);
    const f = FACE[sofa.rotation];
    expect(f[0] * (tv.x - sofa.x) + f[1] * (tv.y - sofa.y)).toBeGreaterThan(2);
    expect(backGap(r.pieces.find((p) => p.kind === 'bed-queen')!, room(u, 'master').rect)).toBeLessThan(0.05);
  });

  it('keeps explicit x, y and rotation and snaps near-wall pieces flush', () => {
    const rm = room(u, 'master').rect;
    const r = applyPlan(u, brief({ occupants: 1, budgetINR: 9000000 }), [{ roomId: master, kind: 'wardrobe', x: rm.x + rm.w - 0.38, y: rm.y + 3, rotation: 270 }]);
    const w = r.pieces[0];
    expect(w.rotation).toBe(270);
    expect(backGap(w, rm)).toBeCloseTo(0, 2);
    const loose = applyPlan(u, brief({ occupants: 1, budgetINR: 9000000 }), [{ roomId: master, kind: 'side-table', x: rm.x + 2.5, y: rm.y + 2.5 }]);
    expect(loose.pieces[0].x).toBeCloseTo(rm.x + 2.5, 3);
  });

  it('flags bad plans and does not throw', () => {
    const r = applyPlan(u, b, [
      { roomId: 'nowhere', kind: 'sofa' },
      { roomId: master, kind: 'sofa', x: 99, y: 99 },
      { roomId: master, kind: 'nope' as never },
      { roomId: living, kind: 'sofa', x: 3, y: 6, rotation: 0 },
      { roomId: living, kind: 'tv-unit', x: 3.2, y: 6.2, rotation: 0 },
    ]);
    expect(r.ok).toBe(false);
    const ks = kinds(r);
    expect(ks).toContain('outside-room');
    expect(ks).toContain('overlap');
  });

  it('reports missing needs and budget from agent plans', () => {
    const r = applyPlan(u, brief({ occupants: 2, wfh: 2, budgetINR: 50000 }), [
      { roomId: living, kind: 'sofa' },
      { roomId: master, kind: 'bed-queen' },
    ]);
    const ks = kinds(r);
    expect(ks).toContain('over-budget');
    expect(ks).toContain('missing-need');
    expect(r.costINR).toBe(CATALOG.sofa.priceByStyle['warm-minimal'] + CATALOG['bed-queen'].priceByStyle['warm-minimal']);
  });
});

describe('plan replay', () => {
  it.each(SAMPLES)('%s: furnish replayed through applyPlan is ok, with and without coordinates', (id, b) => {
    const u = U(id);
    const br = brief(b);
    const f = furnish(u, br);
    const bare = applyPlan(u, br, f.pieces.map((p) => ({ roomId: p.roomId, kind: p.kind })));
    expect(bare.issues).toEqual([]);
    const rot = applyPlan(u, br, f.pieces.map((p) => ({ roomId: p.roomId, kind: p.kind, rotation: p.rotation })));
    expect(rot.issues).toEqual([]);
    const full = applyPlan(u, br, f.pieces.map((p) => ({ roomId: p.roomId, kind: p.kind, x: p.x, y: p.y, rotation: p.rotation })));
    expect(full.issues).toEqual([]);
    expect(full.pieces).toHaveLength(f.pieces.length);
  });

  it('a rug never blocks other placements', () => {
    const u = U('12A');
    const living = room(u, 'living').id;
    const r = applyPlan(u, brief({ budgetINR: 9000000 }), [{ roomId: living, kind: 'rug' }, { roomId: living, kind: 'tv-unit' }, { roomId: living, kind: 'sofa' }, { roomId: living, kind: 'coffee-table' }]);
    expect(r.pieces).toHaveLength(4);
    expect(kinds(r)).not.toContain('overlap');
  });
});
