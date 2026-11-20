import { describe, expect, it } from 'vitest';
import { AVG_HEIGHT_MM, clampDesign, derive, optimise, referenceMassG, reportMarkdown, tally, verify } from '../src/bracket/engine';
import type { BracketDesign, Status, Verification } from '../src/bracket/model';
import { REQUIREMENTS, STARTING } from '../src/bracket/spec';

const GOOD: BracketDesign = { material: 'ti64-lpbf', orientation: 'upright', finish: 'machined', thickness: 2, topWidth: 30, lipWidth: 28, cutout: 0.5, bossHeight: 4 };
const status = (v: Verification, id: string): Status => v.checks.find((c) => c.id === id)!.status;
const fails = (v: Verification) => v.checks.filter((c) => c.status === 'fail').map((c) => c.id);
const with_ = (p: Partial<BracketDesign>) => verify({ ...GOOD, ...p });

describe('hand-worked Ti-6Al-4V riser, t 2, top 30, lips 28, cut-outs 50%', () => {
  const d = derive(GOOD);

  it('loads: F = 20 × 38 × 9.81 = 7,455.6 N; per riser 3,727.8 N; uplift = 7,455.6 × 300 / (2 × 340) = 3,289.2 N', () => {
    expect(d.inertialN).toBeCloseTo(7455.6, 1);
    expect(d.shearPerRiserN).toBeCloseTo(3727.8, 1);
    expect(d.upliftN).toBeCloseTo(3289.2, 1);
  });

  it('LC-01 lip: M = 3,289.2 × 14 / 2 = 23,024 N·mm; capacity = 880 × (28 + 20) × 2² / 4 = 42,240 N·mm', () => {
    expect(d.lipMomentNmm).toBeCloseTo(23024.4, 0);
    expect(d.lipCapacityNmm).toBeCloseTo(42240, 6);
  });

  it('LC-04 = 2 × 880 × 2² = 7,040 N; slam elastic = 4/3 × 880 × 4 = 4,693 N; push-out = 0.5π × 8 × 4 × 0.6 × 950 = 28,651 N', () => {
    expect(d.kickCapacityN).toBeCloseTo(7040, 6);
    expect(d.slamElasticN).toBeCloseTo(4693.33, 1);
    expect(d.pushOutN).toBeCloseTo(0.5 * Math.PI * 8 * 4 * 0.6 * 950, 6);
  });

  it('NVH: I = 380 × 0.5 × 8 / 12 = 126.67; k = 12 × 113,800 × 126.67 / h³; f = √(4k × 1000 / 38) / 2π', () => {
    const I = (380 * 0.5 * 8) / 12;
    const k = (12 * 113800 * I) / AVG_HEIGHT_MM ** 3;
    expect(AVG_HEIGHT_MM).toBeCloseTo(40 + 170 * Math.tan((4.5 * Math.PI) / 180), 9);
    expect(d.frequencyHz).toBeCloseTo(Math.sqrt((4 * k * 1000) / 38) / (2 * Math.PI), 9);
    expect(d.frequencyHz).toBeGreaterThan(32);
  });

  it('geometry: half width 15 + 2 + 28 = 45, harness clearance 60 - 45 = 15, tool clearance 14 - 11 = 3', () => {
    expect(d.halfWidthMm).toBe(45);
    expect(d.harnessClearanceMm).toBe(15);
    expect(d.toolClearanceMm).toBe(3);
  });

  it('mass: sheet 380 × (30 + 2h × 0.5 + 56) × 2 plus bosses minus holes, × 4.43 g/cm³', () => {
    const sheet = 380 * (30 + AVG_HEIGHT_MM + 56) * 2;
    const bosses = 2 * (Math.PI / 4) * (16 ** 2 - 8 ** 2) * 4;
    const holes = ((Math.PI / 4) * 10.2 ** 2 + 3.8 * 10.2 + (Math.PI / 4) * 10.2 ** 2 + 2 * (Math.PI / 4) * 64) * 2;
    expect(d.volumeMm3).toBeCloseTo(sheet + bosses - holes, 6);
    expect(d.massG).toBeCloseTo(((sheet + bosses - holes) / 1000) * 4.43, 6);
    expect(d.massG).toBeLessThan(680);
  });

  it('passes every analysed requirement, with 4 tests and 3 deviations left honest', () => {
    const v = verify(GOOD);
    expect(fails(v)).toEqual([]);
    expect(v.passed).toBe(true);
    const n = tally(v);
    expect(n.test).toBe(4);
    expect(n.deviation).toBe(3);
    expect(['LC-02', 'LC-03', 'FATIGUE', 'CORROSION'].map((id) => status(v, id))).toEqual(['test', 'test', 'test', 'test']);
    expect(['MATERIAL', 'PROCESS', 'PRICE'].map((id) => status(v, id))).toEqual(['deviation', 'deviation', 'deviation']);
    expect(v.checks.find((c) => c.id === 'LC-01')!.working.join('\n')).toContain('7,456 N');
  });
});

