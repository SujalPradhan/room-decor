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
const heater = (extra: Partial<LabItem>) => piece({ id: 'heater', name: 'Heater', kind: 'heater', x: 4.85, z: 0.2, rotation: 270, socketId: 's6', ...extra });
const tidy = (): LabDesign => patch(patch(createOffice(), 'desk-9', { socketId: 's6' }), 'desk-10', { socketId: 's6' });

describe('starting office, checked by hand', () => {
  const report = evaluate(createOffice());
  const load = (id: string) => report.meters.sockets.find(each => each.socketId === id)?.watts;

  it('socket 1 = desk 2 = 180 W', () => expect(load('s1')).toBe(180));
  it('socket 2 = desks 1, 3, 9, 10 = 4 x 180 = 720 W', () => expect(load('s2')).toBe(720));
  it('socket 3 = desks 4, 5 + meeting screen = 180 + 180 + 60 = 420 W', () => expect(load('s3')).toBe(420));
  it('socket 4 = desks 6, 7 + router = 180 + 180 + 15 = 375 W', () => expect(load('s4')).toBe(375));
  it('socket 5 = desk 8 = 180 W', () => expect(load('s5')).toBe(180));
  it('socket 6 has nothing plugged in = 0 W but is still listed', () => expect(load('s6')).toBe(0));
  it('socket 7 = coffee machine 1800 + kettle 2000 = 3800 W', () => expect(load('s7')).toBe(3800));
  it('socket 8 = fridge = 150 W', () => expect(load('s8')).toBe(150));
  it('socket 9 = printer = 600 W', () => expect(load('s9')).toBe(600));
  it('lists all 9 sockets', () => expect(report.meters.sockets).toHaveLength(9));

  it('circuit A = socket 1 180 + socket 2 720 + socket 3 420 = 1320 W of 16 A x 230 V = 3680 W', () => {
    const circuit = report.meters.circuits.find(each => each.circuitId === 'a');
    expect([circuit?.watts, circuit?.limitW]).toEqual([1320, 3680]);
  });

  it('circuit B = socket 4 375 + socket 5 180 + socket 6 0 = 555 W of 3680 W', () => {
    const circuit = report.meters.circuits.find(each => each.circuitId === 'b');
    expect([circuit?.watts, circuit?.limitW]).toEqual([555, 3680]);
  });

  it('circuit C = socket 7 3800 + socket 8 150 + socket 9 600 = 4550 W of 20 A x 230 V = 4600 W, so only socket 7 is over', () => {
    const circuit = report.meters.circuits.find(each => each.circuitId === 'c');
    expect([circuit?.watts, circuit?.limitW]).toEqual([4550, 4600]);
    expect(find(createOffice(), 'circuit-load')).toHaveLength(0);
  });

  it('heat = devices 10 x 180 + 60 + 600 + 1800 + 2000 + 150 + 15 = 6425 W, plus 14 people x 100 = 7825 W, against 8000 W cooling', () => {
    expect(report.meters.people).toBe(14);
    expect(report.meters.heatW).toBe(7825);
    expect(report.meters.coolingW).toBe(8000);
  });

  it('cost = 12 desks x 90 + 2 shelves x 60 + 70 m2 x 28 + aircon 2900 + extinguishers 35 + 45 + cables', () => {
    const cables = report.cables.reduce((sum, each) => sum + each.length * CHANNELS[each.channel].costPerM, 0);
    expect(report.meters.costGBP).toBe(Math.round(1080 + 120 + 1960 + 2900 + 35 + 45 + cables));
  });

  it('carbon = 12 x 18 + 2 x 20 + 70 x 12 + aircon 500 + extinguishers 10 + 14 + cables', () => {
    const cables = report.cables.reduce((sum, each) => sum + each.length * CHANNELS[each.channel].carbonPerM, 0);
    expect(report.meters.carbonKg).toBe(Math.round(216 + 40 + 840 + 500 + 10 + 14 + cables));
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

  it('is 10 m x 7 m with the door on the front wall and 14 seats', () => {
    const { room, items } = createOffice();
    expect([room.width, room.depth, room.door.x, items.filter(item => item.kind === 'chair').length, items.filter(item => item.kind === 'desk').length]).toEqual([10, 7, 0, 14, 12]);
  });

  it('flags only the planned problems: 9 issues, 6 of them wiring', () => {
    const issues = evaluate(createOffice()).issues;
    expect(issues).toHaveLength(9);
    expect([...new Set(issues.map(each => each.rule))].sort()).toEqual(['data-separation', 'extinguisher-type', 'loose-length', 'shelf-load', 'socket-load', 'walkway-cable']);
    expect(issues.filter(each => ['socket-load', 'walkway-cable', 'loose-length', 'data-separation'].includes(each.rule))).toHaveLength(7);
  });

  it('nothing about heat, overlap, walking or circuits', () => {
    const found = rules(createOffice());
    for (const rule of ['heat-balance', 'overlap', 'walkway-clear', 'circuit-load', 'socket-reach', 'extinguisher-reach', 'extinguisher-exit']) expect(found).not.toContain(rule);
  });

  it('messages carry real numbers', () => {
    expect(find(createOffice(), 'shelf-load')[0].message).toBe('Shelf 1 holds 50 kg, over the 40 kg rating of MDF.');
    expect(find(createOffice(), 'socket-load')[0].message).toBe('Socket 7 carries 3,800 W, over its 2,990 W limit.');
  });

  it('runs well under 100 ms (target 20 ms)', () => {
    evaluate(createOffice());
    const start = performance.now();
    for (let i = 0; i < 5; i++) evaluate(createOffice());
    expect((performance.now() - start) / 5).toBeLessThan(100);
  });
});

describe('known-wrong designs are rejected', () => {
  it('coffee machine and kettle on socket 7: 1800 + 2000 = 3800 W is over 2990 W (socket-load), only that socket', () => {
    const issues = find(createOffice(), 'socket-load');
    expect(issues).toHaveLength(1);
    expect(issues[0].itemIds.sort()).toEqual(['coffee', 'kettle']);
  });

  it('2000 W heater on socket 9: circuit C 4550 + 2000 = 6550 W is over 4600 W (circuit-load), socket 9 itself 600 + 2000 = 2600 W is fine', () => {
    const design = add(createOffice(), heater({ x: 4.85, z: 0.2, socketId: 's9' }));
    const circuit = find(design, 'circuit-load');
    expect(circuit).toHaveLength(1);
    expect(circuit[0].message).toContain('6,550');
    expect(circuit[0].message).toContain('4,600');
    expect(find(design, 'socket-load')).toHaveLength(1);
  });

  it('2000 W heater: heat 7825 + 2000 = 9825 W is over 8000 W cooling (heat-balance)', () => {
    const issues = find(add(createOffice(), heater({})), 'heat-balance');
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('9,825');
    expect(issues[0].message).toContain('8,000');
  });

  it('2 desks and 2 chairs: heat 7825 + 2 x 180 + 2 x 100 = 8385 W is over 8000 W (heat-balance)', () => {
    const extra = ['a', 'b'].flatMap(name => [piece({ id: `desk-${name}`, name: `Desk ${name}`, kind: 'desk', x: -4.2, z: 3.2 }), piece({ id: `chair-${name}`, name: `Chair ${name}`, kind: 'chair', x: 0, z: 0 })]);
    const design = add(createOffice(), ...extra.map(item => (item.kind === 'desk' ? { ...item, socketId: 's6' } : item)));
    expect(evaluate(design).meters.heatW).toBe(8385);
    expect(find(design, 'heat-balance')).toHaveLength(1);
  });

  it('a smaller air conditioner makes the unchanged office fail heat-balance: 7825 W is over 7100 W', () => {
    expect(find({ ...createOffice(), acId: 'ac-7100' }, 'heat-balance')).toHaveLength(1);
  });

  it('power and data both under the floor share one cover (data-separation), only for desk 5', () => {
    const issues = find(createOffice(), 'data-separation');
    expect(issues.map(each => each.itemIds)).toEqual([['desk-5']]);
    expect(find(patch(createOffice(), 'desk-1', { channel: 'floor', dataChannel: 'floor' }), 'data-separation').map(each => each.itemIds)).toEqual([['desk-1'], ['desk-5']]);
  });

  it('floor power with wall data is fine', () => {
    expect(find(patch(createOffice(), 'desk-5', { dataChannel: 'wall' }), 'data-separation')).toHaveLength(0);
  });

  it('50 kg on MDF rated 40 kg is rejected (shelf-load), the 30 kg shelf is not', () => {
    expect(find(createOffice(), 'shelf-load').map(each => each.itemIds)).toEqual([['shelf-1']]);
  });

  it('water extinguisher 3.6 m from the kettle is rejected: sqrt(3.55^2 + 0.7^2) (extinguisher-type)', () => {
    const issues = find(createOffice(), 'extinguisher-type');
    expect(issues).toHaveLength(1);
    expect(issues[0].itemIds).toContain('ext-1');
    expect(issues[0].message).toContain('3.6 m');
  });

  it('foam is rejected too, CO2 and powder are not', () => {
    expect(find(patch(createOffice(), 'ext-1', { extinguisher: 'foam' }), 'extinguisher-type')).toHaveLength(1);
    expect(find(patch(createOffice(), 'ext-1', { extinguisher: 'co2' }), 'extinguisher-type')).toHaveLength(0);
    expect(find(patch(createOffice(), 'ext-1', { extinguisher: 'powder' }), 'extinguisher-type')).toHaveLength(0);
  });

  it('printer, coffee, kettle and the 127% loaded socket 7 each need a safe extinguisher within 5 m: without the CO2 one by the kitchen all four fail', () => {
    expect(find(createOffice(), 'extinguisher-reach')).toHaveLength(0);
    expect(find(without(createOffice(), 'ext-2'), 'extinguisher-reach')).toHaveLength(4);
  });

  it('no extinguisher near the door is a warning', () => {
    const issues = find(without(createOffice(), 'ext-1'), 'extinguisher-exit');
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('warning');
    expect(find(createOffice(), 'extinguisher-exit')).toHaveLength(0);
  });

  it('desks 9 and 10 plugged into socket 2 across the aisle: both leads cross the walkway (walkway-cable)', () => {
    expect(find(createOffice(), 'walkway-cable').map(each => each.itemIds)).toEqual([['desk-9'], ['desk-10']]);
  });

  it('a lead along the back wall is not across a walkway: desk 1 on socket 2 is long but clear', () => {
    expect(find(createOffice(), 'walkway-cable').flatMap(each => each.itemIds)).not.toContain('desk-1');
  });

  it('a loose cable from the coffee machine to socket 4 crosses the room (walkway-cable)', () => {
    expect(find(patch(tidy(), 'coffee', { socketId: 's4' }), 'walkway-cable').map(each => each.itemIds)).toEqual([['coffee']]);
  });

  it('a wall-trunking cable still crosses the floor on its way to the wall: meeting desk 2 to the front wall (walkway-cable)', () => {
    const design = patch(tidy(), 'desk-12', { watts: 60, socketId: 's3', channel: 'wall' });
    expect(find(design, 'walkway-cable').map(each => each.itemIds)).toEqual([['desk-12']]);
  });

  it('a loose cable over 3 m is a warning (loose-length): desk 1 at sqrt(3^2 + 0.8^2) = 3.1 m, desk 9 at sqrt(2.6^2 + 3^2) = 4.0 m, desk 10 at sqrt(4^2 + 3^2) = 5.0 m', () => {
    const issues = find(createOffice(), 'loose-length');
    expect(issues.map(each => each.itemIds)).toEqual([['desk-1'], ['desk-9'], ['desk-10']]);
    expect(issues.every(each => each.severity === 'warning')).toBe(true);
    expect(issues.map(each => /(\d\.\d) m/.exec(each.message)?.[1])).toEqual(['3.1', '4.0', '5.0']);
  });

  it('desk 2 moved onto desk 1 overlaps', () => {
    const issues = find(patch(createOffice(), 'desk-2', { x: -3.4 }), 'overlap');
    expect(issues).toHaveLength(1);
    expect(issues[0].itemIds.sort()).toEqual(['desk-1', 'desk-2']);
  });

  it('desks that only touch do not overlap', () => {
    expect(find(createOffice(), 'overlap')).toHaveLength(0);
  });

  it('an item outside the room is rejected, rotation swaps its footprint', () => {
    expect(find(patch(createOffice(), 'fridge', { x: 4.9 }), 'overlap').length).toBeGreaterThan(0);
    const turned = patch(createOffice(), 'desk-1', { rotation: 90 });
    expect(footprint(turned.items.find(item => item.id === 'desk-1') as LabItem).maxZ).toBeCloseTo(-2.7 + 0.7, 9);
    expect(find(turned, 'overlap').length).toBeGreaterThan(0);
  });

  it('a powered item with no socket is rejected (socket-reach)', () => {
    expect(find(patch(createOffice(), 'fridge', { socketId: null }), 'socket-reach')).toHaveLength(1);
    expect(find(patch(createOffice(), 'fridge', { socketId: 's99' }), 'socket-reach')).toHaveLength(1);
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
      expect(route[0]).toEqual([0, 3.5]);
      const end = route[route.length - 1];
      expect(Math.hypot(end[0], end[1])).toBeLessThan(0.9);
      expect(find(design, 'walkway-clear')).toHaveLength(0);
    });
  });
});

