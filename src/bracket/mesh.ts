import * as THREE from 'three';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import type { BracketDesign, BracketId, MaterialId } from './model';
import { heightAt, MAX_HEIGHT_MM } from './engine';
import { BOSS_OD_MM, END_MARGIN_MM, LENGTH_MM, NUT_SPACING_MM, NUT_THREAD_MM, PILOT_HOLE_MM, SLOT_MM } from './spec';

export interface MaterialLook { color: string; roughness: number; metalness: number }

export const MATERIAL_LOOK: Record<MaterialId, MaterialLook> = {
  'ti64-lpbf': { color: '#8c8782', roughness: 0.5, metalness: 0.6 },
  'alsi10mg-lpbf': { color: '#c3c9ce', roughness: 0.42, metalness: 0.7 },
  'ss316l-lpbf': { color: '#e6eaee', roughness: 0.22, metalness: 0.9 },
  'pa12-sls': { color: '#ece5d3', roughness: 0.78, metalness: 0 },
};

export const HI_SEG = 40;
export const LO_SEG = 8;
const WINDOWS = 5;
const WINDOW_SPAN: [number, number] = [34, LENGTH_MM - 34];
const WINDOW_GAP = 9;

export interface Layout {
  length: number;
  t: number;
  topWidth: number;
  lip: number;
  halfWidth: number;
  heightMax: number;
  noseX: number;
  tailX: number;
  pilot: { x: number; y: number; d: number };
  slot: { x: number; y: number; w: number; l: number };
  bosses: number[];
  bossHeight: number;
}

export const topAt = (x: number) => heightAt(x);

export function layoutOf(design: BracketDesign): Layout {
  const t = design.thickness;
  const w = design.topWidth;
  const f = design.lipWidth;
  const outer = w / 2 + t;
  return {
    length: LENGTH_MM,
    t,
    topWidth: w,
    lip: f,
    halfWidth: outer + f,
    heightMax: MAX_HEIGHT_MM,
    noseX: END_MARGIN_MM,
    tailX: END_MARGIN_MM + NUT_SPACING_MM,
    pilot: { x: END_MARGIN_MM, y: outer + f / 2, d: PILOT_HOLE_MM },
    slot: { x: END_MARGIN_MM + NUT_SPACING_MM, y: -(outer + f / 2), w: SLOT_MM[0], l: SLOT_MM[1] },
    bosses: [END_MARGIN_MM, END_MARGIN_MM + NUT_SPACING_MM],
    bossHeight: design.bossHeight,
  };
}

export interface WindowSpec { xc: number; w: number; frac: number; r: number }

export function windowsOf(design: BracketDesign): WindowSpec[] {
  const c = design.cutout;
  if (c <= 0.004) return [];
  const t = design.thickness;
  const span = WINDOW_SPAN[1] - WINDOW_SPAN[0];
  const wMax = (span - (WINDOWS - 1) * WINDOW_GAP) / WINDOWS;
  const pitch = wMax + WINDOW_GAP;
  const wallArea = LENGTH_MM * (heightAt(LENGTH_MM / 2) - t);
  const each = (c * wallArea) / WINDOWS;
  const out: WindowSpec[] = [];
  for (let i = 0; i < WINDOWS; i++) {
    const xc = WINDOW_SPAN[0] + wMax / 2 + i * pitch;
    const hl = heightAt(xc) - t;
    let frac = 0.45 + 0.5 * c;
    let w = each / (frac * hl);
    if (w > wMax) {
      frac = Math.min(0.82, each / (wMax * hl));
      w = Math.min(wMax, each / (frac * hl));
    }
    w = Math.max(w, 4);
    out.push({ xc, w, frac, r: Math.min(7, w / 3, (frac * hl) / 3) });
  }
  return out;
}

function windowPath(win: WindowSpec, t: number, seg: number): THREE.Path {
  const hc = heightAt(win.xc) - t;
  const hw = win.w / 2;
  const hh = (win.frac * hc) / 2;
  const r = Math.max(0.5, Math.min(win.r, hw - 0.1, hh - 0.1));
  const n = Math.max(2, Math.round(seg / 4));
  const pts: [number, number][] = [];
  const corners: [number, number, number][] = [[hw - r, hh - r, 0], [-(hw - r), hh - r, 90], [-(hw - r), -(hh - r), 180], [hw - r, -(hh - r), 270]];
  for (const [cu, cv, a0] of corners) {
    for (let i = 0; i <= n; i++) {
      const a = ((a0 + (90 * i) / n) * Math.PI) / 180;
      pts.push([cu + r * Math.cos(a), cv + r * Math.sin(a)]);
    }
  }
  const path = new THREE.Path();
  pts.forEach(([u, v], i) => {
    const x = win.xc + u;
    const z = (heightAt(x) - t) / 2 + v * ((heightAt(x) - t) / hc);
    if (i === 0) path.moveTo(x, z);
    else path.lineTo(x, z);
  });
  path.closePath();
  return path;
}

export function wallShape(design: BracketDesign, seg = HI_SEG): THREE.Shape {
  const t = design.thickness;
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(LENGTH_MM, 0);
  s.lineTo(LENGTH_MM, heightAt(LENGTH_MM) - t);
  s.lineTo(0, heightAt(0) - t);
  s.closePath();
  for (const win of windowsOf(design)) s.holes.push(windowPath(win, t, seg));
  return s;
}

