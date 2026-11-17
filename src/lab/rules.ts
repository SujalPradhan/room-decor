import type { Channel, ExtinguisherType, MaterialGroup } from './model';

export type Basis = 'physics' | 'standard' | 'guidance' | 'illustrative';
export interface Rule { id: string; title: string; check: string; source: string; basis: Basis }

export const VOLTS = 230;
export const PLUG_AMPS = 13;
export const SOCKET_LIMIT_W = PLUG_AMPS * VOLTS;
export const PERSON_HEAT_W = 100;
export const WALKWAY_M = 0.9;
export const DOOR_EXTINGUISHER_M = 1.5;
export const RISK_EXTINGUISHER_M = 5;
export const MAX_LOOSE_M = 3;
export const SMOKE_SPEED = 0.2;
export const WALK_SPEED = 1.2;
export const REACTION_S = 5;
export const FIRE_CELL = 0.25;

export const RULES: Record<string, Rule> = {
  'socket-load': { id: 'socket-load', title: 'Socket load', check: `Everything on one socket, lead included, draws at most ${PLUG_AMPS} A × ${VOLTS} V = ${SOCKET_LIMIT_W.toLocaleString('en-GB')} W.`, source: 'BS 1363 13 A plugs and sockets, used in the UK and Singapore (SS 145).', basis: 'standard' },
  'circuit-load': { id: 'circuit-load', title: 'Circuit load', check: `All sockets on a circuit draw at most its breaker rating × ${VOLTS} V.`, source: 'Breaker rating on each circuit; power = current × voltage.', basis: 'physics' },
  'heat-balance': { id: 'heat-balance', title: 'Cooling', check: `Every watt used becomes heat, plus about ${PERSON_HEAT_W} W per person. The total must not exceed the air conditioner's cooling capacity.`, source: 'Energy balance. 100 W per seated office worker is a typical design figure (CIBSE Guide A lists similar values).', basis: 'physics' },
  'walkway-cable': { id: 'walkway-cable', title: 'Cables across walkways', check: 'No loose cable crosses the walking route from the door to any seat.', source: 'HSE guidance on slips and trips: keep trailing cables out of walkways.', basis: 'guidance' },
  'loose-length': { id: 'loose-length', title: 'Trailing cable length', check: `A loose cable runs at most ${MAX_LOOSE_M} m; longer runs go in wall trunking or under the floor.`, source: 'Demo threshold.', basis: 'illustrative' },
  'data-separation': { id: 'data-separation', title: 'Power and data apart', check: 'Data cables do not share a channel with power cables without a divider; here each channel has a power side and a data side.', source: 'BS 7671 Reg 528.1 and EN 50174-2 segregation, via secondary sources; confirm against licensed SS 638.', basis: 'standard' },
  'shelf-load': { id: 'shelf-load', title: 'Shelf load', check: 'What a shelf holds stays within its material’s rated load.', source: 'Ratings are typical manufacturer figures, illustrative.', basis: 'illustrative' },
  'overlap': { id: 'overlap', title: 'No overlaps', check: 'No two pieces share floor space, and every piece stays inside the room.', source: 'Geometry.', basis: 'physics' },
  'walkway-clear': { id: 'walkway-clear', title: 'Walking route', check: `Every seat can be reached from the door by a ${WALKWAY_M} m wide route.`, source: 'Demo threshold, close to common accessible-route widths.', basis: 'illustrative' },
  'socket-reach': { id: 'socket-reach', title: 'Plugged in', check: 'Every powered piece is plugged into a socket.', source: 'Geometry.', basis: 'physics' },
  'extinguisher-type': { id: 'extinguisher-type', title: 'Right extinguisher', check: 'Water and foam are not used near live electrics; CO2 or powder is.', source: 'BS EN 3 extinguisher classes; general fire safety guidance.', basis: 'guidance' },
  'extinguisher-reach': { id: 'extinguisher-reach', title: 'Extinguisher nearby', check: `Each fire risk (heater, coffee machine, printer, a socket over 80% load) has a suitable extinguisher within ${RISK_EXTINGUISHER_M} m.`, source: 'Demo threshold. BS 5306-8 allows up to 30 m travel, which every point in a small room meets.', basis: 'illustrative' },
  'extinguisher-exit': { id: 'extinguisher-exit', title: 'Extinguisher by the exit', check: `At least one extinguisher within ${DOOR_EXTINGUISHER_M} m of the door.`, source: 'BS 5306-8 advises siting extinguishers near exits.', basis: 'guidance' },
  'egress': { id: 'egress', title: 'Out before the smoke', check: `In the smoke drill, each person reaches the door before smoke covers their route (walk ${WALK_SPEED} m/s after ${REACTION_S} s to react, smoke spreads about ${SMOKE_SPEED} m/s).`, source: 'Simple grid model for direction and timing. Not a fire safety assessment.', basis: 'illustrative' },
};

