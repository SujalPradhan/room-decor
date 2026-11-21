import { describe, expect, it } from 'vitest';
import { createFurnitureItem, createInitialProject, createRetailProject, getFootprint, upgradeRetiredPresets, validateLayout } from '../src/domain';
import { buildLayoutExplanation, openFloorArea, sampleLayoutExplanation, sampleLayoutTransition, shortestYawDelta } from '../src/layout-explainer';
import { matchLayoutIntent } from '../src/layout-intent';
import { agentReasonFor, highlightFor } from '../src/useLayoutWalkthrough';
import type { ItemKind, Layout, RoomSpec } from '../src/types';

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

/** The original cell-by-cell measure, kept as the reference the faster one must match exactly. */
function openFloorByCell(layout: Layout, room: RoomSpec): number {
  const inside = (x: number, z: number, polygon: { x: number; z: number }[]) => {
    let result = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[i], b = polygon[j];
      if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) result = !result;
    }
    return result;
  };
  const cell = .05, columns = Math.round(room.width / cell), rows = Math.round(room.depth / cell);
  const footprints = layout.items.filter(item => item.visible).map(getFootprint), heights = new Array<number>(columns).fill(0);
  let best = 0;
  for (let row = 0; row < rows; row++) {
    const z = -room.depth / 2 + (row + .5) * cell, stack: number[] = [];
    for (let column = 0; column <= columns; column++) {
      if (column < columns) {
        const x = -room.width / 2 + (column + .5) * cell;
        heights[column] = footprints.some(polygon => inside(x, z, polygon)) ? 0 : heights[column] + 1;
      }
      const height = column < columns ? heights[column] : 0;
      while (stack.length && heights[stack[stack.length - 1]] >= height) {
        const top = heights[stack.pop()!], left = stack.length ? stack[stack.length - 1] + 1 : 0;
        best = Math.max(best, top * (column - left));
      }
      stack.push(column);
    }
  }
  return best * cell * cell;
}

describe('open floor measure', () => {
  it('gives the exact cell-by-cell result for presets, off-grid pieces and pieces past the walls', () => {
    const retail = createRetailProject();
    for (const { layouts, room } of [project, retail]) for (const layout of layouts) expect(openFloorArea(layout, room)).toBe(openFloorByCell(layout, room));
    let seed = 7;
    const random = () => (seed = seed * 16807 % 2147483647) / 2147483647;
    for (const { layouts, room } of [project, retail]) for (let round = 0; round < 12; round++) {
      const items = Array.from({ length: 10 }, (_, index) => ({ ...createFurnitureItem((['desk', 'shelf', 'bed', 'plant'] as ItemKind[])[index % 4]), id: `piece-${index}`, position: { x: (random() - .5) * room.width * 1.1, z: (random() - .5) * room.depth * 1.1 }, rotation: round % 2 ? random() * Math.PI : Math.round(random() * 3) * Math.PI / 2 }));
      const layout = { ...layouts[0], items };
      expect(openFloorArea(layout, room)).toBe(openFloorByCell(layout, room));
    }
  });
});

describe('store wording', () => {
  const store = createRetailProject(), [first, second] = store.layouts;
  it('reads as a store, not a room or a bedroom', () => {
    const plan = buildLayoutExplanation(first, second, store.room);
    const words = [plan.summary, ...plan.warnings, ...plan.steps.flatMap(step => [step.title, step.description, step.why ?? ''])].join(' ');
    expect(plan.steps.length).toBeGreaterThan(0);
    expect(words).not.toMatch(/\b(rooms?|bed|bedroom|furniture)\b/i);
    expect(plan.summary).toMatch(/fixture changes?|Store colours/);
  });
  it('describes taking out and adding a fixture in store terms, and keeps room wording for rooms', () => {
    const counter = first.items.find(item => !item.locked)!;
    const without = { ...structuredClone(first), id: 'without', items: first.items.filter(item => item.id !== counter.id) };
    const whys = (from: Layout, to: Layout, room: RoomSpec) => buildLayoutExplanation(from, to, room).steps.map(step => step.why ?? '').join(' ');
    expect(whys(first, without, store.room)).not.toContain('the room');
    expect(buildLayoutExplanation(original, airy, project.room).summary).toContain('Room sizes are estimated');
    expect(buildLayoutExplanation(original, airy, project.room).summary).toContain('furniture changes');
  });
});

