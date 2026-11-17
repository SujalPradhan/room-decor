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
  const desks: Piece[] = [
    { id: 'desk-1', name: 'Desk 1', kind: 'desk', x: -2.2, z: -1.9, socketId: 's1' },
    { id: 'desk-2', name: 'Desk 2', kind: 'desk', x: -0.8, z: -1.9, socketId: 's1' },
    { id: 'desk-3', name: 'Desk 3', kind: 'desk', x: 0.6, z: -1.9, socketId: 's2' },
    { id: 'desk-4', name: 'Desk 4', kind: 'desk', x: -2.2, z: 0.6, rotation: 180, socketId: 's3', dataChannel: 'floor' },
    { id: 'desk-5', name: 'Desk 5', kind: 'desk', x: -0.8, z: 0.6, rotation: 180, socketId: 's3', dataChannel: 'floor' },
    { id: 'desk-6', name: 'Desk 6', kind: 'desk', x: 0.6, z: 0.6, rotation: 180, socketId: 's3', dataChannel: 'floor' },
  ];
  const chairs: Piece[] = desks.map((desk, index) => ({ id: `chair-${index + 1}`, name: `Chair ${index + 1}`, kind: 'chair', x: desk.x, z: index < 3 ? -1.2 : 1.3, rotation: index < 3 ? 0 : 180 }));
  return {
    id: 'office',
    name: 'Six-desk office',
    room: { width: 6, depth: 5, height: 2.7, door: { x: 1.9, width: 0.9 }, vent: { wall: 'right', x: 3, z: -1.5 }, dataPoint: { wall: 'back', x: 1.6, z: -2.5 } },
    items: [
      ...desks.map(piece),
      ...chairs.map(piece),
      piece({ id: 'printer', name: 'Printer', kind: 'printer', x: 2.6, z: -2.1, socketId: 's4' }),
      piece({ id: 'coffee', name: 'Coffee machine', kind: 'coffee', x: 2.7, z: 0.2, rotation: 270, socketId: 's4' }),
      piece({ id: 'fridge', name: 'Fridge', kind: 'fridge', x: 2.65, z: 0.9, rotation: 270, socketId: 's4' }),
      piece({ id: 'router', name: 'Router', kind: 'router', x: 1.6, z: -2.35, socketId: 's2' }),
      piece({ id: 'shelf', name: 'Shelf', kind: 'shelf', x: -2.75, z: 1.9, rotation: 90, loadKg: 50 }),
      piece({ id: 'ac', name: 'Air conditioner', kind: 'ac', x: 0, z: -2.37 }),
      piece({ id: 'ext-1', name: 'Extinguisher', kind: 'extinguisher', x: 2.8, z: 1.5, extinguisher: 'water' }),
    ],
    sockets: [
      { id: 's1', name: 'Socket 1', wall: 'back', x: -1.5, z: -2.5, circuitId: 'a' },
      { id: 's2', name: 'Socket 2', wall: 'back', x: 1.0, z: -2.5, circuitId: 'a' },
      { id: 's3', name: 'Socket 3', wall: 'left', x: -3, z: 0.6, circuitId: 'b' },
      { id: 's4', name: 'Socket 4', wall: 'right', x: 3, z: -0.6, circuitId: 'b' },
      { id: 's5', name: 'Socket 5', wall: 'front', x: -0.8, z: 2.5, circuitId: 'b' },
    ],
    circuits: [
      { id: 'a', name: 'Circuit A (desks)', breakerA: 16 },
      { id: 'b', name: 'Circuit B (general)', breakerA: 16 },
    ],
    materials: { desk: 'desk-chipboard', shelf: 'shelf-mdf', floor: 'floor-vinyl' },
    acId: 'ac-5000',
  };
}
