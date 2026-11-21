import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { TOWER } from './tower';

export const FH = TOWER.floorHeight;
export const FW = TOWER.footprint.w;
export const FD = TOWER.footprint.d;
export const FLOORS = TOWER.floors;
export const LOBBY = FH * 2;
export const TOP = LOBBY + FLOORS * FH;
export const SLAB_T = 0.36;
export const SLAB_OUT = 0.32;
export const CROWN_TOP = TOP + 6.2;

export const floorBase = (f: number) => LOBBY + (f - 1) * FH;

export const rng = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

export function box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number) {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  g.translate(cx, cy, cz);
  return g;
}

export function mergeAll(list: THREE.BufferGeometry[]) {
  if (!list.length) return null;
  const m = mergeGeometries(list, false);
  list.forEach((g) => g.dispose());
  return m;
}

interface Seg {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  nx: number;
  ny: number;
  outer: boolean;
}

interface PlanRect {
  x: number;
  y: number;
  w: number;
  d: number;
}

function balconies(): PlanRect[] {
  const out: PlanRect[] = [];
  for (const u of TOWER.units) if (u.floor === 1) for (const r of u.rooms) if (r.kind === 'balcony') out.push(r.rect);
  return out;
}

function envelope(holes: PlanRect[], inset = 0): Seg[] {
  const R = 10;
  const W = Math.round(FW * R);
  const D = Math.round(FD * R);
  const ins = Math.round(inset * R);
  const inside = (i: number, j: number) => {
    if (i < ins || j < ins || i >= W - ins || j >= D - ins) return false;
    const x = (i + 0.5) / R - FW / 2;
    const y = (j + 0.5) / R - FD / 2;
    return !holes.some((h) => x > h.x && x < h.x + h.w && y > h.y && y < h.y + h.d);
  };
  const segs: Seg[] = [];
  const runs = new Map<string, { a: number; b: number }[]>();
  const push = (k: string, a: number) => {
    let list = runs.get(k);
    if (!list) runs.set(k, (list = []));
    const last = list[list.length - 1];
    if (last && last.b === a) last.b = a + 1;
    else list.push({ a, b: a + 1 });
  };
  for (let j = 0; j < D; j++)
    for (let i = 0; i < W; i++) {
      if (!inside(i, j)) continue;
      if (!inside(i, j - 1)) push(`y|${j}|-1`, i);
      if (!inside(i, j + 1)) push(`y|${j + 1}|1`, i);
    }
  for (let i = 0; i < W; i++)
    for (let j = 0; j < D; j++) {
      if (!inside(i, j)) continue;
      if (!inside(i - 1, j)) push(`x|${i}|-1`, j);
      if (!inside(i + 1, j)) push(`x|${i + 1}|1`, j);
    }
  for (const [k, list] of runs) {
    const [axis, lineS, sS] = k.split('|');
    const line = Number(lineS);
    const s = Number(sS);
    for (const r of list) {
      if (axis === 'y') {
        const y = line / R - FD / 2;
        segs.push({ x0: r.a / R - FW / 2, y0: y, x1: r.b / R - FW / 2, y1: y, nx: 0, ny: s, outer: Math.abs(Math.abs(y) - FD / 2) < 0.01 });
      } else {
        const x = line / R - FW / 2;
        segs.push({ x0: x, y0: r.a / R - FD / 2, x1: x, y1: r.b / R - FD / 2, nx: s, ny: 0, outer: Math.abs(Math.abs(x) - FW / 2) < 0.01 });
      }
    }
  }
  return segs;
}

export interface TowerBuild {
  group: THREE.Group;
  glassMat: THREE.MeshPhysicalMaterial;
  noAO: THREE.Object3D[];
  dispose(): void;
}

