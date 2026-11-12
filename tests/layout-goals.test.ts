import { describe, expect, it } from 'vitest';
import { createFurnitureItem, createInitialProject, createRetailProject } from '../src/domain';
import { judgeProposal } from '../src/layout-agent-core';
import { readProposal } from '../src/layout-agent-prompt';
import { buildLayoutExplanation } from '../src/layout-explainer';
import { bestForGoal, goalReason, goalsOf, limitsOf, measureStore } from '../src/layout-goals';
import { matchLayoutIntent } from '../src/layout-intent';
import type { FurnitureItem, ItemKind, Layout, RoomSpec } from '../src/types';

const room: RoomSpec = { ...createRetailProject().room, width: 10, depth: 10, door: { wall: 'front', offset: 0, width: 2, height: 3 } };
const piece = (id: string, kind: ItemKind, x: number, z: number, rotation = 0): FurnitureItem => ({ ...createFurnitureItem(kind), id, name: id, position: { x, z }, rotation });
const store = (...items: FurnitureItem[]): Layout => ({ ...createRetailProject().layouts[0], id: `s-${items.map(item => item.id).join('-')}`, items });
const checkout = piece('till', 'checkout-counter', 0, -4);

describe('reading a store request', () => {
  it.each([
    ['Improve sales', ['sales']], ['help us sell more', ['sales']], ['raise the average basket', ['sales']], ['get people to buy more', ['sales']],
    ['let customers browse freely', ['browse']], ['better flow through the aisles', ['browse']],
    ['customers should find products faster', ['find']], ['cut the time to locate items', ['find']], ['shoppers get lost', ['find']],
    ['hold more inventory', ['stock']], ['we need more products on the floor', ['stock']],
    ['the queue at the till is too long', ['checkout']], ['let people pay faster', ['checkout']],
    ['make it wheelchair friendly', ['access']], ['room for prams and strollers', ['access']],
    ['sell more by holding more stock', ['sales', 'stock']], ['improve sales and make it accessible', ['sales', 'access']],
  ])('"%s" names %j', (request, goals) => expect(goalsOf(request, 'retail')).toEqual(goals));

  it.each([
    ['reduce shoplifting', 'Theft'], ['make it feel more premium', 'judgement'], ['use our footfall heatmap', 'Footfall data'],
    ['check stock levels per SKU', 'Inventory data'], ['increase sales by 20%', 'No sales figures'], ['keep people in the store longer through dwell', 'Time spent'],
    ['fewer staff on the floor', 'Staffing'], ['warmer lighting', 'Lighting'], ['put the discounts up front', 'Prices'],
    ['is it fire code compliant', 'Fire and building code'], ['add a mezzanine', 'Walls'], ['make it better', 'No single measure'],
  ])('"%s" is flagged as not measured (%s)', (request, words) => expect(limitsOf(request, 'retail').join(' ')).toContain(words));

  it.each([
    'improve sales', 'move the display units back', 'shift the tables left', 'build a stage for events', 'make it feel more open', 'paint the walls green', 'make it better for events', 'what the store offers at launch',
  ])('"%s" raises no limit', request => expect(limitsOf(request, 'retail')).toEqual([]));

  it('leaves space requests, themes and home rooms to the open-floor explanation', () => {
    expect(goalsOf('I need more space', 'retail')).toEqual([]);
    expect(goalsOf('set up for a launch event', 'retail')).toEqual([]);
    expect(goalsOf('improve sales', 'room')).toEqual([]);
    expect(limitsOf('reduce shoplifting', 'room')).toEqual([]);
    expect(goalsOf(undefined, 'retail')).toEqual([]);
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
  it('finds a gap a shopper fits through but a wheelchair does not', () => {
    const gap = store(checkout, piece('table', 'display-table', 0, -1), ...[-4.2, -1.8, 1.8, 4.2].map((x, i) => piece(`bar${i}`, 'testing-bar', x, 1)));
    const shopper = measureStore(gap, room), wheelchair = measureStore(gap, room, 1.5);
    expect(shopper.reachable).toBe(5);
    expect(wheelchair.reachable).toBeLessThan(shopper.reachable);
  });
  it('measures the queue floor in front of the checkout, less when a fixture stands in it', () => {
    const clear = measureStore(store(checkout), room), blocked = measureStore(store(checkout, piece('table', 'display-table', 0, -1.8)), room);
    expect(clear.queueSpace).toBeGreaterThan(5);
    expect(blocked.queueSpace).toBeLessThan(clear.queueSpace - 1);
    expect(measureStore(store(), room).queueSpace).toBeNaN();
  });
});

describe('goal explanations', () => {
  const project = createRetailProject(), [from, , , , services] = project.layouts;
  it('explains every step of a sales request through sales measures, measured in sequence', () => {
    const plan = buildLayoutExplanation(from, services, project.room, 'retail', ['sales']);
    expect(plan.goals![0]).toMatchObject({ id: 'sales', label: 'For sales' });
    expect(plan.goals![0].lines.map(([label]) => label)).toEqual(['Displays on the way to checkout', 'Displays within reach', 'Average walk to a display', 'Product displays']);
    expect(plan.steps.every(step => step.goalWhys?.length === 1)).toBe(true);
    expect(plan.steps.at(-1)!.goalWhys![0].text).toBe(goalReason('sales', measureStore(from, project.room), measureStore(services, project.room)));
    expect(plan.warnings.at(-1)).toContain('not a sales forecast');
    expect(plan.steps.map(step => step.goalWhys![0].text).join(' ')).not.toMatch(/open floor|\d+%|increase sales|will sell/i);
    const plain = buildLayoutExplanation(from, services, project.room, 'retail').steps;
    plan.steps.forEach((step, index) => expect(plain[index].why!.endsWith(step.why!)).toBe(true));
  });
  it('measures each goal of a request separately, access with a wheelchair aisle', () => {
    const plan = buildLayoutExplanation(from, services, project.room, 'retail', ['sales', 'access']);
    expect(plan.goals!.map(goal => goal.id)).toEqual(['sales', 'access']);
    expect(plan.goals![1].lines[0][0]).toBe('Displays within reach of a 1.5 m aisle');
    expect(plan.steps.every(step => step.goalWhys!.map(why => why.label).join() === 'For sales,For access')).toBe(true);
    expect(plan.steps.at(-1)!.goalWhys![1].text).toBe(goalReason('access', measureStore(from, project.room, 1.5), measureStore(services, project.room, 1.5)));
  });
  it('says plainly when a change does not move the goal on its own', () => {
    const a = store(checkout, piece('plant', 'plant', 4, 4)), b = store(checkout, piece('plant', 'plant', -4, 4));
    expect(buildLayoutExplanation(a, b, room, 'retail', ['find']).steps[0].goalWhys![0].text).toBe('On its own this leaves the walk to products and displays within reach as they were; it is part of the full arrangement.');
  });
  it('reports a change that works against the goal', () => {
    const a = store(checkout, piece('table', 'display-table', 1.6, 0)), b = store(checkout, piece('table', 'display-table', 4, 3));
    expect(buildLayoutExplanation(a, b, room, 'retail', ['sales']).steps[0].goalWhys![0].text).toContain('Takes 1 display off the shortest walk from the door to checkout');
    const c = store(checkout, piece('table', 'display-table', 0, -1.8));
    expect(buildLayoutExplanation(store(checkout, piece('table', 'display-table', 4, 3)), { ...c, id: 'c' }, room, 'retail', ['checkout']).steps[0].goalWhys![0].text).toContain('less clear floor');
  });
  it('carries what was not measured, and keeps home rooms on the open-floor explanation', () => {
    expect(buildLayoutExplanation(from, services, project.room, 'retail', [], ['Theft is not measured.']).limits).toEqual(['Theft is not measured.']);
    const home = createInitialProject(), plan = buildLayoutExplanation(home.layouts[0], home.layouts[1], home.room, 'room', ['sales'], ['x']);
    expect(plan.goals).toBeUndefined();
    expect(plan.limits).toBeUndefined();
    expect(plan.steps.some(step => step.goalWhys)).toBe(false);
  });
});

describe('the model reading the request', () => {
  const decline = { action: 'decline', goal: 'other', layoutId: '', name: '', description: '', reply: 'I cannot measure theft.', moves: [], removals: [], recolors: [], additions: [], wallColor: '', accentColor: '', colorReason: '' };
  it('keeps only known goals and a bounded limits line', () => {
    const read = readProposal({ ...decline, goals: ['sales', 'bogus', 'sales', 'access', 7], limits: 'x'.repeat(400) });
    expect(read.goals).toEqual(['sales', 'access']);
    expect(read.limits.length).toBe(220);
    expect(readProposal({ ...decline, goals: 'sales' }).goals).toEqual([]);
  });
  it('passes the reading on in a store and drops goals in a home room', () => {
    const proposal = readProposal({ ...decline, goals: ['sales'], limits: 'Theft is not measured.' });
    expect(judgeProposal(createRetailProject(), 'sales and theft', proposal).outcome).toMatchObject({ goals: ['sales'], limits: 'Theft is not measured.' });
    expect(judgeProposal(createInitialProject(), 'sales', proposal).outcome).toMatchObject({ goals: [] });
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
    expect(matchLayoutIntent('the checkout queue is too long', project.layouts, 'original', project.room, 'retail').reply).toContain('checkout queue');
    expect(matchLayoutIntent('make it wheelchair friendly', project.layouts, 'original', project.room, 'retail').reply).toContain('1.5 m aisle');
  });
  it('says what it cannot measure instead of guessing', () => {
    const match = matchLayoutIntent('reduce shoplifting', project.layouts, 'original', project.room, 'retail');
    expect(match.targetId).toBeUndefined();
    expect(match.reply).toContain('Theft and staff sightlines are not measured');
  });
  it('still lets themes and edits go first', () => {
    expect(matchLayoutIntent('a space for launch events', project.layouts, 'original', project.room, 'retail').targetId).toBe('open-event');
    expect(matchLayoutIntent('add a display to improve sales', project.layouts, 'original', project.room, 'retail').targetId).toBeUndefined();
  });
});

describe('the short why on every step', () => {
  const project = createRetailProject(), home = createInitialProject();
  const switches = [
    ...project.layouts.slice(1).map(to => buildLayoutExplanation(project.layouts[0], to, project.room, 'retail')),
    buildLayoutExplanation(project.layouts[0], project.layouts[4], project.room, 'retail', ['sales']),
    buildLayoutExplanation(project.layouts[0], project.layouts[1], project.room, 'retail', ['find', 'access']),
    buildLayoutExplanation(home.layouts[0], home.layouts[1], home.room),
  ];
  it('is on every step and short enough to read at a glance', () => {
    for (const plan of switches) for (const step of plan.steps) {
      expect(step.short, step.title).toBeDefined();
      expect(step.short!.text.split(/\s+/).length, step.short!.text).toBeLessThanOrEqual(6);
    }
  });
  it('marks a cost as a trade-off, never as a why', () => {
    const shorts = switches.flatMap(plan => plan.steps.map(step => step.short!));
    for (const short of shorts) expect(/fewer|less|further|Uses|Blocks/.test(short.text), short.text).toBe(Boolean(short.tradeOff));
  });
  it('agrees with the measured why it summarises', () => {
    for (const plan of switches.slice(0, 4)) for (const step of plan.steps.filter(item => item.kind !== 'finish')) {
      const text = step.short!.text;
      if (text.startsWith('Opens')) expect(step.why).toContain('Opens');
      if (text.startsWith('Clears')) expect(step.why).toContain('Clears');
      if (/closer|near checkout|walking room|within reach/.test(text)) expect(step.why).toMatch(/Shortens|Puts|Adds|Opens a 1.2 m aisle/);
    }
  });
  it('follows the goal asked for, and gives a store reason when floor is not the reason', () => {
    const sales = switches[4], noGoal = switches[0];
    expect(sales.steps.some(step => /near checkout|within reach|Products/.test(step.short!.text))).toBe(true);
    expect(sales.steps.some(step => /m² of floor/.test(step.short!.text) && !step.short!.tradeOff && step.short!.text.startsWith('Opens'))).toBe(false);
    expect(noGoal.steps.find(step => step.title.includes('fragrance towers'))!.short).toEqual({ text: 'Products 0.3 m closer' });
  });
});
