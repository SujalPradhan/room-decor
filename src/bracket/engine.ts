import type { BracketDesign, CheckResult, Derived, Finish, MaterialId, Orientation, Status, Verification } from './model';
import {
  ASSUMPTIONS, BOSS_OD_MM, BOUNDS, BUILD_VOLUME_MM, CG_ABOVE_TRACK_MM, CTS, END_MARGIN_MM, FLATNESS_MM, FRONT_HEIGHT_MM, G, HARNESS_CLEARANCE_MM,
  HARNESS_OFFSET_MM, HOLE_TOL_MM, KICK_N, LENGTH_MM, MACHINED_TOL_MM, MACHINING_USD, MASS_TARGET_G, MATERIALS, MAX_STRAIN_PCT, MIN_FREQ_HZ,
  NUT_SPACING_MM, NUT_THREAD_MM, PIECE_PRICE_USD, PILOT_HOLE_MM, PITCH_DEG, PRINT_HOLE_TOL_MM, PRINT_TOL_PER_MM, PUSH_OUT_N, REFERENCE,
  REQUIREMENTS, RISERS_PER_SEAT, SEAT_MASS_KG, SLAM_N, SLOT_MM, SOCKET_RADIUS_MM, SPACING_TOL_MM, TOOL_MARGIN_MM, WASHER_MM,
} from './spec';

const fmt = (n: number, d = 0): string => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const tanPitch = Math.tan((PITCH_DEG * Math.PI) / 180);

export const RISE_MM = NUT_SPACING_MM * tanPitch;
export const heightAt = (x: number): number => FRONT_HEIGHT_MM + (x - END_MARGIN_MM) * tanPitch;
export const AVG_HEIGHT_MM = heightAt(LENGTH_MM / 2);
export const MAX_HEIGHT_MM = heightAt(LENGTH_MM);

export const INERTIAL_N = 20 * SEAT_MASS_KG * G;
const SHEAR_N = INERTIAL_N / RISERS_PER_SEAT;
const UPLIFT_N = (INERTIAL_N * CG_ABOVE_TRACK_MM) / (RISERS_PER_SEAT * NUT_SPACING_MM);

export function derive(design: BracketDesign): Derived {
  const mat = MATERIALS[design.material];
  const { thickness: t, topWidth: b, lipWidth: f, cutout: c, bossHeight: le } = design;
  const a = f / 2;
  const lipMomentNmm = (UPLIFT_N * a) / 2;
  const lipCapacityNmm = (mat.yieldMPa * (2 * a + WASHER_MM) * t * t) / 4;
  const kickCapacityN = 2 * mat.yieldMPa * t * t;
  const slamElasticN = (4 / 3) * mat.yieldMPa * t * t;
  const pushOutN = 0.5 * Math.PI * NUT_THREAD_MM * le * 0.6 * mat.utsMPa;
  const webI = (LENGTH_MM * (1 - c) * t ** 3) / 12;
  const kWeb = (12 * mat.modulus * webI) / AVG_HEIGHT_MM ** 3;
  const kTotal = RISERS_PER_SEAT * 2 * kWeb;
  const frequencyHz = Math.sqrt((kTotal * 1000) / SEAT_MASS_KG) / (2 * Math.PI);
  const halfWidthMm = b / 2 + t + f;
  const harnessClearanceMm = HARNESS_OFFSET_MM - halfWidthMm;
  const toolClearanceMm = a - SOCKET_RADIUS_MM;
  const sheet = LENGTH_MM * (b + 2 * AVG_HEIGHT_MM * (1 - c) + 2 * f) * t;
  const bosses = 2 * (Math.PI / 4) * (BOSS_OD_MM ** 2 - NUT_THREAD_MM ** 2) * le;
  const holes = ((Math.PI / 4) * PILOT_HOLE_MM ** 2 + (SLOT_MM[1] - SLOT_MM[0]) * SLOT_MM[0] + (Math.PI / 4) * SLOT_MM[0] ** 2 + 2 * (Math.PI / 4) * NUT_THREAD_MM ** 2) * t;
  const volumeMm3 = sheet + bosses - holes;
  const massG = (volumeMm3 / 1000) * mat.density;
  const unitCostUSD = (volumeMm3 / 1000) * mat.costPerCm3 + mat.setupUSD + (design.finish === 'machined' ? MACHINING_USD : 0);
  return {
    inertialN: INERTIAL_N, shearPerRiserN: SHEAR_N, upliftN: UPLIFT_N, lipMomentNmm, lipCapacityNmm, kickCapacityN, slamElasticN, pushOutN, frequencyHz,
    halfWidthMm, harnessClearanceMm, toolClearanceMm, volumeMm3, massG, unitCostUSD, envelopeMm: [LENGTH_MM, 2 * halfWidthMm, MAX_HEIGHT_MM],
  };
}

