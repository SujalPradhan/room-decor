import { describe, expect, it } from 'vitest';
import { createFurnitureItem, createInitialProject, createRetailProject } from '../src/domain';
import { buildLayoutExplanation } from '../src/layout-explainer';
import { bestForGoal, goalOf, goalReason, measureStore } from '../src/layout-goals';
import { matchLayoutIntent } from '../src/layout-intent';
import type { FurnitureItem, ItemKind, Layout, RoomSpec } from '../src/types';

const room: RoomSpec = { ...createRetailProject().room, width: 10, depth: 10, door: { wall: 'front', offset: 0, width: 2, height: 3 } };
const piece = (id: string, kind: ItemKind, x: number, z: number, rotation = 0): FurnitureItem => ({ ...createFurnitureItem(kind), id, name: id, position: { x, z }, rotation });
const store = (...items: FurnitureItem[]): Layout => ({ ...createRetailProject().layouts[0], id: `s-${items.map(item => item.id).join('-')}`, items });
const checkout = piece('till', 'checkout-counter', 0, -4);

describe('goalOf', () => {
  it.each([
    ['Improve sales', 'sales'], ['help us sell more', 'sales'], ['raise the average basket', 'sales'], ['boost revenue this quarter', 'sales'],
    ['let customers browse freely', 'browse'], ['better flow through the aisles', 'browse'],
    ['customers should find products faster', 'find'], ['cut the time to locate items', 'find'],
    ['hold more inventory', 'stock'], ['sell more by holding more stock', 'stock'], ['we need more products on the floor', 'stock'],
  ])('reads "%s" as %s in a store', (request, goal) => expect(goalOf(request, 'retail')).toBe(goal));
  it('leaves space requests, other requests and home rooms to the open-floor explanation', () => {
    expect(goalOf('I need more space', 'retail')).toBeUndefined();
    expect(goalOf('set up for a launch event', 'retail')).toBeUndefined();
    expect(goalOf('improve sales', 'room')).toBeUndefined();
    expect(goalOf(undefined, 'retail')).toBeUndefined();
  });
});

describe('measureStore', () => {
  it('counts a display walled off from the door as out of reach', () => {
    const open = store(checkout, piece('table', 'display-table', 0, 0));
    const fenced = store(checkout, piece('table', 'display-table', 0, -1), ...[-4, -2, 0, 2, 4].map((x, i) => piece(`wall${i}`, 'testing-bar', x, 1)));
    expect(measureStore(open, room).reachable).toBe(1);
    const measured = measureStore(fenced, room);
    expect(measured.displays).toBe(6);
    expect(measured.reachable).toBeLessThan(measured.displays);
  });
  it('measures the walk from the door, longer for a display further back', () => {
    const near = measureStore(store(checkout, piece('table', 'display-table', 0, 1)), room).walkToDisplay, far = measureStore(store(checkout, piece('table', 'display-table', 0, -2)), room).walkToDisplay;
    expect(near).toBeGreaterThan(0);
    expect(far - near).toBeGreaterThan(2.5);
    expect(far - near).toBeLessThan(3.5);
  });
  it('counts only displays beside the walk to checkout', () => {
    const beside = measureStore(store(checkout, piece('table', 'display-table', 1.6, 0)), room), aside = measureStore(store(checkout, piece('table', 'display-table', 4, 3)), room);
    expect(beside.onRoute).toBe(1);
    expect(aside.onRoute).toBe(0);
    expect(measureStore(store(piece('table', 'display-table', 1.6, 0)), room).onRoute).toBeNaN();
  });
});

describe('goal explanations', () => {
  const project = createRetailProject(), [from, , , , services] = project.layouts;
  it('explains every step of a sales request through sales measures, measured in sequence', () => {
    const plan = buildLayoutExplanation(from, services, project.room, 'retail', 'sales');
    expect(plan.goal).toMatchObject({ id: 'sales', label: 'For sales' });
    expect(plan.goal!.lines.map(([label]) => label)).toEqual(['Displays on the way to checkout', 'Displays within reach', 'Average walk to a display', 'Product displays']);
    expect(plan.steps.every(step => step.goalWhy)).toBe(true);
    expect(plan.steps.at(-1)!.goalWhy).toBe(goalReason('sales', measureStore(from, project.room), measureStore(services, project.room)));
    expect(plan.warnings.at(-1)).toContain('not a sales forecast');
    const words = plan.steps.map(step => step.goalWhy).join(' ');
    expect(words).not.toMatch(/open floor|\d+%|increase sales|will sell/i);
    expect(plan.steps.map(step => step.why)).toEqual(buildLayoutExplanation(from, services, project.room, 'retail').steps.map(step => step.why));
  });
  it('says plainly when a change does not move the goal on its own', () => {
    const a = store(checkout, piece('plant', 'plant', 4, 4)), b = store(checkout, piece('plant', 'plant', -4, 4));
    expect(buildLayoutExplanation(a, b, room, 'retail', 'find').steps[0].goalWhy).toBe('On its own this leaves the walk to products and displays within reach as they were; it is part of the full arrangement.');
  });
  it('reports a change that works against the goal', () => {
    const a = store(checkout, piece('table', 'display-table', 1.6, 0)), b = store(checkout, piece('table', 'display-table', 4, 3));
    expect(buildLayoutExplanation(a, b, room, 'retail', 'sales').steps[0].goalWhy).toContain('Takes 1 display off the shortest walk from the door to checkout');
  });
  it('keeps home rooms on the open-floor explanation', () => {
    const home = createInitialProject(), plan = buildLayoutExplanation(home.layouts[0], home.layouts[1], home.room, 'room', 'sales');
    expect(plan.goal).toBeUndefined();
    expect(plan.steps.some(step => step.goalWhy)).toBe(false);
  });
});

describe('rules for a goal', () => {
  const project = createRetailProject();
  it('picks the saved layout that measures best and says which measure', () => {
    const best = bestForGoal('sales', project.layouts, project.room)!;
    const match = matchLayoutIntent('How do we improve sales?', project.layouts, 'original', project.room, 'retail');
    expect(match.targetId).toBe(best.layout.id);
    expect(match.reply).toContain('on the way from the door to checkout');
    expect(matchLayoutIntent('help shoppers find products faster', project.layouts, 'original', project.room, 'retail').reply).toContain('average walk');
  });
  it('still lets themes and edits go first', () => {
    expect(matchLayoutIntent('a space for launch events', project.layouts, 'original', project.room, 'retail').targetId).toBe('open-event');
    expect(matchLayoutIntent('add a display to improve sales', project.layouts, 'original', project.room, 'retail').targetId).toBeUndefined();
  });
});
