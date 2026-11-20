import type { BracketDesign, MaterialId, Method } from './model';

export interface Material {
  id: MaterialId;
  name: string;
  short: string;
  process: string;
  yieldMPa: number;
  utsMPa: number;
  elongationPct: number;
  modulus: number;
  density: number;
  costPerCm3: number;
  setupUSD: number;
  minWallMm: number;
  corrosion: string;
  source: string;
}

export const MATERIALS: Record<MaterialId, Material> = {
  'ti64-lpbf': { id: 'ti64-lpbf', name: 'Titanium Ti-6Al-4V (metal LPBF + HIP)', short: 'Ti-6Al-4V', process: 'Laser powder bed fusion, then HIP', yieldMPa: 880, utsMPa: 950, elongationPct: 14, modulus: 113800, density: 4.43, costPerCm3: 8, setupUSD: 80, minWallMm: 1, corrosion: 'Titanium does not rust; salt spray still to be run on the assembly.', source: 'Typical published LPBF + HIP values (yield about 880 MPa, elongation about 14%). Confirm with the print bureau\'s certified data.' },
  'alsi10mg-lpbf': { id: 'alsi10mg-lpbf', name: 'Aluminium AlSi10Mg (metal LPBF)', short: 'AlSi10Mg', process: 'Laser powder bed fusion', yieldMPa: 230, utsMPa: 350, elongationPct: 6, modulus: 70000, density: 2.67, costPerCm3: 3.5, setupUSD: 40, minWallMm: 1, corrosion: 'Needs a coating for 720 h salt spray.', source: 'Typical as-built values, weaker build direction (yield about 230 MPa, elongation about 6%). Confirm with certified data.' },
  'ss316l-lpbf': { id: 'ss316l-lpbf', name: 'Stainless 316L (metal LPBF)', short: '316L', process: 'Laser powder bed fusion', yieldMPa: 440, utsMPa: 600, elongationPct: 35, modulus: 190000, density: 7.98, costPerCm3: 3, setupUSD: 60, minWallMm: 1, corrosion: 'Stainless; salt spray still to be run on the assembly.', source: 'Typical as-built values, weaker build direction (yield about 440 MPa, elongation about 35%). Confirm with certified data.' },
  'pa12-sls': { id: 'pa12-sls', name: 'Nylon PA12 (SLS)', short: 'PA12', process: 'Selective laser sintering', yieldMPa: 43.75, utsMPa: 50, elongationPct: 11, modulus: 1850, density: 0.99, costPerCm3: 0.35, setupUSD: 8, minWallMm: 2, corrosion: 'Does not corrode; UV and heat ageing not checked.', source: 'Formlabs Nylon 12 TDS (50 MPa, E 1850 MPa, 0.99 g/cm³, elongation 11%); weaker direction 43.75 MPa.' },
};

export const REFERENCE = { name: 'HSLA 420 steel, 2.5 mm, stamped (CTS 4.1)', yieldMPa: 420, density: 7.85, thickness: 2.5, elongationPct: 16 };

export const CTS = {
  id: 'CTS-ST-2028-4410-RevB',
  component: 'Bracket, Front Seat Rear Outboard Riser (RH/LH)',
  vehicle: 'Mid-size C-segment electric crossover, MY2028 (assumed by the client)',
  classification: 'Critical Safety Item (CC / Regulatory)',
};