export function clampDesign(design: BracketDesign): BracketDesign {
  const out: BracketDesign = { ...design };
  (Object.keys(BOUNDS) as (keyof typeof BOUNDS)[]).forEach((k) => {
    const [lo, hi] = BOUNDS[k];
    const v = Number.isFinite(design[k]) ? design[k] : lo;
    out[k] = Math.min(hi, Math.max(lo, v));
  });
  return out;
}

interface Flags {
  flatOk: boolean; holesOk: boolean; trackOk: boolean; harnessOk: boolean; toolOk: boolean; bearingMPa: number; punchMPa: number;
  lc01Ok: boolean; strainOk: boolean; kickOk: boolean; slamOk: boolean; nvhOk: boolean; pushOk: boolean; massOk: boolean; printOk: boolean; volumeOk: boolean;
  printDims: [number, number, number];
}

function flags(design: BracketDesign, d: Derived): Flags {
  const mat = MATERIALS[design.material];
  const machined = design.finish === 'machined';
  const bearingMPa = SHEAR_N / 2 / (PILOT_HOLE_MM * design.thickness);
  const punchMPa = UPLIFT_N / (Math.PI * WASHER_MM * design.thickness);
  const printDims: [number, number, number] = design.orientation === 'upright'
    ? [d.envelopeMm[1], d.envelopeMm[2], d.envelopeMm[0]]
    : [d.envelopeMm[0], d.envelopeMm[1], d.envelopeMm[2]];
  return {
    flatOk: machined,
    holesOk: machined,
    trackOk: machined,
    harnessOk: d.harnessClearanceMm >= HARNESS_CLEARANCE_MM,
    toolOk: d.toolClearanceMm >= TOOL_MARGIN_MM,
    bearingMPa,
    punchMPa,
    lc01Ok: d.lipMomentNmm <= d.lipCapacityNmm && bearingMPa <= 1.5 * mat.yieldMPa && punchMPa <= 0.6 * mat.yieldMPa,
    strainOk: mat.elongationPct > MAX_STRAIN_PCT,
    kickOk: d.kickCapacityN >= KICK_N,
    slamOk: d.slamElasticN >= SLAM_N,
    nvhOk: d.frequencyHz >= MIN_FREQ_HZ,
    pushOk: d.pushOutN >= PUSH_OUT_N,
    massOk: d.massG <= MASS_TARGET_G,
    printOk: design.orientation === 'upright' && design.thickness >= mat.minWallMm,
    volumeOk: printDims.every((v, i) => v <= BUILD_VOLUME_MM[i]),
    printDims,
  };
}

const noFail = (f: Flags) =>
  f.flatOk && f.holesOk && f.trackOk && f.harnessOk && f.toolOk && f.lc01Ok && f.strainOk && f.kickOk && f.slamOk && f.nvhOk && f.pushOk && f.massOk && f.printOk && f.volumeOk;

