import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createFurnitureKit } from './furniture-mesh';
import type { FurnishResult, Piece, Room, Unit, UnitStatus } from './model';
import { TOWER, formatINR, unitById } from './tower';

export interface TowerSceneCallbacks {
  onHoverFloor?(floor: number | null): void;
  onPickUnit?(unitId: string): void;
}

export interface TowerSceneState {
  mode: 'tower' | 'unit';
  floor: number | null;
  unitId: string | null;
  furnish: FurnishResult | null;
  highlight?: string[];
  key?: string;
  morphMs?: number;
}

export interface TowerScene {
  update(state: TowerSceneState): void;
  resetView(): void;
  dispose(): void;
}

const FH = TOWER.floorHeight;
const FW = TOWER.footprint.w;
const FD = TOWER.footprint.d;
const FLOORS = TOWER.floors;
const LOBBY = FH * 2;
const TOP = LOBBY + FLOORS * FH;
const SLAB_T = 0.36;
const WALL_H = 2.9;
const LOW_H = 1.25;
const RAIL_H = 1.05;
const WALL_T = 0.12;
const FLIGHT_S = 2.7;
const TOWER_FOV = 30;
const UNIT_FOV = 36;
const FRONT_YAW = Math.PI;

const floorBase = (f: number) => LOBBY + (f - 1) * FH;
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutBack = (t: number) => {
  const c1 = 1.4;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
const rng = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const STATUS_COLOR: Record<UnitStatus, string> = { available: '#19d9b8', reserved: '#f5b83d', sold: '#8d95a6' };
const STATUS_OPACITY: Record<UnitStatus, number> = { available: 0.5, reserved: 0.5, sold: 0.3 };
const STATUS_LABEL: Record<UnitStatus, string> = { available: 'Available', reserved: 'Reserved', sold: 'Sold' };

const FLOOR_STYLE: Record<Room['kind'], { color: string; tex: 'wood' | 'tile' | 'stone' }> = {
  living: { color: '#c9a577', tex: 'wood' },
  kitchen: { color: '#c8cbcf', tex: 'tile' },
  bedroom: { color: '#d2b48a', tex: 'wood' },
  master: { color: '#b98e63', tex: 'wood' },
  bath: { color: '#a9c2cf', tex: 'tile' },
  balcony: { color: '#b8b2a6', tex: 'stone' },
  study: { color: '#bf9f78', tex: 'wood' },
};

function canvasOf(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function makeTexture(c: HTMLCanvasElement, repeat = false) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function woodCanvas() {
  const c = canvasOf(512, 512);
  const g = c.getContext('2d')!;
  const r = rng(7);
  g.fillStyle = '#d9d9d9';
  g.fillRect(0, 0, 512, 512);
  const rows = 8;
  for (let i = 0; i < rows; i++) {
    let x = -r() * 200;
    while (x < 512) {
      const w = 180 + r() * 160;
      const l = 205 + Math.floor(r() * 40);
      g.fillStyle = `rgb(${l},${l},${l})`;
      g.fillRect(x, (i * 512) / rows, w, 512 / rows);
      g.fillStyle = 'rgba(0,0,0,0.28)';
      g.fillRect(x, (i * 512) / rows, 1.5, 512 / rows);
      x += w;
    }
    g.fillStyle = 'rgba(0,0,0,0.2)';
    g.fillRect(0, (i * 512) / rows, 512, 1.5);
  }
  return c;
}

function tileCanvas() {
  const c = canvasOf(256, 256);
  const g = c.getContext('2d')!;
  g.fillStyle = '#f0f0f0';
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(0,0,0,0.22)';
  g.lineWidth = 2;
  for (let i = 0; i <= 4; i++) {
    g.beginPath();
    g.moveTo((i * 256) / 4, 0);
    g.lineTo((i * 256) / 4, 256);
    g.moveTo(0, (i * 256) / 4);
    g.lineTo(256, (i * 256) / 4);
    g.stroke();
  }
  return c;
}

function stoneCanvas() {
  const c = canvasOf(256, 256);
  const g = c.getContext('2d')!;
  const r = rng(11);
  g.fillStyle = '#e4e4e4';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 700; i++) {
    const l = 190 + Math.floor(r() * 50);
    g.fillStyle = `rgba(${l},${l},${l},0.5)`;
    g.fillRect(r() * 256, r() * 256, 2 + r() * 5, 2 + r() * 5);
  }
  g.strokeStyle = 'rgba(0,0,0,0.16)';
  g.lineWidth = 2;
  g.strokeRect(0, 0, 256, 256);
  return c;
}

function facadeTextures() {
  const cols = [17, 11, 17, 11];
  const total = cols.reduce((a, b) => a + b, 0);
  const cw = 28;
  const ch = 46;
  const color = canvasOf(total * cw, FLOORS * ch);
  const glow = canvasOf(total * cw, FLOORS * ch);
  const g = color.getContext('2d')!;
  const e = glow.getContext('2d')!;
  e.fillStyle = '#000';
  e.fillRect(0, 0, glow.width, glow.height);
  const r = rng(21);
  const lit = ['#ffd9a3', '#ffe7c2', '#ffc98a', '#f7efe0', '#cfe2ff'];
  for (let row = 0; row < FLOORS; row++) {
    for (let col = 0; col < total; col++) {
      const x = col * cw;
      const y = (FLOORS - 1 - row) * ch;
      const grad = g.createLinearGradient(0, y, 0, y + ch);
      grad.addColorStop(0, '#34506f');
      grad.addColorStop(1, '#1b2a42');
      g.fillStyle = grad;
      g.fillRect(x, y, cw, ch);
      g.fillStyle = 'rgba(255,255,255,0.07)';
      g.fillRect(x + 2, y + 3, cw * 0.35, ch - 10);
      const on = r() < 0.3 + (row % 5 === 0 ? 0.05 : 0);
      if (on) {
        const c = lit[Math.floor(r() * lit.length)];
        g.fillStyle = c;
        g.fillRect(x + 3, y + 5, cw - 6, ch - 14);
        e.fillStyle = c;
        e.fillRect(x + 3, y + 5, cw - 6, ch - 14);
      }
      g.fillStyle = '#10151f';
      g.fillRect(x, y + ch - 7, cw, 7);
    }
  }
  return { color: makeTexture(color), glow: makeTexture(glow), cols, total };
}

function blockTexture() {
  const cw = 20;
  const ch = 28;
  const c = canvasOf(cw * 8, ch * 8);
  const e = canvasOf(cw * 8, ch * 8);
  const g = c.getContext('2d')!;
  const l = e.getContext('2d')!;
  l.fillStyle = '#000';
  l.fillRect(0, 0, e.width, e.height);
  g.fillStyle = '#4a4f63';
  g.fillRect(0, 0, c.width, c.height);
  const r = rng(5);
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      const on = r() < 0.32;
      const col = on ? (r() < 0.7 ? '#ffd9a3' : '#cfe2ff') : '#2a3044';
      g.fillStyle = col;
      g.fillRect(x * cw + 3, y * ch + 5, cw - 6, ch - 11);
      if (on) {
        l.fillStyle = col;
        l.fillRect(x * cw + 3, y * ch + 5, cw - 6, ch - 11);
      }
    }
  const t = makeTexture(c, true);
  const t2 = makeTexture(e, true);
  return { color: t, glow: t2 };
}

