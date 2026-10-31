import { getFootprint, validateLayout } from './domain';
import type { FurnitureItem, Layout, RoomSpec } from './types';

export interface LayoutExplanationStep {
  id: string;
  itemId?: string;
  kind: 'move' | 'add' | 'remove' | 'update' | 'finish';
  title: string;
  description: string;
  why?: string;
  agentReason?: string;
  from?: FurnitureItem;
  to?: FurnitureItem;
  durationMs: number;
}
export interface LayoutExplanationPlan {
  id: string;
  fromId: string;
  toId: string;
  title: string;
  request?: string;
  steps: LayoutExplanationStep[];
  totalDurationMs: number;
  summary: string;
  warnings: string[];
  startIssueCount: number;
  endIssueCount: number;
  startOpenFloor: number;
  endOpenFloor: number;
}
export type LayoutExplanation = LayoutExplanationPlan;
export interface LayoutExplanationSample {
  layout: Layout;
  stepIndex: number;
  stepProgress: number;
  finished: boolean;
}
const POSITION_EPS = .01;
const ROTATION_EPS = Math.PI / 180;
const SIZE_EPS = .001;
const axes = ['width', 'depth', 'height'] as const;
const clone = <T,>(value: T): T => structuredClone(value);
const clamp = (value: number) => Number.isNaN(value) ? 0 : Math.max(0, Math.min(1, value));
const metres = (value: number) => Number(value.toFixed(2)).toString();

/** Signed shortest yaw change in radians, with a consistent positive choice at 180 degrees. */
export function shortestYawDelta(from: number, to: number): number {
  const turn = Math.PI * 2;
  const delta = ((to - from + Math.PI) % turn + turn) % turn - Math.PI;
  return Math.abs(delta + Math.PI) < 1e-10 ? Math.PI : delta;
}
function itemMap(layout: Layout): Map<string, FurnitureItem> {
  const map = new Map(layout.items.map(item => [item.id, item]));
  if (map.size !== layout.items.length) throw new Error('Layout explanations require unique furniture IDs.');
  return map;
}
function differences(from: FurnitureItem, to: FurnitureItem) {
  return {
    moved: Math.hypot(to.position.x - from.position.x, to.position.z - from.position.z) > POSITION_EPS,
    rotated: Math.abs(shortestYawDelta(from.rotation, to.rotation)) > ROTATION_EPS,
    resized: axes.some(axis => Math.abs(from.dimensions[axis] - to.dimensions[axis]) > SIZE_EPS),
    recolored: from.color.toLowerCase() !== to.color.toLowerCase(),
    geometry: from.kind !== to.kind || from.assetId !== to.assetId || from.productId !== to.productId,
    visibility: from.visible !== to.visible,
    metadata: from.name !== to.name || from.locked !== to.locked || from.dimensionSource !== to.dimensionSource,
  };
}
function movement(from: FurnitureItem, to: FurnitureItem): string {
  const x = to.position.x - from.position.x, z = to.position.z - from.position.z;
  const directions: string[] = [];
  if (Math.abs(x) >= .005) directions.push(`${metres(Math.abs(x))} m ${x > 0 ? 'right' : 'left'}`);
  if (Math.abs(z) >= .005) directions.push(`${metres(Math.abs(z))} m toward the ${z > 0 ? 'front' : 'back'} wall`);
  return `Move ${directions.join(' and ')}.`;
}