describe('known-right fixes pass', () => {
  it('kettle moved to socket 8: socket 7 = 1800 W, socket 8 = 150 + 2000 = 2150 W, both under 2990 W, circuit C unchanged at 4550 W', () => {
    const design = patch(createOffice(), 'kettle', { socketId: 's8' });
    expect(find(design, 'socket-load')).toHaveLength(0);
    const loads = evaluate(design).meters;
    expect(loads.sockets.filter(each => ['s7', 's8'].includes(each.socketId)).map(each => each.watts)).toEqual([1800, 2150]);
    expect(loads.circuits.find(each => each.circuitId === 'c')?.watts).toBe(4550);
  });

  it('desks 9 and 10 moved to socket 6 clear both walkway-cable and loose-length: 2.9 m and 1.5 m', () => {
    const design = tidy();
    expect(find(design, 'walkway-cable')).toHaveLength(0);
    expect(find(design, 'loose-length').flatMap(each => each.itemIds)).toEqual(['desk-1']);
    expect(find(patch(design, 'desk-1', { socketId: 's1' }), 'loose-length')).toHaveLength(0);
  });

  it('desk 9 with power under the floor clears its own crossing', () => {
    expect(find(patch(createOffice(), 'desk-9', { channel: 'floor' }), 'walkway-cable').map(each => each.itemIds)).toEqual([['desk-10']]);
  });

  it('shelf on plywood (60 kg rating) clears shelf-load', () => {
    expect(find({ ...createOffice(), materials: { ...createOffice().materials, shelf: 'shelf-plywood' } }, 'shelf-load')).toHaveLength(0);
  });

  it('shelf on plywood is still rejected above 60 kg', () => {
    const design = patch({ ...createOffice(), materials: { ...createOffice().materials, shelf: 'shelf-plywood' } }, 'shelf-1', { loadKg: 61 });
    expect(find(design, 'shelf-load')).toHaveLength(1);
  });

  it('removing the heater clears heat-balance: 7825 W against 8000 W', () => {
    const design = add(createOffice(), heater({}));
    expect(find(design, 'heat-balance')).toHaveLength(1);
    expect(find(without(design, 'heater'), 'heat-balance')).toHaveLength(0);
  });

  it('a bigger air conditioner clears the heater overload on heat: 9825 W against 10000 W', () => {
    const design = { ...add(createOffice(), heater({})), acId: 'ac-10000' };
    expect(find(design, 'heat-balance')).toHaveLength(0);
  });

  it('a heater by the CO2 extinguisher needs nothing more; one 9.7 m away on the west wall needs its own', () => {
    expect(find(add(createOffice(), heater({})), 'extinguisher-reach')).toHaveLength(0);
    expect(find(add(createOffice(), heater({ x: -4.85, z: 1.2, socketId: 's1' })), 'extinguisher-reach')).toHaveLength(1);
  });

  it('every wiring fix together leaves no wiring issue', () => {
    const fixed = patch(patch(patch(patch(createOffice(), 'kettle', { socketId: 's8' }), 'desk-1', { socketId: 's1' }), 'desk-5', { dataChannel: 'wall' }), 'desk-9', { socketId: 's6' });
    const wiring = ['socket-load', 'walkway-cable', 'loose-length', 'data-separation'];
    expect(evaluate(patch(fixed, 'desk-10', { socketId: 's6' })).issues.filter(each => wiring.includes(each.rule))).toEqual([]);
  });
});

