import { describe, expect, it } from 'vitest';
import type { CablePath, LabDesign, LabItem } from '../src/lab/model';
import { createOffice, piece } from '../src/lab/scenario';
import { CHANNELS, FIRE_CELL, REACTION_S, SMOKE_SPEED, WALK_SPEED } from '../src/lab/rules';
import { evaluate, footprint, routeFromDoor, walkGrid } from '../src/lab/checks';
import { routeCables } from '../src/lab/route';
import { defaultFireStart, runDrill } from '../src/lab/smoke';
import { cheapestWithin, lowestCarbon, materialOptions } from '../src/lab/optimise';

const patch = (design: LabDesign, id: string, changes: Partial<LabItem>): LabDesign => ({ ...design, items: design.items.map(item => (item.id === id ? { ...item, ...changes } : item)) });
const add = (design: LabDesign, ...items: LabItem[]): LabDesign => ({ ...design, items: [...design.items, ...items] });
const without = (design: LabDesign, id: string): LabDesign => ({ ...design, items: design.items.filter(item => item.id !== id) });
const only = (design: LabDesign, items: LabItem[]): LabDesign => ({ ...design, items });
const rules = (design: LabDesign) => evaluate(design).issues.map(each => each.rule);
const find = (design: LabDesign, rule: string) => evaluate(design).issues.filter(each => each.rule === rule);
const cable = (design: LabDesign, id: string): CablePath => routeCables(design).find(each => each.id === id) as CablePath;
const segmentSum = (points: [number, number][]) => points.slice(1).reduce((sum, point, i) => sum + Math.hypot(point[0] - points[i][0], point[1] - points[i][1]), 0);
const heater = (extra: Partial<LabItem>) => piece({ id: 'heater', name: 'Heater', kind: 'heater', x: 2.7, z: -1.2, socketId: 's4', ...extra });

describe('starting office, checked by hand', () => {
  const report = evaluate(createOffice());
  const load = (id: string) => report.meters.sockets.find(each => each.socketId === id)?.watts;

  it('socket 1 = desk 1 180 + desk 2 180 = 360 W', () => expect(load('s1')).toBe(360));
  it('socket 2 = desk 3 180 + router 15 = 195 W', () => expect(load('s2')).toBe(195));
  it('socket 3 = desks 4, 5, 6 = 3 x 180 = 540 W', () => expect(load('s3')).toBe(540));
  it('socket 4 = printer 600 + coffee 1800 + fridge 150 = 2550 W', () => expect(load('s4')).toBe(2550));
  it('socket 5 has nothing plugged in = 0 W but is still listed', () => expect(load('s5')).toBe(0));
  it('lists all 5 sockets', () => expect(report.meters.sockets).toHaveLength(5));

  it('circuit A = socket 1 360 + socket 2 195 = 555 W of 16 A x 230 V = 3680 W', () => {
    const circuit = report.meters.circuits.find(each => each.circuitId === 'a');
    expect([circuit?.watts, circuit?.limitW]).toEqual([555, 3680]);
  });

  it('circuit B = socket 3 540 + socket 4 2550 + socket 5 0 = 3090 W of 3680 W', () => {
    const circuit = report.meters.circuits.find(each => each.circuitId === 'b');
    expect([circuit?.watts, circuit?.limitW]).toEqual([3090, 3680]);
  });

  it('heat = devices 1080 desks + 600 + 1800 + 150 + 15 = 3645 W, plus 6 people x 100 = 4245 W, against 5000 W cooling', () => {
    expect(report.meters.people).toBe(6);
    expect(report.meters.heatW).toBe(4245);
    expect(report.meters.coolingW).toBe(5000);
  });

  it('cost = 6 desks x 90 + 1 shelf x 60 + 30 m2 x 28 + aircon 1900 + extinguisher 35 + cables', () => {
    const cables = report.cables.reduce((sum, each) => sum + each.length * CHANNELS[each.channel].costPerM, 0);
    expect(report.meters.costGBP).toBe(Math.round(540 + 60 + 840 + 1900 + 35 + cables));
  });

  it('carbon = 6 x 18 + 20 + 30 x 12 + aircon 330 + extinguisher 10 + cables', () => {
    const cables = report.cables.reduce((sum, each) => sum + each.length * CHANNELS[each.channel].carbonPerM, 0);
    expect(report.meters.carbonKg).toBe(Math.round(108 + 20 + 360 + 330 + 10 + cables));
  });

  it('cable totals equal the sum of cable lengths, loose is a subset', () => {
    expect(report.meters.cableM).toBeCloseTo(report.cables.reduce((sum, each) => sum + each.length, 0), 9);
    expect(report.meters.looseM).toBeCloseTo(report.cables.filter(each => each.channel === 'loose').reduce((sum, each) => sum + each.length, 0), 9);
    expect(report.meters.looseM).toBeLessThan(report.meters.cableM);
  });

  it('has a power cable for every powered item and a data cable for every data item', () => {
    const items = createOffice().items;
    expect(report.cables.filter(each => each.kind === 'power')).toHaveLength(items.filter(item => item.watts > 0).length);
    expect(report.cables.filter(each => each.kind === 'data')).toHaveLength(items.filter(item => item.data).length);
  });

  it('flags only the planned problems and nothing about load, heat, overlap or walking', () => {
    const found = new Set(rules(createOffice()));
    expect([...found].sort()).toEqual(['extinguisher-reach', 'extinguisher-type', 'shelf-load']);
  });

  it('messages carry real numbers', () => {
    expect(find(createOffice(), 'shelf-load')[0].message).toBe('Shelf holds 50 kg, over the 40 kg rating of MDF.');
  });

  it('runs well under 100 ms (target 20 ms)', () => {
    evaluate(createOffice());
    const start = performance.now();
    for (let i = 0; i < 5; i++) evaluate(createOffice());
    expect((performance.now() - start) / 5).toBeLessThan(100);
  });
});