export function verify(design: BracketDesign): Verification {
  const mat = MATERIALS[design.material];
  const d = derive(design);
  const f = flags(design, d);
  const { thickness: t, topWidth: b, lipWidth: lw, cutout: c, bossHeight: le } = design;
  const st = (ok: boolean): Status => (ok ? 'pass' : 'fail');
  const machined = design.finish === 'machined';
  const a = lw / 2;
  const webI = (LENGTH_MM * (1 - c) * t ** 3) / 12;
  const kWeb = (12 * mat.modulus * webI) / AVG_HEIGHT_MM ** 3;
  const printedFlat = PRINT_TOL_PER_MM * LENGTH_MM;
  const printedSpacing = PRINT_TOL_PER_MM * NUT_SPACING_MM;

  const r: Record<string, { status: Status; value: string; limit: string; working: string[] }> = {
    VCS: {
      status: 'pass', value: 'X along the riser, Y across, Z up', limit: 'vehicle grid',
      working: ['The model is built in vehicle axes: X longitudinal along the riser, Y lateral, Z vertical; RH and LH mirror in Y.'],
    },
    'DATUM-A': {
      status: st(f.flatOk), value: machined ? `${fmt(MACHINED_TOL_MM, 2)} mm (pad faced after printing)` : `about ${fmt(printedFlat, 2)} mm as printed`, limit: `≤ ${FLATNESS_MM} mm`,
      working: machined
        ? [`Pad is face-milled after printing; milling holds about ${MACHINED_TOL_MM} mm`, `${MACHINED_TOL_MM} ≤ ${FLATNESS_MM}`]
        : [`As-printed metal parts hold about ${PRINT_TOL_PER_MM * 100}% of length: ${PRINT_TOL_PER_MM} × ${LENGTH_MM} = ${fmt(printedFlat, 2)} mm`, `${fmt(printedFlat, 2)} > ${FLATNESS_MM}, so the pad must be machined`],
    },
    'DATUM-BC': {
      status: st(f.holesOk), value: machined ? `reamed Ø${PILOT_HOLE_MM} ± ${MACHINED_TOL_MM}` : `printed Ø${PILOT_HOLE_MM} ± ${PRINT_HOLE_TOL_MM}`, limit: `Ø${PILOT_HOLE_MM} +${HOLE_TOL_MM}/-0.0, slot ${SLOT_MM[0]} × ${SLOT_MM[1]}`,
      working: machined
        ? ['Holes printed undersize, then the pilot is reamed and the slot milled to size', `Reamer tolerance about ${MACHINED_TOL_MM} mm fits inside +${HOLE_TOL_MM}/-0.0`]
        : [`Printed holes hold about ± ${PRINT_HOLE_TOL_MM} mm`, `A -${PRINT_HOLE_TOL_MM} mm error breaks the -0.0 lower limit`],
    },
    TRACK: {
      status: st(f.trackOk), value: machined ? `340.0 ± ${MACHINED_TOL_MM} mm, 4.5°` : `340.0 ± ${fmt(printedSpacing, 2)} mm, 4.5°`, limit: `${NUT_SPACING_MM}.0 ± ${SPACING_TOL_MM} mm, ${PITCH_DEG}°`,
      working: [
        `Top flange rises ${NUT_SPACING_MM} × tan ${PITCH_DEG}° = ${fmt(RISE_MM, 1)} mm from the front nut to the rear nut`,
        machined ? `Nut holes drilled and tapped M8 × 1.25 in one fixture: ± ${MACHINED_TOL_MM} mm` : `As printed: ${PRINT_TOL_PER_MM} × ${NUT_SPACING_MM} = ± ${fmt(printedSpacing, 2)} mm, more than ± ${SPACING_TOL_MM}`,
      ],
    },
    'KEEPOUT-HV': {
      status: st(f.harnessOk), value: `${fmt(d.harnessClearanceMm, 1)} mm`, limit: `≥ ${HARNESS_CLEARANCE_MM} mm`,
      working: [
        `Half width = top/2 + t + lip = ${fmt(b / 2, 1)} + ${fmt(t, 2)} + ${fmt(lw, 1)} = ${fmt(d.halfWidthMm, 1)} mm`,
        `Clearance = ${HARNESS_OFFSET_MM} - ${fmt(d.halfWidthMm, 1)} = ${fmt(d.harnessClearanceMm, 1)} mm`,
      ],
    },
    'KEEPOUT-TOOL': {
      status: st(f.toolOk), value: `${fmt(d.toolClearanceMm, 1)} mm beside the socket`, limit: `≥ ${TOOL_MARGIN_MM} mm, 25 mm tall cone`,
      working: [
        `Bolt centre sits lip/2 = ${fmt(a, 1)} mm from the wall; a Ø${2 * SOCKET_RADIUS_MM} socket needs ${SOCKET_RADIUS_MM} mm`,
        `Clearance = ${fmt(a, 1)} - ${SOCKET_RADIUS_MM} = ${fmt(d.toolClearanceMm, 1)} mm; nothing sits above the lip bolts`,
      ],
    },
    'KEEPOUT-BELOW': {
      status: 'pass', value: 'pad underside at Z = 0, nothing below', limit: 'zero protrusion',
      working: ['The pad sits on the crossmember skin; bolts go in from above into the BIW weld nuts, so nothing pierces the skin.'],
    },
    'LC-01': {
      status: st(f.lc01Ok), value: `lip ${fmt(d.lipMomentNmm)} of ${fmt(d.lipCapacityNmm)} N·mm`, limit: 'load ≤ plastic capacity',
      working: [
        `F = 20 × ${SEAT_MASS_KG} kg × ${G} = ${fmt(INERTIAL_N)} N; each of ${RISERS_PER_SEAT} risers takes ${fmt(SHEAR_N)} N along X`,
        `Seat CG ${CG_ABOVE_TRACK_MM} mm up tips the seat: uplift at the far nut = ${fmt(INERTIAL_N)} × ${CG_ABOVE_TRACK_MM} / (${RISERS_PER_SEAT} × ${NUT_SPACING_MM}) = ${fmt(UPLIFT_N)} N`,
        `Lip prying at the bolt: M = P × a / 2 = ${fmt(UPLIFT_N)} × ${fmt(a, 1)} / 2 = ${fmt(d.lipMomentNmm)} N·mm`,
        `Capacity = yield × (2a + washer) × t² / 4 = ${fmt(mat.yieldMPa)} × ${fmt(2 * a + WASHER_MM, 1)} × ${fmt(t, 2)}² / 4 = ${fmt(d.lipCapacityNmm)} N·mm`,
        `Bolt bearing = ${fmt(SHEAR_N / 2)} / (${PILOT_HOLE_MM} × ${fmt(t, 2)}) = ${fmt(f.bearingMPa, 1)} MPa vs 1.5 × yield = ${fmt(1.5 * mat.yieldMPa)} MPa`,
        `Washer pull-through = ${fmt(UPLIFT_N)} / (π × ${WASHER_MM} × ${fmt(t, 2)}) = ${fmt(f.punchMPa, 1)} MPa vs 0.6 × yield = ${fmt(0.6 * mat.yieldMPa)} MPa`,
      ],
    },
    'LC-01-STRAIN': {
      status: st(f.strainOk), value: `elongation ${mat.elongationPct}%`, limit: `> ${MAX_STRAIN_PCT}%`,
      working: [`${mat.short} breaks at about ${mat.elongationPct}% strain; the CTS allows up to ${MAX_STRAIN_PCT}% plastic strain, so the material must stretch further than that`, f.strainOk ? `${mat.elongationPct} > ${MAX_STRAIN_PCT}` : `${mat.elongationPct} ≤ ${MAX_STRAIN_PCT}: it could crack before reaching the allowed strain`],
    },
    'LC-02': {
      status: 'test', value: 'not calculable from the CTS', limit: 'attached, buckle anchor < 45 mm',
      working: ['27,000 N of belt load enters through the inboard buckle; how much reaches this riser depends on the seat frame. Needs the seat CAE model and a pull test.'],
    },
    'LC-03': {
      status: 'test', value: 'dynamic, not hand-calculable', limit: 'controlled absorption',
      working: [`Needs LS-DYNA and a sled test. ${mat.short} elongation ${mat.elongationPct}% is the hand-check proxy for no brittle fracture.`],
    },
    'LC-04': {
      status: st(f.kickOk), value: `collapse at ${fmt(d.kickCapacityN)} N`, limit: `≥ ${fmt(KICK_N)} N`,
      working: [
        'Top flange as a strip fixed at both walls, point load in the middle: collapse load = 8 × Mp / b with Mp = yield × b × t² / 4',
        `= 2 × yield × t² = 2 × ${fmt(mat.yieldMPa)} × ${fmt(t, 2)}² = ${fmt(d.kickCapacityN)} N`,
      ],
    },
    FATIGUE: {
      status: 'test', value: 'no S-N data for the printed material', limit: '100,000 cycles, > 85% clamp load',
      working: ['Printed metals have scatter in fatigue from surface and porosity; needs the 6-DOF shaker test on parts from the production print route.'],
    },
    SLAM: {
      status: st(f.slamOk), value: `elastic up to ${fmt(d.slamElasticN)} N`, limit: `≥ ${fmt(SLAM_N)} N (no set)`,
      working: [
        'Stays elastic, so no permanent set, while the load is below 2/3 of the collapse load',
        `= (4/3) × yield × t² = (4/3) × ${fmt(mat.yieldMPa)} × ${fmt(t, 2)}² = ${fmt(d.slamElasticN)} N`,
        'The 80,000 cycles still need a rig test',
      ],
    },
    NVH: {
      status: st(f.nvhOk), value: `${fmt(d.frequencyHz, 1)} Hz`, limit: `≥ ${MIN_FREQ_HZ} Hz`,
      working: [
        `Each wall bends sideways like a plate: I = L × (1 - cutout) × t³ / 12 = ${LENGTH_MM} × ${fmt(1 - c, 2)} × ${fmt(t, 2)}³ / 12 = ${fmt(webI, 1)} mm⁴`,
        `k per wall = 12 × E × I / h³ = 12 × ${fmt(mat.modulus)} × ${fmt(webI, 1)} / ${fmt(AVG_HEIGHT_MM, 1)}³ = ${fmt(kWeb, 1)} N/mm; ${RISERS_PER_SEAT * 2} walls`,
        `f = √(k / m) / 2π = √(${fmt(RISERS_PER_SEAT * 2 * kWeb, 0)} × 1000 / ${SEAT_MASS_KG}) / 2π = ${fmt(d.frequencyHz, 1)} Hz (brackets only; the seat frame lowers it)`,
      ],
    },
    MATERIAL: {
      status: 'deviation', value: `${mat.short}, ${fmt(t, 2)} mm`, limit: REFERENCE.name,
      working: [`The client asked for a 3D-printable part, so HSLA 420 sheet is replaced by ${mat.name}. Needs written approval.`, mat.source],
    },
    PROCESS: {
      status: 'deviation', value: mat.process, limit: 'progressive die stamping',
      working: ['Printing replaces stamping, so thinning and AutoForm do not apply; inside corner radii are kept at 1.5 × t as in the CTS.'],
    },
    JOINING: {
      status: st(f.pushOk), value: `push-out ${fmt(d.pushOutN)} N, integral boss`, limit: `≥ ${fmt(PUSH_OUT_N)} N, ≥ 55 N·m torque-out`,
      working: [
        'Welded nuts become tapped bosses printed into the part, so they cannot spin out (torque-out met by design)',
        `Thread strip = 0.5 × π × d × engagement × 0.6 × UTS = 0.5 × π × ${NUT_THREAD_MM} × ${fmt(le, 1)} × 0.6 × ${mat.utsMPa} = ${fmt(d.pushOutN)} N`,
      ],
    },
    CORROSION: {
      status: 'test', value: 'salt spray not run', limit: '720 h NSS, zero red rust',
      working: [mat.corrosion],
    },
    MASS: {
      status: st(f.massOk), value: `${fmt(d.massG)} g`, limit: `≤ ${MASS_TARGET_G} g`,
      working: [
        `Sheet = L × (top + 2 × h × (1 - cutout) + 2 × lip) × t = ${LENGTH_MM} × (${fmt(b, 1)} + 2 × ${fmt(AVG_HEIGHT_MM, 1)} × ${fmt(1 - c, 2)} + 2 × ${fmt(lw, 1)}) × ${fmt(t, 2)}`,
        `Plus 2 bosses Ø${BOSS_OD_MM} × ${fmt(le, 1)} mm, minus holes: V = ${fmt(d.volumeMm3 / 1000, 1)} cm³`,
        `Mass = ${fmt(d.volumeMm3 / 1000, 1)} × ${mat.density} = ${fmt(d.massG)} g`,
      ],
    },
    PRICE: {
      status: 'deviation', value: `$${fmt(d.unitCostUSD, 2)} prototype`, limit: `$${PIECE_PRICE_USD} at 120,000 a year`,
      working: [
        `${fmt(d.volumeMm3 / 1000, 1)} cm³ × $${mat.costPerCm3} + $${mat.setupUSD} setup${machined ? ` + $${MACHINING_USD} machining` : ''} = $${fmt(d.unitCostUSD, 2)}`,
        'Printing cannot reach a stamped piece price; the printed part is for prototype and validation builds.',
      ],
    },
    'AM-PRINT': {
      status: st(f.printOk), value: design.orientation === 'upright' ? `upright, wall ${fmt(t, 2)} mm` : 'pads down: top flange bridges the channel', limit: `no trapped supports, wall ≥ ${mat.minWallMm} mm`,
      working: design.orientation === 'upright'
        ? ['Printed standing on its end, the channel profile is the same on every layer, so nothing overhangs']
        : [`Printed pads down, the ${fmt(b, 1)} mm top flange needs supports inside the channel along ${LENGTH_MM} mm, which cannot be removed cleanly`],
    },
    'AM-VOLUME': {
      status: st(f.volumeOk), value: `${f.printDims.map((v) => fmt(v)).join(' × ')} mm`, limit: `${BUILD_VOLUME_MM.join(' × ')} mm`,
      working: [`Part ${fmt(d.envelopeMm[0])} × ${fmt(d.envelopeMm[1])} × ${fmt(d.envelopeMm[2])} mm, printed ${design.orientation}`],
    },
  };

  const checks: CheckResult[] = REQUIREMENTS.map((q) => ({ id: q.id, clause: q.clause, title: q.title, method: q.method, basis: q.basis, ...r[q.id] }));
  return { design, derived: d, checks, passed: noFail(f) };
}