export interface Material { id: string; group: MaterialGroup; name: string; costGBP: number; carbonKg: number; unit: 'per desk' | 'per shelf' | 'per m²'; ratingKg?: number; source: string }

const TYPICAL = 'Typical published range, illustrative. Replace with the product’s EPD and quote.';
export const MATERIALS: Material[] = [
  { id: 'desk-chipboard', group: 'desk', name: 'Melamine chipboard', costGBP: 90, carbonKg: 18, unit: 'per desk', source: TYPICAL },
  { id: 'desk-plywood', group: 'desk', name: 'Birch plywood', costGBP: 160, carbonKg: 14, unit: 'per desk', source: TYPICAL },
  { id: 'desk-oak', group: 'desk', name: 'Solid oak', costGBP: 340, carbonKg: 11, unit: 'per desk', source: TYPICAL },
  { id: 'desk-steel', group: 'desk', name: 'Steel', costGBP: 220, carbonKg: 48, unit: 'per desk', source: TYPICAL },
  { id: 'shelf-mdf', group: 'shelf', name: 'MDF', costGBP: 60, carbonKg: 20, unit: 'per shelf', ratingKg: 40, source: TYPICAL },
  { id: 'shelf-plywood', group: 'shelf', name: 'Plywood', costGBP: 110, carbonKg: 16, unit: 'per shelf', ratingKg: 60, source: TYPICAL },
  { id: 'shelf-steel', group: 'shelf', name: 'Steel', costGBP: 180, carbonKg: 55, unit: 'per shelf', ratingKg: 120, source: TYPICAL },
  { id: 'floor-carpet', group: 'floor', name: 'Carpet tile', costGBP: 22, carbonKg: 9, unit: 'per m²', source: TYPICAL },
  { id: 'floor-vinyl', group: 'floor', name: 'Vinyl plank', costGBP: 28, carbonKg: 12, unit: 'per m²', source: TYPICAL },
  { id: 'floor-linoleum', group: 'floor', name: 'Linoleum', costGBP: 32, carbonKg: 4, unit: 'per m²', source: TYPICAL },
  { id: 'floor-cork', group: 'floor', name: 'Cork', costGBP: 38, carbonKg: 3, unit: 'per m²', source: TYPICAL },
];

export interface AirCon { id: string; name: string; coolingW: number; costGBP: number; carbonKg: number }
export const AIRCONS: AirCon[] = [
  { id: 'ac-3500', name: '3.5 kW split unit', coolingW: 3500, costGBP: 1400, carbonKg: 250 },
  { id: 'ac-5000', name: '5.0 kW split unit', coolingW: 5000, costGBP: 1900, carbonKg: 330 },
  { id: 'ac-7100', name: '7.1 kW split unit', coolingW: 7100, costGBP: 2600, carbonKg: 450 },
];

export const CHANNELS: Record<Channel, { name: string; costPerM: number; carbonPerM: number }> = {
  wall: { name: 'Wall trunking', costPerM: 12, carbonPerM: 1.8 },
  floor: { name: 'Under-floor cover', costPerM: 18, carbonPerM: 2.5 },
  loose: { name: 'Loose on the floor', costPerM: 2.5, carbonPerM: 0.6 },
};

export const ELECTRICAL_SAFE: ExtinguisherType[] = ['co2', 'powder'];
export const EXTINGUISHERS: Record<ExtinguisherType, { name: string; costGBP: number; carbonKg: number }> = {
  co2: { name: 'CO2', costGBP: 45, carbonKg: 14 },
  water: { name: 'Water', costGBP: 35, carbonKg: 10 },
  foam: { name: 'Foam', costGBP: 40, carbonKg: 11 },
  powder: { name: 'Dry powder', costGBP: 38, carbonKg: 12 },
};

export const material = (id: string) => MATERIALS.find(each => each.id === id);
export const aircon = (id: string) => AIRCONS.find(each => each.id === id);