describe('known-wrong designs are rejected', () => {
  it('2000 W heater on socket 4: 2550 + 2000 = 4550 W is over 2990 W (socket-load)', () => {
    const issues = find(add(createOffice(), heater({})), 'socket-load');
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toBe('Socket 4 carries 4,550 W, over its 2,990 W limit.');
  });

  it('heater on socket 5: circuit B 3090 + 2000 = 5090 W is over 3680 W (circuit-load)', () => {
    const design = add(createOffice(), heater({ x: -0.8, z: 2.2, socketId: 's5' }));
    const circuit = find(design, 'circuit-load');
    expect(circuit).toHaveLength(1);
    expect(circuit[0].message).toContain('5,090');
    expect(circuit[0].message).toContain('3,680');
    expect(find(design, 'socket-load')).toHaveLength(0);
  });

  it('heater on socket 5: heat 4245 + 2000 = 6245 W is over 5000 W cooling (heat-balance)', () => {
    const issues = find(add(createOffice(), heater({ x: -0.8, z: 2.2, socketId: 's5' })), 'heat-balance');
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('6,245');
    expect(issues[0].message).toContain('5,000');
  });

  it('a smaller air conditioner makes the unchanged office fail heat-balance: 4245 W is over 3500 W', () => {
    expect(find({ ...createOffice(), acId: 'ac-3500' }, 'heat-balance')).toHaveLength(1);
  });

  it('power and data both under the floor share one cover (data-separation), only for that desk', () => {
    const issues = find(patch(createOffice(), 'desk-1', { channel: 'floor', dataChannel: 'floor' }), 'data-separation');
    expect(issues.map(each => each.itemIds)).toEqual([['desk-1']]);
  });

  it('floor power with wall data is fine', () => {
    expect(find(patch(createOffice(), 'desk-1', { channel: 'floor', dataChannel: 'wall' }), 'data-separation')).toHaveLength(0);
  });

  it('50 kg on MDF rated 40 kg is rejected (shelf-load)', () => {
    expect(find(createOffice(), 'shelf-load')).toHaveLength(1);
  });

  it('water extinguisher 1.3 m from the coffee machine is rejected (extinguisher-type)', () => {
    const issues = find(createOffice(), 'extinguisher-type');
    expect(issues).toHaveLength(1);
    expect(issues[0].itemIds).toContain('ext-1');
    expect(issues[0].message).toContain('1.3 m');
  });

  it('foam is rejected too, CO2 and powder are not', () => {
    expect(find(patch(createOffice(), 'ext-1', { extinguisher: 'foam' }), 'extinguisher-type')).toHaveLength(1);
    expect(find(patch(createOffice(), 'ext-1', { extinguisher: 'co2' }), 'extinguisher-type')).toHaveLength(0);
    expect(find(patch(createOffice(), 'ext-1', { extinguisher: 'powder' }), 'extinguisher-type')).toHaveLength(0);
  });

  it('printer, coffee and the 85% loaded socket 4 each need a safe extinguisher; a CO2 one by the door gives all three', () => {
    expect(find(createOffice(), 'extinguisher-reach')).toHaveLength(3);
    expect(find(patch(createOffice(), 'ext-1', { extinguisher: 'co2' }), 'extinguisher-reach')).toHaveLength(0);
  });

  it('no extinguisher near the door is a warning', () => {
    const issues = find(without(createOffice(), 'ext-1'), 'extinguisher-exit');
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('warning');
    expect(find(createOffice(), 'extinguisher-exit')).toHaveLength(0);
  });

  it('a loose cable from the coffee machine to socket 5 crosses the walkway (walkway-cable)', () => {
    const design = patch(createOffice(), 'coffee', { socketId: 's5' });
    expect(find(design, 'walkway-cable').map(each => each.itemIds)).toEqual([['coffee']]);
  });

  it('a wall-trunking cable still crosses the floor on its way to the wall: desk 5 data to the front wall (walkway-cable)', () => {
    const design = patch(createOffice(), 'desk-5', { dataChannel: 'wall' });
    expect(find(design, 'walkway-cable').map(each => each.itemIds)).toEqual([['desk-5']]);
  });

  it('the starting office has no walkway-cable issue', () => {
    expect(find(createOffice(), 'walkway-cable')).toHaveLength(0);
  });

  it('a loose cable over 3 m is a warning (loose-length): desk 6 at 2.9 m passes, the printer on socket 3 does not', () => {
    expect(find(createOffice(), 'loose-length')).toHaveLength(0);
    const issue = find(patch(createOffice(), 'printer', { socketId: 's3' }), 'loose-length')[0];
    expect(issue.severity).toBe('warning');
    expect(issue.itemIds).toEqual(['printer']);
  });

  it('desk 2 moved onto desk 1 overlaps', () => {
    const issues = find(patch(createOffice(), 'desk-2', { x: -1.8 }), 'overlap');
    expect(issues).toHaveLength(1);
    expect(issues[0].itemIds.sort()).toEqual(['desk-1', 'desk-2']);
  });

  it('desks that only touch do not overlap', () => {
    expect(find(patch(createOffice(), 'desk-2', { x: -0.8 }), 'overlap')).toHaveLength(0);
  });

  it('an item outside the room is rejected, rotation swaps its footprint', () => {
    expect(find(patch(createOffice(), 'fridge', { x: 2.8 }), 'overlap').length).toBeGreaterThan(0);
    const turned = patch(createOffice(), 'desk-4', { x: -2.8, rotation: 90 });
    expect(footprint(turned.items.find(item => item.id === 'desk-4') as LabItem).maxZ).toBeCloseTo(0.6 + 0.7, 9);
    expect(find(turned, 'overlap').length).toBeGreaterThan(0);
  });

  it('a powered item with no socket is rejected (socket-reach)', () => {
    expect(find(patch(createOffice(), 'fridge', { socketId: null }), 'socket-reach')).toHaveLength(1);
    expect(find(patch(createOffice(), 'fridge', { socketId: 's9' }), 'socket-reach')).toHaveLength(1);
  });

  describe('a chair boxed in', () => {
    const box = (name: string, x: number, z: number, w: number, d: number) => piece({ id: name, name, kind: 'shelf', x, z, w, d, loadKg: 0 });
    const ring = [box('top', 0, -0.6, 2, 0.4), box('bottom', 0, 0.6, 2, 0.4), box('left', -0.6, 0, 0.4, 0.8), box('right', 0.6, 0, 0.4, 0.8)];
    const chair = piece({ id: 'chair-1', name: 'Chair 1', kind: 'chair', x: 0, z: 0 });

    it('cannot be reached (walkway-clear)', () => {
      const design = only(createOffice(), [...ring, chair]);
      expect(routeFromDoor(design, 'chair-1')).toBeNull();
      expect(find(design, 'walkway-clear').map(each => each.itemIds)).toEqual([['chair-1']]);
    });

    it('the same chair with the box removed is reachable from the door', () => {
      const design = only(createOffice(), [chair]);
      const route = routeFromDoor(design, 'chair-1') as [number, number][];
      expect(route[0]).toEqual([1.9, 2.5]);
      const end = route[route.length - 1];
      expect(Math.hypot(end[0], end[1])).toBeLessThan(0.9);
      expect(find(design, 'walkway-clear')).toHaveLength(0);
    });
  });
});