export function referenceMassG(): number {
  return ((LENGTH_MM * (40 + 2 * AVG_HEIGHT_MM + 2 * 30) * REFERENCE.thickness) / 1000) * REFERENCE.density;
}

const MATERIAL_IDS = Object.keys(MATERIALS) as MaterialId[];
const ORIENTATIONS: Orientation[] = ['upright', 'pads-down'];
const FINISHES: Finish[] = ['machined', 'as-printed'];
const range = (lo: number, hi: number, step: number) => Array.from({ length: Math.round((hi - lo) / step) + 1 }, (_, i) => +(lo + i * step).toFixed(3));

export function minBossHeight(material: MaterialId): number {
  const need = PUSH_OUT_N / (0.5 * Math.PI * NUT_THREAD_MM * 0.6 * MATERIALS[material].utsMPa);
  return Math.min(BOUNDS.bossHeight[1], Math.max(BOUNDS.bossHeight[0], Math.ceil(need)));
}

export function optimise(only?: MaterialId): Verification | null {
  let best: { d: Derived; design: BracketDesign } | null = null;
  for (const material of only ? [only] : MATERIAL_IDS) {
    const bossHeight = minBossHeight(material);
    for (const orientation of ORIENTATIONS) for (const finish of FINISHES)
      for (const thickness of range(1, 5, 0.25)) for (const topWidth of range(25, 70, 5)) for (const lipWidth of range(20, 45, 1)) for (const cutout of range(0, 0.6, 0.1)) {
        const design: BracketDesign = { material, orientation, finish, thickness, topWidth, lipWidth, cutout, bossHeight };
        const d = derive(design);
        if (best && d.massG > best.d.massG + 1e-9) continue;
        if (!noFail(flags(design, d))) continue;
        if (!best || d.massG < best.d.massG - 1e-9 || d.unitCostUSD < best.d.unitCostUSD) best = { d, design };
      }
  }
  return best ? verify(best.design) : null;
}

