import { describe, expect, it } from 'vitest';
import { createFurnitureItem, createInitialProject, upgradeRetiredPresets, validateLayout } from '../src/domain';
import { buildLayoutExplanation, openFloorArea, sampleLayoutExplanation, sampleLayoutTransition, shortestYawDelta } from '../src/layout-explainer';
import { matchLayoutIntent } from '../src/layout-intent';
import type { Layout } from '../src/types';

const project = createInitialProject();
const [original, airy, work] = project.layouts;
const tinyLayout = (): Layout => ({ ...structuredClone(original), items: [{ ...createFurnitureItem('desk'), id: 'desk', position: { x: -1, z: 0 }, color: '#000000' }] });

describe('deterministic layout explanations', () => {
  it('explains actual presets with factual movement, intent and honest check counts in under eight seconds', () => {
    const plan = buildLayoutExplanation(original, airy, project.room);
    expect(buildLayoutExplanation(original, airy, project.room)).toEqual(plan);
    expect(plan.steps.find(step => step.itemId === 'bed')).toMatchObject({ kind: 'move', from: { id: 'bed' }, to: { id: 'bed' } });
    expect(plan.steps.find(step => step.itemId === 'bed')?.description).toContain('0.9 m left');
    expect(plan.steps.find(step => step.itemId === 'bed')?.description).toContain('0.5 m toward the back wall');
    expect(plan.summary).toContain(airy.description);
    expect(plan.startIssueCount).toBe(validateLayout(original, project.room).length);
    expect(plan.endIssueCount).toBe(validateLayout(airy, project.room).length);
    expect(plan.totalDurationMs).toBeGreaterThan(0);
    expect(plan.totalDurationMs).toBeLessThanOrEqual(8000);
    expect(plan.summary).not.toMatch(/\d+%|optimized|safer/i);
    expect(plan.warnings.join(' ')).toContain('does not verify a collision-free');
  });
  it('recognizes additions, removals, hidden pieces, geometry, size and colour without pairing different IDs', () => {
    const from = tinyLayout(), to = structuredClone(from);
    to.id = 'changed';
    from.items.push({ ...createFurnitureItem('stool'), id: 'removed' });
    to.items.push({ ...createFurnitureItem('plant'), id: 'added', visible: false });
    Object.assign(to.items[0], { assetId: 'builtin:desk', visible: false, color: '#ffffff', dimensions: { width: 1.5, depth: .7, height: .8 } });
    const plan = buildLayoutExplanation(from, to, project.room);
    expect(plan.steps.find(step => step.itemId === 'removed')).toMatchObject({ kind: 'remove', from: { id: 'removed' } });
    expect(plan.steps.find(step => step.itemId === 'added')).toMatchObject({ kind: 'add', to: { id: 'added', visible: false } });
    const description = plan.steps.find(step => step.itemId === 'desk')?.description;
    expect(description).toContain('1.5 × 0.7 × 0.8 m');
    expect(description).toContain('colour');
    expect(description).toContain('furniture model');
    expect(description).toContain('Hide this piece');
  });
  it('reports locked source changes as separate-preset notes and leaves all presets untouched', () => {
    const from = tinyLayout(), to = structuredClone(from);
    from.items[0].locked = true; to.id = 'destination'; to.items[0].position.x = 1;
    const before = structuredClone(from), target = structuredClone(to);
    const plan = buildLayoutExplanation(from, to, project.room);
    sampleLayoutExplanation(from, to, plan, 400);
    expect(plan.warnings.join(' ')).toContain('locked');
    expect(plan.warnings.join(' ')).toContain('source item and its lock remain unchanged');
    expect(from).toEqual(before); expect(to).toEqual(target);
    plan.steps[0].from!.position.x = 90;
    expect(from).toEqual(before);
  });
  it('omits trivial motion and recognizes colour-only and unchanged layouts', () => {
    const from = tinyLayout(), to = structuredClone(from); to.id = 'other';
    to.items[0].position.x += .001; to.items[0].rotation += .001;
    const same = buildLayoutExplanation(from, to, project.room);
    expect(same.steps).toEqual([]); expect(same.totalDurationMs).toBe(0);
    expect(sampleLayoutExplanation(from, to, same, 0)).toMatchObject({ layout: to, finished: true });
    to.wallColor = '#112233';
    expect(buildLayoutExplanation(from, to, project.room).steps).toMatchObject([{ kind: 'finish' }]);
  });
  it('rejects ambiguous duplicate stable IDs', () => {
    const from = tinyLayout(); from.items.push(structuredClone(from.items[0]));
    expect(() => buildLayoutExplanation(from, work, project.room)).toThrow(/unique/);
  });
});