describe('typed store requests', () => {
  const store = createRetailProject();
  const named = (id: string, name: string, description: string): Layout => ({ ...structuredClone(store.layouts[0]), id, name, description });
  const layouts = [named('original', 'Original', 'A familiar starting point'), named('launch', 'Launch night', 'Open floor for an event'), named('path', 'The path', 'A guided discovery journey')];
  const ask = (prompt: string, active = 'original') => matchLayoutIntent(prompt, layouts, active, store.room);
  it('finds event and journey layouts, even when the request says space', () => {
    expect(ask('we are hosting an event').targetId).toBe('launch');
    expect(ask('I want an event space').targetId).toBe('launch');
    for (const prompt of ['more discovery', 'a customer journey', 'something guided', 'let people browse', 'better for browsing']) expect(ask(prompt).targetId).toBe('path');
  });
  it('works on the real store presets', () => {
    const real = (prompt: string) => matchLayoutIntent(prompt, store.layouts, 'original', store.room).targetId;
    expect(real('we are hosting an event')).toBe('open-event');
    expect(real('a guided journey')).toBe('discovery-journey');
    expect(real('more space')).toBe('open-event');
    expect(matchLayoutIntent('reset', store.layouts, 'open-event', store.room).targetId).toBe('original');
  });
  it('still honours reset, named layouts and plain space requests', () => {
    expect(ask('reset it', 'launch').targetId).toBe('original');
    expect(ask('back to the original', 'path').targetId).toBe('original');
    expect(ask('show the path').targetId).toBe('path');
    expect(ask('it feels cramped').reply).toContain('largest open floor area');
  });
  it('offers store suggestions when nothing matches, and room ones for a room', () => {
    expect(ask('paint it purple').reply).toContain('guided journey');
    expect(ask('paint it purple').reply).not.toContain('a place to work');
    expect(matchLayoutIntent('paint it purple', project.layouts, 'original', project.room).reply).toBe('I can only switch between saved layouts: Original, Open & airy, Work & rest. Try asking for more space, or for a place to work.');
  });
});

describe('explicit space', () => {
  const bedroom = createInitialProject();
  it('wins over what the layouts contain', () => {
    const [from, to] = bedroom.layouts;
    expect(buildLayoutExplanation(from, to, bedroom.room).summary).toContain('furniture');
    expect(buildLayoutExplanation(from, to, bedroom.room, 'retail').summary).toContain('fixture');
    const store = createRetailProject();
    expect(buildLayoutExplanation(store.layouts[0], store.layouts[1], store.room, 'room').summary).toContain('furniture');
    expect(matchLayoutIntent('a place to work', bedroom.layouts, 'original', bedroom.room, 'retail').targetId).toBeUndefined();
  });
  it('does not treat a request to edit the store as a layout match', () => {
    const store = createRetailProject(), ask = (request: string) => matchLayoutIntent(request, store.layouts, 'original', store.room, 'retail');
    for (const request of ['Add another testing bar', 'remove the demo stand', 'change the test bars', 'move the testing bar', 'paint the event wall']) {
      expect(ask(request).targetId).toBeUndefined();
      expect(ask(request).reply).toMatch(/^I can only switch between saved layouts/);
    }
    for (const request of ['set it up for an event', 'change to the event setup', 'change the layout for an event']) expect(ask(request).targetId).toBe('open-event');
  });
  it('leaves a bedroom request with an edit verb as it was', () => {
    expect(matchLayoutIntent('move things for work', bedroom.layouts, 'original', bedroom.room).targetId).toBe('work-rest');
  });
});