export const STATUS_WORD: Record<Status, string> = { pass: 'PASS', fail: 'FAIL', test: 'NEEDS TEST', deviation: 'DEVIATION' };

export function tally(v: Verification): Record<Status, number> {
  const out: Record<Status, number> = { pass: 0, fail: 0, test: 0, deviation: 0 };
  for (const c of v.checks) out[c.status] += 1;
  return out;
}

export interface Approval { decision: 'approved' | 'changes'; by: string; date: string; note?: string }

export function reportMarkdown(v: Verification, meta: { date: string; iterations: number; approval?: Approval | null }): string {
  const mat = MATERIALS[v.design.material];
  const dd = v.design;
  const n = tally(v);
  const out: string[] = [];
  out.push(
    '# Design verification report',
    '',
    `Specification: ${CTS.id}`,
    `Component: ${CTS.component}`,
    `Vehicle: ${CTS.vehicle}`,
    `Classification: ${CTS.classification}`,
    `Date: ${meta.date}. Design iterations: ${meta.iterations}.`,
    '',
    '## Design',
    '',
    `Printed hat-section riser, RH and LH mirror images. ${mat.name}, printed ${dd.orientation}, ${dd.finish}. Wall ${dd.thickness} mm, top flange ${dd.topWidth} mm, bolt lips ${dd.lipWidth} mm, wall cut-outs ${Math.round(dd.cutout * 100)}%, tapped bosses ${dd.bossHeight} mm.`,
    `Mass ${fmt(v.derived.massG)} g each. Prototype cost $${fmt(v.derived.unitCostUSD, 2)} each.`,
    '',
    '## Summary',
    '',
    `${n.pass} PASS, ${n.fail} FAIL, ${n.test} NEED CAE OR PHYSICAL TEST, ${n.deviation} DEVIATIONS FOR CLIENT APPROVAL.`,
    n.fail === 0
      ? 'Every requirement that can be checked by analysis or inspection passes. This is not a claim of compliance: the tests and deviations below must close first.'
      : 'The design FAILS at least one requirement.',
    '',
    `Note to client: the CTS reference part (${REFERENCE.name}) at this riser size weighs about ${fmt(referenceMassG())} g by the same formula, above the ${MASS_TARGET_G} g target. Please confirm the target or the riser size.`,
    '',
    '## Compliance matrix',
    '',
    '| CTS | Requirement | Method | Result | Limit | Status |',
    '| --- | --- | --- | --- | --- | --- |',
  );
  for (const c of v.checks) out.push(`| ${c.clause} | ${c.title} | ${c.method} | ${c.value} | ${c.limit} | ${STATUS_WORD[c.status]} |`);
  out.push('', '## Working', '');
  for (const c of v.checks) {
    out.push(`### ${c.clause} ${c.title}: ${STATUS_WORD[c.status]}`, '');
    for (const line of c.working) out.push(`- ${line}`);
    out.push(`- Method: ${c.method}. Basis: ${c.basis}`, '');
  }
  out.push('## Needs CAE or physical test', '');
  for (const c of v.checks.filter((x) => x.status === 'test')) out.push(`- ${c.clause} ${c.title}: ${c.basis}`);
  out.push('', '## Deviations needing client approval', '');
  for (const c of v.checks.filter((x) => x.status === 'deviation')) out.push(`- ${c.clause} ${c.title}: ${c.value} instead of ${c.limit}.`);
  out.push(
    '',
    '## Deliverables against CTS section 5',
    '',
    '- 3D CAD: STL of RH and LH supplied. Native CATIA V5 / NX and the 2D GD&T drawing are not produced yet.',
    '- LS-DYNA crash report: not produced; hand analysis only.',
    '- AutoForm formability: not applicable to a printed part (see the process deviation).',
    '- DFMEA and tolerance stack-up: not produced yet.',
    '',
    '## Assumptions',
    '',
    ...ASSUMPTIONS.map((x) => `- ${x}`),
    '',
    '## Client decision',
    '',
    meta.approval
      ? `${meta.approval.decision === 'approved' ? 'APPROVED' : 'CHANGES REQUESTED'} by ${meta.approval.by} on ${meta.approval.date}.${meta.approval.note ? ` Note: ${meta.approval.note}` : ''}`
      : 'Awaiting client review.',
    '',
  );
  return out.join('\n');
}