describe('known-right fixes pass', () => {
  it('shelf on plywood (60 kg rating) clears shelf-load', () => {
    expect(find({ ...createOffice(), materials: { ...createOffice().materials, shelf: 'shelf-plywood' } }, 'shelf-load')).toHaveLength(0);
  });

  it('shelf on plywood is still rejected above 60 kg', () => {
    const design = patch({ ...createOffice(), materials: { ...createOffice().materials, shelf: 'shelf-plywood' } }, 'shelf', { loadKg: 61 });
    expect(find(design, 'shelf-load')).toHaveLength(1);
  });

  it('removing the heater clears heat-balance: 4245 W against 5000 W', () => {
    const design = add(createOffice(), heater({ x: -0.8, z: 2.2, socketId: 's5' }));
    expect(find(design, 'heat-balance')).toHaveLength(1);
    expect(find(without(design, 'heater'), 'heat-balance')).toHaveLength(0);
  });

  it('moving the coffee cable to the wall channel clears walkway-cable', () => {
    const crossing = patch(createOffice(), 'coffee', { socketId: 's5' });
    expect(find(crossing, 'walkway-cable')).toHaveLength(1);
    expect(find(patch(crossing, 'coffee', { channel: 'wall' }), 'walkway-cable')).toHaveLength(0);
  });

  it('a bigger air conditioner clears the heater overload on heat', () => {
    const design = { ...add(createOffice(), heater({ x: -0.8, z: 2.2, socketId: 's5' })), acId: 'ac-7100' };
    expect(find(design, 'heat-balance')).toHaveLength(0);
  });
});