describe('routing', () => {
  const door = (room: LabDesign['room']) => ({ from: room.door.x - room.door.width / 2, to: room.door.x + room.door.width / 2, z: room.depth / 2 - 0.05 });
  const far = (): LabDesign => ({ ...createOffice(), sockets: [...createOffice().sockets, { id: 's10', name: 'Socket 10', wall: 'front', x: 2.8, z: 3.5, circuitId: 'a' }] });
  const front = patch(far(), 'fridge', { x: -1.5, z: 3.1, channel: 'wall', socketId: 's10' });

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
    expect(route.length).toBeGreaterThan(25);
  });

  it('every wall route in the starting office stays 0.05 m off the wall or runs straight to it', () => {
    const wall = routeCables(createOffice()).filter(each => each.channel === 'wall');
    expect(wall.length).toBeGreaterThanOrEqual(8);
    for (const each of wall) for (const [x, z] of each.points.slice(1, -1)) {
      const inset = Math.min(5 - Math.abs(x), 3.5 - Math.abs(z));
      expect(inset).toBeLessThanOrEqual(0.05 + 1e-9);
    }
  });

  it('wall route length equals the sum of its segments', () => {
    for (const each of [...routeCables(createOffice()), cable(front, 'fridge-power')]) expect(each.length).toBeCloseTo(segmentSum(each.points), 9);
  });

  it('wall data cable from desk 3 runs to the data point on the back wall: up to the wall, along it, to the point', () => {
    const data = cable(createOffice(), 'desk-3-data');
    expect(data.channel).toBe('wall');
    expect(data.points[data.points.length - 1]).toEqual([0.9, -3.5]);
    expect(data.length).toBeCloseTo(0.4 + 2.3 + 0.05, 9);
  });

  it('loose length is the straight-line distance, desk 1: from (-3.5, -2.7) to socket 2 at (-0.5, -3.5) = sqrt(3^2 + 0.8^2)', () => {
    const power = cable(createOffice(), 'desk-1-power');
    expect(power.points).toHaveLength(2);
    expect(power.points[0][0]).toBeCloseTo(-3.5, 9);
    expect(power.points[0][1]).toBeCloseTo(-2.7, 9);
    expect(power.points[1]).toEqual([-0.5, -3.5]);
    expect(power.length).toBeCloseTo(Math.sqrt(9 + 0.64), 9);
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
    expect([grid.cell, grid.cols, grid.rows]).toEqual([0.1, 100, 70]);
    const [x, z] = grid.centre(grid.toCell(0.52, 0.31));
    expect([x, z]).toEqual([expect.closeTo(0.55, 9), expect.closeTo(0.35, 9)]);
    expect(grid.free[grid.toCell(-4.95, 0)]).toBe(0);
    expect(grid.free[grid.toCell(0, -1)]).toBe(1);
    expect(grid.free[grid.toCell(-1.4, -2.7)]).toBe(0);
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
    const wall = [-3, -2, -1, 0, 1, 2, 3].map(z => shelfAt(`s${z}`, z));
    const drill = runDrill(empty(wall), [-2, -1]);
    expect(drill.arrival[index(drill, 2, -1)]).toBe(Infinity);
    expect(runDrill(empty([]), [-2, -1]).arrival[index(drill, 2, -1)]).toBeLessThan(Infinity);
  });

  it('a wall with a gap delays smoke behind it by more than 5 s', () => {
    const wall = [-3, -2, -1, 0, 1, 2].map(z => shelfAt(`s${z}`, z));
    const blocked = runDrill(empty(wall), [-2, -1]);
    const open = runDrill(empty([]), [-2, -1]);
    const behind = index(blocked, 2, -1);
    expect(blocked.arrival[behind]).toBeLessThan(Infinity);
    expect(blocked.arrival[behind]).toBeGreaterThan(open.arrival[behind] + 5);
  });

  it('low items do not block smoke', () => {
    const wall = [-3, -2, -1, 0, 1, 2, 3].map(z => piece({ id: `d${z}`, name: 'Desk', kind: 'desk', x: 0, z, rotation: 90, w: 1, d: 0.4 }));
    expect(runDrill(empty(wall), [-2, -1]).arrival[index(runDrill(empty([]), [-2, -1]), 2, -1)]).toBeLessThan(Infinity);
  });

  it('a person next to the fire is caught, one far away gets out', () => {
    const drill = runDrill(createOffice(), [-4.2, -1.5]);
    const near = drill.people.find(each => each.itemId === 'chair-1');
    const away = drill.people.find(each => each.itemId === 'chair-8');
    expect(near?.safe).toBe(false);
    expect(near?.blockedS).not.toBeNull();
    expect(away?.safe).toBe(true);
    expect(away?.blockedS).toBeNull();
  });

  it('a later fire is less dangerous than a fire on the route: at the door everyone is caught, in the back corner nobody', () => {
    const onRoute = runDrill(createOffice(), [0, 2.5]).people.filter(each => !each.safe).length;
    const cornerFire = runDrill(createOffice(), [-4.8, -3.3]).people.filter(each => !each.safe).length;
    expect(onRoute).toBe(14);
    expect(cornerFire).toBe(0);
  });

  it('exit time = 5 s reaction + route length / 1.2 m/s, path runs seat to door', () => {
    const person = runDrill(createOffice(), [-4.2, -1.5]).people.find(each => each.itemId === 'chair-8');
    const path = person?.path ?? [];
    expect(path[path.length - 1]).toEqual([0, 3.5]);
    expect(person?.exitS).toBeCloseTo(REACTION_S + segmentSum(path) / WALK_SPEED, 9);
  });

  it('every chair is a person; an unreachable chair is not safe', () => {
    expect(runDrill(createOffice(), [0, 0]).people).toHaveLength(14);
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

  it('default fire start: most loaded socket 7 on the right wall at (5, 2.2), nudged 0.3 m in to (4.7, 2.2)', () => {
    const design = createOffice();
    expect(defaultFireStart(design, evaluate(design))).toEqual([4.7, 2.2]);
    expect(runDrill(design).start).toEqual([4.7, 2.2]);
  });

  it('default fire start with nothing plugged in is the coffee machine', () => {
    const design = only(createOffice(), createOffice().items.filter(item => item.id === 'coffee').map(item => ({ ...item, socketId: null })));
    expect(defaultFireStart(design, evaluate(design))).toEqual([4.75, 1.95]);
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
    expect(materialOptions(patch(design, 'shelf-1', { loadKg: 30 })).filter(each => each.feasible)).toHaveLength(48);
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
    const limit = lowestCarbon(design).carbonKg + 300;
    const pick = cheapestWithin(design, limit);
    expect(pick?.carbonKg).toBeLessThanOrEqual(limit);
    const rivals = options.filter(each => each.feasible && each.carbonKg <= limit);
    expect(Math.min(...rivals.map(each => each.costGBP))).toBe(pick?.costGBP);
  });

  it('lowest carbon = oak desks 12 x 11, plywood shelf 2 x 16, cork 70 m2 x 3', () => {
    const pick = lowestCarbon(design);
    expect(pick.materials).toEqual({ desk: 'desk-oak', shelf: 'shelf-plywood', floor: 'floor-cork' });
    expect(pick.carbonKg).toBe(Math.min(...options.filter(each => each.feasible).map(each => each.carbonKg)));
  });
});