export interface Margin { id: string; label: string; ratio: number }

export function margins(design: BracketDesign, d: Derived = derive(design)): Margin[] {
  const f = flags(design, d);
  const mat = MATERIALS[design.material];
  return [
    { id: 'LC-01', label: 'Lip bending (LC-01)', ratio: d.lipCapacityNmm / d.lipMomentNmm },
    { id: 'LC-01-BEARING', label: 'Bolt hole bearing (LC-01)', ratio: (1.5 * mat.yieldMPa) / f.bearingMPa },
    { id: 'LC-01-PUNCH', label: 'Washer punch-through (LC-01)', ratio: (0.6 * mat.yieldMPa) / f.punchMPa },
    { id: 'LC-03', label: 'Seat slam (LC-03)', ratio: d.slamElasticN / SLAM_N },
    { id: 'LC-04', label: 'Foot kick (LC-04)', ratio: d.kickCapacityN / KICK_N },
    { id: 'NVH', label: 'First mode (NVH)', ratio: d.frequencyHz / MIN_FREQ_HZ },
    { id: 'JOINING', label: 'Nut push-out (joining)', ratio: d.pushOutN / PUSH_OUT_N },
  ];
}

export const weakest = (list: Margin[]): Margin => list.reduce((a, b) => (b.ratio < a.ratio ? b : a));