describe('routing', () => {
  const door = (room: LabDesign['room']) => ({ from: room.door.x - room.door.width / 2, to: room.door.x + room.door.width / 2, z: room.depth / 2 - 0.05 });
  const far = (): LabDesign => ({ ...createOffice(), sockets: [...createOffice().sockets, { id: 's6', name: 'Socket 6', wall: 'front', x: 2.8, z: 2.5, circuitId: 'a' }] });
  const front = patch(far(), 'fridge', { x: -1.5, z: 2.1, channel: 'wall', socketId: 's6' });

  it('a wall route from beside the door to the other side of the door goes around the room, not through the opening', () => {
    const route = cable(front, 'fridge-power');
    const { from, to, z } = door(front.room);
    for (let i = 1; i < route.points.length; i++) {
      const [a, b] = [route.points[i - 1], route.points[i]];
      for (let t = 0; t <= 1; t += 0.01) {
        const x = a[0] + (b[0] - a[0]) * t;
        const y = a[1] + (b[1] - a[1]) * t;
        expect(y >= z - 1e-6 && x > from + 1e-6 && x < to - 1e-6).toBe(false);
      }
    }
    expect(route.length).toBeGreaterThan(14);
  });

  it('every wall route in the starting office stays 0.05 m off the wall or runs straight to it', () => {
    const wall = routeCables(createOffice()).filter(each => each.channel === 'wall');
    expect(wall.length).toBeGreaterThanOrEqual(4);
    for (const each of wall) for (const [x, z] of each.points.slice(1, -1)) {
      const inset = Math.min(3 - Math.abs(x), 2.5 - Math.abs(z));
      expect(inset).toBeLessThanOrEqual(0.05 + 1e-9);
    }
  });

  it('wall route length equals the sum of its segments', () => {
    for (const each of [...routeCables(createOffice()), cable(front, 'fridge-power')]) expect(each.length).toBeCloseTo(segmentSum(each.points), 9);
  });

  it('wall data cable from desk 1 runs to the data point on the back wall: down to the wall, along it, to the point', () => {
    const data = cable(createOffice(), 'desk-1-data');
    expect(data.channel).toBe('wall');
    expect(data.points[data.points.length - 1]).toEqual([1.6, -2.5]);
    expect(data.length).toBeCloseTo(0.2 + 3.8 + 0.05, 9);
  });

  it('loose length is the straight-line distance, printer: from (2.6, -1.825) to (3, -0.6) = sqrt(0.4^2 + 1.225^2)', () => {
    const power = cable(createOffice(), 'printer-power');
    expect(power.points).toHaveLength(2);
    expect(power.points[0][0]).toBeCloseTo(2.6, 9);
    expect(power.points[0][1]).toBeCloseTo(-1.825, 9);
    expect(power.points[1]).toEqual([3, -0.6]);
    expect(power.length).toBeCloseTo(Math.sqrt(0.16 + 1.500625), 9);
  });

  it('loose cable with a via point goes item, via, socket', () => {
    const power = cable(patch(createOffice(), 'printer', { via: [2, -1] }), 'printer-power');
    expect(power.points).toHaveLength(3);
    expect(power.points[1]).toEqual([2, -1]);
    expect(power.length).toBeCloseTo(segmentSum(power.points), 9);
  });

  it('floor route is L-shaped and its length is |dx| + |dz|', () => {
    const power = cable(patch(createOffice(), 'printer', { channel: 'floor' }), 'printer-power');
    const [a, b] = [power.points[0], power.points[power.points.length - 1]];
    expect(power.length).toBeCloseTo(Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]), 9);
    for (let i = 1; i < power.points.length; i++) expect(power.points[i][0] === power.points[i - 1][0] || power.points[i][1] === power.points[i - 1][1]).toBe(true);
  });

  it('floor route honours via', () => {
    const power = cable(patch(createOffice(), 'printer', { channel: 'floor', via: [1, 1] }), 'printer-power');
    expect(power.points.some(point => point[0] === 1 && point[1] === 1)).toBe(true);
  });

  it('ids and kinds follow item id', () => {
    const ids = routeCables(createOffice()).map(each => each.id);
    expect(ids).toContain('router-power');
    expect(ids).toContain('desk-3-data');
    expect(ids).not.toContain('ac-power');
  });

  it('walk grid: 0.1 m cells, 60 x 50, centre and toCell agree, free cells keep 0.45 m off the walls', () => {
    const grid = walkGrid(createOffice());
    expect([grid.cell, grid.cols, grid.rows]).toEqual([0.1, 60, 50]);
    const [x, z] = grid.centre(grid.toCell(0.52, 0.31));
    expect([x, z]).toEqual([expect.closeTo(0.55, 9), expect.closeTo(0.35, 9)]);
    expect(grid.free[grid.toCell(-2.95, 0)]).toBe(0);
    expect(grid.free[grid.toCell(0, -1)]).toBe(1);
    expect(grid.free[grid.toCell(-1.5, 0.6)]).toBe(0);
  });
});

