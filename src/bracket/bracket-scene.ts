import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { BracketDesign, BracketId, Verification } from './model';
import { MATERIAL_LOOK, layoutOf, mixDesign, riserGeometry, riserGeometryLo, topAt, wallShape, HI_SEG } from './mesh';
import { HARNESS_OFFSET_MM, HARNESS_CLEARANCE_MM, KICK_N, PITCH_DEG, SOCKET_RADIUS_MM } from './spec';
import { INERTIAL_N } from './engine';

export interface BracketSceneState {
  design: BracketDesign;
  side: BracketId;
  verification: Verification;
  showLoad: boolean;
  showPrint: boolean;
  xray?: boolean;
  morphMs?: number;
  key?: string;
}

export interface BracketScene {
  update(state: BracketSceneState): void;
  resetView(): void;
  capture(): string;
  dispose(): void;
}

const BG = '#26332c';
const GOLD = '#e6c78b';
const ALERT = '#e5483d';
const SUPPORT = '#e8a23c';
const MUTED = '#a9bdb2';
const HARNESS = '#e0892f';
const PRINT_MS = 520;
const PITCH = (PITCH_DEG * Math.PI) / 180;
const SLAB_DEPTH = 16;
const TRACK_W = 22;
const TRACK_H = 10;
const FLOOR_Y = -SLAB_DEPTH - 0.4;
const PLATE_T = 6;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

class Tween {
  value: number;
  private from: number;
  private to: number;
  private t0 = 0;
  private dur = 0;
  constructor(v: number) {
    this.value = this.from = this.to = v;
  }
  set(target: number, now: number, ms: number) {
    if (target === this.to) return;
    this.from = this.value;
    this.to = target;
    this.t0 = now;
    this.dur = ms;
    if (ms <= 0) this.value = target;
  }
  step(now: number) {
    if (this.value === this.to) return false;
    const k = this.dur > 0 ? (now - this.t0) / this.dur : 1;
    this.value = k >= 1 ? this.to : mix(this.from, this.to, smooth(k));
    return true;
  }
}

function labelSprite(text: string, color: string, height: number) {
  const font = '600 52px ui-sans-serif, system-ui, -apple-system, sans-serif';
  const probe = document.createElement('canvas').getContext('2d')!;
  probe.font = font;
  const w = Math.ceil(probe.measureText(text).width) + 72;
  const h = 100;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(20,28,24,0.88)';
  g.beginPath();
  g.roundRect(4, 4, w - 8, h - 8, 46);
  g.fill();
  g.strokeStyle = color;
  g.lineWidth = 4;
  g.stroke();
  g.fillStyle = color;
  g.font = font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.scale.set((height * w) / h, height, 1);
  sp.renderOrder = 12;
  return sp;
}

function disposeGroup(g: THREE.Object3D) {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry && !m.userData.shared) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (mat) (Array.isArray(mat) ? mat : [mat]).forEach((x) => {
      (x as THREE.SpriteMaterial).map?.dispose();
      x.dispose();
    });
  });
  g.clear();
}

const Q_BASE = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
const Q_UP = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2)).multiply(Q_BASE);

