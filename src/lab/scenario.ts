import type { LabDesign, LabItem, LabKind } from './model';

type Piece = Partial<LabItem> & Pick<LabItem, 'id' | 'name' | 'kind' | 'x' | 'z'>;

export const KIND_DEFAULTS: Record<LabKind, Omit<LabItem, 'id' | 'name' | 'kind' | 'x' | 'z'>> = {
  desk: { w: 1.4, d: 0.7, h: 0.74, rotation: 0, watts: 180, data: true, socketId: null, channel: 'loose', dataChannel: 'wall' },
  chair: { w: 0.55, d: 0.55, h: 0.9, rotation: 0, watts: 0, data: false, socketId: null, channel: 'loose', seats: 1 },
  pc: { w: 0.2, d: 0.45, h: 0.45, rotation: 0, watts: 150, data: true, socketId: null, channel: 'loose', dataChannel: 'wall' },
  printer: { w: 0.6, d: 0.55, h: 1.0, rotation: 0, watts: 600, data: true, socketId: null, channel: 'loose', dataChannel: 'wall' },
  coffee: { w: 0.45, d: 0.45, h: 1.0, rotation: 0, watts: 1800, data: false, socketId: null, channel: 'loose' },
  heater: { w: 0.6, d: 0.3, h: 0.6, rotation: 0, watts: 2000, data: false, socketId: null, channel: 'loose' },
  fridge: { w: 0.6, d: 0.6, h: 0.85, rotation: 0, watts: 150, data: false, socketId: null, channel: 'loose' },
  shelf: { w: 1.0, d: 0.4, h: 1.8, rotation: 0, watts: 0, data: false, socketId: null, channel: 'loose', loadKg: 50 },
  router: { w: 0.3, d: 0.2, h: 0.1, rotation: 0, watts: 15, data: false, socketId: null, channel: 'wall' },
  ac: { w: 0.9, d: 0.25, h: 0.3, rotation: 0, watts: 0, data: false, socketId: null, channel: 'wall' },
  extinguisher: { w: 0.25, d: 0.25, h: 0.6, rotation: 0, watts: 0, data: false, socketId: null, channel: 'loose', extinguisher: 'co2' },
};

export const piece = (spec: Piece): LabItem => ({ ...KIND_DEFAULTS[spec.kind], ...spec });