describe('smoke drill', () => {
  const empty = (items: LabItem[]) => only(createOffice(), items);
  const index = (drill: ReturnType<typeof runDrill>, x: number, z: number) => Math.floor((z - drill.originZ) / drill.cell) * drill.cols + Math.floor((x - drill.originX) / drill.cell);
  const shelfAt = (id: string, z: number) => piece({ id, name: id, kind: 'shelf', x: 0, z, rotation: 90 });

  it('arrival is 0 at the start cell and grows with distance: 8 cells (2 m) away takes between 70% and 100% of 2 m at the smoke speed', () => {
    const drill = runDrill(empty([]), [-2, 0]);
    expect(drill.arrival[index(drill, -2, 0)]).toBe(0);
    const row = [0, 1, 2, 3, 4, 5, 6, 7, 8].map(step => drill.arrival[index(drill, -2 + step * 0.25, 0)]);
    row.slice(1).forEach((value, i) => expect(value).toBeGreaterThan(row[i]));
    expect(row[8]).toBeGreaterThanOrEqual(0.7 * 2 / SMOKE_SPEED - 1e-6);
    expect(row[8]).toBeLessThanOrEqual(2 / SMOKE_SPEED + 1e-6);
  });

  it('smoke moving away from the door and vent takes the full cell size over smoke speed per cell', () => {
    const drill = runDrill(empty([]), [-2.4, 0]);
    expect(drill.arrival[index(drill, -2.65, 0)]).toBeCloseTo(FIRE_CELL / SMOKE_SPEED, 5);
  });

  it('a gap-free wall of tall shelves stops smoke reaching the other side', () => {
    const wall = [-2, -1, 0, 1, 2].map(z => shelfAt(`s${z}`, z));
    const drill = runDrill(empty(wall), [-2, -1]);
    expect(drill.arrival[index(drill, 2, -1)]).toBe(Infinity);
    expect(runDrill(empty([]), [-2, -1]).arrival[index(drill, 2, -1)]).toBeLessThan(Infinity);
  });

  it('a wall with a gap delays smoke behind it by more than 5 s', () => {
    const wall = [-2, -1, 0, 1].map(z => shelfAt(`s${z}`, z));
    const blocked = runDrill(empty(wall), [-2, -1]);
    const open = runDrill(empty([]), [-2, -1]);
    const behind = index(blocked, 2, -1);
    expect(blocked.arrival[behind]).toBeLessThan(Infinity);
    expect(blocked.arrival[behind]).toBeGreaterThan(open.arrival[behind] + 5);
  });

  it('low items do not block smoke', () => {
    const wall = [-2, -1, 0, 1, 2].map(z => piece({ id: `d${z}`, name: 'Desk', kind: 'desk', x: 0, z, rotation: 90, w: 1, d: 0.4 }));
    expect(runDrill(empty(wall), [-2, -1]).arrival[index(runDrill(empty([]), [-2, -1]), 2, -1)]).toBeLessThan(Infinity);
  });

  it('a person next to the fire is caught, one far away gets out', () => {
    const drill = runDrill(createOffice(), [-2.2, -1]);
    const near = drill.people.find(each => each.itemId === 'chair-1');
    const away = drill.people.find(each => each.itemId === 'chair-6');
    expect(near?.safe).toBe(false);
    expect(near?.blockedS).not.toBeNull();
    expect(away?.safe).toBe(true);
    expect(away?.blockedS).toBeNull();
  });

  it('a later fire is less dangerous than a fire on the route', () => {
    const onRoute = runDrill(createOffice(), [1.9, 1.8]).people.filter(each => !each.safe).length;
    const cornerFire = runDrill(createOffice(), [-2.9, -2.4]).people.filter(each => !each.safe).length;
    expect(onRoute).toBeGreaterThan(cornerFire);
  });

  it('exit time = 5 s reaction + route length / 1.2 m/s, path runs seat to door', () => {
    const person = runDrill(createOffice(), [-2.2, -1]).people.find(each => each.itemId === 'chair-6');
    const path = person?.path ?? [];
    expect(path[path.length - 1]).toEqual([1.9, 2.5]);
    expect(person?.exitS).toBeCloseTo(REACTION_S + segmentSum(path) / WALK_SPEED, 9);
  });

  it('every chair is a person; an unreachable chair is not safe', () => {
    expect(runDrill(createOffice(), [0, 0]).people).toHaveLength(6);
    const trapped = only(createOffice(), [
      piece({ id: 'a', name: 'a', kind: 'shelf', x: 0, z: -0.6, w: 2, d: 0.4 }), piece({ id: 'b', name: 'b', kind: 'shelf', x: 0, z: 0.6, w: 2, d: 0.4 }),
      piece({ id: 'c', name: 'c', kind: 'shelf', x: -0.6, z: 0, w: 0.4, d: 0.8 }), piece({ id: 'd', name: 'd', kind: 'shelf', x: 0.6, z: 0, w: 0.4, d: 0.8 }),
      piece({ id: 'chair-1', name: 'Chair 1', kind: 'chair', x: 0, z: 0 }),
    ]);
    expect(runDrill(trapped, [2, 2]).people[0].safe).toBe(false);
  });

  it('the same input gives the same output', () => {
    const [a, b] = [runDrill(createOffice()), runDrill(createOffice())];
    expect(Array.from(a.arrival)).toEqual(Array.from(b.arrival));
    expect(a.people).toEqual(b.people);
    expect([a.start, a.endS]).toEqual([b.start, b.endS]);
  });

  it('endS is capped at 120 and covers the slowest exit', () => {
    const drill = runDrill(createOffice());
    expect(drill.endS).toBeLessThanOrEqual(120);
    expect(drill.endS).toBeGreaterThanOrEqual(Math.max(...drill.people.map(each => each.exitS)));
  });

  it('default fire start: most loaded socket 4 on the right wall at (3, -0.6), nudged 0.3 m in to (2.7, -0.6)', () => {
    const design = createOffice();
    expect(defaultFireStart(design, evaluate(design))).toEqual([2.7, -0.6]);
    expect(runDrill(design).start).toEqual([2.7, -0.6]);
  });

  it('default fire start with nothing plugged in is the coffee machine', () => {
    const design = only(createOffice(), createOffice().items.filter(item => item.id === 'coffee').map(item => ({ ...item, socketId: null })));
    expect(defaultFireStart(design, evaluate(design))).toEqual([2.7, 0.2]);
  });
});