function labelTexture(unit: Unit, full: boolean) {
  if (!full) return compactLabel(unit);
  const c = canvasOf(512, 176);
  const g = c.getContext('2d')!;
  const col = STATUS_COLOR[unit.status];
  g.fillStyle = 'rgba(14,18,30,0.86)';
  g.beginPath();
  g.roundRect(6, 6, 500, 164, 30);
  g.fill();
  g.strokeStyle = col;
  g.lineWidth = 5;
  g.stroke();
  g.fillStyle = col;
  g.beginPath();
  g.arc(52, 62, 14, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#fff';
  g.font = '700 58px system-ui, -apple-system, Segoe UI, sans-serif';
  g.textBaseline = 'middle';
  g.fillText(`${unit.id}  ${unit.type}`, 82, 62);
  g.fillStyle = 'rgba(255,255,255,0.82)';
  g.font = '500 40px system-ui, -apple-system, Segoe UI, sans-serif';
  g.fillText(`${STATUS_LABEL[unit.status]}  ${formatINR(unit.priceINR)}`, 34, 128);
  return makeTexture(c);
}

function compactLabel(unit: Unit) {
  const c = canvasOf(256, 96);
  const g = c.getContext('2d')!;
  const col = STATUS_COLOR[unit.status];
  g.fillStyle = 'rgba(14,18,30,0.84)';
  g.beginPath();
  g.roundRect(4, 4, 248, 88, 44);
  g.fill();
  g.strokeStyle = col;
  g.lineWidth = 4;
  g.stroke();
  g.fillStyle = col;
  g.beginPath();
  g.arc(48, 48, 14, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#fff';
  g.font = '700 44px system-ui, -apple-system, Segoe UI, sans-serif';
  g.textBaseline = 'middle';
  g.fillText(unit.id, 76, 50);
  return makeTexture(c);
}

function skyMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color('#0d1230') },
      mid: { value: new THREE.Color('#4b4482') },
      low: { value: new THREE.Color('#d9808f') },
      hor: { value: new THREE.Color('#f6b48a') },
      sunDir: { value: new THREE.Vector3(0.6, 0.06, 0.8).normalize() },
    },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `
      varying vec3 vDir; uniform vec3 top; uniform vec3 mid; uniform vec3 low; uniform vec3 hor; uniform vec3 sunDir;
      void main(){
        float h = clamp(vDir.y, -0.2, 1.0);
        vec3 c = mix(hor, low, smoothstep(0.0, 0.1, h));
        c = mix(c, mid, smoothstep(0.08, 0.38, h));
        c = mix(c, top, smoothstep(0.3, 0.85, h));
        c = mix(c, hor * 0.7, smoothstep(0.0, -0.2, vDir.y));
        float s = max(dot(normalize(vDir), sunDir), 0.0);
        c += vec3(1.0, 0.62, 0.38) * (pow(s, 24.0) * 0.55 + pow(s, 4.0) * 0.12);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

function box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number) {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  g.translate(cx, cy, cz);
  return g;
}

function mergeAll(list: THREE.BufferGeometry[]) {
  if (!list.length) return null;
  const m = mergeGeometries(list, false);
  list.forEach((g) => g.dispose());
  return m;
}

interface Pose {
  pos: THREE.Vector3;
  target: THREE.Vector3;
  fov: number;
}

interface FurnEntry {
  id: string;
  sig: string;
  obj: THREE.Group;
  ring: THREE.Mesh;
  glow: THREE.Object3D | null;
  startAt: number;
  dur: number;
  state: 'hidden' | 'drop' | 'done';
}

export function createTowerScene(container: HTMLElement, callbacks: TowerSceneCallbacks = {}): TowerScene {
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.localClippingEnabled = true;
  const canvas = renderer.domElement;
  canvas.style.cssText = 'display:block;width:100%;height:100%;outline:none;touch-action:none';
  container.appendChild(canvas);

  const scene = new THREE.Scene();
  const horizon = new THREE.Color('#e9a083');
  scene.fog = new THREE.FogExp2(new THREE.Color('#9a6f86'), 0.0030);

  const sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 16), skyMaterial());
  sky.renderOrder = -10;
  scene.add(sky);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), skyMaterial()));
  const softbox = (color: number, x: number, y: number, z: number, w: number, h: number, i: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(i), side: THREE.DoubleSide }));
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    envScene.add(m);
  };
  softbox(0xffc79a, 30, 12, 34, 30, 14, 5);
  softbox(0x7d9cff, -34, 20, -20, 26, 20, 2.2);
  softbox(0xffffff, 0, 42, 0, 30, 30, 1.6);
  const envTex = pmrem.fromScene(envScene, 0.02).texture;
  scene.environment = envTex;
  scene.environmentIntensity = 0.55;

  const camera = new THREE.PerspectiveCamera(TOWER_FOV, 1, 0.5, 3000);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.09;
  controls.enablePan = false;

  const hemi = new THREE.HemisphereLight(0xb8a6d8, 0x3a2f36, 0.55);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffc294, 2.4);
  sun.position.set(80, 60, 90);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);
  const sunWhite = new THREE.Color(0xfff0e0);
  const hemiWhite = new THREE.Color(0xe8ecff);
  const rim = new THREE.DirectionalLight(0x7f9bff, 0.9);
  rim.position.set(-90, 40, -60);
  scene.add(rim);

  const clip = new THREE.Plane(new THREE.Vector3(0, -1, 0), TOP + 10);
  const clipLow = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const clipList = [clip, clipLow];
  const disposables: { dispose(): void }[] = [sky.geometry, sky.material as THREE.Material, envTex, pmrem];

  const track = <T extends { dispose(): void }>(o: T) => {
    disposables.push(o);
    return o;
  };

  const fac = facadeTextures();
  track(fac.color);
  track(fac.glow);
  const blockTex = blockTexture();
  track(blockTex.color);
  track(blockTex.glow);

  const world = new THREE.Group();
  scene.add(world);

  const ground = new THREE.Mesh(
    track(new THREE.CircleGeometry(1400, 64)),
    track(new THREE.MeshStandardMaterial({ color: '#1f2a2c', roughness: 1 })),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;
  ground.receiveShadow = false;
  world.add(ground);

  const lawnMat = track(new THREE.MeshStandardMaterial({ color: '#2f4a38', roughness: 1 }));
  const lawn = new THREE.Mesh(track(new THREE.PlaneGeometry(120, 90)), lawnMat);
  lawn.rotation.x = -Math.PI / 2;
  lawn.position.y = 0.0;
  world.add(lawn);

  const roadMat = track(new THREE.MeshStandardMaterial({ color: '#23262e', roughness: 0.85 }));
  const roadGeo = track(new THREE.PlaneGeometry(1, 1));
  const road = (x: number, z: number, w: number, d: number) => {
    const m = new THREE.Mesh(roadGeo, roadMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.03, z);
    m.scale.set(w, d, 1);
    world.add(m);
  };
  road(0, 56, 300, 11);
  road(-64, 0, 11, 300);

  const podiumMat = track(new THREE.MeshStandardMaterial({ color: '#cfc7bb', roughness: 0.8 }));
  const podium = new THREE.Mesh(track(new THREE.BoxGeometry(FW + 18, 0.9, FD + 18)), podiumMat);
  podium.position.y = 0.45;
  world.add(podium);
  const plinth = new THREE.Mesh(track(new THREE.BoxGeometry(FW + 22, 0.3, FD + 22)), track(new THREE.MeshStandardMaterial({ color: '#8e867b', roughness: 0.9 })));
  plinth.position.y = 0.15;
  world.add(plinth);

  const pond = new THREE.Mesh(
    track(new THREE.PlaneGeometry(30, 9)),
    track(new THREE.MeshStandardMaterial({ color: '#14243a', roughness: 0.04, metalness: 0.95, envMapIntensity: 1.6 })),
  );
  pond.rotation.x = -Math.PI / 2;
  pond.position.set(0, 0.95, FD / 2 + 14.5);
  world.add(pond);
  const pondEdge = new THREE.Mesh(track(new THREE.BoxGeometry(31, 0.2, 10)), podiumMat);
  pondEdge.position.set(0, 0.88, FD / 2 + 14.5);
  world.add(pondEdge);

  const slabMat = track(new THREE.MeshStandardMaterial({ color: '#bdb8b0', roughness: 0.8, clippingPlanes: clipList }));
  const mullionMat = track(new THREE.MeshStandardMaterial({ color: '#c4c0ba', roughness: 0.5, metalness: 0.5, clippingPlanes: clipList }));
  const finMat = track(new THREE.MeshStandardMaterial({ color: '#2d3139', roughness: 0.45, metalness: 0.6, clippingPlanes: clipList }));
  const coreMat = track(new THREE.MeshStandardMaterial({ color: '#8f8a84', roughness: 0.9, clippingPlanes: clipList }));
  const glassMat = track(
    new THREE.MeshStandardMaterial({
      map: fac.color,
      emissiveMap: fac.glow,
      emissive: new THREE.Color('#ffffff'),
      emissiveIntensity: 1.25,
      roughness: 0.2,
      metalness: 0.6,
      envMapIntensity: 1.1,
      side: THREE.DoubleSide,
      clippingPlanes: clipList,
    }),
  );

  const faceGeos: THREE.BufferGeometry[] = [];
  const faceDefs: { w: number; ry: number; x: number; z: number; col0: number; n: number }[] = [
    { w: FW, ry: 0, x: 0, z: FD / 2 + 0.1, col0: 0, n: 17 },
    { w: FD, ry: Math.PI / 2, x: FW / 2 + 0.1, z: 0, col0: 17, n: 11 },
    { w: FW, ry: Math.PI, x: 0, z: -FD / 2 - 0.1, col0: 28, n: 17 },
    { w: FD, ry: -Math.PI / 2, x: -FW / 2 - 0.1, z: 0, col0: 45, n: 11 },
  ];
  for (const f of faceDefs) {
    const g = new THREE.PlaneGeometry(f.w + 0.2, TOP - LOBBY);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setX(i, (f.col0 + uv.getX(i) * f.n) / fac.total);
    g.rotateY(f.ry);
    g.translate(f.x, LOBBY + (TOP - LOBBY) / 2, f.z);
    faceGeos.push(g);
  }
  const glassGeo = track(mergeAll(faceGeos)!);
  const glass = new THREE.Mesh(glassGeo, glassMat);
  world.add(glass);

  const slabGeo = track(new THREE.BoxGeometry(FW + 0.9, SLAB_T, FD + 0.9));
  const slabs = new THREE.InstancedMesh(slabGeo, slabMat, FLOORS + 1);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i <= FLOORS; i++) {
    m4.makeTranslation(0, LOBBY + i * FH - SLAB_T / 2, 0);
    slabs.setMatrixAt(i, m4);
  }
  world.add(slabs);

  const mullGeo = track(new THREE.BoxGeometry(0.14, TOP - LOBBY, 0.22));
  const mullPos: [number, number, number][] = [];
  for (let i = 0; i <= 17; i++) {
    const x = -FW / 2 + (i * FW) / 17;
    mullPos.push([x, 0, FD / 2 + 0.2], [x, 0, -FD / 2 - 0.2]);
  }
  for (let i = 1; i < 11; i++) {
    const z = -FD / 2 + (i * FD) / 11;
    mullPos.push([FW / 2 + 0.2, Math.PI / 2, z], [-FW / 2 - 0.2, Math.PI / 2, z]);
  }
  const mullions = new THREE.InstancedMesh(mullGeo, mullionMat, mullPos.length);
  const e4 = new THREE.Euler();
  mullPos.forEach(([a, ry, b], i) => {
    e4.set(0, ry, 0);
    m4.makeRotationFromEuler(e4);
    if (ry === 0) m4.setPosition(a, LOBBY + (TOP - LOBBY) / 2, b);
    else m4.setPosition(a, LOBBY + (TOP - LOBBY) / 2, b);
    mullions.setMatrixAt(i, m4);
  });
  world.add(mullions);

  const finGeo = track(new THREE.BoxGeometry(1.1, TOP + 2.2 - 0.9, 1.1));
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const f = new THREE.Mesh(finGeo, finMat);
      f.position.set((sx * (FW + 0.9)) / 2, (TOP + 2.2 + 0.9) / 2, (sz * (FD + 0.9)) / 2);
      world.add(f);
    }

  const core = new THREE.Mesh(track(new THREE.BoxGeometry(8, TOP - LOBBY, 6)), coreMat);
  core.position.y = LOBBY + (TOP - LOBBY) / 2;
  world.add(core);

  const crown = new THREE.Group();
  const crownBase = new THREE.Mesh(track(new THREE.BoxGeometry(FW + 1.6, 1.0, FD + 1.6)), slabMat);
  crownBase.position.y = TOP + 0.5;
  const plant = new THREE.Mesh(track(new THREE.BoxGeometry(14, 3.2, 9)), finMat);
  plant.position.set(-3, TOP + 2.6, 0);
  const mast = new THREE.Mesh(track(new THREE.CylinderGeometry(0.1, 0.2, 14, 8)), finMat);
  mast.position.set(6, TOP + 8, 0);
  const blink = new THREE.Mesh(track(new THREE.SphereGeometry(0.4, 12, 8)), track(new THREE.MeshBasicMaterial({ color: '#ff3b4a', toneMapped: false })));
  blink.position.set(6, TOP + 15.2, 0);
  const crownLight = new THREE.Mesh(track(new THREE.BoxGeometry(FW + 1.7, 0.18, FD + 1.7)), track(new THREE.MeshBasicMaterial({ color: '#ffd9a8', toneMapped: false })));
  crownLight.position.y = TOP + 1.05;
  crown.add(crownBase, plant, mast, blink, crownLight);
  world.add(crown);
  crown.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.Material | undefined;
    if (!m) return;
    if (m === slabMat || m === finMat) return;
    const c = m.clone();
    c.clippingPlanes = clipList;
    (o as THREE.Mesh).material = c;
    disposables.push(c);
  });

  const lobbyMat = track(new THREE.MeshStandardMaterial({ color: '#1d1a17', emissive: new THREE.Color('#ffb36b'), emissiveIntensity: 1.3, roughness: 0.6 }));
  const lobby = new THREE.Mesh(track(new THREE.BoxGeometry(FW - 0.4, LOBBY - 0.5, FD - 0.4)), lobbyMat);
  lobby.position.y = (LOBBY - 0.5) / 2 + 0.9;
  world.add(lobby);
  const colGeos: THREE.BufferGeometry[] = [];
  for (let i = 0; i <= 12; i++) {
    const x = -FW / 2 + (i * FW) / 12;
    colGeos.push(box(x, 0.9 + (LOBBY - 0.5) / 2, FD / 2 + 0.2, 0.45, LOBBY - 0.5, 0.45));
  }
  for (let i = 1; i < 6; i++) {
    const z = -FD / 2 + (i * FD) / 6;
    colGeos.push(box(FW / 2 + 0.2, 0.9 + (LOBBY - 0.5) / 2, z, 0.45, LOBBY - 0.5, 0.45), box(-FW / 2 - 0.2, 0.9 + (LOBBY - 0.5) / 2, z, 0.45, LOBBY - 0.5, 0.45));
  }
  colGeos.push(box(0, LOBBY + 0.2, FD / 2 + 3.2, 14, 0.3, 7));
  const colMesh = new THREE.Mesh(track(mergeAll(colGeos)!), track(new THREE.MeshStandardMaterial({ color: '#e6e0d6', roughness: 0.6 })));
  world.add(colMesh);

  const rand = rng(99);
  const trees: { x: number; z: number; s: number }[] = [];
  const treeSpot = (x: number, z: number, s: number) => trees.push({ x, z, s });
  for (let i = 0; i < 16; i++) treeSpot(-FW / 2 - 8 + i * 2.5, FD / 2 + 7.5, 0.9 + rand() * 0.5);
  for (let i = 0; i < 12; i++) treeSpot(-FW / 2 - 6, -FD / 2 - 6 + i * 3.2, 1 + rand() * 0.6);
  for (let i = 0; i < 12; i++) treeSpot(FW / 2 + 6, -FD / 2 - 6 + i * 3.2, 1 + rand() * 0.6);
  for (let i = 0; i < 12; i++) treeSpot(-FW / 2 - 4 + i * 3.5, -FD / 2 - 7, 1 + rand() * 0.6);
  for (let i = 0; i < 40; i++) {
    const a = rand() * Math.PI * 2;
    const r = 38 + rand() * 24;
    const x = Math.cos(a) * r * 1.2;
    const z = Math.sin(a) * r;
    if (Math.abs(z - 56) < 8 || Math.abs(x + 64) < 8) continue;
    treeSpot(x, z, 1.1 + rand() * 0.9);
  }
  const trunkGeo = track(new THREE.CylinderGeometry(0.16, 0.22, 2.2, 6));
  const crownGeo = track(new THREE.IcosahedronGeometry(1.7, 1));
  const trunks = new THREE.InstancedMesh(trunkGeo, track(new THREE.MeshStandardMaterial({ color: '#4a3b2f', roughness: 1 })), trees.length);
  const canopies = new THREE.InstancedMesh(crownGeo, track(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, flatShading: true })), trees.length);
  const tc = new THREE.Color();
  const tp = new THREE.Vector3();
  const tq = new THREE.Quaternion();
  const ts = new THREE.Vector3();
  trees.forEach((t, i) => {
    const onPodium = Math.abs(t.x) < FW / 2 + 9 && Math.abs(t.z) < FD / 2 + 9;
    const gy = onPodium ? 0.9 : 0;
    tp.set(t.x, gy + 1.1 * t.s, t.z);
    ts.set(t.s, t.s, t.s);
    m4.compose(tp, tq, ts);
    trunks.setMatrixAt(i, m4);
    tp.set(t.x, gy + 3.1 * t.s, t.z);
    ts.set(t.s * 1.1, t.s * 0.95, t.s * 1.1);
    m4.compose(tp, tq, ts);
    canopies.setMatrixAt(i, m4);
    tc.setHSL(0.27 + rand() * 0.09, 0.38 + rand() * 0.15, 0.2 + rand() * 0.1);
    canopies.setColorAt(i, tc);
  });
  world.add(trunks, canopies);

  const lampPts: THREE.Vector3[] = [];
  for (let i = 0; i < 12; i++) lampPts.push(new THREE.Vector3(-FW / 2 - 7 + i * 5.2, 3.8, FD / 2 + 8.6));
  for (let i = 0; i < 5; i++) lampPts.push(new THREE.Vector3(-FW / 2 - 8.5, 3.8, -FD / 2 + i * 7), new THREE.Vector3(FW / 2 + 8.5, 3.8, -FD / 2 + i * 7));
  const lampGeo = track(new THREE.SphereGeometry(0.28, 8, 6));
  const lampMat = track(new THREE.MeshBasicMaterial({ color: '#ffd69a', toneMapped: false }));
  const lamps = new THREE.InstancedMesh(lampGeo, lampMat, lampPts.length);
  const haloGeo = track(new THREE.SphereGeometry(1.6, 10, 8));
  const haloMat = track(new THREE.MeshBasicMaterial({ color: '#ffb061', transparent: true, opacity: 0.1, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  const halos = new THREE.InstancedMesh(haloGeo, haloMat, lampPts.length);
  const poleGeo = track(new THREE.CylinderGeometry(0.05, 0.07, 3.8, 6));
  const poles = new THREE.InstancedMesh(poleGeo, finMat.clone(), lampPts.length);
  (poles.material as THREE.Material).clippingPlanes = null;
  disposables.push(poles.material as THREE.Material);
  lampPts.forEach((p, i) => {
    m4.makeTranslation(p.x, p.y, p.z);
    lamps.setMatrixAt(i, m4);
    halos.setMatrixAt(i, m4);
    m4.makeTranslation(p.x, p.y / 2 + 0.4, p.z);
    poles.setMatrixAt(i, m4);
  });
  world.add(lamps, halos, poles);

  const blocks = [
    { x: -62, z: -34, w: 20, d: 16, h: 26 },
    { x: -86, z: 22, w: 18, d: 18, h: 34 },
    { x: 70, z: -30, w: 18, d: 16, h: 22 },
    { x: 92, z: 26, w: 16, d: 20, h: 38 },
    { x: -20, z: -88, w: 30, d: 14, h: 18 },
    { x: 46, z: -92, w: 22, d: 14, h: 28 },
    { x: -120, z: -50, w: 20, d: 16, h: 44 },
    { x: 130, z: -40, w: 22, d: 16, h: 52 },
    { x: 20, z: 96, w: 26, d: 16, h: 16 },
    { x: -52, z: 92, w: 24, d: 16, h: 24 },
  ];
  const blockMat = track(
    new THREE.MeshStandardMaterial({ map: blockTex.color, emissiveMap: blockTex.glow, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0.9, roughness: 0.7, metalness: 0.1 }),
  );
  for (const b of blocks) {
    const g = new THREE.BoxGeometry(b.w, b.h, b.d);
    const uv = g.attributes.uv;
    const faceW = [b.d, b.d, b.w, b.w, b.w, b.w];
    for (let f = 0; f < 6; f++)
      for (let k = 0; k < 4; k++) {
        const i = f * 4 + k;
        uv.setXY(i, (uv.getX(i) * faceW[f]) / 14, (uv.getY(i) * b.h) / 22);
      }
    const m = new THREE.Mesh(track(g), blockMat);
    m.position.set(b.x, b.h / 2, b.z);
    world.add(m);
  }

  const hoverGroup = new THREE.Group();
  scene.add(hoverGroup);
  const bandMat = track(new THREE.MeshBasicMaterial({ color: '#7ff0ff', transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  const bandEdgeMat = track(new THREE.MeshBasicMaterial({ color: '#c8fbff', transparent: true, opacity: 0.95, toneMapped: false }));
  const band = new THREE.Group();
  const bandBody = new THREE.Mesh(track(new THREE.BoxGeometry(FW + 1.6, FH - SLAB_T, FD + 1.6)), bandMat);
  const bandTop = new THREE.Mesh(track(new THREE.BoxGeometry(FW + 1.9, 0.1, FD + 1.9)), bandEdgeMat);
  const bandBot = new THREE.Mesh(track(new THREE.BoxGeometry(FW + 1.9, 0.1, FD + 1.9)), bandEdgeMat);
  bandBody.position.y = (FH - SLAB_T) / 2 - SLAB_T / 2 + 0.2;
  bandTop.position.y = FH - SLAB_T + 0.05;
  bandBot.position.y = -SLAB_T + 0.05;
  band.add(bandBody, bandTop, bandBot);
  band.visible = false;
  hoverGroup.add(band);

  const tintGeo = track(new THREE.BoxGeometry(1, 1, 1));
  const tints: THREE.Mesh[] = [];
  const labels: THREE.Sprite[] = [];
  for (let i = 0; i < 4; i++) {
    const m = new THREE.Mesh(tintGeo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.4, depthWrite: false, toneMapped: false }));
    m.visible = false;
    m.renderOrder = 4;
    hoverGroup.add(m);
    tints.push(m);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false, toneMapped: false }));
    s.scale.set(6.2, 2.33, 1);
    s.renderOrder = 10;
    s.visible = false;
    hoverGroup.add(s);
    labels.push(s);
    disposables.push(m.material as THREE.Material, s.material);
  }
  const labelCache = new Map<string, THREE.CanvasTexture>();
  const labelFor = (u: Unit, full: boolean) => {
    const k = `${u.id}|${u.status}|${u.priceINR}|${full ? 1 : 0}`;
    let t = labelCache.get(k);
    if (!t) {
      t = labelTexture(u, full);
      labelCache.set(k, t);
    }
    return t;
  };

  const interior = new THREE.Group();
  interior.visible = false;
  scene.add(interior);
  const furnGroup = new THREE.Group();
  scene.add(furnGroup);
  let width = 1;
  let height = 1;
  let interiorDisposables: { dispose(): void }[] = [];
  let builtFor: string | null = null;
  let outward = new THREE.Vector3(0, 0, 1);
  let outAxis: 'x' | 'y' = 'y';

  const woodTex = track(makeTexture(woodCanvas(), true));
  const tileTex = track(makeTexture(tileCanvas(), true));
  const stoneTex = track(makeTexture(stoneCanvas(), true));
  const floorTex = { wood: woodTex, tile: tileTex, stone: stoneTex };
  const wallMat = track(new THREE.MeshStandardMaterial({ color: '#f2ede4', roughness: 0.92 }));
  const railMat = track(new THREE.MeshStandardMaterial({ color: '#bfe3f2', roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.35, depthWrite: false }));
  const paneMat = track(new THREE.MeshStandardMaterial({ color: '#a9d6ee', roughness: 0.06, metalness: 0.3, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide }));
  const otherMat = track(new THREE.MeshStandardMaterial({ color: '#2c3530', roughness: 0.95 }));
  const kit = createFurnitureKit();

  const clearInterior = () => {
    while (interior.children.length) interior.remove(interior.children[0]);
    interiorDisposables.forEach((d) => d.dispose());
    interiorDisposables = [];
  };

  const axisFor = (unit: Unit): 'x' | 'y' => {
    const longX = unit.size.w >= unit.size.d;
    const alongX = width / height >= 1 ? !longX : longX;
    return alongX ? 'x' : 'y';
  };

  const applyOutward = (unit: Unit) => {
    const cx = unit.origin.x + unit.size.w / 2;
    const cy = unit.origin.y + unit.size.d / 2;
    outAxis = axisFor(unit);
    outward = outAxis === 'x' ? new THREE.Vector3(Math.sign(cx) || 1, 0, 0) : new THREE.Vector3(0, 0, -(Math.sign(cy) || 1));
  };

  const buildInterior = (unit: Unit) => {
    clearInterior();
    builtFor = unit.id;
    const base = floorBase(unit.floor);
    const cx = unit.origin.x + unit.size.w / 2;
    const cy = unit.origin.y + unit.size.d / 2;
    applyOutward(unit);
    const lowDir: 'x' | 'y' = outAxis === 'y' ? 'x' : 'y';

    const floors = new THREE.Group();
    const plateGeo = new THREE.PlaneGeometry(TOWER.footprint.w + 1, TOWER.footprint.d + 1);
    plateGeo.rotateX(-Math.PI / 2);
    const plate = new THREE.Mesh(plateGeo, otherMat);
    plate.position.set(0, 0.005, 0);
    floors.add(plate);
    const hallGeo = new THREE.PlaneGeometry(unit.size.w, unit.size.d);
    hallGeo.rotateX(-Math.PI / 2);
    const hallMat = new THREE.MeshStandardMaterial({ color: '#d8d0c4', roughness: 0.6 });
    const hall = new THREE.Mesh(hallGeo, hallMat);
    hall.position.set(cx, 0.01, -cy);
    hall.receiveShadow = true;
    floors.add(hall);
    interiorDisposables.push(plateGeo, hallGeo, hallMat);
    for (const r of unit.rooms) {
      const st = FLOOR_STYLE[r.kind];
      const g = new THREE.PlaneGeometry(r.rect.w, r.rect.d);
      const uv = g.attributes.uv;
      const k = st.tex === 'wood' ? 2.4 : 2.2;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * r.rect.w) / k, (uv.getY(i) * r.rect.d) / k);
      g.rotateX(-Math.PI / 2);
      const m = new THREE.MeshStandardMaterial({ color: st.color, map: floorTex[st.tex], roughness: st.tex === 'wood' ? 0.55 : 0.45 });
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set(r.rect.x + r.rect.w / 2, 0.015, -(r.rect.y + r.rect.d / 2));
      mesh.receiveShadow = true;
      floors.add(mesh);
      interiorDisposables.push(g, m);
    }
    for (const o of TOWER.units) {
      if (o.floor !== unit.floor || o.id === unit.id) continue;
      const g = new THREE.BoxGeometry(o.size.w - 0.2, 0.05, o.size.d - 0.2);
      const mesh = new THREE.Mesh(g, otherMat);
      mesh.position.set(o.origin.x + o.size.w / 2, 0.03, -(o.origin.y + o.size.d / 2));
      mesh.receiveShadow = true;
      floors.add(mesh);
      interiorDisposables.push(g);
    }
    interior.add(floors);

    const walls: THREE.BufferGeometry[] = [];
    const rails: THREE.BufferGeometry[] = [];
    const panes: THREE.BufferGeometry[] = [];
    const seen = new Set<string>();
    const segment = (dir: 'x' | 'y', c: number, a: number, b: number, rail: boolean) => {
      const key = `${dir}|${c.toFixed(2)}|${a.toFixed(2)}|${b.toFixed(2)}|${rail ? 1 : 0}`;
      if (seen.has(key)) return;
      seen.add(key);
      const low = !rail && dir === lowDir;
      const H = rail ? RAIL_H : low ? LOW_H : WALL_H;
      const cuts: { a: number; b: number; kind: 'door' | 'window' }[] = [];
      if (!rail)
        for (const o of unit.openings) {
          const along = o.axis === dir;
          if (!along) continue;
          const oc = dir === 'x' ? o.y : o.x;
          const op = dir === 'x' ? o.x : o.y;
          if (Math.abs(oc - c) > 0.25) continue;
          const lo = op - o.width / 2;
          const hi = op + o.width / 2;
          if (hi <= a + 0.05 || lo >= b - 0.05) continue;
          cuts.push({ a: Math.max(a, lo), b: Math.min(b, hi), kind: o.kind === 'window' ? 'window' : 'door' });
        }
      cuts.sort((p, q) => p.a - q.a);
      const put = (list: THREE.BufferGeometry[], s0: number, s1: number, h0: number, h1: number, th = WALL_T) => {
        if (s1 - s0 < 0.01 || h1 - h0 < 0.01) return;
        const len = s1 - s0 + (rail ? 0 : th);
        const mid = (s0 + s1) / 2;
        const hy = (h0 + h1) / 2;
        if (dir === 'x') list.push(box(mid, hy, -c, len, h1 - h0, th));
        else list.push(box(c, hy, -mid, th, h1 - h0, len));
      };
      let cur = a;
      for (const cut of cuts) {
        put(rail ? rails : walls, cur, cut.a, 0, H);
        if (cut.kind === 'door') put(walls, cut.a, cut.b, 2.1, low ? 2.1 : H);
        else if (!low) {
          put(walls, cut.a, cut.b, 0, 0.9);
          put(walls, cut.a, cut.b, 2.1, H);
          put(panes, cut.a, cut.b, 0.9, 2.1, 0.04);
        } else put(walls, cut.a, cut.b, 0, H);
        cur = cut.b;
      }
      put(rail ? rails : walls, cur, b, 0, H);
    };
    for (const r of unit.rooms) {
      const { x, y, w, d } = r.rect;
      const rail = r.kind === 'balcony';
      segment('x', y, x, x + w, rail);
      segment('x', y + d, x, x + w, rail);
      segment('y', x, y, y + d, rail);
      segment('y', x + w, y, y + d, rail);
    }
    const addMerged = (list: THREE.BufferGeometry[], m: THREE.Material, cast: boolean) => {
      const g = mergeAll(list);
      if (!g) return;
      const mesh = new THREE.Mesh(g, m);
      mesh.castShadow = cast;
      mesh.receiveShadow = true;
      interior.add(mesh);
      interiorDisposables.push(g);
    };
    addMerged(walls, wallMat, true);
    addMerged(rails, railMat, false);
    addMerged(panes, paneMat, false);
    interior.position.y = base;
    furnGroup.position.y = base + 0.02;
    sun.target.position.set(cx, base, -cy);
  };


  const towerPose = (): Pose => {
    const aspect = width / height;
    const tanH = Math.tan((TOWER_FOV * Math.PI) / 360);
    const dv = ((TOP + 24) / 2 / tanH) * 1.12;
    const dh = (Math.hypot(FW, FD) * 0.66) / (tanH * aspect);
    const dist = Math.max(dv, dh, 70);
    const el = (11 * Math.PI) / 180;
    const az = (38 * Math.PI) / 180;
    const target = new THREE.Vector3(0, TOP * 0.45, 0);
    const pos = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(dist).add(target);
    return { pos, target, fov: TOWER_FOV };
  };

  const fitCam = new THREE.PerspectiveCamera(UNIT_FOV, 1, 0.5, 3000);

  const unitPose = (unit: Unit): Pose => {
    const aspect = width / height;
    const base = floorBase(unit.floor);
    const el = (63 * Math.PI) / 180;
    const target = new THREE.Vector3(unit.origin.x + unit.size.w / 2, base + 0.3, -(unit.origin.y + unit.size.d / 2));
    const side = new THREE.Vector3(-outward.z, 0, outward.x);
    if (side.x + side.z < 0) side.negate();
    const dir = outward.clone().add(side.multiplyScalar(0.32)).normalize().multiplyScalar(Math.cos(el)).add(new THREE.Vector3(0, Math.sin(el), 0));
    const pts: THREE.Vector3[] = [];
    for (const sx of [0, 1])
      for (const sz of [0, 1])
        for (const h of [0, 2.9]) pts.push(new THREE.Vector3(unit.origin.x + sx * unit.size.w, base + h, -(unit.origin.y + sz * unit.size.d)));
    fitCam.aspect = aspect;
    fitCam.fov = UNIT_FOV;
    fitCam.updateProjectionMatrix();
    const fits = (dist: number) => {
      fitCam.position.copy(target).addScaledVector(dir, dist);
      fitCam.lookAt(target);
      fitCam.updateMatrixWorld(true);
      return pts.every((p) => {
        const q = p.clone().project(fitCam);
        return Math.abs(q.x) < 0.94 && Math.abs(q.y) < 0.92;
      });
    };
    let lo = 8;
    let hi = 220;
    for (let i = 0; i < 22; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
    const pos = target.clone().addScaledVector(dir, hi);
    return { pos, target, fov: UNIT_FOV };
  };

  let flightU = 0;
  let flightDir: 0 | 1 = 0;
  let wantUnit: string | null = null;
  let mode: 'tower' | 'unit' = 'tower';
  let startPose: Pose = towerPose();
  let endPose: Pose = startPose;
  let pathPos: THREE.CatmullRomCurve3 | null = null;
  let pathTgt: THREE.CatmullRomCurve3 | null = null;
  let pathFov = [TOWER_FOV, UNIT_FOV];
  let activeUnit: Unit | null = null;

  const buildPath = () => {
    if (!activeUnit) return;
    const u = activeUnit;
    const base = floorBase(u.floor);
    const c = new THREE.Vector3(u.origin.x + u.size.w / 2, base, -(u.origin.y + u.size.d / 2));
    const reach = (outAxis === 'x' ? u.size.w : u.size.d) / 2;
    const far = c.clone().addScaledVector(outward, reach + 20);
    far.y = base + 4.2;
    const door = c.clone().addScaledVector(outward, reach - 3.2);
    door.y = base + 1.9;
    const lookFar = c.clone();
    lookFar.y = base + 1.3;
    const lookIn = c.clone();
    lookIn.y = base + 0.9;
    pathPos = new THREE.CatmullRomCurve3([startPose.pos.clone(), far, door, endPose.pos.clone()], false, 'centripetal');
    pathTgt = new THREE.CatmullRomCurve3([startPose.target.clone(), lookFar, lookIn, endPose.target.clone()], false, 'centripetal');
    pathFov = [startPose.fov, endPose.fov];
  };

  const placeCamera = (pos: THREE.Vector3, target: THREE.Vector3, fov: number) => {
    camera.position.copy(pos);
    controls.target.copy(target);
    if (Math.abs(camera.fov - fov) > 0.001) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    camera.lookAt(target);
  };

  const configureControls = () => {
    const inUnit = flightDir === 1;
    if (inUnit && activeUnit) {
      const d = endPose.pos.distanceTo(endPose.target);
      controls.minDistance = d * 0.45;
      controls.maxDistance = d * 1.7;
      controls.minPolarAngle = 0.18;
      controls.maxPolarAngle = 1.32;
    } else {
      controls.minDistance = 60;
      controls.maxDistance = 330;
      controls.minPolarAngle = 0.55;
      controls.maxPolarAngle = 1.5;
    }
  };

  const applyFlight = () => {
    const t = easeInOut(flightU);
    if (flightU <= 0 || !pathPos || !pathTgt) {
      clip.constant = TOP + 10;
    }
    const topClip = TOP + 10;
    const unitClip = activeUnit ? floorBase(activeUnit.floor) + FH - SLAB_T - 0.04 : topClip;
    const cut = smooth(0.1, 0.62, flightU);
    clip.constant = topClip + (unitClip - topClip) * cut;
    const fade = smooth(0.22, 0.56, flightU);
    const op = 1 - 0.97 * fade;
    const wasT = glassMat.transparent;
    glassMat.opacity = op;
    glassMat.transparent = op < 0.995;
    if (wasT !== glassMat.transparent) glassMat.needsUpdate = true;
    glassMat.emissiveIntensity = 1.25 * (1 - fade * 0.85);
    glassMat.depthWrite = op > 0.5;
    const mop = 1 - 0.85 * fade;
    const wasM = mullionMat.transparent;
    mullionMat.opacity = mop;
    mullionMat.transparent = mop < 0.995;
    if (wasM !== mullionMat.transparent) mullionMat.needsUpdate = true;
    const showTower = flightU < 0.02;
    hoverGroup.visible = showTower;
    const w = smooth(0.0, 0.7, flightU);
    hemi.intensity = 0.55 + 0.9 * w;
    scene.environmentIntensity = 0.55 - 0.2 * w;
    core.visible = cut < 0.99;
    lobby.visible = cut < 0.6;
    colMesh.visible = cut < 0.6;
    clipLow.constant = -(activeUnit ? (floorBase(activeUnit.floor) - SLAB_T - 0.02) * cut : 0);
    sun.intensity = 2.4 + 0.3 * w;
    sun.color.set(0xffc294).lerp(sunWhite, w);
    hemi.color.set(0xb8a6d8).lerp(hemiWhite, w);
    interior.visible = !!activeUnit && flightU > 0 || (!!activeUnit && mode === 'tower');
    furnGroup.visible = flightU > 0.3;
    if (flightU > 0 && pathPos && pathTgt) {
      const pos = pathPos.getPoint(t);
      const tg = pathTgt.getPoint(t);
      placeCamera(pos, tg, pathFov[0] + (pathFov[1] - pathFov[0]) * smooth(0, 1, t));
    }
  };

  const setSunFor = (unit: Unit) => {
    const base = floorBase(unit.floor);
    const c = new THREE.Vector3(unit.origin.x + unit.size.w / 2, base, -(unit.origin.y + unit.size.d / 2));
    const side = new THREE.Vector3(-outward.z, 0, outward.x);
    sun.position.copy(c).addScaledVector(outward, 16).addScaledVector(side, 14).add(new THREE.Vector3(0, 30, 0));
    sun.target.position.copy(c);
    const sc = sun.shadow.camera;
    const r = Math.hypot(unit.size.w, unit.size.d) * 0.75 + 3;
    sc.left = -r;
    sc.right = r;
    sc.top = r;
    sc.bottom = -r;
    sc.near = 5;
    sc.far = 90;
    sc.updateProjectionMatrix();
  };

  const entries = new Map<string, FurnEntry>();
  const pendingDrops: FurnEntry[] = [];
  const ringGeo = track(new THREE.RingGeometry(0.82, 1, 40));
  let furnKey: string | undefined;
  let lastFurnish: FurnishResult | null = null;
  let furnResult: FurnishResult | null = null;
  let highlightIds: string[] = [];
  let highlightSince = 0;
  let morph = 2000;

  const pieceSig = (p: Piece) => `${p.kind}|${p.roomId}|${p.x.toFixed(3)}|${p.y.toFixed(3)}|${p.rotation}|${p.color}|${p.w}|${p.d}|${p.h}`;

  const removeEntry = (e: FurnEntry) => {
    furnGroup.remove(e.obj);
    furnGroup.remove(e.ring);
    e.obj.traverse((o) => {
      if (o.userData.glow) {
        const m = o as THREE.Mesh;
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    });
    (e.ring.material as THREE.Material).dispose();
    const i = pendingDrops.indexOf(e);
    if (i >= 0) pendingDrops.splice(i, 1);
  };

  const clearFurniture = () => {
    entries.forEach(removeEntry);
    entries.clear();
  };

  const syncFurniture = () => {
    const res = furnResult && activeUnit && furnResult.unitId === activeUnit.id ? furnResult : null;
    if (!res) {
      clearFurniture();
      return;
    }
    const ids = new Set(res.pieces.map((p) => p.id));
    for (const [id, e] of [...entries]) {
      const p = res.pieces.find((q) => q.id === id);
      if (!ids.has(id) || !p || pieceSig(p) !== e.sig) {
        removeEntry(e);
        entries.delete(id);
      }
    }
    const roomOrder = new Map(activeUnit!.rooms.map((r, i) => [r.id, i]));
    const fresh = res.pieces
      .filter((p) => !entries.has(p.id))
      .sort((a, b) => {
        const ra = roomOrder.get(a.roomId) ?? 99;
        const rb = roomOrder.get(b.roomId) ?? 99;
        if (ra !== rb) return ra - rb;
        const ga = a.kind === 'rug' ? 0 : 1;
        const gb = b.kind === 'rug' ? 0 : 1;
        if (ga !== gb) return ga - gb;
        return b.w * b.d - a.w * a.d;
      });
    const n = fresh.length;
    const dur = Math.min(520, Math.max(160, morph / 3));
    const stagger = n > 1 ? Math.max(0, (morph - dur) / (n - 1)) : 0;
    fresh.forEach((p, i) => {
      const obj = kit.build(p, true);
      obj.position.set(p.x, 0, -p.y);
      obj.rotation.y = FRONT_YAW - (p.rotation * Math.PI) / 180;
      obj.visible = false;
      obj.traverse((o) => {
        if (o.userData.glow) o.visible = false;
      });
      const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(p.x, 0.04, -p.y);
      ring.scale.setScalar(0.001);
      ring.visible = false;
      furnGroup.add(obj, ring);
      const e: FurnEntry = { id: p.id, sig: pieceSig(p), obj, ring, glow: null, startAt: i * stagger, dur, state: 'hidden' };
      entries.set(p.id, e);
      pendingDrops.push(e);
    });
    if (reduced) {
      pendingDrops.forEach((e) => {
        e.obj.visible = true;
        e.state = 'done';
      });
      pendingDrops.length = 0;
    }
    applyHighlight();
  };

  const applyHighlight = () => {
    entries.forEach((e) => {
      const on = highlightIds.includes(e.id);
      e.obj.traverse((o) => {
        if (o.userData.glow) o.visible = on;
      });
    });
  };

  const stepFurniture = (now: number) => {
    let busy = false;
    if (flightU >= 0.98 && flightDir === 1 && pendingDrops.length) {
      for (const e of pendingDrops) e.startAt += now;
      for (const e of pendingDrops) e.state = 'drop';
      pendingDrops.length = 0;
    }
    entries.forEach((e) => {
      if (e.state !== 'drop') return;
      const t = (now - e.startAt) / e.dur;
      if (t < 0) {
        busy = true;
        return;
      }
      e.obj.visible = true;
      const k = Math.min(1, t);
      const eased = easeOutBack(k);
      e.obj.position.y = (1 - eased) * 1.1;
      const s = 0.9 + 0.1 * smooth(0, 1, k);
      e.obj.scale.setScalar(s);
      const rk = Math.min(1, Math.max(0, (t - 0.55) / 0.9));
      if (t > 0.55 && rk < 1) {
        e.ring.visible = true;
        const sz = Math.max(...[0.5]) * 0.5;
        const piece = furnResult?.pieces.find((p) => p.id === e.id);
        const r = piece ? Math.max(piece.w, piece.d) * 0.62 : sz;
        e.ring.scale.setScalar(r * (0.8 + 0.6 * rk));
        (e.ring.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - rk);
      } else if (rk >= 1) e.ring.visible = false;
      if (k >= 1 && rk >= 1) {
        e.state = 'done';
        e.obj.position.y = 0;
        e.obj.scale.setScalar(1);
        e.ring.visible = false;
      } else busy = true;
    });
    return busy;
  };

  let hoverLocal: number | null = null;
  let hoverUnitId: string | null = null;
  let lastEmitted: number | null | undefined;
  let bandLift = 0;
  let bandFloor = 0;
  let selectedUnitId: string | null = null;
  let stateFloor: number | null = null;

  const emitHover = (f: number | null) => {
    if (f === lastEmitted) return;
    lastEmitted = f;
    callbacks.onHoverFloor?.(f);
  };

  const showFloor = () => {
    const f = hoverLocal ?? stateFloor ?? (selectedUnitId ? (unitById(selectedUnitId)?.floor ?? null) : null);
    if (!f || flightU > 0.02 || flightDir === 1) {
      band.visible = false;
      tints.forEach((t) => (t.visible = false));
      labels.forEach((s) => (s.visible = false));
      return;
    }
    if (bandFloor !== f) {
      bandFloor = f;
      bandLift = reduced ? 1 : 0;
    }
    band.visible = true;
    band.position.y = floorBase(f) + bandLift * 0.0;
    band.scale.set(1 + (1 - bandLift) * 0.03, 1, 1 + (1 - bandLift) * 0.03);
    const us = TOWER.units.filter((u) => u.floor === f);
    tints.forEach((t, i) => {
      const u = us[i];
      if (!u) {
        t.visible = false;
        labels[i].visible = false;
        return;
      }
      const sel = u.id === hoverUnitId || u.id === selectedUnitId;
      const mat = t.material as THREE.MeshBasicMaterial;
      mat.color.set(STATUS_COLOR[u.status]);
      mat.opacity = sel ? Math.min(0.85, STATUS_OPACITY[u.status] + 0.3) : STATUS_OPACITY[u.status];
      t.visible = true;
      t.scale.set(u.size.w + 0.5, FH - SLAB_T - 0.1, u.size.d + 0.5);
      t.position.set(u.origin.x + u.size.w / 2, floorBase(f) + (FH - SLAB_T) / 2 - 0.1, -(u.origin.y + u.size.d / 2));
      const s = labels[i];
      (s.material as THREE.SpriteMaterial).map = labelFor(u, sel);
      (s.material as THREE.SpriteMaterial).needsUpdate = true;
      s.visible = true;
      const toCam = camera.position;
      const lx = u.origin.x + u.size.w / 2 + Math.sign(toCam.x - (u.origin.x + u.size.w / 2)) * u.size.w * 0.3;
      const lz = -(u.origin.y + u.size.d / 2) + Math.sign(toCam.z + (u.origin.y + u.size.d / 2)) * u.size.d * 0.3;
      s.position.set(lx, floorBase(f) + FH * 0.5 + (sel ? 0.6 : 0), lz);
      if (sel) s.scale.set(13, 4.45, 1);
      else s.scale.set(6.2, 2.33, 1);
    });
  };

  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const towerBox = new THREE.Box3(new THREE.Vector3(-FW / 2, LOBBY, -FD / 2), new THREE.Vector3(FW / 2, TOP, FD / 2));
  const hit = new THREE.Vector3();

  const probe = (clientX: number, clientY: number) => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -(((clientY - r.top) / r.height) * 2 - 1));
    ray.setFromCamera(ndc, camera);
    if (!ray.ray.intersectBox(towerBox, hit)) return { floor: null as number | null, unit: null as Unit | null };
    const f = Math.floor((hit.y - LOBBY) / FH) + 1;
    if (f < 1 || f > FLOORS) return { floor: null, unit: null };
    let best: Unit | null = null;
    let bd = Infinity;
    const b3 = new THREE.Box3();
    const p = new THREE.Vector3();
    for (const u of TOWER.units) {
      if (u.floor !== f) continue;
      const y0 = floorBase(f);
      b3.min.set(u.origin.x, y0, -(u.origin.y + u.size.d));
      b3.max.set(u.origin.x + u.size.w, y0 + FH, -u.origin.y);
      if (ray.ray.intersectBox(b3, p)) {
        const d = p.distanceTo(ray.ray.origin);
        if (d < bd) {
          bd = d;
          best = u;
        }
      }
    }
    return { floor: f, unit: best };
  };

  let dragging = false;
  let down: { x: number; y: number; t: number } | null = null;

  const setHover = (floor: number | null, unit: Unit | null) => {
    const changed = floor !== hoverLocal || (unit?.id ?? null) !== hoverUnitId;
    hoverLocal = floor;
    hoverUnitId = unit?.id ?? null;
    canvas.style.cursor = unit ? 'pointer' : 'grab';
    emitHover(floor);
    if (changed) {
      showFloor();
      wake();
    }
  };

  const onMove = (e: PointerEvent) => {
    if (flightDir === 1 || flightU > 0.02 || dragging) return;
    if (e.pointerType === 'touch') return;
    const p = probe(e.clientX, e.clientY);
    setHover(p.floor, p.unit);
  };
  const onLeave = () => {
    if (flightDir === 1) return;
    setHover(null, null);
  };
  const onDown = (e: PointerEvent) => {
    down = { x: e.clientX, y: e.clientY, t: performance.now() };
    dragging = false;
  };
  const onDragMove = (e: PointerEvent) => {
    if (down && e.buttons && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) dragging = true;
  };
  const onUp = (e: PointerEvent) => {
    const d = down;
    down = null;
    const wasDrag = dragging;
    dragging = false;
    if (!d || wasDrag || flightDir === 1 || flightU > 0.02) return;
    if (performance.now() - d.t > 600) return;
    const p = probe(e.clientX, e.clientY);
    setHover(p.floor, p.unit);
    if (p.unit) callbacks.onPickUnit?.(p.unit.id);
  };
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointermove', onDragMove);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointerup', onUp);

  let raf = 0;
  let lastTs = 0;
  let disposed = false;
  let blinkOn = true;

  function wake() {
    if (!raf && !disposed) raf = requestAnimationFrame(tick);
  }

  function tick(now: number) {
    raf = 0;
    if (disposed) return;
    const dt = lastTs ? Math.min(0.12, (now - lastTs) / 1000) : 0.016;
    lastTs = now;
    let busy = false;

    const goal = flightDir;
    if (flightU !== goal) {
      const step = reduced ? 1 : dt / FLIGHT_S;
      flightU = goal === 1 ? Math.min(1, flightU + step) : Math.max(0, flightU - step);
      controls.enabled = false;
      applyFlight();
      if (flightU === goal) {
        controls.enabled = true;
        configureControls();
        if (goal === 1) {
          if (activeUnit) endPose = unitPose(activeUnit);
          camera.position.copy(endPose.pos);
          controls.target.copy(endPose.target);
        } else {
          interior.visible = !!activeUnit && !!selectedUnitId;
          camera.position.copy(startPose.pos);
          controls.target.copy(startPose.target);
          showFloor();
        }
        placeCamera(camera.position, controls.target, goal === 1 ? endPose.fov : startPose.fov);
      } else busy = true;
    }
    if (bandLift < 1 && band.visible) {
      bandLift = Math.min(1, bandLift + dt / 0.22);
      showFloor();
      busy = true;
    }
    if (stepFurniture(now)) busy = true;
    if (highlightIds.length && now - highlightSince < 2600) {
      const pulse = 0.28 + 0.22 * Math.sin((now - highlightSince) / 140);
      entries.forEach((e) =>
        e.obj.traverse((o) => {
          if (o.userData.glow) ((o as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = pulse;
        }),
      );
      busy = true;
    }
    if (controls.enabled && controls.update()) busy = true;
    if (flightU === 0) {
      blinkOn = Math.floor(now / 900) % 2 === 0;
      blink.visible = blinkOn;
    }
    renderer.render(scene, camera);
    canvas.dataset.flight = flightU.toFixed(3);
    canvas.dataset.calls = String(renderer.info.render.calls);
    canvas.dataset.tris = String(renderer.info.render.triangles);
    if (busy) wake();
  }

  controls.addEventListener('change', () => wake());

  const resize = () => {
    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    width = w;
    height = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (flightDir === 0 && flightU === 0) {
      const p = towerPose();
      startPose = p;
      placeCamera(p.pos, p.target, p.fov);
    } else if (activeUnit && flightDir === 1 && flightU === 1) {
      if (axisFor(activeUnit) !== outAxis) {
        buildInterior(activeUnit);
        setSunFor(activeUnit);
      }
      endPose = unitPose(activeUnit);
      buildPath();
      placeCamera(endPose.pos, endPose.target, endPose.fov);
    } else if (activeUnit && flightDir === 1) {
      endPose = unitPose(activeUnit);
      buildPath();
    }
    wake();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();
  configureControls();

  const update = (s: TowerSceneState) => {
    morph = s.morphMs ?? 2000;
    stateFloor = s.floor;
    selectedUnitId = s.unitId;
    highlightIds = s.highlight ?? [];
    highlightSince = performance.now();
    const unit = s.unitId ? (unitById(s.unitId) ?? null) : null;
    const wantFly = s.mode === 'unit' && !!unit;
    mode = s.mode;

    if (unit && builtFor !== unit.id) {
      const wasIn = flightDir === 1 && flightU > 0.5;
      buildInterior(unit);
      activeUnit = unit;
      setSunFor(unit);
      clearFurniture();
      endPose = unitPose(unit);
      if (wasIn) {
        placeCamera(endPose.pos, endPose.target, endPose.fov);
        startPose = towerPose();
        buildPath();
      }
    } else if (!unit && builtFor && flightU === 0 && !wantFly) {
      clearInterior();
      builtFor = null;
      activeUnit = null;
      clearFurniture();
    }

    furnResult = s.furnish;
    furnKey = s.key;
    if (activeUnit) {
      if (s.furnish !== lastFurnish || !s.furnish) syncFurniture();
      else applyHighlight();
    }
    lastFurnish = s.furnish;

    if (wantFly && flightDir === 0 && unit) {
      startPose = flightU === 0 ? { pos: camera.position.clone(), target: controls.target.clone(), fov: camera.fov } : startPose;
      endPose = unitPose(unit);
      buildPath();
      flightDir = 1;
      configureControls();
    } else if (!wantFly && flightDir === 1) {
      endPose = { pos: camera.position.clone(), target: controls.target.clone(), fov: camera.fov };
      buildPath();
      flightDir = 0;
      controls.enabled = false;
    }
    if (activeUnit && flightU === 0 && mode === 'tower') interior.visible = !!selectedUnitId;
    if (flightU === 0 && flightDir === 0) {
      interior.visible = !!activeUnit;
      applyFlight();
      showFloor();
    }
    wake();
  };

  const resetView = () => {
    const target = flightDir === 1 && activeUnit ? unitPose(activeUnit) : towerPose();
    if (flightDir === 1 && activeUnit) endPose = target;
    else startPose = target;
    if (flightDir === 1) buildPath();
    placeCamera(target.pos, target.target, target.fov);
    controls.update();
    wake();
  };

  const dispose = () => {
    disposed = true;
    cancelAnimationFrame(raf);
    ro.disconnect();
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointermove', onDragMove);
    canvas.removeEventListener('pointerleave', onLeave);
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointerup', onUp);
    controls.dispose();
    clearFurniture();
    kit.dispose();
    clearInterior();
    labelCache.forEach((t) => t.dispose());
    disposables.forEach((d) => d.dispose());
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    renderer.dispose();
    canvas.remove();
  };

  wake();
  return { update, resetView, dispose };
}
