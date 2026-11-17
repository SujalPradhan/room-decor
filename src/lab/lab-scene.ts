import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { CablePath, LabDesign, LabItem, LabReport, LabRoom, LabSocket, Wall } from './model';
import { REACTION_S, WALK_SPEED } from './rules';

export type LabViewMode = 'plan' | 'orbit' | 'walk';

export interface DrillView {
  arrival: Float32Array;
  cols: number;
  rows: number;
  cell: number;
  originX: number;
  originZ: number;
  t: number;
  people: { itemId: string; path: [number, number][]; exitS: number; blockedS: number | null }[];
  start: [number, number];
}

export interface LabSceneState {
  design: LabDesign;
  report: LabReport;
  mode: LabViewMode;
  xray: boolean;
  selectedId: string | null;
  highlight?: string[];
  changes?: { itemId: string; label: string }[];
  drill?: DrillView | null;
}

export interface LabSceneCallbacks {
  onSelect(id: string | null): void;
  onMoveItem(id: string, x: number, z: number): void;
  onMoveSocket(id: string, x: number, z: number): void;
  onMoveVia(itemId: string, x: number, z: number): void;
  onPickCable?(itemId: string, kind: 'power' | 'data'): void;
}

export interface LabScene {
  update(state: LabSceneState): void;
  resetView(): void;
  capture(): string;
  dispose(): void;
}

type Pt = [number, number];
type Mat = THREE.MeshStandardMaterial | THREE.MeshBasicMaterial;
type PickType = 'item' | 'socket' | 'via' | 'cable';
interface Pick { type: PickType; id: string; cableKind?: 'power' | 'data' }
interface MeshOptions { edges?: boolean; shadow?: boolean; parent?: THREE.Object3D }
interface MatOptions { emissive?: string; emissiveIntensity?: number; roughness?: number; metalness?: number }

const SNAP_STEPS = 20;
const WALL_T = 0.12;
const CUT_H = 0.4;
const XRAY_ALPHA = 0.15;
const XRAY_SECONDS = 0.25;
const DOOR_H = 2.05;
const SOCKET_Y = 0.3;
const EYE_HEIGHT = 1.6;
const WALK_RADIUS = 0.25;
const WALK_MS = 1.6;
const GOLD = '#e6c78b';
const ALERT = '#e5483d';
const CHANGED = '#58d39b';
const BG = new THREE.Color('#344139');
const BG_XRAY = new THREE.Color('#18222c');
const XRAY_TINT = new THREE.Color('#8fb8e6');
const LOAD_COLORS = { ok: '#4fc477', warn: '#f0b13d', over: '#ee4b3f' };
const DATA_COLOR = '#3da5ff';
const CIRCUIT_COLORS = ['#ffd166', '#c792ea', '#7fdbca', '#f78c6c'];
const DESK_COLORS: Record<string, string> = { 'desk-chipboard': '#d9d2c3', 'desk-plywood': '#d8b88a', 'desk-oak': '#a97c50', 'desk-steel': '#8d959c' };
const SHELF_COLORS: Record<string, string> = { 'shelf-mdf': '#c9a574', 'shelf-plywood': '#d6b98c', 'shelf-steel': '#9ea6ad' };
const FLOOR_COLORS: Record<string, string> = { 'floor-vinyl': '#b3a48a', 'floor-carpet': '#8d8b86', 'floor-linoleum': '#a28a66', 'floor-cork': '#b78a58' };
const BOX_COLORS = ['#b88a5a', '#6f8f9a', '#c9b27a', '#8d6f8c'];
const WALL_KINDS = new Set(['ac', 'router']);
const SOFT_KINDS = new Set(['chair', 'router', 'ac']);

const snap = (v: number) => Math.round(v * SNAP_STEPS) / SNAP_STEPS;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const radians = (deg: number) => (deg * Math.PI) / 180;
const extents = (item: LabItem) => (item.rotation === 90 || item.rotation === 270 ? { w: item.d, d: item.w } : { w: item.w, d: item.d });

function nearestWall(room: LabRoom, x: number, z: number): Wall {
  const gaps: [Wall, number][] = [['back', z + room.depth / 2], ['front', room.depth / 2 - z], ['left', x + room.width / 2], ['right', room.width / 2 - x]];
  return gaps.reduce((best, gap) => (gap[1] < best[1] ? gap : best))[0];
}

function wallRotation(wall: Wall) {
  return { back: 0, front: Math.PI, left: Math.PI / 2, right: -Math.PI / 2 }[wall];
}

function wallPosition(room: LabRoom, wall: Wall, x: number, z: number, y: number, inset: number) {
  const hw = room.width / 2;
  const hd = room.depth / 2;
  if (wall === 'back') return new THREE.Vector3(x, y, -hd + inset);
  if (wall === 'front') return new THREE.Vector3(x, y, hd - inset);
  if (wall === 'left') return new THREE.Vector3(-hw + inset, y, z);
  return new THREE.Vector3(hw - inset, y, z);
}

function constrainToWall(room: LabRoom, wall: Wall, x: number, z: number, margin: number): Pt {
  const hw = room.width / 2;
  const hd = room.depth / 2;
  if (wall === 'back' || wall === 'front') return [clamp(snap(x), -hw + margin, hw - margin), wall === 'back' ? -hd : hd];
  return [wall === 'left' ? -hw : hw, clamp(snap(z), -hd + margin, hd - margin)];
}

function mountHeight(item: LabItem) {
  return item.kind === 'ac' ? 2.2 - item.h / 2 : 1.0;
}

function loadColor(watts: number, limitW: number) {
  const ratio = limitW > 0 ? watts / limitW : 0;
  if (ratio > 1) return LOAD_COLORS.over;
  return ratio >= 0.8 ? LOAD_COLORS.warn : LOAD_COLORS.ok;
}

class XrayLayer {
  readonly edge = new THREE.LineBasicMaterial({ color: '#bfdcff', transparent: true, opacity: 0, toneMapped: false, depthWrite: false });
  private entries = new Map<Mat, { color: THREE.Color; opacity: number }>();
  private t = 0;

  add<T extends Mat>(material: T): T {
    const entry = { color: material.color.clone(), opacity: material.opacity };
    this.entries.set(material, entry);
    this.write(material, entry);
    return material;
  }

  remove(material: Mat) {
    this.entries.delete(material);
  }

  set(t: number) {
    this.t = t;
    this.entries.forEach((entry, material) => this.write(material, entry));
    this.edge.visible = t > 0.01;
    this.edge.opacity = 0.8 * t;
  }

  private write(material: Mat, entry: { color: THREE.Color; opacity: number }) {
    const transparent = this.t > 0.001 || entry.opacity < 1;
    if (material.transparent !== transparent) {
      material.transparent = transparent;
      material.needsUpdate = true;
    }
    material.opacity = THREE.MathUtils.lerp(entry.opacity, Math.min(entry.opacity, XRAY_ALPHA), this.t);
    material.depthWrite = this.t < 0.5;
    material.color.copy(entry.color).lerp(XRAY_TINT, 0.45 * this.t);
  }
}

class Parts {
  readonly root = new THREE.Group();
  private mats: Mat[] = [];
  private raws: THREE.Material[] = [];
  private xray: XrayLayer;

  constructor(xray: XrayLayer) {
    this.xray = xray;
  }

  mat(color: string, o: MatOptions = {}) {
    const material = this.xray.add(new THREE.MeshStandardMaterial({ color, roughness: o.roughness ?? 0.75, metalness: o.metalness ?? 0, emissive: o.emissive ?? '#000000', emissiveIntensity: o.emissiveIntensity ?? 1 }));
    this.mats.push(material);
    return material;
  }

  raw<T extends THREE.Material>(material: T): T {
    this.raws.push(material);
    return material;
  }