export const G = 9.81;
export const SEAT_MASS_KG = 38;
export const NUT_SPACING_MM = 340;
export const PITCH_DEG = 4.5;
export const END_MARGIN_MM = 20;
export const LENGTH_MM = NUT_SPACING_MM + 2 * END_MARGIN_MM;
export const FRONT_HEIGHT_MM = 40;
export const CG_ABOVE_TRACK_MM = 300;
export const RISERS_PER_SEAT = 2;
export const HARNESS_OFFSET_MM = 60;
export const HARNESS_CLEARANCE_MM = 12;
export const SOCKET_RADIUS_MM = 11;
export const TOOL_MARGIN_MM = 2;
export const PILOT_HOLE_MM = 10.2;
export const SLOT_MM: [number, number] = [10.2, 14];
export const WASHER_MM = 20;
export const NUT_THREAD_MM = 8;
export const BOSS_OD_MM = 16;
export const KICK_N = 3500;
export const SLAM_N = 1150;
export const PUSH_OUT_N = 18000;
export const MIN_FREQ_HZ = 32;
export const MAX_STRAIN_PCT = 12;
export const MASS_TARGET_G = 680;
export const PIECE_PRICE_USD = 2.45;
export const FLATNESS_MM = 0.3;
export const HOLE_TOL_MM = 0.1;
export const SPACING_TOL_MM = 0.15;
export const PRINT_TOL_PER_MM = 0.002;
export const PRINT_HOLE_TOL_MM = 0.15;
export const MACHINED_TOL_MM = 0.05;
export const MACHINING_USD = 60;
export const BUILD_VOLUME_MM: [number, number, number] = [400, 400, 400];

export interface Requirement { id: string; clause: string; title: string; text: string; method: Method; basis: string }

export const REQUIREMENTS: Requirement[] = [
  { id: 'VCS', clause: '1.1', title: 'Vehicle coordinates', text: 'CAD aligned to the vehicle grid: X longitudinal, Y lateral, Z vertical.', method: 'inspection', basis: 'CTS 1.1' },
  { id: 'DATUM-A', clause: '1.2', title: 'Datum A flatness', text: 'Bottom mounting pad flat within 0.3 mm.', method: 'inspection', basis: 'CTS 1.2 primary datum' },
  { id: 'DATUM-BC', clause: '1.2', title: 'Pilot hole and slot', text: 'Forward pilot Ø10.2 +0.1/-0.0 mm, rearward slot 10.2 × 14.0 mm.', method: 'inspection', basis: 'CTS 1.2 secondary and tertiary datums' },
  { id: 'TRACK', clause: '1.3', title: 'Upper track interface', text: 'Two M8 × 1.25 nuts 340.0 ± 0.15 mm apart at 4.5° rearward pitch.', method: 'inspection', basis: 'CTS 1.3' },
  { id: 'KEEPOUT-HV', clause: '1.4', title: 'HV harness clearance', text: 'At least 12.0 mm static clearance to the under-seat HV harness and HVAC duct.', method: 'inspection', basis: 'CTS 1.4, CAD-ENV-882. Harness edge assumed 60 mm from the riser centre line.' },
  { id: 'KEEPOUT-TOOL', clause: '1.4', title: 'Nutrunner access', text: '25.0 mm vertical clear cone above every fastener head.', method: 'inspection', basis: 'CTS 1.4. Socket Ø22 mm assumed.' },
  { id: 'KEEPOUT-BELOW', clause: '1.4', title: 'Nothing below the crossmember', text: 'Zero protrusion below the BIW crossmember upper skin; no piercing fasteners.', method: 'inspection', basis: 'CTS 1.4' },
  { id: 'LC-01', clause: '2', title: 'LC-01 20G inertia', text: '20 × 38 kg seat at the seat CG, forward and rearward: no detachment.', method: 'analysis', basis: 'FMVSS 207 / ECE R17 via CTS LC-01. Hand calculation; LS-DYNA still required.' },
  { id: 'LC-01-STRAIN', clause: '2', title: 'LC-01 plastic strain', text: 'Max plastic strain below 12%, below the material fracture limit.', method: 'datasheet', basis: 'CTS LC-01 acceptance. Material elongation must exceed 12%.' },
  { id: 'LC-02', clause: '2', title: 'LC-02 belt + 20G', text: '13,500 N lap + 13,500 N shoulder pull plus 20G seat load for 10 s; buckle anchor moves < 45 mm.', method: 'test', basis: 'FMVSS 210 / ECE R14. Load share to this riser needs the seat CAE model.' },
  { id: 'LC-03', clause: '2', title: 'LC-03 rear impact', text: '50 km/h rear sled pulse, 18G peak, 102 kg dummy: controlled absorption, no sharp edges.', method: 'test', basis: 'IIHS / Euro NCAP. Dynamic; needs sled test and CAE.' },
  { id: 'LC-04', clause: '2', title: 'LC-04 foot kick', text: '3,500 N point load on the rear flange: no collapse into the HVAC duct.', method: 'analysis', basis: 'OEM abuse spec via CTS LC-04. Plastic collapse of the top flange.' },
  { id: 'FATIGUE', clause: '3.1', title: 'Road load fatigue', text: '100,000 cycles on a 6-DOF shaker, no crack, > 85% clamp load kept.', method: 'test', basis: 'CTS 3.1' },
  { id: 'SLAM', clause: '3.2', title: 'Ingress / egress slam', text: '1,150 N drop load, permanent set under 0.5 mm (80,000 cycles).', method: 'analysis', basis: 'CTS 3.2. Analysis covers set; the 80,000 cycles need a rig test.' },
  { id: 'NVH', clause: '3.3', title: 'First natural frequency', text: 'Lateral and fore-aft first mode at least 32 Hz.', method: 'analysis', basis: 'CTS 3.3. Bracket-only estimate; full seat modal test required.' },
  { id: 'MATERIAL', clause: '4.1', title: 'Material', text: 'HSLA 420 (HC420LA / SAE J2340 420X), 2.5 mm.', method: 'review', basis: 'CTS 4.1' },
  { id: 'PROCESS', clause: '4.2', title: 'Forming process', text: 'Progressive die stamping; bend radius at least 1.5 × thickness; thinning under 18%.', method: 'review', basis: 'CTS 4.2' },
  { id: 'JOINING', clause: '4.3', title: 'Nut push-out', text: 'M8 nuts: push-out at least 18 kN, torque-out at least 55 N·m.', method: 'analysis', basis: 'CTS 4.3. Printed design uses integral tapped bosses instead of projection-welded nuts.' },
  { id: 'CORROSION', clause: '4.4', title: 'Corrosion', text: '720 h neutral salt spray (ASTM B117), zero red rust.', method: 'test', basis: 'CTS 4.4' },
  { id: 'MASS', clause: '4.5', title: 'Mass', text: 'At most 0.68 kg per bracket, without fasteners.', method: 'analysis', basis: 'CTS 4.5' },
  { id: 'PRICE', clause: '4.5', title: 'Piece price', text: '$2.45 at 120,000 units a year.', method: 'review', basis: 'CTS 4.5' },
  { id: 'AM-PRINT', clause: 'AM', title: 'Printable without trapped supports', text: 'Walls at least the process minimum; no supports trapped inside the channel.', method: 'inspection', basis: 'Firm design rule for 3D printing.' },
  { id: 'AM-VOLUME', clause: 'AM', title: 'Fits the printer', text: 'Part fits a 400 × 400 × 400 mm large-format build volume in its print orientation.', method: 'inspection', basis: 'Firm design rule; 250 mm class machines are too small for a 380 mm part.' },
];

