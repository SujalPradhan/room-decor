import type { LabDesign, LabReport } from './model';
import { evaluate, footprint, routeFromDoor, shortestPaths } from './checks';
import { FIRE_CELL, REACTION_S, SMOKE_SPEED, WALK_SPEED } from './rules';
import { distance, polylineLength, type Point } from './route';

export interface DrillPerson { itemId: string; name: string; path: [number, number][]; exitS: number; blockedS: number | null; safe: boolean }
export interface DrillResult { cell: number; cols: number; rows: number; originX: number; originZ: number; arrival: Float32Array; people: DrillPerson[]; start: [number, number]; endS: number }

const TALL_M = 1.2;
const DRAWN_FASTER = 0.7;
const CAP_S = 120;
const STEPS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export function defaultFireStart(design: LabDesign, report: LabReport): [number, number] {
  const loaded = report.meters.sockets.filter(load => load.watts > 0).sort((a, b) => b.watts - a.watts)[0];
  const socket = design.sockets.find(each => each.id === loaded?.socketId);
  if (socket) {
    const inward = { back: [0, 0.3], front: [0, -0.3], left: [0.3, 0], right: [-0.3, 0] }[socket.wall];
    return [socket.x + inward[0], socket.z + inward[1]];
  }
  const coffee = design.items.find(item => item.kind === 'coffee');
  return coffee ? [coffee.x, coffee.z] : [0, 0];
}

function blockedCells(design: LabDesign, cols: number, rows: number, originX: number, originZ: number): Uint8Array {
  const blocked = new Uint8Array(cols * rows);
  for (const item of design.items.filter(each => each.h > TALL_M)) {
    const box = footprint(item);
    for (let index = 0; index < blocked.length; index++) {
      const x = originX + (index % cols) * FIRE_CELL;
      const z = originZ + Math.floor(index / cols) * FIRE_CELL;
      if (x < box.maxX && x + FIRE_CELL > box.minX && z < box.maxZ && z + FIRE_CELL > box.minZ) blocked[index] = 1;
    }
  }
  return blocked;
}

function walkTimes(path: Point[]): number[] {
  const times = [REACTION_S];
  for (let i = 1; i < path.length; i++) times.push(times[i - 1] + distance(path[i - 1], path[i]) / WALK_SPEED);
  return times;
}

export function runDrill(design: LabDesign, start?: [number, number]): DrillResult {
  const { room } = design;
  const cols = Math.ceil(room.width / FIRE_CELL);
  const rows = Math.ceil(room.depth / FIRE_CELL);
  const originX = -room.width / 2;
  const originZ = -room.depth / 2;
  const origin = start ?? design.fireStart ?? defaultFireStart(design, evaluate(design));
  const cellAt = (x: number, z: number) => Math.min(rows - 1, Math.max(0, Math.floor((z - originZ) / FIRE_CELL))) * cols + Math.min(cols - 1, Math.max(0, Math.floor((x - originX) / FIRE_CELL)));
  const centreOf = (index: number): Point => [originX + ((index % cols) + 0.5) * FIRE_CELL, originZ + (Math.floor(index / cols) + 0.5) * FIRE_CELL];
  const blocked = blockedCells(design, cols, rows, originX, originZ);
  const draws: Point[] = [[room.door.x, room.depth / 2]];
  if (room.vent) draws.push([room.vent.x, room.vent.z]);
  const toward = (from: Point, to: Point) => draws.some(draw => distance(to, draw) < distance(from, draw));
  const step = FIRE_CELL / SMOKE_SPEED;
  const { dist } = shortestPaths(cols * rows, [cellAt(origin[0], origin[1])], (from, visit) => {
    const col = from % cols;
    const row = Math.floor(from / cols);
    for (const [dc, dr] of STEPS) {
      const c = col + dc;
      const r = row + dr;
      if (c < 0 || r < 0 || c >= cols || r >= rows || blocked[r * cols + c]) continue;
      visit(r * cols + c, toward(centreOf(from), centreOf(r * cols + c)) ? step * DRAWN_FASTER : step);
    }
  });
  const arrival = Float32Array.from(dist);
  const people = design.items.filter(item => item.kind === 'chair').map(chair => personFor(design, chair.id, chair.name.replace(/^Chair/, 'Desk'), arrival, cellAt));
  const times = [...people.map(person => person.exitS), ...arrival].filter(Number.isFinite);
  return { cell: FIRE_CELL, cols, rows, originX, originZ, arrival, people, start: origin, endS: Math.min(CAP_S, Math.max(0, ...times)) };
}

function personFor(design: LabDesign, itemId: string, name: string, arrival: Float32Array, cellAt: (x: number, z: number) => number): DrillPerson {
  const route = routeFromDoor(design, itemId);
  if (!route) return { itemId, name, path: [], exitS: Infinity, blockedS: null, safe: false };
  const path = route.reverse();
  const times = walkTimes(path);
  const hit = path.findIndex((point, i) => arrival[cellAt(point[0], point[1])] <= times[i]);
  const blockedS = hit < 0 ? null : hit === 0 ? arrival[cellAt(path[0][0], path[0][1])] : times[hit];
  return { itemId, name, path, exitS: REACTION_S + polylineLength(path) / WALK_SPEED, blockedS, safe: blockedS === null };
}