  mesh(geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, o: MeshOptions = {}) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = o.shadow ?? true;
    mesh.receiveShadow = true;
    if (o.edges ?? true) mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 30), this.xray.edge));
    (o.parent ?? this.root).add(mesh);
    return mesh;
  }

  box(w: number, h: number, d: number, color: string, x: number, y: number, z: number, o: MeshOptions & MatOptions = {}) {
    return this.mesh(new THREE.BoxGeometry(w, h, d), this.mat(color, o), x, y, z, o);
  }

  cyl(rTop: number, rBottom: number, h: number, color: string, x: number, y: number, z: number, o: MeshOptions & MatOptions = {}) {
    return this.mesh(new THREE.CylinderGeometry(rTop, rBottom, h, 20), this.mat(color, o), x, y, z, o);
  }

  dispose() {
    this.root.removeFromParent();
    this.root.traverse((object) => {
      const geometry = (object as THREE.Mesh).geometry;
      if (geometry && !(object as THREE.Sprite).isSprite) geometry.dispose();
    });
    this.mats.forEach((material) => {
      this.xray.remove(material);
      material.dispose();
    });
    this.raws.forEach((material) => material.dispose());
  }
}

class PolyCurve extends THREE.Curve<THREE.Vector3> {
  private pts: THREE.Vector3[];

  constructor(pts: THREE.Vector3[]) {
    super();
    this.pts = pts;
  }

  getPoint(t: number, target = new THREE.Vector3()) {
    const f = t * (this.pts.length - 1);
    const i = Math.min(Math.floor(f), this.pts.length - 2);
    return target.lerpVectors(this.pts[i], this.pts[i + 1], f - i);
  }

  getUtoTmapping(u: number) {
    return u;
  }
}

function tubeGeometry(points: THREE.Vector3[], radius: number) {
  const clean = points.filter((p, i) => i === 0 || p.distanceTo(points[i - 1]) > 1e-4);
  if (clean.length < 2) return new THREE.BufferGeometry();
  return new THREE.TubeGeometry(new PolyCurve(clean), clean.length - 1, radius, 6, false);
}

function pointAlong(points: Pt[], fraction: number): Pt {
  const lengths = points.slice(1).map((p, i) => Math.hypot(p[0] - points[i][0], p[1] - points[i][1]));
  let left = lengths.reduce((a, b) => a + b, 0) * fraction;
  for (let i = 0; i < lengths.length; i++) {
    if (left <= lengths[i] || i === lengths.length - 1) {
      const f = lengths[i] > 0 ? Math.min(1, left / lengths[i]) : 0;
      return [points[i][0] + (points[i + 1][0] - points[i][0]) * f, points[i][1] + (points[i + 1][1] - points[i][1]) * f];
    }
    left -= lengths[i];
  }
  return points[0] ?? [0, 0];
}

function cableVectors(cable: CablePath, room: LabRoom): THREE.Vector3[] {
  const lift = cable.kind === 'data' ? 0.015 : 0;
  const hw = room.width / 2;
  const hd = room.depth / 2;
  return cable.points.map(([x, z]) => {
    if (cable.channel === 'floor') return new THREE.Vector3(x, -0.03 + lift, z);
    if (cable.channel === 'loose') return new THREE.Vector3(x, 0.012 + lift, z);
    const gaps: [number, () => Pt][] = [
      [z + hd, () => [x, -hd - WALL_T / 2]],
      [hd - z, () => [x, hd + WALL_T / 2]],
      [x + hw, () => [-hw - WALL_T / 2, z]],
      [hw - x, () => [hw + WALL_T / 2, z]],
    ];
    const [gap, inside] = gaps.reduce((best, g) => (g[0] < best[0] ? g : best));
    if (gap > 0.15) return new THREE.Vector3(x, 0.012 + lift, z);
    const [px, pz] = inside();
    return new THREE.Vector3(px, SOCKET_Y + lift, pz);
  });
}

function perimeterS(room: LabRoom, socket: LabSocket) {
  const w = room.width;
  const d = room.depth;
  if (socket.wall === 'back') return socket.x + w / 2;
  if (socket.wall === 'right') return w + socket.z + d / 2;
  if (socket.wall === 'front') return w + d + (w / 2 - socket.x);
  return 2 * w + d + (d / 2 - socket.z);
}

function perimeterPoint(room: LabRoom, s: number, off: number): Pt {
  const w = room.width;
  const d = room.depth;
  const hw = w / 2 + off;
  const hd = d / 2 + off;
  if (s <= w) return [s - w / 2, -hd];
  if (s <= w + d) return [hw, s - w - d / 2];
  if (s <= 2 * w + d) return [w / 2 - (s - w - d), hd];
  return [-hw, d / 2 - (s - 2 * w - d)];
}

function circuitPath(room: LabRoom, sockets: LabSocket[]): Pt[] {
  const off = WALL_T / 2;
  const corners = [0, room.width, room.width + room.depth, 2 * room.width + room.depth];
  const sorted = sockets.map((s) => perimeterS(room, s)).sort((a, b) => a - b);
  const out: Pt[] = [];
  sorted.forEach((s, i) => {
    if (i > 0) corners.filter((c) => c > sorted[i - 1] && c < s).forEach((c) => out.push(perimeterCorner(room, c, off)));
    out.push(perimeterPoint(room, s, off));
  });
  return out;
}

function perimeterCorner(room: LabRoom, s: number, off: number): Pt {
  const hw = room.width / 2 + off;
  const hd = room.depth / 2 + off;
  if (s === 0) return [-hw, -hd];
  if (s === room.width) return [hw, -hd];
  if (s === room.width + room.depth) return [hw, hd];
  return [-hw, hd];
}

let glowMap: THREE.CanvasTexture | null = null;
function glowTexture() {
  if (glowMap) return glowMap;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  glowMap = new THREE.CanvasTexture(canvas);
  glowMap.colorSpace = THREE.SRGBColorSpace;
  return glowMap;
}

function labelSprite(text: string, fg: string, bg: string, height: number) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  ctx.font = '600 40px system-ui, sans-serif';
  const width = Math.ceil(ctx.measureText(text).width) + 28;
  canvas.width = width;
  canvas.height = 60;
  ctx.font = '600 40px system-ui, sans-serif';
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(0, 0, width, 60, 14);
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 14, 32);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, toneMapped: false }));
  sprite.scale.set((height * width) / 60, height, 1);
  sprite.renderOrder = 20;
  return sprite;
}

function disposeSprite(sprite: THREE.Sprite) {
  sprite.removeFromParent();
  sprite.material.map?.dispose();
  sprite.material.dispose();
}

function buildDesk(p: Parts, item: LabItem, color: string) {
  const { w, d, h } = item;
  p.box(w, 0.04, d, color, 0, h - 0.02, 0);
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => p.box(0.05, h - 0.04, 0.05, '#4d5257', sx * (w / 2 - 0.05), (h - 0.04) / 2, sz * (d / 2 - 0.05)));
  p.box(0.05, 0.2, 0.04, '#2b2f33', 0, h + 0.1, -d / 2 + 0.16);
  p.box(0.56, 0.32, 0.03, '#23272b', 0, h + 0.32, -d / 2 + 0.14);
  p.box(0.5, 0.26, 0.004, '#46698a', 0, h + 0.32, -d / 2 + 0.158, { emissive: '#2a4766', emissiveIntensity: 0.8, edges: false });
  p.box(0.38, 0.015, 0.12, '#c9ccd0', 0, h + 0.008, 0.08);
}

function buildChair(p: Parts, item: LabItem) {
  const half = item.d / 2;
  p.box(0.46, 0.07, 0.46, '#4b5560', 0, 0.46, 0);
  p.box(0.46, 0.5, 0.06, '#4b5560', 0, 0.78, -half + 0.07);
  p.cyl(0.03, 0.03, 0.4, '#2d3236', 0, 0.23, 0);
  p.cyl(0.26, 0.26, 0.04, '#2d3236', 0, 0.03, 0);
}

function buildPc(p: Parts, item: LabItem) {
  p.box(item.w, item.h, item.d, '#33383d', 0, item.h / 2, 0);
  p.box(0.02, 0.02, 0.004, '#5fd38d', 0, item.h - 0.06, item.d / 2 + 0.003, { emissive: '#5fd38d', edges: false });
}

function buildPrinter(p: Parts, item: LabItem) {
  const { w, d, h } = item;
  p.box(w * 0.9, h * 0.45, d * 0.9, '#5a6066', 0, h * 0.225, 0);
  p.box(w, h * 0.42, d, '#e4e0d6', 0, h * 0.66, 0);
  p.box(w * 0.94, h * 0.1, d * 0.94, '#c9c5b9', 0, h * 0.92, 0);
  p.box(w * 0.4, 0.04, 0.01, '#2e3a46', 0, h * 0.72, d / 2 + 0.005, { emissive: '#3d6a9a', edges: false });
}