export const ASSUMPTIONS = [
  `The riser is a hat-section channel ${LENGTH_MM} mm long carrying one seat track through the two M8 nuts ${NUT_SPACING_MM} mm apart; the seat sits on ${RISERS_PER_SEAT} such risers (inboard and outboard).`,
  `Riser height ${FRONT_HEIGHT_MM} mm at the front nut, rising at 4.5° to the rear; set by the H-point packaging the client did not supply.`,
  `Seat CG ${CG_ABOVE_TRACK_MM} mm above the track (not in the CTS).`,
  `HV harness edge ${HARNESS_OFFSET_MM} mm from the riser centre line; nutrunner socket Ø${2 * SOCKET_RADIUS_MM} mm.`,
  'Material values are typical published figures, not certified test data.',
  'RH and LH are mirror images; every check applies to both.',
];

export const BOUNDS: Record<'thickness' | 'topWidth' | 'lipWidth' | 'cutout' | 'bossHeight', [number, number]> = {
  thickness: [1, 5], topWidth: [25, 70], lipWidth: [20, 45], cutout: [0, 0.6], bossHeight: [3, 15],
};

export const STARTING: BracketDesign = {
  material: 'alsi10mg-lpbf', orientation: 'pads-down', finish: 'as-printed', thickness: 2.5, topWidth: 40, lipWidth: 24, cutout: 0, bossHeight: 5,
};
