import { getFootprint, kindsForSpace, validateLayout } from './domain';
import { aisleFor, GOALS, goalLines, goalReason, goalShorts, measureStore, type LayoutGoal } from './layout-goals';
import type { FurnitureItem, ItemKind, Layout, RoomSpec, SpaceType } from './types';

/** One piece a step changes, with the piece as the step starts and as it ends (absent for an addition or a removal). */
export interface LayoutExplanationPart {
  itemId: string;
  from?: FurnitureItem;
  to?: FurnitureItem;
}
export interface StepShort { text: string; tradeOff?: boolean }
export interface LayoutExplanationStep {
  id: string;
  /** The piece the step is about. For a chapter step this is its lead piece, the one that travels furthest. */
  itemId?: string;
  /**
   * Set only on chapter steps of a large switch: every piece the step changes, lead piece included, all animating together.
   * When present it is authoritative and itemId/from/to repeat the lead part. Small switches never carry it.
   */
  parts?: LayoutExplanationPart[];
  kind: 'move' | 'add' | 'remove' | 'update' | 'finish';
  title: string;
  description: string;
  why?: string;
  goalWhys?: { goal: LayoutGoal; label: string; text: string }[];
  short?: StepShort;
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
  byAgent?: boolean;
  goals?: { id: LayoutGoal; label: string; heading: string; lines: [string, string][]; note: string }[];
  limits?: string[];
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

/** A layout holding any kind a home room cannot hold is a store. For callers that have layouts but no project. */
export function spaceOfLayouts(...layouts: Layout[]): SpaceType {
  const roomKinds = kindsForSpace('room');
  return layouts.some(layout => layout.items.some(item => !roomKinds.includes(item.kind))) ? 'retail' : 'room';
}
/** Sorted x values where a footprint's edges cross the line at z, in the even-odd sense: a point is inside between each pair. */
function crossings(z: number, polygon: { x: number; z: number }[]): number[] {
  const xs: number[] = [];
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.z > z) !== (b.z > z)) xs.push((b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x);
  }
  return xs.sort((a, b) => a - b);
}
/** Largest empty rectangle of floor in m², measured on a 5 cm grid from the furniture footprints. A coarser cell only ranks. */
export function openFloorArea(layout: Layout, room: RoomSpec, cell = .05): number {
  const columns = Math.round(room.width / cell), rows = Math.round(room.depth / cell), originX = -room.width / 2;
  const footprints = layout.items.filter(item => item.visible).map(getFootprint).map(polygon => ({ polygon, top: Math.min(...polygon.map(point => point.z)), bottom: Math.max(...polygon.map(point => point.z)) })), heights = new Int32Array(columns + 1), blocked = new Uint8Array(columns), stack = new Int32Array(columns + 1);
  let best = 0;
  for (let row = 0; row < rows; row++) {
    const z = -room.depth / 2 + (row + .5) * cell;
    let depth = 0;
    blocked.fill(0);
    // Each row marks only the cells between footprint edges, which keeps a large store as cheap as a small room.
    for (const { polygon, top, bottom } of footprints) {
      if (z < top || z > bottom) continue;
      const xs = crossings(z, polygon);
      for (let pair = 0; pair + 1 < xs.length; pair += 2) {
        const last = Math.min(columns - 1, Math.ceil((xs[pair + 1] - originX) / cell));
        for (let column = Math.max(0, Math.floor((xs[pair] - originX) / cell) - 1); column <= last; column++) {
          const x = originX + (column + .5) * cell;
          if (x >= xs[pair] && x < xs[pair + 1]) blocked[column] = 1;
        }
      }
    }
    for (let column = 0; column <= columns; column++) {
      if (column < columns) heights[column] = blocked[column] ? 0 : heights[column] + 1;
      const height = column < columns ? heights[column] : 0;
      while (depth && heights[stack[depth - 1]] >= height) {
        const top = heights[stack[--depth]], left = depth ? stack[depth - 1] + 1 : 0;
        if (top * (column - left) > best) best = top * (column - left);
      }
      stack[depth++] = column;
    }
  }
  return best * cell * cell;
}
function wallGap(item: FurnitureItem, room: RoomSpec): number {
  return Math.min(...getFootprint(item).flatMap(point => [room.width / 2 - Math.abs(point.x), room.depth / 2 - Math.abs(point.z)]));
}
function stepReason(step: LayoutExplanationStep, floorBefore: number, floorAfter: number, issuesBefore: number, issuesAfter: number, room: RoomSpec, targetName: string, place: string): string {
  const reasons: string[] = [], change = floorAfter - floorBefore;
  if (change >= .05) reasons.push(`Opens ${metres(change)} m² of continuous floor (${metres(floorBefore)} → ${metres(floorAfter)} m²).`);
  else if (change <= -.05) reasons.push(`On its own this takes ${metres(-change)} m² from the largest open area; it is part of the full ${targetName} arrangement.`);
  if (step.from && step.to && wallGap(step.from, room) - wallGap(step.to, room) >= .05) reasons.push(`Sits ${metres(wallGap(step.from, room) - wallGap(step.to, room))} m closer to the wall.`);
  if (issuesAfter < issuesBefore) reasons.push(`Clears ${issuesBefore - issuesAfter === 1 ? 'a placement finding' : `${issuesBefore - issuesAfter} placement findings`}.`);
  if (reasons.length) return reasons.join(' ');
  if (!step.to) return `Takes it out of the ${place}.`;
  if (!step.from) return `Adds it to the ${place}.`;
  return step.kind === 'move' ? `Leaves the largest open area as it is; this is where ${targetName} puts it.` : 'Leaves the largest open area as it is.';
}