function buildCoffee(p: Parts, item: LabItem) {
  const { w, d, h } = item;
  p.box(w, h * 0.55, d, '#6b4f3b', 0, h * 0.275, 0);
  p.box(w * 0.92, h * 0.45, d * 0.92, '#2f3438', 0, h * 0.775, 0);
  p.cyl(0.04, 0.035, 0.07, '#f2efe8', 0, h * 0.55 + 0.035, d / 2 - 0.1);
  p.box(0.04, 0.02, 0.004, '#ee5a4a', w / 4, h * 0.9, d * 0.46 + 0.004, { emissive: '#ee5a4a', edges: false });
}

function buildFridge(p: Parts, item: LabItem) {
  const { w, d, h } = item;
  p.box(w, h, d, '#e7e4dc', 0, h / 2, 0);
  p.box(w + 0.004, 0.012, d + 0.004, '#b9b6ae', 0, h * 0.7, 0, { edges: false });
  p.box(0.025, 0.3, 0.025, '#8c9298', w / 2 - 0.07, h * 0.45, d / 2 + 0.015);
}

function buildHeater(p: Parts, item: LabItem) {
  const { w, d, h } = item;
  p.box(w, h, d, '#3a3f45', 0, h / 2, 0);
  p.box(w * 0.82, h * 0.6, 0.012, '#ff8a3a', 0, h * 0.52, d / 2 + 0.006, { emissive: '#ff5a14', emissiveIntensity: 1.6, edges: false });
  const sprite = new THREE.Sprite(p.raw(new THREE.SpriteMaterial({ map: glowTexture(), color: '#ff7a30', blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.6, toneMapped: false })));
  sprite.scale.set(1.6, 1.2, 1);
  sprite.position.set(0, h * 0.5, d / 2 + 0.25);
  p.root.add(sprite);
}

function buildShelf(p: Parts, item: LabItem, color: string) {
  const { w, d, h } = item;
  p.box(0.03, h, d, color, -(w / 2 - 0.015), h / 2, 0);
  p.box(0.03, h, d, color, w / 2 - 0.015, h / 2, 0);
  p.box(w, h, 0.01, color, 0, h / 2, -d / 2 + 0.005);
  const levels = [0, 1, 2, 3, 4].map((i) => 0.015 + (i * (h - 0.03)) / 4);
  levels.forEach((y) => p.box(w - 0.06, 0.03, d, color, 0, y, 0));
  const count = clamp(Math.round((item.loadKg ?? 0) / 6), 0, 16);
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / 4);
    const x = -w / 2 + 0.2 + (i % 4) * ((w - 0.4) / 3);
    p.box(0.2, 0.2, d * 0.7, BOX_COLORS[i % BOX_COLORS.length], x, levels[Math.min(row, 3)] + 0.115, 0.02);
  }
}

function buildRouter(p: Parts, item: LabItem) {
  const { w, d, h } = item;
  p.box(w, h, d, '#2b2f33', 0, h / 2, 0);
  [-1, 1].forEach((s) => p.cyl(0.01, 0.01, 0.2, '#1d2023', s * (w / 3), h + 0.1, -d / 4));
  p.box(0.02, 0.012, 0.004, '#5fd38d', w / 3, h / 2, d / 2 + 0.003, { emissive: '#5fd38d', edges: false });
}

function buildAc(p: Parts, item: LabItem) {
  const { w, d, h } = item;
  p.box(w, h, d, '#e9e9e4', 0, h / 2, 0);
  p.box(w * 0.92, h * 0.14, 0.012, '#9aa0a5', 0, h * 0.22, d / 2 + 0.002, { edges: false });
  p.box(0.03, 0.015, 0.004, '#5fd38d', w * 0.4, h * 0.7, d / 2 + 0.003, { emissive: '#5fd38d', edges: false });
}

const BAND: Record<string, { color: string; height: number }> = {
  water: { color: '#f2ead3', height: 0.16 },
  co2: { color: '#1b1b1d', height: 0.1 },
  foam: { color: '#f2ead3', height: 0.07 },
  powder: { color: '#2f64b8', height: 0.1 },
};

function buildExtinguisher(p: Parts, item: LabItem) {
  const h = item.h;
  const r = Math.min(item.w, item.d) * 0.36;
  const band = BAND[item.extinguisher ?? 'co2'];
  p.cyl(r, r, h * 0.68, '#c1272d', 0, h * 0.34, 0, { roughness: 0.45 });
  p.cyl(r * 0.4, r, h * 0.1, '#c1272d', 0, h * 0.73, 0);
  p.cyl(r * 0.5, r * 0.5, h * 0.1, '#232427', 0, h * 0.83, 0);
  p.box(r * 1.8, 0.02, 0.03, '#232427', 0, h * 0.92, 0);
  p.cyl(r * 1.03, r * 1.03, band.height, band.color, 0, h * 0.42, 0, { edges: false });
}

function buildItem(p: Parts, item: LabItem, design: LabDesign) {
  const desk = DESK_COLORS[design.materials.desk] ?? '#d9d2c3';
  const shelf = SHELF_COLORS[design.materials.shelf] ?? '#c9a574';
  const builders: Record<string, () => void> = {
    desk: () => buildDesk(p, item, desk),
    chair: () => buildChair(p, item),
    pc: () => buildPc(p, item),
    printer: () => buildPrinter(p, item),
    coffee: () => buildCoffee(p, item),
    fridge: () => buildFridge(p, item),
    heater: () => buildHeater(p, item),
    shelf: () => buildShelf(p, item, shelf),
    router: () => buildRouter(p, item),
    ac: () => buildAc(p, item),
    extinguisher: () => buildExtinguisher(p, item),
  };
  builders[item.kind]();
}

interface RoomView { sig: string; parts: Parts; walls: Record<Wall, THREE.Group>; cuts: Record<Wall, number>; ceiling: THREE.Mesh; subfloor: THREE.MeshBasicMaterial }

function buildWalls(p: Parts, room: LabRoom) {
  const { width: W, depth: D, height: H } = room;
  const color = '#d6ccb8';
  const walls = { back: new THREE.Group(), front: new THREE.Group(), left: new THREE.Group(), right: new THREE.Group() };
  Object.values(walls).forEach((g) => p.root.add(g));
  p.box(W + 2 * WALL_T, H, WALL_T, color, 0, H / 2, -D / 2 - WALL_T / 2, { parent: walls.back, shadow: false });
  p.box(WALL_T, H, D, color, -W / 2 - WALL_T / 2, H / 2, 0, { parent: walls.left, shadow: false });
  p.box(WALL_T, H, D, color, W / 2 + WALL_T / 2, H / 2, 0, { parent: walls.right, shadow: false });
  const frontZ = D / 2 + WALL_T / 2;
  const gapL = room.door.x - room.door.width / 2;
  const gapR = room.door.x + room.door.width / 2;
  const left = gapL + W / 2 + WALL_T;
  const right = W / 2 + WALL_T - gapR;
  p.box(left, H, WALL_T, color, -W / 2 - WALL_T + left / 2, H / 2, frontZ, { parent: walls.front, shadow: false });
  p.box(right, H, WALL_T, color, W / 2 + WALL_T - right / 2, H / 2, frontZ, { parent: walls.front, shadow: false });
  p.box(room.door.width, H - DOOR_H, WALL_T, color, room.door.x, DOOR_H + (H - DOOR_H) / 2, frontZ, { parent: walls.front, shadow: false });
  [gapL + 0.03, gapR - 0.03].forEach((x) => p.box(0.06, DOOR_H, WALL_T + 0.04, '#8a6a4a', x, DOOR_H / 2, frontZ, { parent: walls.front, shadow: false }));
  p.box(room.door.width, 0.06, WALL_T + 0.04, '#8a6a4a', room.door.x, DOOR_H - 0.03, frontZ, { parent: walls.front, shadow: false });
  return walls;
}