function insideFootprint(x: number, z: number, polygon: { x: number; z: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}
/** Largest empty rectangle of floor in m², measured on a 5 cm grid from the furniture footprints. */
export function openFloorArea(layout: Layout, room: RoomSpec): number {
  const cell = .05, columns = Math.round(room.width / cell), rows = Math.round(room.depth / cell);
  const footprints = layout.items.filter(item => item.visible).map(getFootprint), heights = new Array<number>(columns).fill(0);
  let best = 0;
  for (let row = 0; row < rows; row++) {
    const z = -room.depth / 2 + (row + .5) * cell, stack: number[] = [];
    for (let column = 0; column <= columns; column++) {
      if (column < columns) {
        const x = -room.width / 2 + (column + .5) * cell;
        heights[column] = footprints.some(polygon => insideFootprint(x, z, polygon)) ? 0 : heights[column] + 1;
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
function wallGap(item: FurnitureItem, room: RoomSpec): number {
  return Math.min(...getFootprint(item).flatMap(point => [room.width / 2 - Math.abs(point.x), room.depth / 2 - Math.abs(point.z)]));
}
function stepReason(step: LayoutExplanationStep, floorBefore: number, floorAfter: number, issuesBefore: number, issuesAfter: number, room: RoomSpec, targetName: string): string {
  const reasons: string[] = [], change = floorAfter - floorBefore;
  if (change >= .05) reasons.push(`Opens ${metres(change)} m² of continuous floor (${metres(floorBefore)} → ${metres(floorAfter)} m²).`);
  else if (change <= -.05) reasons.push(`On its own this takes ${metres(-change)} m² from the largest open area; it is part of the full ${targetName} arrangement.`);
  if (step.from && step.to && wallGap(step.from, room) - wallGap(step.to, room) >= .05) reasons.push(`Sits ${metres(wallGap(step.from, room) - wallGap(step.to, room))} m closer to the wall.`);
  if (issuesAfter < issuesBefore) reasons.push(`Clears ${issuesBefore - issuesAfter === 1 ? 'a placement finding' : `${issuesBefore - issuesAfter} placement findings`}.`);
  return reasons.join(' ') || `Leaves the largest open area as it is; this is where ${targetName} puts it.`;
}

/** A deterministic explanation of preset differences, not an optimization or physical motion simulation. */
export function buildLayoutExplanation(from: Layout, to: Layout, room: RoomSpec): LayoutExplanationPlan {
  const before = itemMap(from), after = itemMap(to), steps: LayoutExplanationStep[] = [], warnings: string[] = [];
  for (const item of from.items) {
    const target = after.get(item.id);
    if (!target) {
      steps.push({ id: `remove:${item.id}`, itemId: item.id, kind: 'remove', title: `Remove ${item.name}`, description: `${item.name} is absent from ${to.name}.`, from: clone(item), durationMs: 900 });
    } else {
      const change = differences(item, target);
      if (!Object.values(change).some(Boolean)) continue;
      const details: string[] = [];
      if (change.moved) details.push(movement(item, target));
      if (change.rotated) details.push(`Rotate ${Math.round(Math.abs(shortestYawDelta(item.rotation, target.rotation)) * 180 / Math.PI)}° along the shortest turn.`);
      if (change.resized) details.push(`Set width × depth × height to ${axes.map(axis => metres(target.dimensions[axis])).join(' × ')} m.`);
      if (change.recolored) details.push(`Change its colour from ${item.color} to ${target.color}.`);
      if (change.geometry) details.push('Use the target preset’s furniture model and product association.');
      if (change.visibility) details.push(target.visible ? 'Show this piece.' : 'Hide this piece.');
      if (change.metadata) details.push('Keep the name, lock and measurement labels stored in the target preset.');
      const spatialOnly = (change.moved || change.rotated) && !change.resized && !change.recolored && !change.geometry && !change.visibility && !change.metadata;
      steps.push({ id: `change:${item.id}`, itemId: item.id, kind: spatialOnly ? 'move' : 'update', title: `${spatialOnly ? 'Reposition' : 'Update'} ${target.name}`, description: details.join(' '), from: clone(item), to: clone(target), durationMs: 900 });
    }
    if (item.locked) warnings.push(`${item.name} is locked in ${from.name}. This previews a separate preset; the source item and its lock remain unchanged.`);
  }
  for (const item of to.items) if (!before.has(item.id)) {
    steps.push({ id: `add:${item.id}`, itemId: item.id, kind: 'add', title: `Add ${item.name}`, description: `${item.name} is included in ${to.name}${item.visible ? '' : ' and starts hidden'}.`, to: clone(item), durationMs: 900 });
  }
  const finishChanged = from.wallColor.toLowerCase() !== to.wallColor.toLowerCase() || from.accentColor.toLowerCase() !== to.accentColor.toLowerCase();
  if (steps.length || finishChanged) {
    const details: string[] = [];
    if (from.wallColor.toLowerCase() !== to.wallColor.toLowerCase()) details.push(`Set the walls to ${to.wallColor}.`);
    if (from.accentColor.toLowerCase() !== to.accentColor.toLowerCase()) details.push(`Set the accent colour to ${to.accentColor}.`);
    if (to.description.trim()) details.push(`Preset intent: ${to.description.trim()}`);
    steps.push({ id: 'finish', kind: 'finish', title: `See ${to.name}`, description: details.join(' ') || 'Show the target preset in full.', durationMs: 650 });
  }
  const startOpenFloor = openFloorArea(from, room), endOpenFloor = openFloorArea(to, room);
  let reached = clone(from), reachedFloor = startOpenFloor, reachedIssues = validateLayout(from, room).length;
  const finishStep = steps.find(step => step.kind === 'finish'), pending = steps.filter(step => step !== finishStep);
  steps.length = 0;
  // Biggest measured gain first, so the opening moves show why the arrangement changes.
  while (pending.length) {
    const floors = pending.map(step => openFloorArea(completedStep(reached, step), room));
    const index = floors.indexOf(Math.max(...floors)), [step] = pending.splice(index, 1);
    const next = completedStep(reached, step), nextIssues = validateLayout(next, room).length;
    step.why = stepReason(step, reachedFloor, floors[index], reachedIssues, nextIssues, room, to.name);
    steps.push(step);
    reached = next; reachedFloor = floors[index]; reachedIssues = nextIssues;
  }
  if (finishStep) {
    if (Math.abs(endOpenFloor - startOpenFloor) >= .05) finishStep.why = `Largest open floor area goes from ${metres(startOpenFloor)} to ${metres(endOpenFloor)} m².`;
    steps.push(finishStep);
  }
  const unbounded = steps.reduce((sum, step) => sum + step.durationMs, 0);
  if (unbounded > 8000) for (const step of steps) step.durationMs = Math.floor(step.durationMs * 8000 / unbounded);
  const startIssueCount = validateLayout(from, room).length, endIssueCount = validateLayout(to, room).length;
  const changes = steps.filter(step => step.kind !== 'finish').length;
  const summary = `${changes ? `${changes} furniture ${changes === 1 ? 'change' : 'changes'}` : finishChanged ? 'Room colours change' : 'No visible furniture or colour changes'}. ${to.description.trim() ? `Preset intent: ${to.description.trim()}. ` : ''}Largest open floor: ${metres(startOpenFloor)} → ${metres(endOpenFloor)} m². Placement checks report ${startIssueCount} ${startIssueCount === 1 ? 'finding' : 'findings'} before and ${endIssueCount} in the target. Room sizes are estimated; this does not establish verified fit.`;
  if (steps.length) warnings.unshift('Animated movement illustrates the preset change; it does not verify a collision-free physical moving route.');
  return { id: `layout-explanation:${from.id}:${to.id}`, fromId: from.id, toId: to.id, title: `${from.name} → ${to.name}`, steps, totalDurationMs: steps.reduce((sum, step) => sum + step.durationMs, 0), summary, warnings, startIssueCount, endIssueCount, startOpenFloor, endOpenFloor };
}

function colorBetween(from: string, to: string, progress: number): string {
  if (!/^#[a-f\d]{6}$/i.test(from) || !/^#[a-f\d]{6}$/i.test(to)) return progress < .5 ? from : to;
  return '#' + [1, 3, 5].map(offset => Math.round(parseInt(from.slice(offset, offset + 2), 16) * (1 - progress) + parseInt(to.slice(offset, offset + 2), 16) * progress).toString(16).padStart(2, '0')).join('');
}
/** Numeric transforms interpolate together. Discrete models/visibility switch halfway; renderers can crossfade snapshots. */
export function sampleLayoutTransition(from: Layout, to: Layout, progress: number): Layout {
  const p = clamp(progress);
  if (p <= 0) return clone(from);
  if (p >= 1) return clone(to);
  const before = itemMap(from), after = itemMap(to);
  const items: FurnitureItem[] = [];
  for (const item of from.items) {
    const target = after.get(item.id);
    if (!target) { items.push({ ...clone(item), visible: item.visible && p < .5 }); continue; }
    const next = clone(p < .5 ? item : target);
    next.position = { x: item.position.x + (target.position.x - item.position.x) * p, z: item.position.z + (target.position.z - item.position.z) * p };
    next.rotation = item.rotation + shortestYawDelta(item.rotation, target.rotation) * p;
    next.dimensions = { width: item.dimensions.width + (target.dimensions.width - item.dimensions.width) * p, depth: item.dimensions.depth + (target.dimensions.depth - item.dimensions.depth) * p, height: item.dimensions.height + (target.dimensions.height - item.dimensions.height) * p };
    next.color = colorBetween(item.color, target.color, p);
    items.push(next);
  }
  for (const item of to.items) if (!before.has(item.id)) items.push({ ...clone(item), visible: item.visible && p >= .5 });
  return { ...clone(from), items, wallColor: colorBetween(from.wallColor, to.wallColor, p), accentColor: colorBetween(from.accentColor, to.accentColor, p) };
}
function completedStep(layout: Layout, step: LayoutExplanationStep): Layout {
  const result = clone(layout);
  if (!step.itemId) return result;
  if (!step.to) result.items = result.items.filter(item => item.id !== step.itemId);
  else {
    const index = result.items.findIndex(item => item.id === step.itemId);
    if (index < 0) result.items.push(clone(step.to));
    else result.items[index] = clone(step.to);
  }
  return result;
}

/** Sequential playback samples, with eased movement and exact target/source endpoints. Never mutates presets. */
export function sampleLayoutExplanation(from: Layout, to: Layout, plan: LayoutExplanationPlan, elapsedMs: number): LayoutExplanationSample {
  if (plan.fromId !== from.id || plan.toId !== to.id) throw new Error('The explanation belongs to different layouts.');
  let elapsed = Number.isNaN(elapsedMs) ? 0 : Math.max(0, elapsedMs);
  if (!plan.steps.length || elapsed >= plan.totalDurationMs) return { layout: clone(to), stepIndex: Math.max(0, plan.steps.length - 1), stepProgress: 1, finished: true };
  let layout = clone(from);
  for (let index = 0; index < plan.steps.length; index++) {
    const step = plan.steps[index];
    if (elapsed >= step.durationMs) { layout = step.kind === 'finish' ? clone(to) : completedStep(layout, step); elapsed -= step.durationMs; continue; }
    const stepProgress = clamp(elapsed / step.durationMs), eased = stepProgress * stepProgress * (3 - 2 * stepProgress);
    const target = step.kind === 'finish' ? to : completedStep(layout, step);
    const sampled = sampleLayoutTransition(layout, target, eased);
    // Room finishes rebuild scene walls. Apply those once at the completed endpoint, not every frame.
    sampled.items=sampled.items.map(item=>{const before=layout.items.find(i=>i.id===item.id);return before?{...item,color:before.color}:item;});
    sampled.wallColor = from.wallColor;
    sampled.accentColor = from.accentColor;
    return { layout: sampled, stepIndex: index, stepProgress, finished: false };
  }
  return { layout: clone(to), stepIndex: Math.max(0, plan.steps.length - 1), stepProgress: 1, finished: true };
}