const FINAL = 'Part of the final layout';
const tenth = (value: number) => Number(value.toFixed(1)).toString();
function shortReason(floorBefore: number, floorAfter: number, issuesBefore: number, issuesAfter: number): StepShort {
  const change = floorAfter - floorBefore, cleared = issuesBefore - issuesAfter;
  if (change >= .05) return { text: `Opens ${tenth(change)} m² of floor` };
  if (cleared > 0) return { text: `Clears ${count(cleared)} crowded ${cleared === 1 ? 'spot' : 'spots'}` };
  if (change <= -.05) return { text: `Uses ${tenth(-change)} m² of floor`, tradeOff: true };
  return { text: FINAL };
}
function finishShort(startFloor: number, endFloor: number, coloured: boolean): StepShort {
  if (coloured) return { text: 'New colours, nothing moves' };
  return endFloor - startFloor >= .05 ? { text: `Opens ${tenth(endFloor - startFloor)} m² overall` } : { text: 'Shows the finished layout' };
}

const GREEDY_STEPS = 12, RANK_CELL = .1;

// Large switches (a flagship store has 28–61 changed pieces) play as a few chapters of pieces that belong together.
const MAX_CHAPTERS = 9, CHAPTER_MIN_MS = 1200, CHAPTER_MAX_MS = 2000, FINISH_MS = 1400, STORY_MIN_MS = 9500, STORY_MAX_MS = 12000;
/** Store fixtures that work as one zone share a chapter. Order breaks ties between chapters that open the same floor. */
const STORE_FAMILIES: [string, string, ItemKind[]][] = [
  ['arrival', 'the arrival plinths and tables', ['hero-plinth', 'display-table']],
  ['fragrance', 'the fragrance towers', ['fragrance-tower']],
  ['walls', 'the wall displays and screens', ['wall-display', 'digital-wall', 'shelf']],
  ['diagnostics', 'the skin diagnostics and testing bars', ['skin-analyzer', 'consultation-station', 'chair', 'testing-bar']],
  ['makeup', 'the makeup stations', ['mirror-station', 'beauty-chair']],
  ['cabins', 'the treatment cabins', ['service-cabin']],
  ['lounge', 'the lounge', ['lounge-bench']],
  ['checkout', 'the gifting and checkout', ['gift-station', 'checkout-counter']],
  ['plants', 'the plants', ['plant']],
];
const PLURAL: Partial<Record<ItemKind, string>> = {
  'hero-plinth': 'plinths', 'consultation-station': 'consultation vanities', 'lounge-bench': 'lounge benches', 'service-cabin': 'treatment cabins',
  shelf: 'shelves', 'pedestal-fan': 'fans', 'floor-bed': 'floor beds',
};
const plural = (kind: ItemKind) => PLURAL[kind] ?? `${kind.replace(/-/g, ' ')}s`;
const SINGULAR: Partial<Record<ItemKind, string>> = { 'hero-plinth': 'plinth', 'consultation-station': 'consultation vanity', 'service-cabin': 'treatment cabin', 'pedestal-fan': 'fan' };
const singular = (kind: ItemKind) => SINGULAR[kind] ?? kind.replace(/-/g, ' ');
const NUMBERS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const count = (n: number) => NUMBERS[n] ?? String(n);
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const list = (words: string[]) => words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
const lower = (name: string) => name.charAt(0).toLowerCase() + name.slice(1);
const pieceOf = (part: LayoutExplanationPart) => (part.to ?? part.from)!;
const travel = (part: LayoutExplanationPart) => part.from && part.to ? Math.hypot(part.to.position.x - part.from.position.x, part.to.position.z - part.from.position.z) : 0;