export type VariantId = 'lightest' | 'balanced' | 'robust';
export interface Variant { id: VariantId; name: string; why: string; verification: Verification; weakest: Margin }

export const BALANCED_MARGIN = 1.5;

const VARIANT_TEXT: Record<VariantId, { name: string; why: string }> = {
  lightest: { name: 'Lightest', why: 'Every gram counts against the mass target. Thinnest wall and the largest cut-outs that still clear every check.' },
  balanced: { name: 'Balanced', why: `The lightest design with at least ${BALANCED_MARGIN}× margin on every load check, so a physical test that comes in below the hand calculation does not force a redesign.` },
  robust: { name: 'Most margin', why: 'The most headroom on its weakest check within the mass target. For a first physical build where a retest costs more than the extra grams.' },
};

export function searchVariants(): Record<VariantId, BracketDesign | null> {
  type Cand = { design: BracketDesign; d: Derived; min: number };
  let lightest: Cand | null = null, balanced: Cand | null = null, robust: Cand | null = null;
  const lighter = (a: Cand, b: Cand | null) => !b || a.d.massG < b.d.massG - 1e-9 || (Math.abs(a.d.massG - b.d.massG) <= 1e-9 && a.d.unitCostUSD < b.d.unitCostUSD);
  for (const material of MATERIAL_IDS) {
    for (const bossHeight of range(minBossHeight(material), BOUNDS.bossHeight[1], 1)) for (const orientation of ORIENTATIONS) for (const finish of FINISHES)
      for (const thickness of range(1, 5, 0.25)) for (const topWidth of range(25, 70, 5)) for (const lipWidth of range(20, 45, 1)) for (const cutout of range(0, 0.6, 0.1)) {
        const design: BracketDesign = { material, orientation, finish, thickness, topWidth, lipWidth, cutout, bossHeight };
        const d = derive(design);
        if (d.massG > MASS_TARGET_G) continue;
        if (!noFail(flags(design, d))) continue;
        const pick: Cand = { design, d, min: weakest(margins(design, d)).ratio };
        if (lighter(pick, lightest)) lightest = pick;
        if (pick.min >= BALANCED_MARGIN && lighter(pick, balanced)) balanced = pick;
        if (!robust || pick.min > robust.min + 1e-9 || (Math.abs(pick.min - robust.min) <= 1e-9 && lighter(pick, robust))) robust = pick;
      }
  }
  return { lightest: lightest?.design ?? null, balanced: balanced?.design ?? null, robust: robust?.design ?? null };
}

