import type { CablePath, Channel, LabDesign, LabItem, LabRoom } from './model';

export type Point = [number, number];
export interface Box { minX: number; maxX: number; minZ: number; maxZ: number }

const INSET = 0.05;
const SAME = 1e-9;

export function footprint(item: LabItem): Box {
  const turned = item.rotation === 90 || item.rotation === 270;
  const halfW = (turned ? item.d : item.w) / 2;
  const halfD = (turned ? item.w : item.d) / 2;
  return { minX: item.x - halfW, maxX: item.x + halfW, minZ: item.z - halfD, maxZ: item.z + halfD };
}

export const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function polylineLength(points: Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distance(points[i - 1], points[i]);
  return total;
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

function dropRepeats(points: Point[]): Point[] {
  return points.filter((point, i) => i === 0 || distance(point, points[i - 1]) > SAME);
}

function edgeMidpoint(item: LabItem, target: Point): Point {
  const box = footprint(item);
  const midX = (box.minX + box.maxX) / 2;
  const midZ = (box.minZ + box.maxZ) / 2;
  const edges: Point[] = [[midX, box.minZ], [box.maxX, midZ], [midX, box.maxZ], [box.minX, midZ]];
  return edges.reduce((best, edge) => (distance(edge, target) < distance(best, target) - SAME ? edge : best));
}

function wallLoop(room: LabRoom): Point[] {
  const hx = room.width / 2 - INSET;
  const hz = room.depth / 2 - INSET;
  const left = Math.max(-hx, room.door.x - room.door.width / 2);
  const right = Math.min(hx, room.door.x + room.door.width / 2);
  return [[right, hz], [hx, hz], [hx, -hz], [-hx, -hz], [-hx, hz], [left, hz]];
}

function marks(loop: Point[]): number[] {
  const result = [0];
  for (let i = 1; i < loop.length; i++) result.push(result[i - 1] + distance(loop[i - 1], loop[i]));
  return result;
}

function snap(loop: Point[], from: Point): { point: Point; along: number } {
  const at = marks(loop);
  let best = { point: loop[0], along: 0, gap: Infinity };
  for (let i = 1; i < loop.length; i++) {
    const a = loop[i - 1];
    const b = loop[i];
    const run = at[i] - at[i - 1];
    const t = run > 0 ? clamp(((from[0] - a[0]) * (b[0] - a[0]) + (from[1] - a[1]) * (b[1] - a[1])) / (run * run), 0, 1) : 0;
    const point: Point = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
    const gap = distance(from, point);
    if (gap < best.gap - SAME) best = { point, along: at[i - 1] + t * run, gap };
  }
  return { point: best.point, along: best.along };
}

function wallPath(room: LabRoom, start: Point, target: Point): Point[] {
  const loop = wallLoop(room);
  const at = marks(loop);
  const first = snap(loop, start);
  const last = snap(loop, target);
  const low = Math.min(first.along, last.along);
  const high = Math.max(first.along, last.along);
  const corners = loop.filter((_, i) => at[i] > low + SAME && at[i] < high - SAME);
  if (first.along > last.along) corners.reverse();
  return [start, first.point, ...corners, last.point, target];
}

function floorPath(start: Point, stops: Point[]): Point[] {
  const points: Point[] = [start];
  for (const stop of stops) {
    const here = points[points.length - 1];
    points.push([stop[0], here[1]], stop);
  }
  return points;
}

function pathFor(room: LabRoom, item: LabItem, channel: Channel, target: Point, via?: Point): Point[] {
  const stops: Point[] = via ? [via, target] : [target];
  if (channel === 'wall') return wallPath(room, edgeMidpoint(item, snap(wallLoop(room), [item.x, item.z]).point), target);
  const start = edgeMidpoint(item, stops[0]);
  return channel === 'floor' ? floorPath(start, stops) : [start, ...stops];
}

function cable(room: LabRoom, item: LabItem, kind: 'power' | 'data', channel: Channel, target: Point, via?: Point): CablePath {
  const points = dropRepeats(pathFor(room, item, channel, target, via));
  return { id: `${item.id}-${kind}`, itemId: item.id, kind, channel, points, length: polylineLength(points) };
}

export function routeCables(design: LabDesign): CablePath[] {
  const { room } = design;
  const cables: CablePath[] = [];
  for (const item of design.items) {
    const socket = design.sockets.find(each => each.id === item.socketId);
    if (item.watts > 0 && socket) cables.push(cable(room, item, 'power', item.channel, [socket.x, socket.z], item.via));
    if (item.data) cables.push(cable(room, item, 'data', item.dataChannel ?? 'wall', [room.dataPoint.x, room.dataPoint.z]));
  }
  return cables;
}