describe('layout transition sampling', () => {
  it('uses the shortest yaw across wraparound and interpolates positions, size and colour', () => {
    const from = tinyLayout(), to = structuredClone(from); to.id = 'other';
    Object.assign(from.items[0], { rotation: 350 * Math.PI / 180 });
    Object.assign(to.items[0], { rotation: 10 * Math.PI / 180, position: { x: 1, z: 2 }, dimensions: { width: 2, depth: 1, height: 1 }, color: '#ffffff' });
    const middle = sampleLayoutTransition(from, to, .5).items[0];
    expect(shortestYawDelta(from.items[0].rotation, to.items[0].rotation)).toBeCloseTo(20 * Math.PI / 180);
    expect(middle.rotation).toBeCloseTo(Math.PI * 2);
    expect(middle.position).toEqual({ x: 0, z: 1 });
    expect(middle.dimensions.width).toBeCloseTo(1.6);
    expect(middle.color).toBe('#808080');
    expect(sampleLayoutTransition(from, to, -1)).toEqual(from);
    expect(sampleLayoutTransition(from, to, 2)).toEqual(to);
  });
  it('applies one step at a time and finishes at the exact real preset', () => {
    const plan = buildLayoutExplanation(original, work, project.room), first = plan.steps[0];
    const start = sampleLayoutExplanation(original, work, plan, 0);
    expect(start.layout).toEqual(original); expect(start.finished).toBe(false);
    const middle = sampleLayoutExplanation(original, work, plan, first.durationMs / 2);
    expect(middle).toMatchObject({ stepIndex: 0, stepProgress: .5, finished: false });
    for (const item of middle.layout.items.filter(item => item.id !== first.itemId)) expect(item).toEqual(original.items.find(source => source.id === item.id));
    const boundary = sampleLayoutExplanation(original, work, plan, first.durationMs);
    expect(boundary.stepIndex).toBe(1);
    expect(boundary.layout.items.find(item => item.id === first.itemId)).toEqual(first.to);
    const final = sampleLayoutExplanation(original, work, plan, plan.totalDurationMs);
    expect(final).toMatchObject({ layout: work, finished: true, stepProgress: 1 });
    const duringFinish = sampleLayoutExplanation(original, work, plan, plan.totalDurationMs - 100);
    expect(duringFinish.layout.wallColor).toBe(original.wallColor);
    expect(duringFinish.layout.accentColor).toBe(original.accentColor);
    expect(final.layout.wallColor).toBe(work.wallColor);
    final.layout.items[0].name = 'Changed copy';
    expect(work.items[0].name).not.toBe('Changed copy');
    expect(() => sampleLayoutExplanation(original, airy, plan, 0)).toThrow(/different layouts/);
  });
  it('represents addition/removal visibility without inventing geometry and preserves exact endpoints', () => {
    const from = tinyLayout(), to = { ...structuredClone(from), id: 'added', items: [{ ...createFurnitureItem('plant'), id: 'plant', visible: true }] };
    const early = sampleLayoutTransition(from, to, .25), late = sampleLayoutTransition(from, to, .75);
    expect(early.items.find(item => item.id === 'desk')?.visible).toBe(true);
    expect(early.items.find(item => item.id === 'plant')?.visible).toBe(false);
    expect(late.items.find(item => item.id === 'desk')?.visible).toBe(false);
    expect(late.items.find(item => item.id === 'plant')?.visible).toBe(true);
    expect(sampleLayoutTransition(from, to, 0)).toEqual(from);
    expect(sampleLayoutTransition(from, to, 1)).toEqual(to);
  });
});