export function buildTower(clipList: THREE.Plane[]): TowerBuild {
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(o: T) => {
    disposables.push(o);
    return o;
  };
  const noAO: THREE.Object3D[] = [];
  const add = (geo: THREE.BufferGeometry | null, mat: THREE.Material, cast = true) => {
    if (!geo) return null;
    track(geo);
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = cast;
    m.receiveShadow = true;
    group.add(m);
    return m;
  };
  const std = (color: string, roughness: number, metalness = 0) => track(new THREE.MeshStandardMaterial({ color, roughness, metalness, clippingPlanes: clipList }));

  const slabMat = std('#f1eee8', 0.62);
  const stoneMat = std('#e4ddd0', 0.78);
  const mullMat = std('#c9ccce', 0.32, 0.75);
  const finMat = std('#f4f2ee', 0.45);
  const darkMat = std('#3a3f45', 0.5, 0.4);
  const railMat = track(
    new THREE.MeshPhysicalMaterial({ color: '#cfe3ea', roughness: 0.05, metalness: 0, transparent: true, opacity: 0.32, depthWrite: false, clippingPlanes: clipList, envMapIntensity: 1.2 }),
  );
  const glassMat = track(
    new THREE.MeshPhysicalMaterial({
      color: '#ffffff',
      roughness: 0.03,
      metalness: 0.78,
      envMapIntensity: 1.15,
      clearcoat: 1,
      clearcoatRoughness: 0.02,
      clippingPlanes: clipList,
    }),
  );
  const lobbyGlassMat = track(
    new THREE.MeshPhysicalMaterial({ color: '#d9e6ea', roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.38, depthWrite: false, envMapIntensity: 1.4, clippingPlanes: clipList }),
  );
  const lobbyInMat = track(new THREE.MeshStandardMaterial({ color: '#d8b48a', roughness: 0.7, emissive: new THREE.Color('#ffd7a0'), emissiveIntensity: 0.35, side: THREE.BackSide, clippingPlanes: clipList }));

  const holes = balconies();
  const segs = envelope(holes);
  const r = rng(31);

  const slabs: THREE.BufferGeometry[] = [];
  for (let i = 1; i <= FLOORS; i++) slabs.push(box(0, LOBBY + (i - 1) * FH - SLAB_T / 2, 0, FW + SLAB_OUT * 2, SLAB_T, FD + SLAB_OUT * 2));
  slabs.push(box(0, TOP - SLAB_T / 2 + 0.2, 0, FW + SLAB_OUT * 2, SLAB_T + 0.4, FD + SLAB_OUT * 2));
  add(mergeAll(slabs), slabMat);

  const paneH = FH - SLAB_T;
  const paneGeo = track(new THREE.PlaneGeometry(1, 1));
  paneGeo.translate(0, 0.5, 0);
  const panes: THREE.Matrix4[] = [];
  const paneColors: THREE.Color[] = [];
  const mulls: THREE.Matrix4[] = [];
  const fins: THREE.Matrix4[] = [];
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const tints = ['#8fa9ba', '#7f9bb0', '#9ab3c2', '#7590a6', '#88a3b6', '#b9b4aa'];
  const colH = TOP - LOBBY;
  for (const sg of segs) {
    const len = Math.hypot(sg.x1 - sg.x0, sg.y1 - sg.y0);
    if (len < 0.15) continue;
    const n = Math.max(1, Math.round(len / 1.55));
    const yaw = Math.atan2(sg.nx, -sg.ny);
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const x = sg.x0 + (sg.x1 - sg.x0) * t;
      const y = sg.y0 + (sg.y1 - sg.y0) * t;
      e.set(0, yaw, 0);
      q.setFromEuler(e);
      p.set(x + sg.nx * 0.06, LOBBY + colH / 2 - SLAB_T / 2, -(y + sg.ny * 0.06));
      s.set(0.07, colH - SLAB_T, 0.14);
      mulls.push(new THREE.Matrix4().compose(p, q, s));
      if (sg.outer && k % 2 === 0 && k > 0 && k < n) {
        p.set(x + sg.nx * 0.3, LOBBY + colH / 2 - SLAB_T / 2, -(y + sg.ny * 0.3));
        s.set(0.1, colH - SLAB_T, 0.5);
        fins.push(new THREE.Matrix4().compose(p, q, s));
      }
    }
    for (let f = 1; f <= FLOORS; f++) {
      const base = floorBase(f);
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        const x = sg.x0 + (sg.x1 - sg.x0) * t;
        const y = sg.y0 + (sg.y1 - sg.y0) * t;
        e.set((r() - 0.5) * 0.02, yaw + (r() - 0.5) * 0.025, 0);
        q.setFromEuler(e);
        p.set(x, base, -y);
        s.set(len / n, paneH, 1);
        panes.push(new THREE.Matrix4().compose(p, q, s));
        const c = new THREE.Color(tints[Math.floor(r() * tints.length)]);
        c.multiplyScalar(0.88 + r() * 0.2);
        paneColors.push(c);
      }
    }
  }
  const glass = new THREE.InstancedMesh(paneGeo, glassMat, panes.length);
  panes.forEach((mm, i) => {
    glass.setMatrixAt(i, mm);
    glass.setColorAt(i, paneColors[i]);
  });
  glass.receiveShadow = true;
  group.add(glass);

  const unitBox = track(new THREE.BoxGeometry(1, 1, 1));
  const inst = (list: THREE.Matrix4[], mat: THREE.Material) => {
    const im = new THREE.InstancedMesh(unitBox, mat, list.length);
    list.forEach((mm, i) => im.setMatrixAt(i, mm));
    im.castShadow = true;
    im.receiveShadow = true;
    group.add(im);
    return im;
  };
  inst(mulls, mullMat);
  inst(fins, finMat);

  const rails: THREE.BufferGeometry[] = [];
  const railTops: THREE.BufferGeometry[] = [];
  const dividers: THREE.BufferGeometry[] = [];
  const planters: THREE.Vector3[] = [];
  for (const h of holes) {
    const edges: { x0: number; y0: number; x1: number; y1: number }[] = [];
    if (Math.abs(h.y + h.d - FD / 2) < 0.01) edges.push({ x0: h.x, y0: FD / 2, x1: h.x + h.w, y1: FD / 2 });
    if (Math.abs(h.y + FD / 2) < 0.01) edges.push({ x0: h.x, y0: -FD / 2, x1: h.x + h.w, y1: -FD / 2 });
    if (Math.abs(h.x + h.w - FW / 2) < 0.01) edges.push({ x0: FW / 2, y0: h.y, x1: FW / 2, y1: h.y + h.d });
    if (Math.abs(h.x + FW / 2) < 0.01) edges.push({ x0: -FW / 2, y0: h.y, x1: -FW / 2, y1: h.y + h.d });
    for (let f = 1; f <= FLOORS; f++) {
      const base = floorBase(f);
      for (const ed of edges) {
        const cx = (ed.x0 + ed.x1) / 2;
        const cy = (ed.y0 + ed.y1) / 2;
        const lx = Math.abs(ed.x1 - ed.x0);
        const ly = Math.abs(ed.y1 - ed.y0);
        const sx = lx > 0 ? lx : 0.02;
        const sz = ly > 0 ? ly : 0.02;
        rails.push(box(cx, base + 0.55, -cy, sx, 1.0, sz));
        railTops.push(box(cx, base + 1.06, -cy, lx > 0 ? lx : 0.06, 0.05, ly > 0 ? ly : 0.06));
      }
      if (r() < 0.45) planters.push(new THREE.Vector3(h.x + 0.5 + r() * (h.w - 1), base, -(h.y + h.d / 2)));
    }
    for (const o of holes) {
      if (o === h) continue;
      if (Math.abs(o.x - (h.x + h.w)) < 0.01 && Math.abs(o.y - h.y) < 0.01) {
        for (let f = 1; f <= FLOORS; f++) dividers.push(box(o.x, floorBase(f) + paneH / 2, -(h.y + h.d / 2), 0.25, paneH, h.d));
      }
    }
  }
  const railMesh = add(mergeAll(rails), railMat, false);
  if (railMesh) noAO.push(railMesh);
  add(mergeAll(railTops), mullMat, false);
  add(mergeAll(dividers), stoneMat);

  const potGeo = track(new THREE.CylinderGeometry(0.3, 0.24, 0.5, 10));
  potGeo.translate(0, 0.25, 0);
  const bushGeo = track(new THREE.IcosahedronGeometry(0.5, 1));
  bushGeo.translate(0, 0.85, 0);
  const pots = new THREE.InstancedMesh(potGeo, stoneMat, planters.length);
  const bushes = new THREE.InstancedMesh(bushGeo, track(new THREE.MeshStandardMaterial({ color: '#4f7d3b', roughness: 0.9, clippingPlanes: clipList })), planters.length);
  planters.forEach((v, i) => {
    m4.makeTranslation(v.x, v.y, v.z);
    pots.setMatrixAt(i, m4);
    const k = 0.8 + r() * 0.5;
    m4.compose(v, q.identity(), s.set(k, k, k));
    bushes.setMatrixAt(i, m4);
  });
  pots.castShadow = bushes.castShadow = true;
  group.add(pots, bushes);

  const core = add(box(0, LOBBY + colH / 2, 0, 8, colH, 6), stoneMat, false);
  if (core) core.castShadow = false;

  const lobbyInset = 1.6;
  const lobbyBox = add(box(0, LOBBY / 2, 0, FW - lobbyInset * 2 - 0.2, LOBBY - SLAB_T, FD - lobbyInset * 2 - 0.2), lobbyInMat, false);
  if (lobbyBox) lobbyBox.receiveShadow = false;
  const lg: THREE.BufferGeometry[] = [];
  const LW = FW - lobbyInset * 2;
  const LD = FD - lobbyInset * 2;
  lg.push(box(0, (LOBBY - SLAB_T) / 2, LD / 2, LW, LOBBY - SLAB_T, 0.04), box(0, (LOBBY - SLAB_T) / 2, -LD / 2, LW, LOBBY - SLAB_T, 0.04));
  lg.push(box(LW / 2, (LOBBY - SLAB_T) / 2, 0, 0.04, LOBBY - SLAB_T, LD), box(-LW / 2, (LOBBY - SLAB_T) / 2, 0, 0.04, LOBBY - SLAB_T, LD));
  const lobbyGlass = add(mergeAll(lg), lobbyGlassMat, false);
  if (lobbyGlass) noAO.push(lobbyGlass);
  const cols: THREE.BufferGeometry[] = [];
  const colGeo = (x: number, z: number) => {
    const g = new THREE.CylinderGeometry(0.32, 0.32, LOBBY - SLAB_T, 20);
    g.translate(x, (LOBBY - SLAB_T) / 2, z);
    return g;
  };
  for (let i = 0; i <= 6; i++) {
    const x = -FW / 2 + 0.6 + (i * (FW - 1.2)) / 6;
    cols.push(colGeo(x, FD / 2 - 0.3), colGeo(x, -FD / 2 + 0.3));
  }
  for (let i = 1; i < 4; i++) {
    const z = -FD / 2 + 0.6 + (i * (FD - 1.2)) / 4;
    cols.push(colGeo(FW / 2 - 0.3, z), colGeo(-FW / 2 + 0.3, z));
  }
  add(mergeAll(cols), stoneMat);
  const plinth: THREE.BufferGeometry[] = [];
  plinth.push(box(0, 0.06, 0, FW + 1.2, 0.12, FD + 1.2));
  add(mergeAll(plinth), stoneMat, false);
  const canopy: THREE.BufferGeometry[] = [];
  canopy.push(box(0, 4.7, FD / 2 + 3.6, 13, 0.32, 7.2));
  canopy.push(box(0, 5.0, FD / 2 + 7.15, 13, 0.6, 0.12));
  for (const sx of [-1, 1]) {
    const g = new THREE.CylinderGeometry(0.11, 0.11, 4.55, 12);
    g.translate(sx * 6.0, 4.55 / 2, FD / 2 + 6.6);
    canopy.push(g);
  }
  add(mergeAll(canopy), finMat);

  const crown: THREE.BufferGeometry[] = [];
  const pH = 1.15;
  crown.push(box(0, TOP + 0.2 + pH / 2, FD / 2 + SLAB_OUT - 0.1, FW + SLAB_OUT * 2, pH, 0.2));
  crown.push(box(0, TOP + 0.2 + pH / 2, -FD / 2 - SLAB_OUT + 0.1, FW + SLAB_OUT * 2, pH, 0.2));
  crown.push(box(FW / 2 + SLAB_OUT - 0.1, TOP + 0.2 + pH / 2, 0, 0.2, pH, FD + SLAB_OUT * 2));
  crown.push(box(-FW / 2 - SLAB_OUT + 0.1, TOP + 0.2 + pH / 2, 0, 0.2, pH, FD + SLAB_OUT * 2));
  const fx = FW / 2 - 0.8;
  const fz = FD / 2 - 0.8;
  const frameY = CROWN_TOP - 0.45;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) crown.push(box(sx * fx, (TOP + frameY) / 2 + 0.2, sz * fz, 0.45, frameY - TOP, 0.45));
  crown.push(box(0, frameY, fz, FW - 1.1, 0.9, 0.5), box(0, frameY, -fz, FW - 1.1, 0.9, 0.5));
  crown.push(box(fx, frameY, 0, 0.5, 0.9, FD - 1.1), box(-fx, frameY, 0, 0.5, 0.9, FD - 1.1));
  for (let i = 1; i < 12; i++) {
    const x = -fx + (i * 2 * fx) / 12;
    crown.push(box(x, frameY + 0.1, 0, 0.18, 0.5, FD - 1.6));
  }
  add(mergeAll(crown), finMat);
  add(box(0, TOP + 0.4 + 1.8, 0, 13, 3.6, 8), darkMat);
  const louv: THREE.Matrix4[] = [];
  for (let i = 0; i <= 26; i++) {
    const x = -6.5 + i * 0.5;
    louv.push(new THREE.Matrix4().compose(p.set(x, TOP + 2.2, 4.08), q.identity(), s.set(0.06, 3.6, 0.22)));
    louv.push(new THREE.Matrix4().compose(p.set(x, TOP + 2.2, -4.08), q.identity(), s.set(0.06, 3.6, 0.22)));
  }
  for (let i = 0; i <= 16; i++) {
    const z = -4 + i * 0.5;
    louv.push(new THREE.Matrix4().compose(p.set(6.58, TOP + 2.2, z), q.identity(), s.set(0.22, 3.6, 0.06)));
    louv.push(new THREE.Matrix4().compose(p.set(-6.58, TOP + 2.2, z), q.identity(), s.set(0.22, 3.6, 0.06)));
  }
  inst(louv, mullMat);

  return {
    group,
    glassMat,
    noAO,
    dispose() {
      disposables.forEach((d) => d.dispose());
      group.traverse((o) => {
        if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
      });
    },
  };
}