export function createOffice(): LabDesign {
  const west = [-4.2, -2.8, -1.4], east = [1.4, 2.8, 4.2];
  const desks: Piece[] = [
    { id: 'desk-1', name: 'Desk 1', kind: 'desk', x: west[0], z: -2.7, socketId: 's2' },
    { id: 'desk-2', name: 'Desk 2', kind: 'desk', x: west[1], z: -2.7, socketId: 's1' },
    { id: 'desk-3', name: 'Desk 3', kind: 'desk', x: west[2], z: -2.7, socketId: 's2' },
    { id: 'desk-4', name: 'Desk 4', kind: 'desk', x: west[0], z: -0.5, rotation: 180, socketId: 's3', dataChannel: 'floor' },
    { id: 'desk-5', name: 'Desk 5', kind: 'desk', x: west[1], z: -0.5, rotation: 180, socketId: 's3', channel: 'floor', dataChannel: 'floor' },
    { id: 'desk-6', name: 'Desk 6', kind: 'desk', x: east[0], z: -2.7, socketId: 's4' },
    { id: 'desk-7', name: 'Desk 7', kind: 'desk', x: east[1], z: -2.7, socketId: 's4' },
    { id: 'desk-8', name: 'Desk 8', kind: 'desk', x: east[2], z: -2.7, socketId: 's5' },
    { id: 'desk-9', name: 'Desk 9', kind: 'desk', x: east[1], z: -0.5, rotation: 180, socketId: 's2', dataChannel: 'floor' },
    { id: 'desk-10', name: 'Desk 10', kind: 'desk', x: east[2], z: -0.5, rotation: 180, socketId: 's2', dataChannel: 'floor' },
  ];
  const seats: Piece[] = desks.map((desk, index) => ({ id: `chair-${index + 1}`, name: `Chair ${index + 1}`, kind: 'chair', x: desk.x, z: desk.z === -2.7 ? -1.95 : -1.25, rotation: desk.z === -2.7 ? 0 : 180 }));
  const meeting: Piece[] = [
    { id: 'desk-11', name: 'Meeting desk 1', kind: 'desk', x: -3, z: 1.9, watts: 60, data: false, socketId: 's3' },
    { id: 'desk-12', name: 'Meeting desk 2', kind: 'desk', x: -1.6, z: 1.9, watts: 0, data: false },
    { id: 'chair-11', name: 'Chair 11', kind: 'chair', x: -3, z: 1.25, rotation: 180 },
    { id: 'chair-12', name: 'Chair 12', kind: 'chair', x: -1.6, z: 1.25, rotation: 180 },
    { id: 'chair-13', name: 'Chair 13', kind: 'chair', x: -3, z: 2.55 },
    { id: 'chair-14', name: 'Chair 14', kind: 'chair', x: -1.6, z: 2.55 },
  ];
  return {
    id: 'office',
    name: 'Open-plan office',
    room: { width: 10, depth: 7, height: 2.8, door: { x: 0, width: 0.9 }, vent: { wall: 'right', x: 5, z: -1.5 }, dataPoint: { wall: 'back', x: 0.9, z: -3.5 } },
    items: [
      ...[...desks, ...meeting.slice(0, 2)].map(piece),
      ...[...seats, ...meeting.slice(2)].map(piece),
      piece({ id: 'printer', name: 'Printer', kind: 'printer', x: 4.72, z: 0.9, rotation: 270, socketId: 's9' }),
      piece({ id: 'coffee', name: 'Coffee machine', kind: 'coffee', x: 4.75, z: 1.95, rotation: 270, socketId: 's7' }),
      piece({ id: 'kettle', name: 'Kettle', kind: 'coffee', x: 4.75, z: 2.6, rotation: 270, watts: 2000, socketId: 's7' }),
      piece({ id: 'fridge', name: 'Fridge', kind: 'fridge', x: 4.7, z: 3.15, rotation: 270, socketId: 's8' }),
      piece({ id: 'router', name: 'Router', kind: 'router', x: 0.9, z: -3.35, socketId: 's4' }),
      piece({ id: 'shelf-1', name: 'Shelf 1', kind: 'shelf', x: -4.8, z: 2.6, rotation: 90, loadKg: 50 }),
      piece({ id: 'shelf-2', name: 'Shelf 2', kind: 'shelf', x: 4.8, z: -1.55, rotation: 90, loadKg: 30 }),
      piece({ id: 'ac', name: 'Air conditioner', kind: 'ac', x: 0, z: -3.37 }),
      piece({ id: 'ext-1', name: 'Extinguisher 1', kind: 'extinguisher', x: 1.2, z: 3.3, extinguisher: 'water' }),
      piece({ id: 'ext-2', name: 'Extinguisher 2', kind: 'extinguisher', x: 4.8, z: 1.45, extinguisher: 'co2' }),
    ],
    sockets: [
      { id: 's1', name: 'Socket 1', wall: 'back', x: -3.6, z: -3.5, circuitId: 'a' },
      { id: 's2', name: 'Socket 2', wall: 'back', x: -0.5, z: -3.5, circuitId: 'a' },
      { id: 's3', name: 'Socket 3', wall: 'left', x: -5, z: 0.4, circuitId: 'a' },
      { id: 's4', name: 'Socket 4', wall: 'back', x: 2.2, z: -3.5, circuitId: 'b' },
      { id: 's5', name: 'Socket 5', wall: 'right', x: 5, z: -2.7, circuitId: 'b' },
      { id: 's6', name: 'Socket 6', wall: 'right', x: 5, z: -0.5, circuitId: 'b' },
      { id: 's7', name: 'Socket 7', wall: 'right', x: 5, z: 2.2, circuitId: 'c' },
      { id: 's8', name: 'Socket 8', wall: 'right', x: 5, z: 3.1, circuitId: 'c' },
      { id: 's9', name: 'Socket 9', wall: 'right', x: 5, z: 1, circuitId: 'c' },
    ],
    circuits: [
      { id: 'a', name: 'Circuit A (west desks)', breakerA: 16 },
      { id: 'b', name: 'Circuit B (east desks)', breakerA: 16 },
      { id: 'c', name: 'Circuit C (kitchen and print)', breakerA: 20 },
    ],
    materials: { desk: 'desk-chipboard', shelf: 'shelf-mdf', floor: 'floor-vinyl' },
    acId: 'ac-8000',
  };
}