const TI: Pick<BracketDesign, 'material' | 'orientation' | 'finish'> = { material: 'ti64-lpbf', orientation: 'upright', finish: 'machined' };
export const VARIANT_DESIGNS: Record<VariantId, BracketDesign> = {
  lightest: { ...TI, thickness: 1.5, topWidth: 25, lipWidth: 26, cutout: 0.5, bossHeight: 3 },
  balanced: { ...TI, thickness: 2, topWidth: 25, lipWidth: 26, cutout: 0.6, bossHeight: 4 },
  robust: { ...TI, thickness: 3.25, topWidth: 25, lipWidth: 26, cutout: 0.6, bossHeight: 9 },
};

let variantCache: Variant[] | null = null;

export function variants(): Variant[] {
  variantCache ??= (Object.keys(VARIANT_DESIGNS) as VariantId[]).map(id => {
    const design = VARIANT_DESIGNS[id];
    return { id, ...VARIANT_TEXT[id], verification: verify(design), weakest: weakest(margins(design)) };
  });
  return variantCache;
}

export const sameDesign = (a: BracketDesign, b: BracketDesign): boolean =>
  (Object.keys(a) as (keyof BracketDesign)[]).every(k => typeof a[k] === 'number' ? Math.abs((a[k] as number) - (b[k] as number)) < 1e-6 : a[k] === b[k]);