describe('material optimiser', () => {
  const design = createOffice();
  const options = materialOptions(design);

  it('enumerates 4 desks x 3 shelves x 4 floors = 48 distinct options', () => {
    expect(options).toHaveLength(48);
    expect(new Set(options.map(each => JSON.stringify(each.materials))).size).toBe(48);
  });

  it('MDF shelves cannot hold 50 kg (40 kg rating): all 16 are infeasible, the other 32 are feasible', () => {
    expect(options.filter(each => each.materials.shelf === 'shelf-mdf').every(each => !each.feasible)).toBe(true);
    expect(options.filter(each => each.feasible)).toHaveLength(32);
  });

  it('with a 30 kg shelf load MDF becomes feasible', () => {
    expect(materialOptions(patch(design, 'shelf', { loadKg: 30 })).filter(each => each.feasible)).toHaveLength(48);
  });

  it('every pareto option is feasible', () => {
    expect(options.some(each => each.pareto)).toBe(true);
    expect(options.filter(each => each.pareto).every(each => each.feasible)).toBe(true);
  });

  it('no feasible option is at least as cheap and as low-carbon as a pareto option and better on one axis', () => {
    const feasible = options.filter(each => each.feasible);
    for (const best of options.filter(each => each.pareto)) {
      expect(feasible.some(other => other.costGBP <= best.costGBP && other.carbonKg <= best.carbonKg && (other.costGBP < best.costGBP || other.carbonKg < best.carbonKg))).toBe(false);
    }
  });

  it('every feasible non-pareto option is beaten by some feasible option', () => {
    const feasible = options.filter(each => each.feasible);
    for (const each of feasible.filter(one => !one.pareto)) {
      expect(feasible.some(other => other.costGBP <= each.costGBP && other.carbonKg <= each.carbonKg && (other.costGBP < each.costGBP || other.carbonKg < each.carbonKg))).toBe(true);
    }
  });

  it('option cost and carbon match evaluating that design directly', () => {
    const pick = options[17];
    const report = evaluate({ ...design, materials: pick.materials });
    expect([pick.costGBP, pick.carbonKg]).toEqual([report.meters.costGBP, report.meters.carbonKg]);
  });

  it('cheapest with a huge carbon allowance = global cheapest feasible: chipboard desks, plywood shelf, carpet', () => {
    const feasible = options.filter(each => each.feasible);
    const cheapest = Math.min(...feasible.map(each => each.costGBP));
    const pick = cheapestWithin(design, 1e9);
    expect(pick?.costGBP).toBe(cheapest);
    expect(pick?.materials).toEqual({ desk: 'desk-chipboard', shelf: 'shelf-plywood', floor: 'floor-carpet' });
  });

  it('cheapest within a tiny carbon limit is null', () => {
    expect(cheapestWithin(design, 1)).toBeNull();
  });

  it('cheapest within a limit respects the limit and is never beaten by another option inside it', () => {
    const limit = 1000;
    const pick = cheapestWithin(design, limit);
    expect(pick?.carbonKg).toBeLessThanOrEqual(limit);
    const rivals = options.filter(each => each.feasible && each.carbonKg <= limit);
    expect(Math.min(...rivals.map(each => each.costGBP))).toBe(pick?.costGBP);
  });

  it('lowest carbon = oak desks 6 x 11, plywood shelf 16, cork 30 m2 x 3', () => {
    const pick = lowestCarbon(design);
    expect(pick.materials).toEqual({ desk: 'desk-oak', shelf: 'shelf-plywood', floor: 'floor-cork' });
    expect(pick.carbonKg).toBe(Math.min(...options.filter(each => each.feasible).map(each => each.carbonKg)));
  });
});