export function createBracketScene(container: HTMLElement): BracketScene {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const dom = renderer.domElement;
  dom.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;outline:none';
  container.appendChild(dom);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;
  scene.environmentIntensity = 0.55;

  scene.add(new THREE.HemisphereLight('#e5eff4', '#6f6a58', 0.55));
  const sun = new THREE.DirectionalLight('#fff4de', 2.2);
  sun.position.set(-200, 420, 260);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -330, right: 330, top: 330, bottom: -330, near: 50, far: 1400 });
  sun.shadow.normalBias = 0.6;
  sun.shadow.radius = 4;
  scene.add(sun);
  const fill = new THREE.DirectionalLight('#cfe0da', 0.6);
  fill.position.set(300, 180, -220);
  scene.add(fill);

  const grid = new THREE.GridHelper(1600, 80, '#4a6657', '#2f4137');
  (grid.material as THREE.Material).transparent = true;
  scene.add(grid);
  const shadowFloor = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), new THREE.ShadowMaterial({ opacity: 0.32 }));
  shadowFloor.rotation.x = -Math.PI / 2;
  shadowFloor.receiveShadow = true;
  scene.add(shadowFloor);

  const plateMat = new THREE.MeshStandardMaterial({ color: '#33473c', roughness: 0.6, metalness: 0.2, transparent: true });
  const plate = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), plateMat);
  plate.receiveShadow = true;
  const plateEdgeMat = new THREE.LineBasicMaterial({ color: GOLD, transparent: true });
  plate.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), plateEdgeMat));
  plate.visible = false;
  scene.add(plate);
  const plateLabel = labelSprite('BUILD PLATE', GOLD, 18);
  plateLabel.visible = false;
  scene.add(plateLabel);
  const buildArrow = new THREE.Group();
  const arrowMat = new THREE.MeshStandardMaterial({ color: GOLD, roughness: 0.4, emissive: '#b8872e', emissiveIntensity: 0.5, transparent: true });
  const arrowShaft = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 1, 16), arrowMat);
  const arrowHead = new THREE.Mesh(new THREE.ConeGeometry(5, 12, 20), arrowMat);
  const buildLabel = labelSprite('BUILD DIRECTION', GOLD, 20);
  buildArrow.add(arrowShaft, arrowHead, buildLabel);
  buildArrow.visible = false;
  scene.add(buildArrow);

  const partMat = new THREE.MeshStandardMaterial({ color: '#cdd2d6', roughness: 0.4, metalness: 0.88, side: THREE.DoubleSide });
  const part = new THREE.Mesh(new THREE.BufferGeometry(), partMat);
  part.castShadow = true;
  part.receiveShadow = true;
  const vehicle = new THREE.Group();
  vehicle.add(part);
  const ctx = new THREE.Group();
  const loads = new THREE.Group();
  const fails = new THREE.Group();
  const printFx = new THREE.Group();
  vehicle.add(ctx, loads, fails, printFx);
  scene.add(vehicle);

  const camera = new THREE.PerspectiveCamera(32, 1, 1, 5000);
  const controls = new OrbitControls(camera, dom);
  controls.enableDamping = true;
  controls.dampingFactor = 0.09;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.minDistance = 60;
  controls.maxDistance = 1800;

  const reduced = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let raf = 0;
  let disposed = false;
  let touched = false;
  let fitSig = '';
  let lastKey: string | undefined;
  let state: BracketSceneState | null = null;
  let shown: BracketDesign | null = null;
  let target: BracketDesign | null = null;
  let morph: { from: BracketDesign; t0: number; ms: number; colorFrom: THREE.Color; roughFrom: number; metalFrom: number } | null = null;
  const colorNow = new THREE.Color('#cdd2d6');
  const colorTo = new THREE.Color();
  let roughNow = 0.4;
  let metalNow = 0.88;
  const printT = new Tween(0);
  const upT = new Tween(0);
  const xrayT = new Tween(0);

  const sideSign = () => (state?.side === 'lh' ? -1 : 1);

  function localBox(d: BracketDesign, extra = 0) {
    const L = layoutOf(d);
    return { x0: -extra, x1: L.length + extra, y0: -L.halfWidth - extra, y1: L.halfWidth + extra, z0: -extra * 0, z1: L.heightMax };
  }

  function placement(d: BracketDesign, kUp: number) {
    const q = new THREE.Quaternion().slerpQuaternions(Q_BASE, Q_UP, kUp);
    const b = localBox(d);
    const box = new THREE.Box3();
    for (const x of [b.x0, b.x1]) for (const y of [b.y0, b.y1]) for (const z of [b.z0, b.z1]) box.expandByPoint(new THREE.Vector3(x, y, z).applyQuaternion(q));
    const c = box.getCenter(new THREE.Vector3());
    return { q, pos: new THREE.Vector3(-c.x, -box.min.y, -c.z), box };
  }

  function stageDims(d: BracketDesign) {
    const { box } = placement(d, upT.value);
    const size = box.getSize(new THREE.Vector3());
    return { sx: size.x, sy: size.y, sz: size.z };
  }

  function fitCamera() {
    if (!state || !shown) return;
    const printing = state.showPrint;
    const up = printing && state.design.orientation === 'upright' ? 1 : 0;
    const pl = placement(shown, up);
    const pts: THREE.Vector3[] = [];
    const b = localBox(shown, printing ? 0 : 30);
    const zTop = printing ? b.z1 : b.z1 + (state.showLoad ? 110 : 50);
    const zBot = printing ? 0 : -SLAB_DEPTH;
    for (const x of [b.x0, b.x1]) for (const y of [b.y0, b.y1]) for (const z of [zBot, zTop]) {
      pts.push(new THREE.Vector3(x, y, z).applyQuaternion(pl.q).add(pl.pos));
    }
    if (printing) {
      const s = pl.box.getSize(new THREE.Vector3());
      const hx = Math.max(s.x + 60, 220) / 2 + 40;
      const hz = Math.max(s.z + 60, 220) / 2;
      pts.push(new THREE.Vector3(-hx, -PLATE_T, -hz), new THREE.Vector3(hx, 0, hz), new THREE.Vector3(hx + 70, Math.min(s.y * 0.7, 240) + 50, 0));
    }
    const box = new THREE.Box3().setFromPoints(pts);
    const c = box.getCenter(new THREE.Vector3());
    const s = sideSign();
    const dir = (camera.aspect < 0.8 ? new THREE.Vector3(0.95, 0.62, 0.62 * s) : new THREE.Vector3(0.32, 0.6, 0.78 * s)).normalize();
    const probe = new THREE.PerspectiveCamera();
    probe.position.copy(c).add(dir);
    probe.lookAt(c);
    probe.updateMatrixWorld(true);
    const inv = probe.matrixWorldInverse.copy(probe.matrixWorld).invert();
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const tanH = tanV * camera.aspect;
    let dist = 1;
    for (const p of pts) {
      const v = p.clone().applyMatrix4(inv);
      dist = Math.max(dist, 1 + Math.abs(v.x) / tanH + v.z, 1 + Math.abs(v.y) / tanV + v.z);
    }
    dist *= 1.07;
    controls.target.copy(c);
    camera.position.copy(c).addScaledVector(dir, dist);
    camera.near = 5;
    camera.far = 6000;
    camera.updateProjectionMatrix();
    controls.update();
  }

  const resize = () => {
    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (!touched) fitCamera();
    kick();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  controls.addEventListener('start', () => {
    touched = true;
  });

  const matSteel = new THREE.MeshStandardMaterial({ color: '#c4cad0', roughness: 0.4, metalness: 0.75 });
  const glow = (color: string, opacity: number, depthTest = true) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, depthTest, side: THREE.DoubleSide });

  function add(group: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, p: [number, number, number], order = 0, cast = false) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(...p);
    m.renderOrder = order;
    m.castShadow = cast;
    group.add(m);
    return m;
  }

  function zCyl(group: THREE.Object3D, r0: number, r1: number, z0: number, z1: number, x: number, y: number, mat: THREE.Material, seg = 28, order = 0, cast = false) {
    const g = new THREE.CylinderGeometry(r1, r0, z1 - z0, seg);
    g.rotateX(Math.PI / 2);
    return add(group, g, mat, [x, y, (z0 + z1) / 2], order, cast);
  }

  function bolt(group: THREE.Object3D, x: number, y: number, r: number, zBottom: number, zHead: number, headR: number, headH: number) {
    zCyl(group, r, r, zBottom, zHead, x, y, matSteel, 20, 0, true);
    zCyl(group, headR * 1.2, headR * 1.2, zHead, zHead + 1.6, x, y, matSteel, 32, 0, true);
    const head = zCyl(group, headR, headR, zHead + 1.6, zHead + 1.6 + headH, x, y, matSteel, 6, 0, true);
    head.rotation.y = Math.PI / 6;
  }

  function arrow(group: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, color: string, r = 2.2) {
    const dir = to.clone().sub(from);
    const len = dir.length();
    dir.normalize();
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.4, emissive: '#b8872e', emissiveIntensity: 0.6 });
    const headL = Math.min(len * 0.4, r * 5.5);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len - headL, 18), mat);
    shaft.position.copy(from).addScaledVector(dir, (len - headL) / 2);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(r * 2.6, headL, 24), mat);
    cone.position.copy(to).addScaledVector(dir, -headL / 2);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    shaft.quaternion.copy(q);
    cone.quaternion.copy(q);
    shaft.renderOrder = cone.renderOrder = 6;
    group.add(shaft, cone);
  }

  function label(group: THREE.Object3D, text: string, color: string, width: number, p: [number, number, number]) {
    const s = labelSprite(text, color, width);
    s.position.set(...p);
    group.add(s);
  }

  function buildContext(d: BracketDesign, withLabels: boolean, hvFail: boolean, toolFail: boolean) {
    disposeGroup(ctx);
    const L = layoutOf(d);
    const t = L.t;
    const slabMat = new THREE.MeshStandardMaterial({ color: '#3d4b54', roughness: 0.7, metalness: 0.45 });
    const slabW = 2 * (L.halfWidth + 26);
    const slab = add(ctx, new THREE.BoxGeometry(L.length + 60, slabW, SLAB_DEPTH), slabMat, [L.length / 2, 0, -SLAB_DEPTH / 2]);
    slab.receiveShadow = true;
    ctx.add(new THREE.LineSegments(new THREE.EdgesGeometry(slab.geometry), new THREE.LineBasicMaterial({ color: '#6d8190', transparent: true, opacity: 0.6 })).translateX(L.length / 2).translateZ(-SLAB_DEPTH / 2));

    const R = 10;
    const hy = -(HARNESS_OFFSET_MM + R);
    const hMat = new THREE.MeshStandardMaterial({
      color: hvFail ? ALERT : HARNESS, roughness: 0.5, transparent: true, opacity: hvFail ? 0.85 : 0.55, emissive: hvFail ? '#8a1c14' : '#6a3a0c', emissiveIntensity: hvFail ? 0.7 : 0.35, depthWrite: false,
    });
    for (let x = -30; x < L.length + 30; x += 34) {
      const g = new THREE.CylinderGeometry(R, R, 24, 20);
      g.rotateZ(Math.PI / 2);
      add(ctx, g, hMat, [x + 12, hy, R], 2);
    }
    if (hvFail) {
      const gap = L.halfWidth - HARNESS_OFFSET_MM;
      const y0 = gap > 0 ? -(L.halfWidth + 1.2) : -HARNESS_OFFSET_MM;
      const y1 = gap > 0 ? -HARNESS_OFFSET_MM + 1.2 : -L.halfWidth;
      const lo = Math.min(y0, y1);
      const hi = Math.max(y0, y1);
      add(ctx, new THREE.BoxGeometry(L.length + 60, Math.max(hi - lo, 1.2), 2 * R + 6), glow(ALERT, 0.38, false), [L.length / 2, (lo + hi) / 2, R + 3], 5);
      const clearance = HARNESS_OFFSET_MM - L.halfWidth;
      if (withLabels) label(ctx, `HV gap ${clearance.toFixed(0)} mm (need ${HARNESS_CLEARANCE_MM})`, ALERT, 17, [L.length * 0.5, hy - 6, R + 26]);
    }

    const ySide = [L.pilot.y, L.slot.y];
    const xs = [L.pilot.x, L.slot.x];
    for (let i = 0; i < 2; i++) bolt(ctx, xs[i], ySide[i], 4.8, -SLAB_DEPTH + 3, t, 8.6, 6.4);
    if (toolFail) {
      for (let i = 0; i < 2; i++) {
        const g = new THREE.CylinderGeometry(SOCKET_RADIUS_MM, SOCKET_RADIUS_MM * 0.75, 25, 36, 1, true);
        g.rotateX(Math.PI / 2);
        add(ctx, g, glow(ALERT, 0.42, false), [xs[i], ySide[i], t + 8 + 12.5], 5);
      }
    }

    const trackLen = L.length + 30;
    const trackG = new THREE.BoxGeometry(trackLen, TRACK_W, TRACK_H);
    const trackMat = new THREE.MeshStandardMaterial({ color: '#8ea2b2', roughness: 0.5, metalness: 0.6, transparent: true, opacity: 0.5, depthWrite: false });
    const track = add(ctx, trackG, trackMat, [L.length / 2, 0, topAt(L.length / 2) + TRACK_H / 2 / Math.cos(PITCH)], 3);
    track.rotation.y = -PITCH;
    track.add(new THREE.LineSegments(new THREE.EdgesGeometry(trackG), new THREE.LineBasicMaterial({ color: '#c3d3df', transparent: true, opacity: 0.7 })));
    for (const xb of L.bosses) {
      const zTop = topAt(xb) + TRACK_H / Math.cos(PITCH);
      bolt(ctx, xb, 0, 3.9, topAt(xb) - t - L.bossHeight + 0.5, zTop, 7.4, 5.3);
    }
    if (withLabels) {
      label(ctx, 'BIW crossmember', MUTED, 13, [L.length + 6, 0, -6]);
      label(ctx, 'HV harness', HARNESS, 13, [L.length * 0.82, hy - 4, R + 18]);
      label(ctx, 'Seat track', MUTED, 13, [L.length * 0.05, 0, topAt(L.length * 0.05) + 24]);
    }
  }

  function buildLoads(d: BracketDesign) {
    disposeGroup(loads);
    const L = layoutOf(d);
    const trackTop = (x: number) => topAt(x) + TRACK_H / Math.cos(PITCH);
    const zA = trackTop(170) + 34;
    arrow(loads, new THREE.Vector3(190, 0, zA), new THREE.Vector3(50, 0, zA), GOLD, 2.4);
    label(loads, `LC-01  ${Math.round(INERTIAL_N / 2).toLocaleString('en-US')} N fore-aft`, GOLD, 19, [150, 0, zA + 24]);
    const xr = L.bosses[1];
    arrow(loads, new THREE.Vector3(xr, 0, trackTop(xr) + 22), new THREE.Vector3(xr, 0, trackTop(xr) + 78), GOLD, 2.4);
    label(loads, 'LC-01  3,289 N uplift', GOLD, 19, [xr + 25, 0, trackTop(xr) + 92]);
    const xk = 225;
    arrow(loads, new THREE.Vector3(xk, 0, trackTop(xk) + 120), new THREE.Vector3(xk, 0, trackTop(xk) + 3), GOLD, 2.4);
    label(loads, `LC-04  ${KICK_N.toLocaleString('en-US')} N kick`, GOLD, 19, [xk - 35, 0, trackTop(xk) + 138]);
  }

  function failedIds(v: Verification) {
    return new Set(v.checks.filter((c) => c.status === 'fail').map((c) => c.id));
  }

  function buildFails(d: BracketDesign, fail: Set<string>) {
    disposeGroup(fails);
    const L = layoutOf(d);
    const t = L.t;
    const inner = L.topWidth / 2;
    const outer = inner + t;
    const red = (o = 0.5) => glow(ALERT, o);

    if (fail.has('LC-01') || fail.has('LC-01-STRAIN')) {
      add(fails, new THREE.BoxGeometry(60, L.lip, 0.8), red(0.55), [L.pilot.x + 6, L.pilot.y, t + 0.5], 4);
      add(fails, new THREE.BoxGeometry(60, L.lip, 0.8), red(0.55), [L.slot.x - 6, L.slot.y, t + 0.5], 4);
    }
    if (fail.has('LC-04') || fail.has('SLAM')) {
      const g = new THREE.BoxGeometry(140, 2 * outer, 0.9);
      const m = add(fails, g, red(0.55), [310, 0, topAt(310) + 0.5], 4);
      m.rotation.y = -PITCH;
    }
    if (fail.has('NVH')) {
      const geo = (shift: number) => {
        const g = new THREE.ExtrudeGeometry(wallShape(d, 16), { depth: 0.7, bevelEnabled: false, curveSegments: 16 });
        g.applyMatrix4(new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, -1, shift, 0, 1, 0, 0, 0, 0, 0, 1));
        return g;
      };
      add(fails, geo(outer + 0.7), red(0.5), [0, 0, 0], 4);
      add(fails, geo(-outer), red(0.5), [0, 0, 0], 4);
    }
    if (fail.has('DATUM-A')) {
      for (const sy of [1, -1]) {
        const y0 = outer + L.lip / 2;
        add(fails, new THREE.BoxGeometry(L.length + 2, 1.4, 1.4), red(0.95), [L.length / 2, sy * (outer + L.lip + 0.2), 0.7], 5);
        add(fails, new THREE.BoxGeometry(1.4, L.lip, 1.4), red(0.95), [-0.2, sy * y0, 0.7], 5);
        add(fails, new THREE.BoxGeometry(1.4, L.lip, 1.4), red(0.95), [L.length + 0.2, sy * y0, 0.7], 5);
      }
    }
    if (fail.has('DATUM-BC')) {
      const ring = (x: number, y: number, rx: number, ry: number) => {
        const s = new THREE.Shape();
        s.absellipse(0, 0, rx + 3.2, ry + 3.2, 0, Math.PI * 2, false, 0);
        const h = new THREE.Path();
        h.absellipse(0, 0, rx + 1.2, ry + 1.2, 0, Math.PI * 2, true, 0);
        s.holes.push(h);
        add(fails, new THREE.ShapeGeometry(s, 40), glow(ALERT, 0.95, false), [x, y, t + 0.12], 6);
      };
      ring(L.pilot.x, L.pilot.y, L.pilot.d / 2, L.pilot.d / 2);
      ring(L.slot.x, L.slot.y, L.slot.l / 2, L.slot.w / 2);
    }
    if (fail.has('TRACK')) {
      for (const xb of L.bosses) {
        const g = new THREE.RingGeometry(9.5, 11.5, 40);
        const m = add(fails, g, glow(ALERT, 0.95, false), [xb, 0, topAt(xb) + TRACK_H / Math.cos(PITCH) + 0.2], 6);
        m.rotation.y = -PITCH;
      }
    }
    if (fail.has('JOINING')) {
      for (const xb of L.bosses) {
        const g = new THREE.CylinderGeometry(9, 9, L.bossHeight + 2, 32);
        g.rotateX(Math.PI / 2);
        add(fails, g, glow(ALERT, 0.55, false), [xb, 0, topAt(xb) - t - L.bossHeight / 2 + 1], 6);
      }
    }
    if (fail.has('MASS')) {
      const out = new THREE.Mesh(part.geometry, new THREE.MeshBasicMaterial({ color: ALERT, side: THREE.BackSide, transparent: true, opacity: 0.55, depthWrite: false }));
      const k = 1.03;
      const c = new THREE.Vector3(L.length / 2, 0, L.heightMax / 2);
      out.scale.setScalar(k);
      out.position.set(c.x * (1 - k), 0, c.z * (1 - k));
      out.userData.shared = true;
      out.renderOrder = 1;
      fails.add(out);
      const bb = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(L.length + 8, 2 * L.halfWidth + 8, L.heightMax + 8)), new THREE.LineBasicMaterial({ color: ALERT }));
      bb.position.set(L.length / 2, 0, L.heightMax / 2);
      fails.add(bb);
    }
  }

  function buildPrint(d: BracketDesign, fail: Set<string>) {
    disposeGroup(printFx);
    if (d.orientation !== 'pads-down') return;
    const L = layoutOf(d);
    const t = L.t;
    const inner = L.topWidth / 2;
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    s.lineTo(L.length, 0);
    s.lineTo(L.length, topAt(L.length) - t);
    s.lineTo(0, topAt(0) - t);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 2 * inner - 0.6, bevelEnabled: false });
    g.applyMatrix4(new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, -1, inner - 0.3, 0, 1, 0, 0, 0, 0, 0, 1));
    const bad = fail.has('AM-PRINT');
    const mat = new THREE.MeshStandardMaterial({ color: SUPPORT, transparent: true, opacity: 0.5, roughness: 0.7, depthWrite: false, emissive: bad ? '#a82a1a' : '#a8681a', emissiveIntensity: 0.6 });
    const block = new THREE.Mesh(g, mat);
    block.renderOrder = 5;
    printFx.add(block);
    const lines: number[] = [];
    for (let x = 6; x < L.length; x += 9) {
      for (const y of [-inner * 0.7, 0, inner * 0.7]) lines.push(x, y, 0.4, x, y, topAt(x) - t - 0.4);
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
    const ls = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: bad ? ALERT : SUPPORT, transparent: true, opacity: 0.85 }));
    ls.renderOrder = 6;
    printFx.add(ls);
    label(printFx, bad ? 'Trapped supports in channel' : 'Supports in channel', bad ? ALERT : SUPPORT, 19, [L.length * 0.5, 0, topAt(L.length * 0.5) + 22]);
  }

  function setGeometry(d: BracketDesign, hi: boolean) {
    if (!state) return;
    const old = part.geometry;
    part.geometry = hi ? riserGeometry(d, state.side, HI_SEG) : riserGeometryLo(d, state.side);
    old.dispose();
    shown = d;
  }

  function mirrorGroups() {
    const s = sideSign();
    for (const g of [ctx, loads, fails, printFx]) g.scale.set(1, s, 1);
  }

  function rebuild(final: boolean) {
    if (!state || !shown) return;
    mirrorGroups();
    sun.position.z = 260 * sideSign();
    fill.position.z = -220 * sideSign();
    const fail = failedIds(state.verification);
    buildContext(shown, final, fail.has('KEEPOUT-HV'), fail.has('KEEPOUT-TOOL'));
    if (final) {
      buildLoads(shown);
      buildFails(shown, fail);
      buildPrint(shown, fail);
    } else {
      disposeGroup(loads);
      disposeGroup(fails);
      disposeGroup(printFx);
    }
    syncVisibility();
  }

  function syncVisibility() {
    if (!state) return;
    const p = state.showPrint;
    ctx.visible = !p;
    loads.visible = state.showLoad && !p;
    fails.visible = !p;
    printFx.visible = p;
  }

  function driveTweens(now: number) {
    if (!state) return;
    const ms = reduced() ? 0 : PRINT_MS;
    printT.set(state.showPrint ? 1 : 0, now, ms);
    upT.set(state.showPrint && state.design.orientation === 'upright' ? 1 : 0, now, ms);
    xrayT.set(state.xray || (state.showPrint && state.design.orientation === 'pads-down') ? 1 : 0, now, ms ? 300 : 0);
  }

  function applyLook() {
    partMat.color.copy(colorNow);
    partMat.roughness = roughNow;
    partMat.metalness = metalNow;
    const v = xrayT.value;
    partMat.transparent = v > 0.001;
    partMat.opacity = mix(1, 0.28, v);
    partMat.depthWrite = v < 0.5;
    part.castShadow = v < 0.5;
  }

  function placeStage() {
    if (!shown) return;
    const pl = placement(shown, upT.value);
    vehicle.quaternion.copy(pl.q);
    vehicle.position.copy(pl.pos);
    const p = printT.value;
    const on = p > 0.01;
    plate.visible = on;
    plateLabel.visible = on;
    buildArrow.visible = on;
    const s = pl.box.getSize(new THREE.Vector3());
    const pw = Math.max(s.x + 60, 220);
    const pd = Math.max(s.z + 60, 220);
    plate.scale.set(pw, PLATE_T, pd);
    plate.position.set(0, -PLATE_T / 2, 0);
    plateMat.opacity = p;
    plateEdgeMat.opacity = p * 0.75;
    (plateLabel.material as THREE.SpriteMaterial).opacity = p;
    plateLabel.position.set(-pw / 2 + 50, 8, pd / 2 + 4);
    arrowMat.opacity = p;
    (buildLabel.material as THREE.SpriteMaterial).opacity = p;
    const len = clamp(s.y * 0.7, 55, 240);
    arrowShaft.scale.y = len;
    arrowShaft.position.y = len / 2;
    arrowHead.position.y = len + 6;
    buildLabel.position.y = len + 24;
    buildArrow.position.set(pw / 2 + 28, 0, 0);
    const floor = mix(FLOOR_Y, -PLATE_T - 0.2, p);
    grid.position.y = floor;
    shadowFloor.position.y = floor + 0.02;
    (grid.material as THREE.Material).opacity = 1 - p * 0.6;
  }

  function frameStep(now: number) {
    if (morph && target && state) {
      const k = clamp((now - morph.t0) / morph.ms, 0, 1);
      const e = smooth(k);
      const look = MATERIAL_LOOK[state.design.material];
      if (k >= 1) {
        const done = target;
        morph = null;
        setGeometry(done, true);
        colorNow.set(look.color);
        roughNow = look.roughness;
        metalNow = look.metalness;
        rebuild(true);
      } else {
        const mid = mixDesign(morph.from, target, e);
        setGeometry(mid, false);
        colorTo.set(look.color);
        colorNow.copy(morph.colorFrom).lerp(colorTo, e);
        roughNow = mix(morph.roughFrom, look.roughness, e);
        metalNow = mix(morph.metalFrom, look.metalness, e);
        rebuild(false);
      }
    }
    driveTweens(now);
    const steps = [printT.step(now), upT.step(now), xrayT.step(now)];
    applyLook();
    placeStage();
    return morph !== null || steps.some(Boolean);
  }

  function frame(t: number) {
    raf = 0;
    if (disposed) return;
    const moving = frameStep(t);
    const ctl = controls.update();
    renderer.render(scene, camera);
    if (moving || ctl) kick();
  }

  function kick() {
    if (!raf && !disposed) raf = requestAnimationFrame(frame);
  }
  controls.addEventListener('change', kick);

  return {
    update(next) {
      const now = performance.now();
      const keyChanged = lastKey !== undefined && next.key !== undefined && next.key !== lastKey;
      const ms = next.morphMs ?? 0;
      const wantMorph = keyChanged && ms > 0 && !reduced() && shown !== null;
      lastKey = next.key ?? lastKey;
      const prevSide = state?.side;
      const prevPrint = state?.showPrint;
      const prevOrient = state?.design.orientation;
      state = next;
      const look = MATERIAL_LOOK[next.design.material];
      if (wantMorph && shown) {
        morph = { from: shown, t0: now, ms, colorFrom: colorNow.clone(), roughFrom: roughNow, metalFrom: metalNow };
        target = next.design;
      } else if (morph) {
        target = next.design;
      } else {
        morph = null;
        target = next.design;
        setGeometry(next.design, true);
        colorNow.set(look.color);
        roughNow = look.roughness;
        metalNow = look.metalness;
        rebuild(true);
        if (reduced()) {
          printT.set(next.showPrint ? 1 : 0, now, 0);
          upT.set(next.showPrint && next.design.orientation === 'upright' ? 1 : 0, now, 0);
          xrayT.set(next.xray || (next.showPrint && next.design.orientation === 'pads-down') ? 1 : 0, now, 0);
        }
      }
      driveTweens(now);
      syncVisibility();
      const sig = `${next.side}|${next.showPrint}|${next.design.orientation}`;
      if (fitSig === '' || (!touched && sig !== fitSig) || prevSide !== next.side || prevPrint !== next.showPrint || prevOrient !== next.design.orientation) {
        if (sig !== fitSig) touched = false;
        fitSig = sig;
        fitCamera();
      }
      kick();
    },
    resetView() {
      touched = false;
      fitCamera();
      kick();
    },
    capture() {
      frameStep(performance.now());
      controls.update();
      renderer.render(scene, camera);
      return dom.toDataURL('image/png');
    },
    dispose() {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      for (const g of [ctx, loads, fails, printFx]) disposeGroup(g);
      part.geometry.dispose();
      partMat.dispose();
      matSteel.dispose();
      disposeGroup(plate);
      disposeGroup(buildArrow);
      disposeGroup(plateLabel);
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
      shadowFloor.geometry.dispose();
      (shadowFloor.material as THREE.Material).dispose();
      envTex.dispose();
      pmrem.dispose();
      renderer.dispose();
      dom.remove();
    },
  };
}