describe('large switches play as a short story of chapters', () => {
  const store = createRetailProject(), { room } = store;
  const pairs = store.layouts.flatMap(from => store.layouts.filter(to => to !== from).map(to => [from, to] as const));
  const starts = (plan: ReturnType<typeof buildLayoutExplanation>) => plan.steps.map((_, index) => plan.steps.slice(0, index).reduce((sum, step) => sum + step.durationMs, 0));
  const byId = (layout: Layout) => [...layout.items].sort((a, b) => a.id.localeCompare(b.id));
  const metres = (value: number) => Number(value.toFixed(2)).toString();
  it('tells each flagship switch in a handful of chapters, each long enough to watch', () => {
    for (const [from, to] of pairs) {
      const plan = buildLayoutExplanation(from, to, room), chapters = plan.steps.filter(step => step.kind !== 'finish');
      expect(chapters.length, `${from.id} → ${to.id}`).toBeGreaterThanOrEqual(4);
      expect(chapters.length).toBeLessThanOrEqual(9);
      expect(plan.steps.at(-1)?.kind).toBe('finish');
      for (const step of plan.steps) { expect(step.durationMs).toBeGreaterThanOrEqual(1200); expect(step.durationMs).toBeLessThanOrEqual(2000); }
      expect(plan.totalDurationMs).toBeGreaterThanOrEqual(9500);
      expect(plan.totalDurationMs).toBeLessThanOrEqual(12000);
      // Every changed piece belongs to exactly one chapter, and the lead piece is one of its parts.
      const changed = new Set([...from.items, ...to.items].map(item => item.id).filter(id => JSON.stringify(from.items.find(item => item.id === id)) !== JSON.stringify(to.items.find(item => item.id === id))));
      const moved = chapters.flatMap(step => step.parts!.map(part => part.itemId)), recoloured = plan.steps.at(-1)!.parts?.map(part => part.itemId) ?? [];
      expect(new Set(moved).size).toBe(moved.length);
      expect(new Set([...moved, ...recoloured])).toEqual(changed);
      for (const step of chapters) expect(step.parts!.map(part => part.itemId)).toContain(step.itemId);
    }
  });
  it('measures every why in sequence, so no chapter contradicts another', () => {
    for (const [from, to] of pairs) {
      const plan = buildLayoutExplanation(from, to, room), offsets = starts(plan);
      plan.steps.forEach((step, index) => {
        if (step.kind === 'finish') return;
        const before = sampleLayoutExplanation(from, to, plan, offsets[index]).layout, after = sampleLayoutExplanation(from, to, plan, offsets[index] + step.durationMs).layout;
        const floorBefore = openFloorArea(before, room), floorAfter = openFloorArea(after, room), change = floorAfter - floorBefore, why = step.why ?? '';
        if (change >= .05) expect(why).toContain(`Opens ${metres(change)} m² of continuous floor (${metres(floorBefore)} → ${metres(floorAfter)} m²).`);
        else if (change <= -.05) expect(why).toContain(`Uses ${metres(-change)} m² of the largest open area (${metres(floorBefore)} → ${metres(floorAfter)} m²)`);
        else expect(why).toContain(`The largest open area stays at ${metres(floorAfter)} m².`);
        const issuesBefore = validateLayout(before, room).length, issuesAfter = validateLayout(after, room).length;
        if (issuesAfter < issuesBefore) expect(why).toContain(`(${issuesBefore} → ${issuesAfter}).`);
        else if (issuesAfter > issuesBefore) expect(why).toContain(`Crowded spots go from ${issuesBefore} to ${issuesAfter} for now`);
        else expect(why).not.toMatch(/placement finding|crowded spot/i);
        expect(why).not.toMatch(/Leaves the largest open area as it is/);
      });
      expect(plan.steps.at(-1)!.why).toContain(`from ${metres(plan.startOpenFloor)} to ${metres(plan.endOpenFloor)} m²`);
    }
  });
  it('never shows a colour code, and puts colour changes into plain words at the end', () => {
    for (const [from, to] of pairs) {
      const plan = buildLayoutExplanation(from, to, room), words = [plan.summary, ...plan.steps.flatMap(step => [step.title, step.description, step.why ?? ''])].join(' ');
      expect(words).not.toMatch(/#[\da-f]{3,8}\b/i);
      expect(words).not.toMatch(/\b(rooms?|bed|bedroom|furniture)\b/i);
      const finish = plan.steps.at(-1)!;
      expect(finish.title).toBe(`New finishes for ${to.name}`);
      expect(finish.description).toMatch(/^(Warmer|Cooler|Lighter|Darker|Subtly different)[^.]* finishes on the /);
      for (const step of plan.steps.slice(0, -1)) for (const part of step.parts!) if (part.from && part.to) expect(part.to.color).toBe(part.from.color);
    }
  });
  it('moves a chapter’s pieces together and ends exactly on the target layout', () => {
    for (const [from, to] of pairs) {
      const plan = buildLayoutExplanation(from, to, room), offsets = starts(plan), chapter = plan.steps.findIndex(step => step.parts!.filter(part => part.from && part.to).length > 1);
      const middle = sampleLayoutExplanation(from, to, plan, offsets[chapter] + plan.steps[chapter].durationMs / 2);
      expect(middle).toMatchObject({ stepIndex: chapter, finished: false });
      for (const part of plan.steps[chapter].parts!.filter(part => part.from && part.to && Math.hypot(part.to.position.x - part.from.position.x, part.to.position.z - part.from.position.z) > .1)) {
        const piece = middle.layout.items.find(item => item.id === part.itemId)!;
        expect(Math.hypot(piece.position.x - part.from!.position.x, piece.position.z - part.from!.position.z)).toBeGreaterThan(.01);
        expect(Math.hypot(piece.position.x - part.to!.position.x, piece.position.z - part.to!.position.z)).toBeGreaterThan(.01);
      }
      const lateFinish = sampleLayoutExplanation(from, to, plan, plan.totalDurationMs - 1);
      expect(byId(lateFinish.layout)).toEqual(byId(to));
      expect(lateFinish.layout.wallColor).toBe(to.wallColor);
      expect(sampleLayoutExplanation(from, to, plan, plan.totalDurationMs)).toMatchObject({ layout: to, finished: true, stepProgress: 1 });
      expect(sampleLayoutExplanation(from, to, plan, 0).layout).toEqual(from);
    }
  });
  it('builds the largest flagship switch quickly', () => {
    const [from, to] = [store.layouts.find(layout => layout.id === 'open-event')!, store.layouts.find(layout => layout.id === 'services-first')!];
    buildLayoutExplanation(from, to, room);
    const start = performance.now();
    buildLayoutExplanation(from, to, room);
    expect(performance.now() - start).toBeLessThan(500);
  });
  it('keeps agent reasons on grouped steps and outlines one piece only for a single-piece step', () => {
    const plan = buildLayoutExplanation(store.layouts[0], store.layouts[1], room), chapter = plan.steps.find(step => step.parts!.length > 2)!;
    const [first, second] = chapter.parts!, reasons = { [first.itemId]: 'Clears the avenue.', [second.itemId]: 'Clears the avenue.', finish: 'Calmer colours.' };
    expect(agentReasonFor(chapter, reasons)).toBe('Clears the avenue.');
    expect(agentReasonFor(plan.steps.at(-1)!, reasons)).toContain('Calmer colours.');
    expect(agentReasonFor(chapter, undefined)).toBeUndefined();
    expect(highlightFor(chapter)).toBeUndefined();
    const bedroom = buildLayoutExplanation(original, airy, project.room);
    expect(agentReasonFor(bedroom.steps[0], { bed: 'Against the wall.' })).toBe('Against the wall.');
    expect(highlightFor(bedroom.steps[0])).toBe('bed');
  });
  it('keeps small switches and the bedroom exactly as they were: one piece per step, same order and reasons', () => {
    expect(buildLayoutExplanation(original, airy, project.room).steps.map(step => [step.id, step.durationMs, step.why ?? null])).toEqual([
      ['change:bed', 900, 'Opens 1.51 m² of continuous floor (4.54 → 6.05 m²). Sits 0.57 m closer to the wall.'],
      ['change:fan', 900, 'Opens 2.48 m² of continuous floor (6.05 → 8.53 m²). Sits 0.25 m closer to the wall.'],
      ['change:wardrobe', 900, 'Clears a placement finding.'],
      ['change:desk', 900, 'Leaves the largest open area as it is; this is where Open & airy puts it.'],
      ['change:chair', 900, 'Leaves the largest open area as it is; this is where Open & airy puts it.'],
      ['change:stool', 900, 'Sits 0.5 m closer to the wall.'],
      ['change:floor-bed', 900, 'On its own this takes 1.38 m² from the largest open area; it is part of the full Open & airy arrangement. Sits 0.07 m closer to the wall. Clears a placement finding.'],
      ['finish', 650, 'Largest open floor area goes from 4.54 to 7.14 m².'],
    ]);
    for (const from of project.layouts) for (const to of project.layouts) if (from !== to) for (const step of buildLayoutExplanation(from, to, project.room).steps) expect(step).not.toHaveProperty('parts');
    // Twelve changed fixtures in the store still play one at a time, colour codes and all.
    const [first] = store.layouts, twelve = { ...structuredClone(first), id: 'twelve', items: first.items.map((item, index) => index < 12 ? { ...item, position: { x: item.position.x, z: item.position.z - .2 } } : item) };
    const plan = buildLayoutExplanation(first, twelve, room);
    expect(plan.steps.filter(step => step.kind !== 'finish')).toHaveLength(12);
    for (const step of plan.steps) expect(step).not.toHaveProperty('parts');
    expect(plan.totalDurationMs).toBeLessThanOrEqual(8000);
    const thirteen = { ...twelve, items: twelve.items.map((item, index) => index === 12 ? { ...item, position: { x: item.position.x, z: item.position.z - .2 } } : item) };
    expect(buildLayoutExplanation(first, thirteen, room).steps[0]).toHaveProperty('parts');
  });
});