/** Pieces of each kind, in words: "9 fragrance towers", "four mirror stations and four beauty chairs". Names when there are three or fewer. */
function pieceWords(parts: LayoutExplanationPart[]): string {
  const kinds = new Map<ItemKind, number>();
  for (const part of parts) kinds.set(pieceOf(part).kind, (kinds.get(pieceOf(part).kind) ?? 0) + 1);
  if (parts.length === 1 || (parts.length <= 3 && kinds.size > 1)) return list(parts.map(part => `the ${lower(pieceOf(part).name)}`));
  if (kinds.size === 1) return `the ${count(parts.length)} ${plural(parts.map(pieceOf)[0].kind)}`;
  return list([...kinds].map(([kind, n]) => `${count(n)} ${n === 1 ? singular(kind) : plural(kind)}`));
}
/** Where a piece ends, in words a visitor would use. The door is in the front wall. */
function placeWords(item: FurnitureItem, room: RoomSpec, place: string): string {
  if (wallGap(item, room) <= .6) {
    const sides = [[room.width / 2 + item.position.x, 'the left wall'], [room.width / 2 - item.position.x, 'the right wall'], [room.depth / 2 + item.position.z, 'the back wall'], [room.depth / 2 - item.position.z, 'the entrance wall']] as const;
    return [...sides].sort((a, b) => a[0] - b[0])[0][1];
  }
  const depth = item.position.z > room.depth / 6 ? 'front' : item.position.z < -room.depth / 6 ? 'back' : 'middle';
  const side = item.position.x < -room.width / 6 ? 'left' : item.position.x > room.width / 6 ? 'right' : '';
  if (depth === 'front') return side ? `the entrance, on the ${side}` : 'the entrance';
  if (depth === 'back') return side ? `the back ${side} of the ${place}` : `the back of the ${place}`;
  return side ? `the ${side} side of the ${place}` : `the centre of the ${place}`;
}
/** Where a group ends, or undefined when it scatters too much to name one place. */
function destinationWords(parts: LayoutExplanationPart[], room: RoomSpec, place: string): string | undefined {
  const ends = parts.filter(part => part.to).map(part => placeWords(part.to!, room, place)), tally = new Map<string, number>();
  for (const end of ends) tally.set(end, (tally.get(end) ?? 0) + 1);
  const ranked = [...tally].sort((a, b) => b[1] - a[1]);
  if (ranked.length === 1) return ranked[0][0];
  if (ranked.length === 2 && ranked.every(([end]) => end.endsWith(' wall'))) return `the ${ranked.map(([end]) => end.slice(4, -5)).join(' and ')} walls`;
  if (ranked[0][1] * 3 >= ends.length * 2) return `mostly ${ranked[0][0]}`;
  return undefined;
}
function chapterTitle(parts: LayoutExplanationPart[], label: string, room: RoomSpec, place: string): string {
  const kinds = new Set(parts.map(part => pieceOf(part).kind)), [kind] = kinds;
  const subject = parts.length === 1 ? `the ${lower(pieceOf(parts[0]).name)}` : kinds.size === 1 ? `the ${count(parts.length)} ${plural(kind)}` : label;
  if (parts.every(part => !part.to)) return `Take out ${subject}`;
  if (parts.every(part => !part.from)) { const destination = destinationWords(parts, room, place); return destination ? `Add ${subject} at ${destination.replace(/^mostly /, '')}` : `Add ${subject}`; }
  const moving = parts.filter(part => travel(part) > POSITION_EPS);
  if (!moving.length) return parts.every(part => part.from && part.to && differences(part.from, part.to).rotated) ? `Turn ${subject}` : `Change ${subject}`;
  const forward = moving.reduce((sum, part) => sum + part.to!.position.z - part.from!.position.z, 0) / moving.length;
  const sideways = moving.reduce((sum, part) => sum + Math.abs(part.to!.position.x - part.from!.position.x), 0) / moving.length;
  const destination = destinationWords(moving, room, place);
  if (Math.abs(forward) > 1.5 && Math.abs(forward) > sideways * 2) {
    if (forward > 0) return destination ? `Bring ${subject} forward to ${destination}` : `Bring ${subject} forward`;
    if (!destination) return `Move ${subject} toward the back`;
    if (!destination.includes('back')) return `Move ${subject} toward the back, ${destination.startsWith('mostly') ? destination : `to ${destination}`}`;
  }
  if (destination) return `Move ${subject} ${destination.startsWith('mostly') ? destination.replace(/^mostly /, 'mostly to ') : `to ${destination}`}`;
  const outward = moving.filter(part => wallGap(part.to!, room) < wallGap(part.from!, room) - .3).length, inward = moving.filter(part => wallGap(part.to!, room) > wallGap(part.from!, room) + .3).length;
  if (outward * 3 >= moving.length * 2) return `Pull ${subject} out toward the walls`;
  if (inward * 3 >= moving.length * 2) return `Bring ${subject} in from the walls`;
  return `Rearrange ${subject} around the ${place}`;
}
function chapterDescription(parts: LayoutExplanationPart[], heldColours: number, place: string): string {
  const sentences: string[] = [], removed = parts.filter(part => !part.to), added = parts.filter(part => !part.from), kept = parts.filter(part => part.from && part.to);
  const moving = kept.filter(part => travel(part) > POSITION_EPS), turning = kept.filter(part => differences(part.from!, part.to!).rotated);
  if (kept.length) {
    const facts: string[] = [];
    const furthest = Math.max(0, ...moving.map(travel));
    if (moving.length) facts.push(`${moving.length === 1 ? 'it' : 'the furthest'} travels ${Number(furthest.toFixed(1))} m`);
    if (turning.length) facts.push(turning.length === kept.length ? (kept.length === 1 ? 'it turns to face a new way' : 'all turn to face a new way') : `${count(turning.length)} ${turning.length === 1 ? 'turns' : 'turn'} to face a new way`);
    const resized = kept.filter(part => differences(part.from!, part.to!).resized).length, remodelled = kept.filter(part => differences(part.from!, part.to!).geometry).length;
    if (resized) facts.push(`${count(resized)} ${resized === 1 ? 'changes' : 'change'} size`);
    if (remodelled) facts.push(`${count(remodelled)} ${remodelled === 1 ? 'becomes' : 'become'} a different model`);
    sentences.push(`${capital(pieceWords(kept))} ${kept.length === 1 ? 'moves' : 'move together'}${facts.length ? `; ${list(facts)}` : ''}.`);
    const hidden = kept.filter(part => part.from!.visible && !part.to!.visible).length, shown = kept.filter(part => !part.from!.visible && part.to!.visible).length;
    if (hidden) sentences.push(`${capital(count(hidden))} ${hidden === 1 ? 'is' : 'are'} hidden.`);
    if (shown) sentences.push(`${capital(count(shown))} ${shown === 1 ? 'appears' : 'appear'}.`);
  }
  if (removed.length) sentences.push(`${capital(pieceWords(removed))} ${removed.length === 1 ? 'leaves' : 'leave'} the ${place}.`);
  if (added.length) sentences.push(`${capital(pieceWords(added))} ${added.length === 1 ? 'joins' : 'join'} the ${place}${added.some(part => !part.to!.visible) ? ', some starting hidden' : ''}.`);
  if (heldColours) sentences.push(heldColours === 1 && parts.length === 1 ? 'Its new finish comes at the end.' : 'Their new finishes come at the end.');
  return sentences.join(' ');
}
/** Plain words for a colour change: "cooler, darker". Never a code. */
function toneWords(from: string, to: string): string {
  const rgb = (hex: string) => /^#[a-f\d]{6}$/i.test(hex) ? [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255) : undefined;
  const a = rgb(from), b = rgb(to);
  if (!a || !b) return 'new';
  const warmth = (c: number[]) => c[0] - c[2], light = (c: number[]) => .2126 * c[0] + .7152 * c[1] + .0722 * c[2], words: string[] = [];
  if (warmth(b) - warmth(a) > .06) words.push('warmer'); else if (warmth(b) - warmth(a) < -.06) words.push('cooler');
  if (light(b) - light(a) > .06) words.push('lighter'); else if (light(b) - light(a) < -.06) words.push('darker');
  return words.join(', ') || 'subtly different';
}
function finishDescription(colourParts: LayoutExplanationPart[], from: Layout, to: Layout): string {
  const byTone = new Map<string, Set<ItemKind>>(), sentences: string[] = [];
  for (const part of colourParts) {
    const tone = toneWords(part.from!.color, part.to!.color);
    if (!byTone.has(tone)) byTone.set(tone, new Set());
    byTone.get(tone)!.add(part.to!.kind);
  }
  const phrases = [...byTone].map(([tone, kinds]) => `${tone} finishes on the ${list([...kinds].map(plural))}`);
  if (phrases.length) sentences.push(`${capital(phrases.join('; '))}.`);
  if (from.wallColor.toLowerCase() !== to.wallColor.toLowerCase()) sentences.push(`The walls take a ${toneWords(from.wallColor, to.wallColor)} colour.`);
  if (from.accentColor.toLowerCase() !== to.accentColor.toLowerCase()) sentences.push(`The accent colour turns ${toneWords(from.accentColor, to.accentColor).replace(', ', ' and ')}.`);
  if (to.description.trim()) sentences.push(`Intent: ${intent(to)}.`);
  return sentences.join(' ') || 'Show the target preset in full.';
}
/** A layout with these parts done, sharing untouched pieces with the input. Read-only use: measuring, never storing. */
function withParts(layout: Layout, parts: LayoutExplanationPart[]): Layout {
  const changes = new Map(parts.map(part => [part.itemId, part]));
  const items = layout.items.flatMap(item => { const part = changes.get(item.id); return part ? (part.to ? [part.to] : []) : [item]; });
  for (const part of parts) if (!part.from && part.to) items.push(part.to);
  return { ...layout, items };
}
function chapterReason(floorBefore: number, floorAfter: number, issuesBefore: number, issuesAfter: number, context: { endOpenFloor: number; endIssueCount: number }, parts: LayoutExplanationPart[], room: RoomSpec, targetName: string): string {
  const reasons: string[] = [], change = floorAfter - floorBefore;
  if (change >= .05) reasons.push(`Opens ${metres(change)} m² of continuous floor (${metres(floorBefore)} → ${metres(floorAfter)} m²).`);
  else if (change <= -.05) reasons.push(`Uses ${metres(-change)} m² of the largest open area (${metres(floorBefore)} → ${metres(floorAfter)} m²)${context.endOpenFloor - floorAfter >= .05 ? `; by the end it reaches ${metres(context.endOpenFloor)} m²` : `; this is where ${targetName} puts ${parts.length === 1 ? 'it' : 'them'}`}.`);
  else reasons.push(`The largest open area stays at ${metres(floorAfter)} m².`);
  const closer = parts.filter(part => part.from && part.to && wallGap(part.from, room) - wallGap(part.to, room) >= .05).length;
  if (closer) reasons.push(closer === parts.length ? (closer === 1 ? 'It ends closer to the wall.' : `All ${count(closer)} end closer to the walls.`) : `${capital(count(closer))} of them ${closer === 1 ? 'ends' : 'end'} closer to the walls.`);
  if (issuesAfter < issuesBefore) reasons.push(`Clears ${issuesBefore - issuesAfter === 1 ? 'a crowded spot' : `${count(issuesBefore - issuesAfter)} crowded spots`} (${issuesBefore} → ${issuesAfter}).`);
  else if (issuesAfter > issuesBefore) reasons.push(`Crowded spots go from ${issuesBefore} to ${issuesAfter} for now${context.endIssueCount < issuesAfter ? (context.endIssueCount ? `; the finished layout has ${context.endIssueCount}` : '; none remain in the finished layout') : ''}.`);
  return reasons.join(' ');
}
/** Groups per-piece changes into chapters, orders them by measured gain, and measures each chapter's why in sequence. */
function chapterSteps(from: Layout, to: Layout, room: RoomSpec, pieceSteps: LayoutExplanationStep[], context: { retail: boolean; place: string; startOpenFloor: number; endOpenFloor: number; startIssueCount: number; endIssueCount: number }): LayoutExplanationStep[] {
  // Colour waits for the finishing step, so each chapter shows shape and place and the colours land together in words.
  const colourParts: LayoutExplanationPart[] = [], groups = new Map<string, { key: string; label: string; order: number; parts: LayoutExplanationPart[]; held: number }>();
  for (const step of pieceSteps) {
    const change = step.from && step.to ? differences(step.from, step.to) : undefined;
    let part: LayoutExplanationPart = { itemId: step.itemId!, from: step.from, to: step.to }, held = 0;
    if (change?.recolored) {
      colourParts.push({ itemId: step.itemId!, from: { ...clone(step.to!), color: step.from!.color }, to: clone(step.to!) });
      if (!Object.entries(change).some(([name, value]) => value && name !== 'recolored')) continue;
      part = { ...part, to: { ...clone(step.to!), color: step.from!.color } }; held = 1;
    }
    const kind = pieceOf(part).kind, family = context.retail ? STORE_FAMILIES.findIndex(([, , kinds]) => kinds.includes(kind)) : -1;
    const key = family >= 0 ? STORE_FAMILIES[family][0] : kind, label = family >= 0 ? STORE_FAMILIES[family][1] : `the ${plural(kind)}`;
    if (!groups.has(key)) groups.set(key, { key, label, order: family >= 0 ? family : STORE_FAMILIES.length + groups.size, parts: [], held: 0 });
    const group = groups.get(key)!; group.parts.push(part); group.held += held;
  }
  // A handful of chapters: past the limit, the smallest groups share one last chapter.
  let pending = [...groups.values()];
  if (pending.length > MAX_CHAPTERS) {
    const bySize = [...pending].sort((a, b) => a.parts.length - b.parts.length || a.order - b.order), merged = bySize.slice(0, pending.length - MAX_CHAPTERS + 1);
    pending = [...pending.filter(group => !merged.includes(group)), { key: 'remaining', label: 'the remaining pieces', order: Infinity, parts: merged.flatMap(group => group.parts), held: merged.reduce((sum, group) => sum + group.held, 0) }];
  }
  pending.sort((a, b) => a.order - b.order);
  // Biggest measured gain first, re-ranked after each chapter on a coarse grid; the reported figures use the exact 5 cm measure.
  const chapters: LayoutExplanationStep[] = [];
  let reached = from, reachedFloor = context.startOpenFloor, reachedIssues = context.startIssueCount;
  while (pending.length) {
    const floors = pending.map(group => openFloorArea(withParts(reached, group.parts), room, RANK_CELL));
    const [group] = pending.splice(floors.indexOf(Math.max(...floors)), 1);
    const next = withParts(reached, group.parts), nextFloor = openFloorArea(next, room), nextIssues = validateLayout(next, room).length;
    const lead = [...group.parts].sort((a, b) => travel(b) - travel(a))[0];
    const kinds = group.parts.map(part => !part.to ? 'remove' : !part.from ? 'add' : Object.entries(differences(part.from, part.to)).some(([name, value]) => value && name !== 'moved' && name !== 'rotated') ? 'update' : 'move');
    chapters.push({
      id: `chapter:${group.key}`, itemId: lead.itemId, parts: group.parts.map(part => ({ itemId: part.itemId, ...(part.from && { from: clone(part.from) }), ...(part.to && { to: clone(part.to) }) })),
      kind: kinds.every(kind => kind === kinds[0]) ? kinds[0] as LayoutExplanationStep['kind'] : 'update',
      title: chapterTitle(group.parts, group.label, room, context.place),
      description: chapterDescription(group.parts, group.held, context.place),
      why: chapterReason(reachedFloor, nextFloor, reachedIssues, nextIssues, context, group.parts, room, to.name),
      short: shortReason(reachedFloor, nextFloor, reachedIssues, nextIssues),
      ...(lead.from && { from: clone(lead.from) }), ...(lead.to && { to: clone(lead.to) }),
      durationMs: Math.min(CHAPTER_MAX_MS, CHAPTER_MIN_MS + 100 * (group.parts.length - 1)),
    });
    reached = next; reachedFloor = nextFloor; reachedIssues = nextIssues;
  }
  const finishChanged = from.wallColor.toLowerCase() !== to.wallColor.toLowerCase() || from.accentColor.toLowerCase() !== to.accentColor.toLowerCase();
  const floorWords = Math.abs(context.endOpenFloor - context.startOpenFloor) >= .05 ? `Altogether, the largest open floor goes from ${metres(context.startOpenFloor)} to ${metres(context.endOpenFloor)} m².` : `Altogether, the largest open floor stays at ${metres(context.endOpenFloor)} m².`;
  chapters.push({
    id: 'finish', kind: 'finish', title: colourParts.length || finishChanged ? `New finishes for ${to.name}` : `See ${to.name}`, description: finishDescription(colourParts, from, to),
    why: `${floorWords}${colourParts.length || finishChanged ? ' Colour changes do not move anything.' : ''}`,
    short: finishShort(context.startOpenFloor, context.endOpenFloor, Boolean(colourParts.length) || finishChanged),
    ...(colourParts.length && { parts: colourParts }), durationMs: FINISH_MS,
  });
  // Each chapter long enough to watch; the whole story about ten to twelve seconds.
  const total = chapters.reduce((sum, step) => sum + step.durationMs, 0), floor = CHAPTER_MIN_MS * chapters.length;
  if (total > STORY_MAX_MS && total > floor) for (const step of chapters) step.durationMs = Math.floor(CHAPTER_MIN_MS + (step.durationMs - CHAPTER_MIN_MS) * Math.max(0, STORY_MAX_MS - floor) / (total - floor));
  else if (total < STORY_MIN_MS) for (const step of chapters) step.durationMs = Math.min(CHAPTER_MAX_MS, Math.floor(step.durationMs * STORY_MIN_MS / total));
  return chapters;
}
/** True when the target differs visibly from the source, without measuring anything. */
export function layoutsDiffer(from: Layout, to: Layout): boolean {
  const before = itemMap(from), after = itemMap(to);
  if (from.wallColor.toLowerCase() !== to.wallColor.toLowerCase() || from.accentColor.toLowerCase() !== to.accentColor.toLowerCase()) return true;
  if (from.items.length !== to.items.length || to.items.some(item => !before.has(item.id))) return true;
  return from.items.some(item => { const target = after.get(item.id); return !target || Object.values(differences(item, target)).some(Boolean); });
}
const intent = (layout: Layout) => layout.description.trim().replace(/[.!]+$/, '');
/** A deterministic explanation of preset differences, not an optimization or physical motion simulation. */
export function buildLayoutExplanation(from: Layout, to: Layout, room: RoomSpec, space?: SpaceType, goals: LayoutGoal[] = [], limits: string[] = []): LayoutExplanationPlan {
  const plan = explain(from, to, room, space);
  if ((space ?? spaceOfLayouts(from, to)) !== 'retail') return plan;
  const measured = goals.length ? withGoals(plan, from, to, room, [...new Set(goals)]) : withShopperReasons(plan, from, room);
  return limits.length ? { ...measured, limits: [...new Set(limits)] } : measured;
}
const SHOPPER_GOALS: LayoutGoal[] = ['find', 'sales', 'browse'];
function withShopperReasons(plan: LayoutExplanationPlan, from: Layout, room: RoomSpec): LayoutExplanationPlan {
  let reached = from, measured = measureStore(from, room);
  const steps = plan.steps.map(step => {
    if (step.kind === 'finish') return step;
    const next = completedStep(reached, step), after = measureStore(next, room), before = measured;
    reached = next; measured = after;
    if (step.short && !step.short.tradeOff && step.short.text !== FINAL) return step;
    const gain = SHOPPER_GOALS.flatMap(goal => goalShorts(goal, before, after)).find(item => item.gain);
    return gain ? { ...step, short: { text: gain.text }, why: [gain.long, step.why].filter(Boolean).join(' ') } : step;
  });
  return { ...plan, steps };
}
function withGoals(plan: LayoutExplanationPlan, from: Layout, to: Layout, room: RoomSpec, goals: LayoutGoal[]): LayoutExplanationPlan {
  const aisles = [...new Set(goals.map(aisleFor))], measure = (layout: Layout) => new Map(aisles.map(aisle => [aisle, measureStore(layout, room, aisle)]));
  const start = measure(from), end = measure(to), whys = (before: typeof start, after: typeof start) => goals.map(goal => ({ goal, label: GOALS[goal].label, text: goalReason(goal, before.get(aisleFor(goal))!, after.get(aisleFor(goal))!) }));
  const short = (before: typeof start, after: typeof start): StepShort | undefined => {
    const shorts = goals.flatMap(goal => goalShorts(goal, before.get(aisleFor(goal))!, after.get(aisleFor(goal))!)), best = shorts.find(item => item.gain) ?? shorts[0];
    return best && { text: best.text, ...(!best.gain && { tradeOff: true }) };
  };
  let reached = from, measured = start;
  const steps = plan.steps.map(step => {
    if (step.kind === 'finish') return { ...step, goalWhys: whys(start, end), short: short(start, end) ?? step.short };
    const next = completedStep(reached, step), after = measure(next), goalWhys = whys(measured, after);
    const stepShort = short(measured, after) ?? (step.short && !step.short.tradeOff ? step.short : { text: FINAL });
    reached = next; measured = after;
    return { ...step, goalWhys, short: stepShort };
  });
  return { ...plan, steps, goals: goals.map(goal => ({ id: goal, ...GOALS[goal], lines: goalLines(goal, start.get(aisleFor(goal))!, end.get(aisleFor(goal))!) })), warnings: [...plan.warnings, ...goals.map(goal => GOALS[goal].note)] };
}
function explain(from: Layout, to: Layout, room: RoomSpec, space?: SpaceType): LayoutExplanationPlan {
  const before = itemMap(from), after = itemMap(to), steps: LayoutExplanationStep[] = [], warnings: string[] = [];
  const retail = (space ?? spaceOfLayouts(from, to)) === 'retail', place = retail ? 'store' : 'room', Place = retail ? 'Store' : 'Room', pieces = retail ? 'fixture' : 'furniture';
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
      if (change.geometry) details.push(`Use the target layout’s ${pieces} model and product association.`);
      if (change.visibility) details.push(target.visible ? 'Show this piece.' : 'Hide this piece.');
      if (change.metadata) details.push('Keep the name, lock and measurement labels stored in the target layout.');
      const spatialOnly = (change.moved || change.rotated) && !change.resized && !change.recolored && !change.geometry && !change.visibility && !change.metadata;
      steps.push({ id: `change:${item.id}`, itemId: item.id, kind: spatialOnly ? 'move' : 'update', title: `${spatialOnly ? 'Reposition' : 'Update'} ${target.name}`, description: details.join(' '), from: clone(item), to: clone(target), durationMs: 900 });
    }
    if (item.locked) warnings.push(`${item.name} is locked in ${from.name}. This previews a separate layout; the source item and its lock remain unchanged.`);
  }
  for (const item of to.items) if (!before.has(item.id)) {
    steps.push({ id: `add:${item.id}`, itemId: item.id, kind: 'add', title: `Add ${item.name}`, description: `${item.name} is included in ${to.name}${item.visible ? '' : ' and starts hidden'}.`, to: clone(item), durationMs: 900 });
  }
  const finishChanged = from.wallColor.toLowerCase() !== to.wallColor.toLowerCase() || from.accentColor.toLowerCase() !== to.accentColor.toLowerCase();
  if (steps.length || finishChanged) {
    const details: string[] = [];
    if (from.wallColor.toLowerCase() !== to.wallColor.toLowerCase()) details.push(`Set the walls to ${to.wallColor}.`);
    if (from.accentColor.toLowerCase() !== to.accentColor.toLowerCase()) details.push(`Set the accent colour to ${to.accentColor}.`);
    if (to.description.trim()) details.push(`Intent: ${intent(to)}.`);
    steps.push({ id: 'finish', kind: 'finish', title: `See ${to.name}`, description: details.join(' ') || 'Show the target preset in full.', durationMs: 650 });
  }
  const startOpenFloor = openFloorArea(from, room), endOpenFloor = openFloorArea(to, room);
  if (steps.filter(step => step.kind !== 'finish').length > GREEDY_STEPS) {
    const startIssueCount = validateLayout(from, room).length, endIssueCount = validateLayout(to, room).length;
    const chapters = chapterSteps(from, to, room, steps.filter(step => step.kind !== 'finish'), { retail, place, startOpenFloor, endOpenFloor, startIssueCount, endIssueCount });
    const changes = steps.length - 1, story = chapters.length - 1;
    const summary = `${changes} ${pieces} changes, shown as ${story} ${story === 1 ? 'chapter' : 'chapters'} and a finishing step. ${to.description.trim() ? `Intent: ${intent(to)}. ` : ''}Largest open floor: ${metres(startOpenFloor)} → ${metres(endOpenFloor)} m². Placement checks report ${startIssueCount} ${startIssueCount === 1 ? 'finding' : 'findings'} before and ${endIssueCount} in the target. ${Place} sizes are estimated; this does not establish verified fit.`;
    warnings.unshift('Animated movement illustrates the change; it does not verify a collision-free physical moving route.');
    return { id: `layout-explanation:${from.id}:${to.id}`, fromId: from.id, toId: to.id, title: `${from.name} → ${to.name}`, steps: chapters, totalDurationMs: chapters.reduce((sum, step) => sum + step.durationMs, 0), summary, warnings, startIssueCount, endIssueCount, startOpenFloor, endOpenFloor };
  }
  let reached = clone(from), reachedFloor = startOpenFloor, reachedIssues = validateLayout(from, room).length;
  const finishStep = steps.find(step => step.kind === 'finish'), pending = steps.filter(step => step !== finishStep);
  steps.length = 0;
  // Biggest measured gain first, so the opening moves show why the arrangement changes. Large switches tell chapters instead (above).
  while (pending.length) {
    const floors = pending.map(step => openFloorArea(completedStep(reached, step), room));
    const index = floors.indexOf(Math.max(...floors)), [step] = pending.splice(index, 1);
    const next = completedStep(reached, step), nextIssues = validateLayout(next, room).length;
    step.why = stepReason(step, reachedFloor, floors[index], reachedIssues, nextIssues, room, to.name, place);
    step.short = shortReason(reachedFloor, floors[index], reachedIssues, nextIssues);
    steps.push(step);
    reached = next; reachedFloor = floors[index]; reachedIssues = nextIssues;
  }
  if (finishStep) {
    if (Math.abs(endOpenFloor - startOpenFloor) >= .05) finishStep.why = `Largest open floor area goes from ${metres(startOpenFloor)} to ${metres(endOpenFloor)} m².`;
    finishStep.short = finishShort(startOpenFloor, endOpenFloor, finishChanged);
    steps.push(finishStep);
  }
  const unbounded = steps.reduce((sum, step) => sum + step.durationMs, 0);
  if (unbounded > 8000) for (const step of steps) step.durationMs = Math.floor(step.durationMs * 8000 / unbounded);
  const startIssueCount = validateLayout(from, room).length, endIssueCount = validateLayout(to, room).length;
  const changes = steps.filter(step => step.kind !== 'finish').length;
  const summary = `${changes ? `${changes} ${pieces} ${changes === 1 ? 'change' : 'changes'}` : finishChanged ? `${Place} colours change` : `No visible ${pieces} or colour changes`}. ${to.description.trim() ? `Intent: ${intent(to)}. ` : ''}Largest open floor: ${metres(startOpenFloor)} → ${metres(endOpenFloor)} m². Placement checks report ${startIssueCount} ${startIssueCount === 1 ? 'finding' : 'findings'} before and ${endIssueCount} in the target. ${Place} sizes are estimated; this does not establish verified fit.`;
  if (steps.length) warnings.unshift('Animated movement illustrates the change; it does not verify a collision-free physical moving route.');
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
  if (step.parts && step.kind !== 'finish') return clone(withParts(layout, step.parts));
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
    // A large switch's finishing step is about its colours, so they change once, halfway, while its words are on screen.
    if (step.kind === 'finish' && step.parts && stepProgress >= .5) {
      const colours = new Map(to.items.map(item => [item.id, item.color]));
      sampled.items = sampled.items.map(item => ({ ...item, color: colours.get(item.id) ?? item.color }));
      sampled.wallColor = to.wallColor; sampled.accentColor = to.accentColor;
      return { layout: sampled, stepIndex: index, stepProgress, finished: false };
    }
    // Room finishes rebuild scene walls. Apply those once at the completed endpoint, not every frame.
    sampled.items=sampled.items.map(item=>{const before=layout.items.find(i=>i.id===item.id);return before?{...item,color:before.color}:item;});
    sampled.wallColor = from.wallColor;
    sampled.accentColor = from.accentColor;
    return { layout: sampled, stepIndex: index, stepProgress, finished: false };
  }
  return { layout: clone(to), stepIndex: Math.max(0, plan.steps.length - 1), stepProgress: 1, finished: true };
}