describe('measured reasons', () => {
  it('measures the largest open rectangle from footprints', () => {
    const empty = { ...structuredClone(original), items: [] };
    expect(openFloorArea(empty, project.room)).toBeCloseTo(project.room.width * project.room.depth, 1);
    expect(openFloorArea(original, project.room)).toBeLessThan(openFloorArea(empty, project.room));
    expect(openFloorArea({ ...empty, items: original.items.map(item => ({ ...item, visible: false })) }, project.room)).toBeCloseTo(openFloorArea(empty, project.room));
  });
  it('gives every furniture step a reason and reports the measured floor change', () => {
    const plan = buildLayoutExplanation(original, airy, project.room);
    expect(plan.steps.filter(step => step.kind !== 'finish').every(step => Boolean(step.why))).toBe(true);
    expect(plan.startOpenFloor).toBe(openFloorArea(original, project.room));
    expect(plan.endOpenFloor).toBe(openFloorArea(airy, project.room));
    expect(plan.steps[0].why).toContain('Opens');
  });
  it('makes Open & airy measurably more open than Original, with no placement findings', () => {
    expect(openFloorArea(airy, project.room)).toBeGreaterThan(openFloorArea(original, project.room) + 1);
    expect(validateLayout(airy, project.room)).toEqual([]);
  });
  it('upgrades only unedited saved copies of the retired preset', () => {
    const saved = structuredClone(project);
    const retired: Record<string, [number, number]> = { bed: [-.95, -.7], wardrobe: [1.32, -2.05], desk: [-1.72, 1.3], chair: [-.95, 1.4], 'floor-bed': [.8, .35], fan: [1.65, -.6], stool: [-.2, 2.05] };
    const copy = saved.layouts[1];
    copy.items = copy.items.map(item => ({ ...item, position: { x: retired[item.id][0], z: retired[item.id][1] } }));
    const edited = structuredClone(saved);
    edited.layouts[1].items[0].position.x = .3;
    expect(upgradeRetiredPresets(saved).layouts[1].items).toEqual(airy.items);
    expect(upgradeRetiredPresets(structuredClone(edited))).toEqual(edited);
  });
});

describe('typed layout requests', () => {
  const ask = (prompt: string, active = 'original', layouts = project.layouts) => matchLayoutIntent(prompt, layouts, active, project.room);
  it('sends a request for space to the layout with the most measured open floor', () => {
    const best = [...project.layouts].sort((a, b) => openFloorArea(b, project.room) - openFloorArea(a, project.room))[0];
    const active = project.layouts.find(layout => layout.id !== best.id)!.id;
    expect(ask('My room looks a little cluttered, and I need more space', active).targetId).toBe(best.id);
    expect(ask('I need more space', best.id).targetId).toBeUndefined();
    expect(ask('I need more space', best.id).reply).toContain('already showing');
  });
  it('honours named layouts, themes and reset requests', () => {
    expect(ask('show me work & rest').targetId).toBe('work-rest');
    expect(ask('I want a better place to study').targetId).toBe('work-rest');
    expect(ask('take me back to the original', 'open-airy').targetId).toBe('original');
    expect(ask('workspace please').targetId).toBe('work-rest');
  });
  it('declines rather than guessing', () => {
    const answer = ask('paint it purple');
    expect(answer.targetId).toBeUndefined();
    expect(answer.reply).toContain('Open & airy');
  });
});