function buildWallFixtures(p: Parts, room: LabRoom) {
  if (room.vent) {
    const g = new THREE.Group();
    g.position.copy(wallPosition(room, room.vent.wall, room.vent.x, room.vent.z, 2.3, 0));
    g.rotation.y = wallRotation(room.vent.wall);
    p.root.add(g);
    p.box(0.34, 0.22, 0.02, '#c9c9c4', 0, 0, 0.01, { parent: g, shadow: false });
    [-0.06, -0.02, 0.02, 0.06].forEach((y) => p.box(0.28, 0.012, 0.006, '#4a4d50', 0, y, 0.022, { parent: g, shadow: false, edges: false }));
  }
  const dp = room.dataPoint;
  const g = new THREE.Group();
  g.position.copy(wallPosition(room, dp.wall, dp.x, dp.z, SOCKET_Y, 0));
  g.rotation.y = wallRotation(dp.wall);
  p.root.add(g);
  p.box(0.09, 0.09, 0.015, '#bcd9f5', 0, 0, 0.0075, { parent: g, shadow: false });
  [-0.02, 0.02].forEach((x) => p.box(0.025, 0.025, 0.006, '#23272b', x, 0, 0.017, { parent: g, shadow: false, edges: false }));
  const marker = p.mesh(new THREE.CircleGeometry(0.07, 16).rotateX(-Math.PI / 2), p.raw(new THREE.MeshBasicMaterial({ color: DATA_COLOR, toneMapped: false })), 0, 0, 0, { edges: false, shadow: false });
  const top = wallPosition(room, dp.wall, dp.x, dp.z, CUT_H + 0.012, -WALL_T / 2);
  marker.position.copy(top);
  marker.userData.planOnly = true;
}

function buildRoom(xray: XrayLayer, room: LabRoom, floorId: string): RoomView {
  const p = new Parts(xray);
  const { width: W, depth: D, height: H } = room;
  const floor = p.mesh(new THREE.PlaneGeometry(W, D).rotateX(-Math.PI / 2), p.mat(FLOOR_COLORS[floorId] ?? '#b3a48a', { roughness: 0.9 }), 0, 0, 0, { shadow: false });
  floor.renderOrder = -1;
  const subfloor = p.raw(new THREE.MeshBasicMaterial({ color: '#142030', transparent: true, opacity: 0 }));
  p.mesh(new THREE.PlaneGeometry(W + 2 * WALL_T, D + 2 * WALL_T).rotateX(-Math.PI / 2), subfloor, 0, -0.08, 0, { edges: false, shadow: false });
  const walls = buildWalls(p, room);
  buildWallFixtures(p, room);
  const ceiling = p.mesh(new THREE.PlaneGeometry(W, D).rotateX(Math.PI / 2), p.mat('#e8e3d8', { roughness: 1, emissive: '#cfc8b8', emissiveIntensity: 0.7 }), 0, H, 0, { shadow: false });
  ceiling.userData.walkOnly = true;
  return { sig: '', parts: p, walls, cuts: { back: 0, front: 0, left: 0, right: 0 }, ceiling, subfloor };
}

interface ItemView { sig: string; parts: Parts; group: THREE.Group; hull: THREE.Mesh; halo: THREE.Mesh | null; label: THREE.Sprite | null }
interface SocketView { parts: Parts; group: THREE.Group; ring: THREE.MeshBasicMaterial; glow: THREE.MeshBasicMaterial; marker: THREE.Mesh; wall: Wall }
interface CableView { sig: string; group: THREE.Group; thick: THREE.Mesh; thin: THREE.Mesh; hit: THREE.Mesh; thickMat: THREE.MeshBasicMaterial; thinMat: THREE.MeshBasicMaterial; channel: string; kind: 'power' | 'data'; itemId: string; mid: Pt }
interface CircuitView { sig: string; group: THREE.Group; mats: THREE.MeshBasicMaterial[]; sprites: THREE.Sprite[]; geos: THREE.BufferGeometry[] }
interface DragState { type: 'item' | 'socket' | 'via'; id: string; planeY: number; offX: number; offZ: number; wall: Wall | null; last: string }

function itemOrientation(item: LabItem, design: LabDesign) {
  if (WALL_KINDS.has(item.kind)) return wallRotation(nearestWall(design.room, item.x, item.z));
  const base = radians(item.rotation);
  const other = (kind: string) => design.items.filter((o) => o.kind === kind).sort((a, b) => Math.hypot(a.x - item.x, a.z - item.z) - Math.hypot(b.x - item.x, b.z - item.z))[0];
  if (item.kind === 'chair') {
    const desk = other('desk');
    return desk ? Math.atan2(desk.x - item.x, desk.z - item.z) : base;
  }
  if (item.kind === 'desk') {
    const chair = other('chair');
    const a = radians(item.rotation % 180);
    if (!chair) return base;
    return Math.sin(a) * (chair.x - item.x) + Math.cos(a) * (chair.z - item.z) < 0 ? a + Math.PI : a;
  }
  return base;
}