describe('known-wrong designs fail the right clause, and the single fix passes it', () => {
  it('AlSi10Mg fails LC-01 plastic strain (6% ≤ 12%); Ti-6Al-4V (14%) passes', () => {
    expect(status(with_({ material: 'alsi10mg-lpbf' }), 'LC-01-STRAIN')).toBe('fail');
    expect(status(verify(GOOD), 'LC-01-STRAIN')).toBe('pass');
  });
  it('as-printed fails datum A, holes and track tolerances; machined passes them', () => {
    const v = with_({ finish: 'as-printed' });
    expect(['DATUM-A', 'DATUM-BC', 'TRACK'].map((id) => status(v, id))).toEqual(['fail', 'fail', 'fail']);
  });
  it('pads-down traps supports (AM-PRINT fails); upright passes', () => {
    expect(status(with_({ orientation: 'pads-down' }), 'AM-PRINT')).toBe('fail');
  });
  it('wide riser breaks the 12 mm harness clearance: top 50 + lips 30 gives 60 - 57 = 3 mm', () => {
    const v = with_({ topWidth: 50, lipWidth: 30 });
    expect(v.derived.harnessClearanceMm).toBe(3);
    expect(status(v, 'KEEPOUT-HV')).toBe('fail');
  });
  it('lips 24 mm leave 12 - 11 = 1 mm beside the socket (fail); 26 mm leave 2 (pass)', () => {
    expect(status(with_({ lipWidth: 24 }), 'KEEPOUT-TOOL')).toBe('fail');
    expect(status(with_({ lipWidth: 26 }), 'KEEPOUT-TOOL')).toBe('pass');
  });
  it('Ti 1.2 mm: LC-04 2 × 880 × 1.44 = 2,534 N < 3,500 fails; 1.5 mm = 3,960 N passes', () => {
    expect(status(with_({ thickness: 1.2 }), 'LC-04')).toBe('fail');
    expect(status(with_({ thickness: 1.5 }), 'LC-04')).toBe('pass');
  });
  it('AlSi10Mg boss 5 mm strips at 0.5π × 8 × 5 × 0.6 × 350 = 13,195 N < 18 kN; 7 mm passes', () => {
    const v = with_({ material: 'alsi10mg-lpbf', bossHeight: 5 });
    expect(v.derived.pushOutN).toBeCloseTo(13194.7, 0);
    expect(status(v, 'JOINING')).toBe('fail');
    expect(status(with_({ material: 'alsi10mg-lpbf', bossHeight: 7 }), 'JOINING')).toBe('pass');
  });
  it('316L at the same size is over the 680 g mass target', () => {
    const v = with_({ material: 'ss316l-lpbf' });
    expect(v.derived.massG).toBeGreaterThan(680);
    expect(status(v, 'MASS')).toBe('fail');
  });
  it('PA12 fails structure and stiffness', () => {
    const v = with_({ material: 'pa12-sls' });
    for (const id of ['LC-01', 'LC-04', 'SLAM', 'NVH', 'JOINING']) expect(status(v, id)).toBe('fail');
  });
  it('wall cut-outs trade stiffness: Ti 1.5 mm at 60% cut-outs is below 32 Hz', () => {
    expect(status(with_({ thickness: 1.5, cutout: 0.6 }), 'NVH')).toBe('fail');
  });
});

describe('optimiser, starting design, report', () => {
  it('optimise returns the lightest passing design, Ti-6Al-4V upright machined, under 680 g', () => {
    const v = optimise()!;
    expect(v).not.toBeNull();
    expect(v.passed).toBe(true);
    expect(fails(v)).toEqual([]);
    expect(v.design.material).toBe('ti64-lpbf');
    expect(v.design.orientation).toBe('upright');
    expect(v.design.finish).toBe('machined');
    expect(v.derived.massG).toBeLessThan(680);
  });
  it('STARTING (steel part copied in aluminium, as printed) fails several clauses', () => {
    const v = verify(STARTING);
    expect(v.passed).toBe(false);
    expect(fails(v)).toEqual(expect.arrayContaining(['DATUM-A', 'LC-01-STRAIN', 'LC-04', 'AM-PRINT', 'KEEPOUT-TOOL']));
  });
  it('every check list follows the CTS requirement order', () => {
    expect(verify(GOOD).checks.map((c) => c.id)).toEqual(REQUIREMENTS.map((r) => r.id));
  });
  it('clampDesign keeps numbers in bounds', () => {
    const c = clampDesign({ ...GOOD, thickness: 99, cutout: -1, bossHeight: Number.NaN });
    expect([c.thickness, c.cutout, c.bossHeight]).toEqual([5, 0, 3]);
  });
  it('the CTS reference steel part is over its own mass target', () => {
    expect(referenceMassG()).toBeGreaterThan(680);
  });
  it('report has the CTS id, every clause, the honest summary, deliverables and the approval line', () => {
    const md = reportMarkdown(verify(GOOD), { date: '2026-11-20', iterations: 2, approval: { decision: 'approved', by: 'Client', date: '2026-11-20' } });
    expect(md).toContain('CTS-ST-2028-4410-RevB');
    for (const r of REQUIREMENTS) expect(md).toContain(r.title);
    expect(md).toContain('This is not a claim of compliance');
    expect(md).toContain('LS-DYNA crash report: not produced');
    expect(md).toContain('APPROVED by Client');
    expect(md).not.toContain('—');
    expect(reportMarkdown(verify(GOOD), { date: 'x', iterations: 1 })).toContain('Awaiting client review.');
  });
});