function circlePath(cx: number, cy: number, r: number) {
  const p = new THREE.Path();
  p.absarc(cx, cy, r, 0, Math.PI * 2, false);
  return p;
}

function stadiumPath(cx: number, cy: number, w: number, l: number) {
  const r = w / 2;
  const a = l / 2 - r;
  const p = new THREE.Path();
  p.moveTo(cx + a, cy - r);
  p.absarc(cx + a, cy, r, -Math.PI / 2, Math.PI / 2, false);
  p.lineTo(cx - a, cy + r);
  p.absarc(cx - a, cy, r, Math.PI / 2, (3 * Math.PI) / 2, false);
  p.closePath();
  return p;
}

function rectShape(x0: number, y0: number, x1: number, y1: number) {
  const s = new THREE.Shape();
  s.moveTo(x0, y0);
  s.lineTo(x1, y0);
  s.lineTo(x1, y1);
  s.lineTo(x0, y1);
  s.closePath();
  return s;
}

function extrude(shape: THREE.Shape, depth: number, seg: number): Float32Array {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: seg });
  const out = Float32Array.from(g.getAttribute('position').array as ArrayLike<number>);
  g.dispose();
  return out;
}

function riserParts(design: BracketDesign, seg: number): Float32Array[] {
  const L = layoutOf(design);
  const t = L.t;
  const inner = L.topWidth / 2;
  const outer = inner + t;
  const parts: Float32Array[] = [];

  const flange = extrude(
    (() => {
      const s = rectShape(0, -outer, LENGTH_MM, outer);
      for (const x of L.bosses) s.holes.push(circlePath(x, 0, NUT_THREAD_MM / 2));
      return s;
    })(),
    t,
    seg,
  );
  for (let i = 0; i < flange.length; i += 3) flange[i + 2] += heightAt(flange[i]) - t;
  parts.push(flange);

  const wall = extrude(wallShape(design, seg), t, seg);
  for (const sy of [1, -1]) {
    const w = Float32Array.from(wall);
    const shift = sy > 0 ? outer : -inner;
    for (let i = 0; i < w.length; i += 3) {
      const y = w[i + 1];
      const z = w[i + 2];
      w[i + 1] = -z + shift;
      w[i + 2] = y;
    }
    parts.push(w);
  }

  const lipPlus = rectShape(0, outer, LENGTH_MM, outer + L.lip);
  lipPlus.holes.push(circlePath(L.pilot.x, L.pilot.y, L.pilot.d / 2));
  parts.push(extrude(lipPlus, t, seg));
  const lipMinus = rectShape(0, -(outer + L.lip), LENGTH_MM, -outer);
  lipMinus.holes.push(stadiumPath(L.slot.x, L.slot.y, L.slot.w, L.slot.l));
  parts.push(extrude(lipMinus, t, seg));

  for (const xb of L.bosses) {
    const s = new THREE.Shape();
    s.absarc(xb, 0, BOSS_OD_MM / 2, 0, Math.PI * 2, false);
    s.holes.push(circlePath(xb, 0, NUT_THREAD_MM / 2));
    const b = extrude(s, L.bossHeight, seg);
    const bottom = heightAt(xb) - t - L.bossHeight;
    for (let i = 0; i < b.length; i += 3) {
      b[i + 2] = b[i + 2] > L.bossHeight / 2 ? heightAt(b[i]) - t : bottom;
    }
    parts.push(b);
  }
  return parts;
}

export function riserGeometry(design: BracketDesign, side: BracketId, seg = HI_SEG): THREE.BufferGeometry {
  const parts = riserParts(design, seg);
  const total = parts.reduce((n, p) => n + p.length, 0);
  const pos = new Float32Array(total);
  let o = 0;
  for (const p of parts) {
    pos.set(p, o);
    o += p.length;
  }
  if (side === 'lh') {
    for (let i = 0; i < pos.length; i += 9) {
      for (let k = 0; k < 9; k += 3) pos[i + k + 1] = -pos[i + k + 1];
      for (let k = 0; k < 3; k++) {
        const tmp = pos[i + 3 + k];
        pos[i + 3 + k] = pos[i + 6 + k];
        pos[i + 6 + k] = tmp;
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const creased = toCreasedNormals(g, Math.PI / 5);
  g.dispose();
  creased.computeBoundingBox();
  creased.computeBoundingSphere();
  return creased;
}

export const riserGeometryLo = (design: BracketDesign, side: BracketId) => riserGeometry(design, side, LO_SEG);

const NUMERIC = ['thickness', 'topWidth', 'lipWidth', 'cutout', 'bossHeight'] as const;

export function mixDesign(a: BracketDesign, b: BracketDesign, t: number): BracketDesign {
  const out: BracketDesign = { ...b };
  for (const k of NUMERIC) out[k] = a[k] + (b[k] - a[k]) * t;
  return out;
}

export function exportStl(design: BracketDesign, side: BracketId): Blob {
  const geo = riserGeometry(design, side, HI_SEG);
  geo.deleteAttribute('normal');
  const mesh = new THREE.Mesh(geo);
  const data = new STLExporter().parse(mesh, { binary: true }) as unknown as DataView;
  geo.dispose();
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return new Blob([bytes.slice().buffer], { type: 'model/stl' });
}