export function createLabScene(container: HTMLElement, callbacks: LabSceneCallbacks): LabScene {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const dom = renderer.domElement;
  dom.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;outline:none';
  dom.tabIndex = 0;
  container.appendChild(dom);

  const scene = new THREE.Scene();
  scene.background = BG.clone();
  const world = new THREE.Group();
  scene.add(world);
  const xray = new XrayLayer();

  scene.add(new THREE.HemisphereLight('#e5eff4', '#8d7f65', 0.7));
  const sun = new THREE.DirectionalLight('#fff4de', 1.8);
  sun.position.set(2, 8, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 0.5, far: 20 });
  sun.shadow.normalBias = 0.012;
  sun.shadow.radius = 3;
  scene.add(sun);
  const fill = new THREE.DirectionalLight('#d8e4e0', 0.4);
  fill.position.set(-4, 5, -3);
  scene.add(fill);

  const planCamera = new THREE.OrthographicCamera(-4, 4, 4, -4, 0.1, 60);
  const orbitCamera = new THREE.PerspectiveCamera(52, 1, 0.05, 100);
  const walkCamera = new THREE.PerspectiveCamera(70, 1, 0.05, 100);
  walkCamera.rotation.order = 'YXZ';
  let camera: THREE.Camera = orbitCamera;
  const controls = new OrbitControls(orbitCamera, dom);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;
  controls.minDistance = 1.5;
  controls.maxDistance = 16;
  controls.maxPolarAngle = Math.PI * 0.49;

  let current: LabDesign | null = null;
  let mode: LabViewMode = 'orbit';
  let xrayOn = false;
  let xrayT = 0;
  let selectedId: string | null = null;
  let highlighted = new Set<string>();
  let changed = new Set<string>();
  let badgeSig = '';
  const badges: THREE.Sprite[] = [];
  let room: RoomView | null = null;
  let disposed = false;
  let raf = 0;
  let last = performance.now();
  let clock = 0;
  let size = { w: 1, h: 1 };
  const walk = { x: 0, z: 0, yaw: 0, pitch: 0 };
  const keys = new Set<string>();
  const itemViews = new Map<string, ItemView>();
  const socketViews = new Map<string, SocketView>();
  const cableViews = new Map<string, CableView>();
  const handles = new Map<string, THREE.Mesh>();
  const circuits: { view: CircuitView | null } = { view: null };
  const socketColors = new Map<string, string>();
  const handleMat = new THREE.MeshBasicMaterial({ color: GOLD, toneMapped: false });
  const handleGeo = new THREE.SphereGeometry(0.055, 14, 10);

  function roomOrDefault(): LabRoom {
    return current?.room ?? { width: 6, depth: 5, height: 2.7, door: { x: 0, width: 0.9 }, dataPoint: { wall: 'back', x: 0, z: -2.5 } };
  }

  function syncRoom(design: LabDesign) {
    const r = design.room;
    const sig = JSON.stringify([r.width, r.depth, r.height, r.door, r.vent, r.dataPoint, design.materials.floor]);
    if (room?.sig === sig) return;
    room?.parts.dispose();
    room = buildRoom(xray, r, design.materials.floor);
    room.sig = sig;
    world.add(room.parts.root);
    shadowDirty();
    if (!current) resetView();
  }

  function shadowDirty() {
    renderer.shadowMap.needsUpdate = true;
  }

  function markPicks(root: THREE.Object3D, pick: Pick) {
    root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.userData.pick = pick;
    });
  }

  function makeHull(item: LabItem, height: number) {
    const geo = new THREE.BoxGeometry(item.w + 0.1, height + 0.08, item.d + 0.1);
    const hull = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: GOLD, side: THREE.BackSide, transparent: true, depthWrite: false, toneMapped: false }));
    hull.position.y = height / 2;
    hull.visible = false;
    const outline = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: GOLD, toneMapped: false }));
    hull.add(outline);
    return hull;
  }

  function makeHalo(item: LabItem) {
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(item.w + 0.24, item.d + 0.24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.4, depthWrite: false, toneMapped: false }));
    halo.position.y = 0.006;
    halo.visible = false;
    return halo;
  }

  function buildItemView(item: LabItem, design: LabDesign, sig: string): ItemView {
    const parts = new Parts(xray);
    buildItem(parts, item, design);
    markPicks(parts.root, { type: 'item', id: item.id });
    const group = new THREE.Group();
    group.add(parts.root);
    const height = item.kind === 'desk' ? item.h + 0.5 : item.h;
    const hull = makeHull(item, height);
    const halo = WALL_KINDS.has(item.kind) ? null : makeHalo(item);
    group.add(hull);
    if (halo) group.add(halo);
    let label: THREE.Sprite | null = null;
    if (item.kind !== 'chair' && item.kind !== 'pc') {
      label = labelSprite(item.name, '#f4efe2', 'rgba(30,38,34,0.78)', 0.14);
      label.position.set(0, item.h + 0.3, 0);
      group.add(label);
    }
    world.add(group);
    return { sig, parts, group, hull, halo, label };
  }

  function disposeItemView(view: ItemView) {
    view.parts.dispose();
    view.group.removeFromParent();
    const outline = view.hull.children[0] as THREE.LineSegments;
    outline.geometry.dispose();
    (outline.material as THREE.Material).dispose();
    [view.hull, view.halo].forEach((m) => {
      if (m) {
        (m.material as THREE.Material).dispose();
        m.geometry.dispose();
      }
    });
    if (view.label) disposeSprite(view.label);
  }

  function syncBadges(design: LabDesign, changes: { itemId: string; label: string }[]) {
    const placed = changes.map((change) => ({ change, item: design.items.find((each) => each.id === change.itemId) })).filter((each) => each.item);
    const sig = JSON.stringify(placed.map(({ change, item }) => [change.label, item!.x, item!.z, item!.h, item!.kind]));
    if (sig === badgeSig) return;
    badgeSig = sig;
    badges.splice(0).forEach(disposeSprite);
    const labels = new Map<string, { item: LabItem; text: string[] }>();
    placed.forEach(({ change, item }) => {
      const entry = labels.get(item!.id) ?? { item: item!, text: [] };
      entry.text.push(change.label);
      labels.set(item!.id, entry);
    });
    labels.forEach(({ item, text }) => {
      const sprite = labelSprite(text.join(' '), '#14201a', CHANGED, 0.26);
      const turned = item.rotation === 90 || item.rotation === 270;
      const hw = (turned ? item.d : item.w) / 2;
      const hd = (turned ? item.w : item.d) / 2;
      sprite.position.set(item.x + hw, (WALL_KINDS.has(item.kind) ? mountHeight(item) : 0) + item.h + 0.3, item.z - hd);
      world.add(sprite);
      badges.push(sprite);
    });
  }

  function syncItems(design: LabDesign) {
    const seen = new Set<string>();
    design.items.forEach((item) => {
      seen.add(item.id);
      const sig = [item.kind, item.w, item.d, item.h, item.loadKg ?? 0, item.extinguisher ?? '', item.name, design.materials.desk, design.materials.shelf].join('|');
      let view = itemViews.get(item.id);
      if (!view || view.sig !== sig) {
        if (view) disposeItemView(view);
        view = buildItemView(item, design, sig);
        itemViews.set(item.id, view);
      }
      view.group.position.set(item.x, WALL_KINDS.has(item.kind) ? mountHeight(item) : 0, item.z);
      view.group.rotation.y = itemOrientation(item, design);
    });
    itemViews.forEach((view, id) => {
      if (!seen.has(id)) {
        disposeItemView(view);
        itemViews.delete(id);
      }
    });
    shadowDirty();
  }

  function buildSocketView(socket: LabSocket): SocketView {
    const parts = new Parts(xray);
    const group = new THREE.Group();
    group.add(parts.root);
    parts.box(0.09, 0.09, 0.015, '#f4f1ea', 0, 0, 0.0075, { shadow: false });
    const ring = parts.raw(new THREE.MeshBasicMaterial({ color: LOAD_COLORS.ok, toneMapped: false }));
    parts.mesh(new THREE.TorusGeometry(0.06, 0.009, 8, 28), ring, 0, 0, 0.017, { edges: false, shadow: false });
    const glow = parts.raw(new THREE.MeshBasicMaterial({ color: LOAD_COLORS.ok, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    parts.mesh(new THREE.CircleGeometry(0.2, 24), glow, 0, 0, 0.004, { edges: false, shadow: false });
    const marker = new THREE.Mesh(new THREE.CircleGeometry(0.11, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: LOAD_COLORS.ok, toneMapped: false }));
    markPicks(group, { type: 'socket', id: socket.id });
    markPicks(marker, { type: 'socket', id: socket.id });
    world.add(group, marker);
    return { parts, group, ring, glow, marker, wall: socket.wall };
  }

  function disposeSocketView(view: SocketView) {
    view.parts.dispose();
    view.group.removeFromParent();
    view.marker.removeFromParent();
    view.marker.geometry.dispose();
    (view.marker.material as THREE.Material).dispose();
  }

  function syncSockets(design: LabDesign) {
    const seen = new Set<string>();
    design.sockets.forEach((socket) => {
      seen.add(socket.id);
      let view = socketViews.get(socket.id);
      if (!view) {
        view = buildSocketView(socket);
        socketViews.set(socket.id, view);
      }
      view.wall = socket.wall;
      view.group.position.copy(wallPosition(design.room, socket.wall, socket.x, socket.z, SOCKET_Y, 0.002));
      view.group.rotation.y = wallRotation(socket.wall);
      const color = socketColors.get(socket.id) ?? LOAD_COLORS.ok;
      view.ring.color.set(color);
      view.glow.color.set(color);
      (view.marker.material as THREE.MeshBasicMaterial).color.set(color);
      view.marker.position.copy(wallPosition(design.room, socket.wall, socket.x, socket.z, CUT_H + 0.012, -WALL_T / 2));
    });
    socketViews.forEach((view, id) => {
      if (!seen.has(id)) {
        disposeSocketView(view);
        socketViews.delete(id);
      }
    });
  }

  function buildCableView(cable: CablePath, sig: string, design: LabDesign): CableView {
    const pts = cableVectors(cable, design.room);
    const group = new THREE.Group();
    const color = cable.kind === 'data' ? DATA_COLOR : LOAD_COLORS.ok;
    const thickMat = new THREE.MeshBasicMaterial({ color, toneMapped: false, transparent: true });
    const thinMat = new THREE.MeshBasicMaterial({ color: '#25282b', toneMapped: false, transparent: true });
    const hitMat = new THREE.MeshBasicMaterial({ visible: false });
    const thick = new THREE.Mesh(tubeGeometry(pts, cable.kind === 'data' ? 0.011 : 0.016), thickMat);
    const thin = new THREE.Mesh(tubeGeometry(pts, 0.005), thinMat);
    const hit = new THREE.Mesh(tubeGeometry(pts, 0.05), hitMat);
    thick.renderOrder = 5;
    thin.renderOrder = 5;
    hit.userData.pick = { type: 'cable', id: cable.itemId, cableKind: cable.kind } satisfies Pick;
    group.add(thick, thin, hit);
    world.add(group);
    return { sig, group, thick, thin, hit, thickMat, thinMat, channel: cable.channel, kind: cable.kind, itemId: cable.itemId, mid: pointAlong(cable.points, 0.5) };
  }

  function disposeCableView(view: CableView) {
    view.group.removeFromParent();
    [view.thick, view.thin, view.hit].forEach((m) => {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    });
  }

  function syncCables(design: LabDesign, rep: LabReport) {
    const seen = new Set<string>();
    const owner = new Map(design.items.map((i) => [i.id, i]));
    rep.cables.forEach((cable) => {
      seen.add(cable.id);
      const sig = `${cable.kind}|${cable.channel}|${cable.itemId}|${cable.points.map((p) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`).join(';')}`;
      let view = cableViews.get(cable.id);
      if (!view || view.sig !== sig) {
        if (view) disposeCableView(view);
        view = buildCableView(cable, sig, design);
        cableViews.set(cable.id, view);
      }
      if (cable.kind === 'power') view.thickMat.color.set(socketColors.get(owner.get(cable.itemId)?.socketId ?? '') ?? '#cfd6dd');
    });
    cableViews.forEach((view, id) => {
      if (!seen.has(id)) {
        disposeCableView(view);
        cableViews.delete(id);
      }
    });
    syncHandles(design);
  }

  function syncHandles(design: LabDesign) {
    const wanted = new Map<string, CableView>();
    cableViews.forEach((view) => {
      if (view.channel === 'wall') return;
      const prior = wanted.get(view.itemId);
      if (!prior || (prior.kind === 'data' && view.kind === 'power')) wanted.set(view.itemId, view);
    });
    wanted.forEach((view, itemId) => {
      const item = design.items.find((i) => i.id === itemId);
      const at = item?.via ?? view.mid;
      let handle = handles.get(itemId);
      if (!handle) {
        handle = new THREE.Mesh(handleGeo, handleMat);
        handle.userData.pick = { type: 'via', id: itemId } satisfies Pick;
        handle.renderOrder = 6;
        world.add(handle);
        handles.set(itemId, handle);
      }
      handle.position.set(at[0], view.channel === 'floor' ? -0.01 : 0.05, at[1]);
    });
    handles.forEach((handle, id) => {
      if (!wanted.has(id)) {
        handle.removeFromParent();
        handles.delete(id);
      }
    });
  }

  function disposeCircuits() {
    const view = circuits.view;
    if (!view) return;
    view.group.removeFromParent();
    view.geos.forEach((g) => g.dispose());
    view.mats.forEach((m) => m.dispose());
    view.sprites.forEach(disposeSprite);
    circuits.view = null;
  }

  function syncCircuits(design: LabDesign) {
    const sig = JSON.stringify([design.room.width, design.room.depth, design.circuits.map((c) => c.id), design.sockets.map((s) => [s.wall, s.x, s.z, s.circuitId])]);
    if (circuits.view?.sig === sig) return;
    disposeCircuits();
    const view: CircuitView = { sig, group: new THREE.Group(), mats: [], sprites: [], geos: [] };
    design.circuits.forEach((circuit, index) => {
      const own = design.sockets.filter((s) => s.circuitId === circuit.id);
      if (!own.length) return;
      const color = CIRCUIT_COLORS[index % CIRCUIT_COLORS.length];
      const material = new THREE.MeshBasicMaterial({ color, toneMapped: false, transparent: true });
      view.mats.push(material);
      const path = circuitPath(design.room, own);
      const geo = tubeGeometry(path.map(([x, z]) => new THREE.Vector3(x, 0.5, z)), 0.01);
      view.geos.push(geo);
      const line = new THREE.Mesh(geo, material);
      line.renderOrder = 5;
      view.group.add(line);
      const first = own[0];
      const sprite = labelSprite(circuit.id.toUpperCase(), '#1b1f1d', color, 0.22);
      sprite.position.copy(wallPosition(design.room, first.wall, first.x, first.z, 0.62, 0.15));
      view.sprites.push(sprite);
      view.group.add(sprite);
    });
    circuits.view = view;
    world.add(view.group);
  }

  const drillGroup = new THREE.Group();
  world.add(drillGroup);
  const drillState = {
    texture: null as THREE.DataTexture | null,
    data: null as Uint8Array | null,
    key: '',
    layers: [] as THREE.Mesh[],
    flame: new THREE.Group(),
    flameSprite: null as THREE.Sprite | null,
    people: new Map<string, THREE.Mesh>(),
    peopleGeo: new THREE.CapsuleGeometry(0.17, 0.8, 4, 12),
    headGeo: new THREE.SphereGeometry(0.12, 14, 10),
    flameGeos: [new THREE.ConeGeometry(0.13, 0.4, 12), new THREE.ConeGeometry(0.07, 0.26, 10)],
    flameMats: [new THREE.MeshBasicMaterial({ color: '#ff7a1f', toneMapped: false }), new THREE.MeshBasicMaterial({ color: '#ffd45a', toneMapped: false })],
  };
  drillState.flame.add(new THREE.Mesh(drillState.flameGeos[0], drillState.flameMats[0]));
  const inner = new THREE.Mesh(drillState.flameGeos[1], drillState.flameMats[1]);
  inner.position.y = -0.03;
  drillState.flame.add(inner);
  drillState.flameSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#ff8a2a', blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.7, toneMapped: false }));
  drillState.flameSprite.scale.set(1.4, 1.4, 1);
  drillState.flame.add(drillState.flameSprite);
  drillGroup.add(drillState.flame);
  drillGroup.visible = false;

  function ensureSmoke(drill: DrillView) {
    const key = `${drill.cols}x${drill.rows}x${drill.cell}x${drill.originX}x${drill.originZ}`;
    if (drillState.key === key) return;
    drillState.layers.forEach((m) => {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
      m.removeFromParent();
    });
    drillState.texture?.dispose();
    drillState.data = new Uint8Array(drill.cols * drill.rows * 4);
    drillState.texture = new THREE.DataTexture(drillState.data, drill.cols, drill.rows, THREE.RGBAFormat);
    drillState.texture.magFilter = THREE.LinearFilter;
    drillState.texture.minFilter = THREE.LinearFilter;
    drillState.texture.colorSpace = THREE.SRGBColorSpace;
    drillState.texture.needsUpdate = true;
    drillState.layers = [[2.35, 0.42], [1.8, 0.3], [1.2, 0.16]].map(([y, opacity]) => {
      const mat = new THREE.MeshBasicMaterial({ map: drillState.texture, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(drill.cols * drill.cell, drill.rows * drill.cell).rotateX(-Math.PI / 2), mat);
      mesh.position.set(drill.originX + (drill.cols * drill.cell) / 2, y, drill.originZ + (drill.rows * drill.cell) / 2);
      mesh.renderOrder = 8;
      drillGroup.add(mesh);
      return mesh;
    });
    drillState.key = key;
  }

  function fillSmoke(drill: DrillView) {
    const data = drillState.data!;
    for (let row = 0; row < drill.rows; row++) {
      for (let col = 0; col < drill.cols; col++) {
        const density = clamp((drill.t - drill.arrival[row * drill.cols + col]) / 3, 0, 1);
        const at = ((drill.rows - 1 - row) * drill.cols + col) * 4;
        data[at] = 92;
        data[at + 1] = 94;
        data[at + 2] = 100;
        data[at + 3] = Number.isFinite(density) ? Math.round(density * 255) : 0;
      }
    }
    drillState.texture!.needsUpdate = true;
  }

  function personAt(path: Pt[], distance: number): Pt {
    let left = distance;
    for (let i = 0; i < path.length - 1; i++) {
      const len = Math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]);
      if (left <= len) {
        const f = len > 0 ? left / len : 0;
        return [path[i][0] + (path[i + 1][0] - path[i][0]) * f, path[i][1] + (path[i + 1][1] - path[i][1]) * f];
      }
      left -= len;
    }
    return path[path.length - 1] ?? [0, 0];
  }

  function syncPeople(drill: DrillView) {
    const seen = new Set<string>();
    drill.people.forEach((person) => {
      seen.add(person.itemId);
      let mesh = drillState.people.get(person.itemId);
      if (!mesh) {
        mesh = new THREE.Mesh(drillState.peopleGeo, new THREE.MeshStandardMaterial({ color: '#4fc477', roughness: 0.6 }));
        const head = new THREE.Mesh(drillState.headGeo, mesh.material);
        head.position.y = 0.62;
        mesh.add(head);
        mesh.castShadow = true;
        drillGroup.add(mesh);
        drillState.people.set(person.itemId, mesh);
      }
      const [x, z] = personAt(person.path, Math.max(0, drill.t - REACTION_S) * WALK_SPEED);
      mesh.position.set(x, 0.57, z);
      const blocked = person.blockedS !== null && drill.t >= person.blockedS;
      (mesh.material as THREE.MeshStandardMaterial).color.set(blocked ? '#ee4b3f' : '#4fc477');
    });
    drillState.people.forEach((mesh, id) => {
      if (!seen.has(id)) {
        (mesh.material as THREE.Material).dispose();
        mesh.removeFromParent();
        drillState.people.delete(id);
      }
    });
  }

  function syncDrill(drill: DrillView | null | undefined) {
    drillGroup.visible = !!drill;
    if (!drill) return;
    ensureSmoke(drill);
    fillSmoke(drill);
    drillState.flame.position.set(drill.start[0], 0.3, drill.start[1]);
    drillState.flame.children[0].scale.setScalar(1.5);
    syncPeople(drill);
  }

  function socketColorMap(rep: LabReport) {
    socketColors.clear();
    rep.meters.sockets.forEach((s) => socketColors.set(s.socketId, loadColor(s.watts, s.limitW)));
  }

  function fitPlan() {
    const r = roomOrDefault();
    const aspect = size.w / Math.max(1, size.h);
    const halfH = Math.max((r.depth + 1.4) / 2, (r.width + 1.4) / 2 / aspect);
    Object.assign(planCamera, { left: -halfH * aspect, right: halfH * aspect, top: halfH, bottom: -halfH });
    planCamera.up.set(0, 0, -1);
    planCamera.position.set(0, 20, 0);
    planCamera.lookAt(0, 0, 0);
    planCamera.updateProjectionMatrix();
  }

  function resetWalk() {
    const r = roomOrDefault();
    walk.x = r.door.x;
    walk.z = r.depth / 2 - 0.5;
    walk.yaw = 0;
    walk.pitch = 0;
    applyWalk();
  }

  function applyWalk() {
    walkCamera.position.set(walk.x, EYE_HEIGHT, walk.z);
    walkCamera.rotation.set(walk.pitch, walk.yaw, 0);
  }

  function resetOrbit() {
    const r = roomOrDefault();
    orbitCamera.position.set(r.width * 0.5, Math.max(r.width, r.depth) * 0.72, r.depth * 1.05);
    controls.target.set(0, 0.5, 0);
    controls.update();
  }

  function resetView() {
    fitPlan();
    resetOrbit();
    resetWalk();
  }

  function setMode(next: LabViewMode) {
    mode = next;
    camera = next === 'plan' ? planCamera : next === 'walk' ? walkCamera : orbitCamera;
    if (next === 'walk') applyWalk();
  }

  function resize() {
    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    size = { w, h };
    renderer.setSize(w, h, false);
    orbitCamera.aspect = w / h;
    walkCamera.aspect = w / h;
    orbitCamera.updateProjectionMatrix();
    walkCamera.updateProjectionMatrix();
    fitPlan();
  }

  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();
  resetView();

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hitPoint = new THREE.Vector3();
  let drag: DragState | null = null;
  let down: { x: number; y: number; hit: Pick | null; look: boolean } | null = null;
  let moved = false;

  function aim(e: PointerEvent) {
    const rect = dom.getBoundingClientRect();
    ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
  }

  function ground(y: number) {
    plane.constant = -y;
    return raycaster.ray.intersectPlane(plane, hitPoint) ? hitPoint : null;
  }

  function collect(type: PickType) {
    const out: THREE.Mesh[] = [];
    const visit = (o: THREE.Object3D) => {
      if (!o.visible) return;
      const pick = o.userData.pick as Pick | undefined;
      if ((o as THREE.Mesh).isMesh && pick?.type === type) out.push(o as THREE.Mesh);
      o.children.forEach(visit);
    };
    visit(world);
    return out;
  }

  function pickAt(): Pick | null {
    const order: PickType[] = xrayOn ? ['via', 'socket', 'cable', 'item'] : ['item'];
    for (const type of order) {
      const hit = raycaster.intersectObjects(collect(type), false)[0];
      if (hit) return hit.object.userData.pick as Pick;
    }
    return null;
  }

  function beginDrag(pick: Pick, e: PointerEvent) {
    const design = current;
    if (!design) return;
    if (pick.type === 'item') {
      const item = design.items.find((i) => i.id === pick.id);
      if (!item || item.locked) return;
      const at = ground(0);
      if (!at) return;
      drag = { type: 'item', id: item.id, planeY: 0, offX: item.x - at.x, offZ: item.z - at.z, wall: WALL_KINDS.has(item.kind) ? nearestWall(design.room, item.x, item.z) : null, last: '' };
    } else if (pick.type === 'socket') {
      drag = { type: 'socket', id: pick.id, planeY: SOCKET_Y, offX: 0, offZ: 0, wall: null, last: '' };
    } else {
      drag = { type: 'via', id: pick.id, planeY: 0, offX: 0, offZ: 0, wall: null, last: '' };
    }
    controls.enabled = false;
    dom.setPointerCapture(e.pointerId);
    dom.style.cursor = 'grabbing';
  }

  function emitItemMove(d: DragState, at: THREE.Vector3, design: LabDesign) {
    const item = design.items.find((i) => i.id === d.id);
    if (!item) return;
    const r = design.room;
    let target: Pt;
    if (d.wall) {
      target = constrainToWall(r, d.wall, at.x + d.offX, at.z + d.offZ, (d.wall === 'back' || d.wall === 'front' ? item.w : item.d) / 2 + 0.05);
      target = d.wall === 'back' || d.wall === 'front' ? [target[0], item.z] : [item.x, target[1]];
    } else {
      const e = extents(item);
      target = [clamp(snap(at.x + d.offX), -r.width / 2 + e.w / 2, r.width / 2 - e.w / 2), clamp(snap(at.z + d.offZ), -r.depth / 2 + e.d / 2, r.depth / 2 - e.d / 2)];
    }
    const key = target.join(',');
    if (key === d.last) return;
    d.last = key;
    callbacks.onMoveItem(d.id, target[0], target[1]);
  }

  function emitDrag(e: PointerEvent) {
    const design = current;
    if (!drag || !design) return;
    aim(e);
    const at = ground(drag.planeY);
    if (!at) return;
    if (drag.type === 'item') return emitItemMove(drag, at, design);
    const r = design.room;
    let target: Pt;
    if (drag.type === 'socket') {
      const socket = design.sockets.find((s) => s.id === drag!.id);
      if (!socket) return;
      target = constrainToWall(r, socket.wall, at.x, at.z, 0.2);
    } else {
      target = [clamp(snap(at.x), -r.width / 2 + 0.05, r.width / 2 - 0.05), clamp(snap(at.z), -r.depth / 2 + 0.05, r.depth / 2 - 0.05)];
    }
    const key = target.join(',');
    if (key === drag.last) return;
    drag.last = key;
    if (drag.type === 'socket') callbacks.onMoveSocket(drag.id, target[0], target[1]);
    else callbacks.onMoveVia(drag.id, target[0], target[1]);
  }

  function onDown(e: PointerEvent) {
    if (e.button !== 0) return;
    dom.focus();
    moved = false;
    if (mode === 'walk') {
      down = { x: e.clientX, y: e.clientY, hit: null, look: true };
      dom.setPointerCapture(e.pointerId);
      return;
    }
    aim(e);
    const hit = pickAt();
    down = { x: e.clientX, y: e.clientY, hit, look: false };
    if (!hit) return;
    if (hit.type === 'cable') {
      callbacks.onPickCable?.(hit.id, hit.cableKind ?? 'power');
      return;
    }
    if (hit.type === 'item') callbacks.onSelect(hit.id);
    beginDrag(hit, e);
  }

  function onMove(e: PointerEvent) {
    if (!down) return;
    const dx = e.clientX - down.x;
    const dy = e.clientY - down.y;
    if (Math.hypot(dx, dy) > 4) moved = true;
    if (down.look) {
      walk.yaw -= (e.movementX || 0) * 0.004;
      walk.pitch = clamp(walk.pitch - (e.movementY || 0) * 0.004, -1.2, 1.2);
      applyWalk();
      return;
    }
    if (drag && moved) emitDrag(e);
  }

  function onUp(e: PointerEvent) {
    if (!down) return;
    const start = down;
    down = null;
    if (dom.hasPointerCapture(e.pointerId)) dom.releasePointerCapture(e.pointerId);
    dom.style.cursor = '';
    drag = null;
    controls.enabled = mode === 'orbit';
    if (moved) return;
    if (start.look) {
      aim(e);
      const hit = raycaster.intersectObjects(collect('item'), false)[0];
      callbacks.onSelect(hit ? (hit.object.userData.pick as Pick).id : null);
    } else if (!start.hit) {
      callbacks.onSelect(null);
    }
  }

  function typing(e: KeyboardEvent) {
    const tag = (e.target as HTMLElement | null)?.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  }

  function onKeyDown(e: KeyboardEvent) {
    if (mode !== 'walk' || typing(e) || e.metaKey || e.ctrlKey) return;
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
      keys.add(e.code);
      e.preventDefault();
    }
  }

  function onKeyUp(e: KeyboardEvent) {
    keys.delete(e.code);
  }

  dom.addEventListener('pointerdown', onDown, { capture: true });
  dom.addEventListener('pointermove', onMove);
  dom.addEventListener('pointerup', onUp);
  dom.addEventListener('pointercancel', onUp);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', () => keys.clear());

  function blockers() {
    return (current?.items ?? []).filter((i) => !SOFT_KINDS.has(i.kind) && i.kind !== 'extinguisher').map((i) => {
      const e = extents(i);
      return { x0: i.x - e.w / 2, x1: i.x + e.w / 2, z0: i.z - e.d / 2, z1: i.z + e.d / 2 };
    });
  }

  function walkBlocked(x: number, z: number, rects: ReturnType<typeof blockers>) {
    const r = roomOrDefault();
    if (Math.abs(x) > r.width / 2 - WALK_RADIUS || Math.abs(z) > r.depth / 2 - WALK_RADIUS) return true;
    return rects.some((b) => Math.hypot(x - clamp(x, b.x0, b.x1), z - clamp(z, b.z0, b.z1)) < WALK_RADIUS);
  }

  function stepWalk(dt: number) {
    if (mode !== 'walk') return;
    const turn = (keys.has('ArrowLeft') ? 1 : 0) - (keys.has('ArrowRight') ? 1 : 0);
    const forward = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    walk.yaw += turn * 1.8 * dt;
    if (forward || strafe) {
      const sin = Math.sin(walk.yaw);
      const cos = Math.cos(walk.yaw);
      const dx = (-sin * forward + cos * strafe) * WALK_MS * dt;
      const dz = (-cos * forward - sin * strafe) * WALK_MS * dt;
      const rects = blockers();
      if (!walkBlocked(walk.x + dx, walk.z, rects)) walk.x += dx;
      if (!walkBlocked(walk.x, walk.z + dz, rects)) walk.z += dz;
    }
    applyWalk();
  }

  function stepWalls(dt: number) {
    if (!room || !current) return;
    const r = current.room;
    const p = camera.position;
    const outside: Record<Wall, boolean> = { back: p.z < -r.depth / 2 - WALL_T, front: p.z > r.depth / 2 + WALL_T, left: p.x < -r.width / 2 - WALL_T, right: p.x > r.width / 2 + WALL_T };
    (Object.keys(room.walls) as Wall[]).forEach((wall) => {
      const target = mode === 'plan' ? 1 : mode === 'orbit' && !xrayOn && outside[wall] ? 1 : 0;
      room!.cuts[wall] += (target - room!.cuts[wall]) * Math.min(1, dt * 10);
      room!.walls[wall].scale.y = THREE.MathUtils.lerp(1, CUT_H / r.height, room!.cuts[wall]);
    });
  }

  function applyFade() {
    xray.set(xrayT);
    (scene.background as THREE.Color).copy(BG).lerp(BG_XRAY, xrayT);
    sun.shadow.intensity = 1 - 0.85 * xrayT;
    if (room) room.subfloor.opacity = 0.9 * xrayT;
    cableViews.forEach((v) => {
      v.thick.visible = xrayT > 0.01;
      v.thickMat.opacity = xrayT;
      v.thin.visible = v.channel === 'loose' && xrayT < 0.99;
      v.thinMat.opacity = 1 - xrayT;
      v.hit.visible = xrayOn;
    });
    handles.forEach((h) => (h.visible = xrayOn));
    socketViews.forEach((v) => {
      v.glow.opacity = 0.55 * xrayT;
      v.glow.visible = xrayT > 0.01;
    });
    if (circuits.view) {
      circuits.view.group.visible = xrayT > 0.01;
      circuits.view.mats.forEach((m) => (m.opacity = xrayT));
      circuits.view.sprites.forEach((s) => (s.material.opacity = xrayT));
    }
  }

  function applyModeVisibility() {
    const plan = mode === 'plan';
    itemViews.forEach((v) => {
      if (v.label) v.label.visible = plan;
    });
    socketViews.forEach((v) => {
      v.marker.visible = plan;
    });
    room?.parts.root.traverse((o) => {
      if (o.userData.planOnly) o.visible = plan;
      if (o.userData.walkOnly) o.visible = mode === 'walk';
    });
  }

  function applyHighlights() {
    const pulse = 0.5 + 0.5 * Math.sin(clock * 6);
    itemViews.forEach((view, id) => {
      const bad = highlighted.has(id);
      const gold = id === selectedId;
      const fresh = changed.has(id);
      const color = gold ? GOLD : bad ? ALERT : CHANGED;
      view.hull.visible = bad || gold || fresh;
      const hull = view.hull.material as THREE.MeshBasicMaterial;
      hull.color.set(color);
      hull.opacity = gold ? 0.2 : 0.1 + 0.2 * pulse;
      ((view.hull.children[0] as THREE.LineSegments).material as THREE.LineBasicMaterial).color.set(color);
      if (view.halo) {
        view.halo.visible = bad || gold || fresh;
        const halo = view.halo.material as THREE.MeshBasicMaterial;
        halo.color.set(color);
        halo.opacity = gold ? 0.4 : 0.3 + 0.35 * pulse;
      }
    });
  }

  function applyDrill() {
    const flicker = 1 + 0.15 * Math.sin(clock * 17) + 0.1 * Math.sin(clock * 29);
    drillState.flame.scale.set(flicker, 0.9 + 0.3 * Math.abs(Math.sin(clock * 11)), flicker);
  }

  function frame(now: number) {
    if (disposed) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    clock += dt;
    const target = xrayOn ? 1 : 0;
    const before = xrayT;
    xrayT = xrayT < target ? Math.min(target, xrayT + dt / XRAY_SECONDS) : Math.max(target, xrayT - dt / XRAY_SECONDS);
    if (before !== xrayT) applyFade();
    stepWalk(dt);
    stepWalls(dt);
    applyHighlights();
    if (drillGroup.visible) applyDrill();
    if (camera === orbitCamera) controls.update();
    renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(frame);

  return {
    update(state) {
      current = state.design;
      xrayOn = state.xray;
      selectedId = state.selectedId;
      highlighted = new Set(state.highlight ?? []);
      changed = new Set((state.changes ?? []).map((change) => change.itemId));
      syncBadges(state.design, state.changes ?? []);
      socketColorMap(state.report);
      syncRoom(state.design);
      syncItems(state.design);
      syncSockets(state.design);
      syncCables(state.design, state.report);
      syncCircuits(state.design);
      syncDrill(state.drill);
      setMode(state.mode);
      controls.enabled = mode === 'orbit' && !drag;
      applyModeVisibility();
      applyFade();
    },
    resetView,
    capture() {
      renderer.render(scene, camera);
      return dom.toDataURL('image/png');
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      dom.removeEventListener('pointerdown', onDown, { capture: true });
      dom.removeEventListener('pointermove', onMove);
      dom.removeEventListener('pointerup', onUp);
      dom.removeEventListener('pointercancel', onUp);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      controls.dispose();
      room?.parts.dispose();
      itemViews.forEach(disposeItemView);
      socketViews.forEach(disposeSocketView);
      cableViews.forEach(disposeCableView);
      disposeCircuits();
      handleGeo.dispose();
      handleMat.dispose();
      drillState.layers.forEach((m) => {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      });
      drillState.texture?.dispose();
      drillState.people.forEach((m) => (m.material as THREE.Material).dispose());
      [drillState.peopleGeo, drillState.headGeo, ...drillState.flameGeos, ...drillState.flameMats].forEach((d) => d.dispose());
      drillState.flameSprite?.material.dispose();
      glowMap?.dispose();
      glowMap = null;
      xray.edge.dispose();
      renderer.dispose();
      dom.remove();
    },
  };
}