function canopyGeometry(seed: number, blobCount = 0) {
  const r = rng(seed);
  const parts: THREE.BufferGeometry[] = [];
  const blobs = blobCount || 6 + Math.floor(r() * 3);
  for (let i = 0; i < blobs; i++) {
    const g = new THREE.IcosahedronGeometry(0.75 + r() * 0.45, 1);
    const a = r() * Math.PI * 2;
    const d = i === 0 ? 0 : 0.6 + r() * 0.5;
    g.translate(Math.cos(a) * d, 0.2 + r() * 0.9 + (i === 0 ? 0.3 : 0), Math.sin(a) * d);
    parts.push(g);
  }
  const merged = mergeGeometries(parts, false)!;
  parts.forEach((x) => x.dispose());
  merged.deleteAttribute('normal');
  merged.deleteAttribute('uv');
  const g = mergeVertices(merged, 1e-4);
  merged.dispose();
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = Math.sin(v.x * 4.1 + seed) * Math.cos(v.z * 3.7) * Math.sin(v.y * 5.3) * 0.16 + Math.sin(v.x * 9.7 + v.y * 7.1) * Math.cos(v.z * 8.3) * 0.05;
    v.multiplyScalar(1 + n);
    pos.setXYZ(i, v.x, v.y, v.z);
    const k = 0.62 + 0.38 * Math.min(1, Math.max(0, (v.y + 0.3) / 2.2));
    colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

export interface SiteBuild {
  group: THREE.Group;
  water: THREE.Mesh;
  dispose(): void;
}

export function buildSite(onTexture: () => void, anisotropy: number): SiteBuild {
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(o: T) => {
    disposables.push(o);
    return o;
  };
  const loader = new THREE.TextureLoader();
  const tex = (url: string, repeat: number) => {
    const t = track(
      loader.load(url, () => onTexture(), undefined, () => undefined),
    );
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.anisotropy = anisotropy;
    return t;
  };
  const lawnMat = track(new THREE.MeshStandardMaterial({ color: '#a4b08c', roughness: 0.95, map: tex('/assets/tower/textures/lawn_diff.jpg', 420) }));
  lawnMat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#ifdef USE_MAP
        vec4 sampledDiffuseColor = texture2D( map, vMapUv );
        float macroA = texture2D( map, vMapUv * 0.043 + vec2(0.31, 0.17) ).g;
        float macroB = texture2D( map, vMapUv * 0.011 + vec2(0.7, 0.4) ).g;
        float macro = 0.45 + 0.75 * macroA * 0.6 + 0.75 * macroB * 0.6;
        diffuseColor *= sampledDiffuseColor * vec4(vec3(macro) * vec3(1.0, 1.0 + (macroB - 0.5) * 0.25, 1.0), 1.0);
      #endif`,
    );
  };
  const ground = new THREE.Mesh(track(new THREE.CircleGeometry(6000, 96)), lawnMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  const pave = (x: number, z: number, w: number, d: number, color: string, rep: number, y = 0.03) => {
    const t = tex('/assets/tower/textures/paving_diff.jpg', 1);
    t.repeat.set(w / rep, d / rep);
    const m = track(new THREE.MeshStandardMaterial({ color, roughness: 0.82, map: t }));
    const g = track(new THREE.PlaneGeometry(w, d));
    g.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(x, y, z);
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  pave(0, 3, FW + 26, FD + 30, '#ffffff', 3.2);
  pave(0, FD / 2 + 31, 9, 34, '#e8e6e2', 3.2, 0.035);

  const roadMat = track(new THREE.MeshStandardMaterial({ color: '#6b6e72', roughness: 0.9 }));
  const roadGeo = track(new THREE.PlaneGeometry(900, 14));
  roadGeo.rotateX(-Math.PI / 2);
  const road = new THREE.Mesh(roadGeo, roadMat);
  road.position.set(0, 0.04, 56);
  road.receiveShadow = true;
  group.add(road);
  const walkMat = track(new THREE.MeshStandardMaterial({ color: '#d9d5cd', roughness: 0.85 }));
  for (const z of [47.5, 64.5]) {
    const g = track(new THREE.BoxGeometry(900, 0.16, 3));
    const m = new THREE.Mesh(g, walkMat);
    m.position.set(0, 0.08, z);
    m.receiveShadow = true;
    group.add(m);
  }
  const dashes: THREE.BufferGeometry[] = [];
  for (let x = -300; x <= 300; x += 9) dashes.push(box(x, 0.05, 56, 4, 0.01, 0.18));
  const dashMesh = new THREE.Mesh(track(mergeAll(dashes)!), track(new THREE.MeshStandardMaterial({ color: '#f4f1e8', roughness: 0.8 })));
  group.add(dashMesh);

  const water = new THREE.Mesh(
    track(new THREE.PlaneGeometry(20, 7)),
    track(new THREE.MeshPhysicalMaterial({ color: '#2f5f73', roughness: 0.02, metalness: 0.1, envMapIntensity: 1.3, clearcoat: 1, clearcoatRoughness: 0 })),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(-19, 0.12, FD / 2 + 12);
  group.add(water);
  const edgeMat = track(new THREE.MeshStandardMaterial({ color: '#ece7de', roughness: 0.7 }));
  const edges: THREE.BufferGeometry[] = [];
  edges.push(box(-19, 0.1, FD / 2 + 8.3, 20.8, 0.2, 0.4), box(-19, 0.1, FD / 2 + 15.7, 20.8, 0.2, 0.4));
  edges.push(box(-29.2, 0.1, FD / 2 + 12, 0.4, 0.2, 7.8), box(-8.8, 0.1, FD / 2 + 12, 0.4, 0.2, 7.8));
  const edgeMesh = new THREE.Mesh(track(mergeAll(edges)!), edgeMat);
  edgeMesh.receiveShadow = true;
  group.add(edgeMesh);

  const r = rng(77);
  const trees: { x: number; z: number; s: number }[] = [];
  const clear = (x: number, z: number) => {
    if (Math.abs(x) < FW / 2 + 7 && z > -FD / 2 - 7 && z < FD / 2 + 9) return false;
    if (Math.abs(x) < 7 && z > FD / 2 && z < 50) return false;
    if (z > 45 && z < 67) return false;
    if (x > -31 && x < -7 && z > FD / 2 + 6 && z < FD / 2 + 18) return false;
    return true;
  };
  for (let i = 0; i < 9; i++) trees.push({ x: 9 + i * 3.4, z: FD / 2 + 15 + (i % 2) * 1.2, s: 0.95 + r() * 0.3 });
  for (let i = 0; i < 6; i++) trees.push({ x: -FW / 2 - 9, z: -FD / 2 + i * 5.2, s: 1 + r() * 0.35 });
  for (let i = 0; i < 6; i++) trees.push({ x: FW / 2 + 9, z: -FD / 2 - 4 + i * 5.6, s: 1 + r() * 0.35 });
  for (let x = -120; x <= 120; x += 12) {
    trees.push({ x: x + r() * 2, z: 45.5, s: 1.05 + r() * 0.25 });
    trees.push({ x: x + r() * 2, z: 66.5, s: 1.05 + r() * 0.25 });
  }
  let guard = 0;
  while (trees.length < 150 && guard++ < 2000) {
    const a = r() * Math.PI * 2;
    const d = 34 + Math.pow(r(), 0.7) * 120;
    const x = Math.cos(a) * d * 1.25;
    const z = Math.sin(a) * d;
    if (!clear(x, z)) continue;
    if (trees.some((t) => Math.hypot(t.x - x, t.z - z) < 4.5)) continue;
    trees.push({ x, z, s: 0.9 + r() * 0.8 });
  }
  const nearCount = trees.length;
  for (let k = 0; k < 40; k++) {
    const a = (k / 40) * Math.PI * 2 + r() * 0.08;
    const d = 230 + r() * 360;
    const cx = Math.cos(a) * d;
    const cz = Math.sin(a) * d;
    const n = 5 + Math.floor(r() * 7);
    for (let i = 0; i < n; i++) {
      const x = cx + (r() - 0.5) * 34;
      const z = cz + (r() - 0.5) * 26;
      if (z > 40 && z < 72) continue;
      trees.push({ x, z, s: 1.5 + r() * 1.4 });
    }
  }
  const variants = [canopyGeometry(3), canopyGeometry(11), canopyGeometry(23), canopyGeometry(41, 3)].map(track);
  const leafMat = track(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95, vertexColors: true, envMapIntensity: 0.55 }));
  const trunkGeo = track(new THREE.CylinderGeometry(0.14, 0.24, 3.2, 7));
  trunkGeo.translate(0, 1.6, 0);
  const trunks = new THREE.InstancedMesh(trunkGeo, track(new THREE.MeshStandardMaterial({ color: '#6b5544', roughness: 0.95 })), trees.length);
  const buckets: { x: number; z: number; s: number }[][] = [[], [], [], []];
  trees.forEach((t, i) => buckets[i < nearCount ? i % 3 : 3].push(t));
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const c = new THREE.Color();
  trees.forEach((t, i) => {
    m4.compose(p.set(t.x, 0, t.z), q.identity(), s.set(t.s, t.s, t.s));
    trunks.setMatrixAt(i, m4);
  });
  trunks.castShadow = true;
  group.add(trunks);
  buckets.forEach((list, vi) => {
    const im = new THREE.InstancedMesh(variants[vi], leafMat, list.length);
    list.forEach((t, i) => {
      q.setFromEuler(new THREE.Euler(0, r() * Math.PI * 2, 0));
      m4.compose(p.set(t.x, 2.5 * t.s + 0.6, t.z), q, s.set(t.s * 1.6, t.s * 1.45, t.s * 1.6));
      im.setMatrixAt(i, m4);
      c.setHSL(0.21 + r() * 0.09, 0.42 + r() * 0.2, 0.14 + r() * 0.08);
      im.setColorAt(i, c);
    });
    im.castShadow = true;
    im.receiveShadow = true;
    group.add(im);
  });

  const hedgeGeo = track(new THREE.IcosahedronGeometry(1, 2));
  const hedges: THREE.Matrix4[] = [];
  const hedgeAt = (x: number, z: number, sx: number, sz: number) => hedges.push(new THREE.Matrix4().compose(p.set(x, 0.35, z), q.identity(), s.set(sx, 0.55, sz)));
  for (let i = 0; i < 12; i++) hedgeAt(-FW / 2 - 11 + i * 1.6, -FD / 2 - 12, 1.0, 0.8);
  for (let i = 0; i < 12; i++) hedgeAt(FW / 2 + 11 - i * 1.6, -FD / 2 - 12, 1.0, 0.8);
  for (let i = 0; i < 10; i++) hedgeAt(FW / 2 + 12, -FD / 2 - 8 + i * 1.7, 0.8, 1.0);
  for (let i = 0; i < 10; i++) hedgeAt(-FW / 2 - 12, -FD / 2 - 8 + i * 1.7, 0.8, 1.0);
  for (let i = 0; i < 7; i++) hedgeAt(6.5, FD / 2 + 20 + i * 1.6, 0.7, 0.9), hedgeAt(-6.5, FD / 2 + 20 + i * 1.6, 0.7, 0.9);
  const hedgeMesh = new THREE.InstancedMesh(hedgeGeo, track(new THREE.MeshStandardMaterial({ color: '#4c7536', roughness: 0.9 })), hedges.length);
  hedges.forEach((mm, i) => hedgeMesh.setMatrixAt(i, mm));
  hedgeMesh.castShadow = true;
  hedgeMesh.receiveShadow = true;
  group.add(hedgeMesh);

  return {
    group,
    water,
    dispose() {
      disposables.forEach((d) => d.dispose());
      group.traverse((o) => {
        if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
      });
    },
  };
}
