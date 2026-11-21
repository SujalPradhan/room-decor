import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createFurnitureKit } from './furniture-mesh';
import type { FurnishResult, Piece, Room, Unit, UnitStatus } from './model';
import { TOWER, formatINR, unitById } from './tower';
import { CROWN_TOP, FD, FH, FLOORS, FW, LOBBY, SLAB_T, TOP, box, buildSite, buildTower, floorBase, mergeAll } from './scene-building';
import { createKeyControls } from './scene-keys';
import { createPeerLayer, validPose, type CameraPose, type PeerMarker } from './scene-peers';
import { createPost } from './scene-post';
import { createSkyEnvironment, sunDirection } from './scene-sky';

export type { CameraPose, PeerMarker } from './scene-peers';

export interface TowerSceneCallbacks {
  onHoverFloor?(floor: number | null): void;
  onPickUnit?(unitId: string): void;
  onViewChange?(pose: CameraPose): void;
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
  getView(): CameraPose;
  setView(pose: CameraPose, opts?: { smooth?: boolean }): void;
  setPeers(peers: PeerMarker[]): void;
}

const WALL_H = 2.9;
const LOW_H = 1.25;
const RAIL_H = 1.05;
const WALL_T = 0.12;
const FLIGHT_S = 2.7;
const TOWER_FOV = 32;
const UNIT_FOV = 36;
const FRONT_YAW = Math.PI;
const SUN = sunDirection(50, -32);
const AO_TOWER = 2.4;
const AO_UNIT = 0.5;

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

const STATUS_COLOR: Record<UnitStatus, string> = { available: '#12c9a8', reserved: '#f2a922', sold: '#7d8696' };
const STATUS_OPACITY: Record<UnitStatus, number> = { available: 0.72, reserved: 0.72, sold: 0.5 };
const STATUS_LABEL: Record<UnitStatus, string> = { available: 'Available', reserved: 'Reserved', sold: 'Sold' };

type FloorTex = 'wood' | 'tile' | 'deck';
const FLOOR_STYLE: Record<Room['kind'], { color: string; tex: FloorTex; size: number }> = {
  living: { color: '#ffffff', tex: 'wood', size: 2.2 },
  kitchen: { color: '#ffffff', tex: 'tile', size: 2.4 },
  bedroom: { color: '#f4ece2', tex: 'wood', size: 2.2 },
  master: { color: '#ece0d2', tex: 'wood', size: 2.2 },
  bath: { color: '#f2f2f2', tex: 'tile', size: 1.8 },
  balcony: { color: '#f2ece4', tex: 'deck', size: 1.8 },
  study: { color: '#f4ece2', tex: 'wood', size: 2.2 },
};

function canvasOf(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function makeTexture(c: HTMLCanvasElement) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function labelTexture(unit: Unit, full: boolean) {
  if (!full) return compactLabel(unit);
  const c = canvasOf(512, 176);
  const g = c.getContext('2d')!;
  const col = STATUS_COLOR[unit.status];
  g.fillStyle = 'rgba(255,255,255,0.94)';
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
  g.fillStyle = '#141821';
  g.font = '700 58px system-ui, -apple-system, Segoe UI, sans-serif';
  g.textBaseline = 'middle';
  g.fillText(`${unit.id}  ${unit.type}`, 82, 62);
  g.fillStyle = 'rgba(20,24,33,0.72)';
  g.font = '500 40px system-ui, -apple-system, Segoe UI, sans-serif';
  g.fillText(`${STATUS_LABEL[unit.status]}  ${formatINR(unit.priceINR)}`, 34, 128);
  return makeTexture(c);
}

function compactLabel(unit: Unit) {
  const c = canvasOf(256, 96);
  const g = c.getContext('2d')!;
  const col = STATUS_COLOR[unit.status];
  g.fillStyle = 'rgba(255,255,255,0.93)';
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
  g.fillStyle = '#141821';
  g.font = '700 44px system-ui, -apple-system, Segoe UI, sans-serif';
  g.textBaseline = 'middle';
  g.fillText(unit.id, 76, 50);
  return makeTexture(c);
}

interface Pose {
  pos: THREE.Vector3;
  target: THREE.Vector3;
  fov: number;
}

interface FurnEntry {
  id: string;
  sig: string;
  piece: Piece;
  obj: THREE.Group;
  ring: THREE.Mesh;
  startAt: number;
  dur: number;
  state: 'hidden' | 'drop' | 'done';
}

export function createTowerScene(container: HTMLElement, callbacks: TowerSceneCallbacks = {}): TowerScene {
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.62;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.localClippingEnabled = true;
  const canvas = renderer.domElement;
  canvas.style.cssText = 'display:block;width:100%;height:100%;outline:none;touch-action:none';
  container.appendChild(canvas);

  const addedTab = !container.hasAttribute('tabindex');
  const addedLabel = !container.hasAttribute('aria-label');
  if (addedTab) container.tabIndex = 0;
  if (addedLabel) container.setAttribute('aria-label', '3D tower view. Arrow keys or W A S D orbit, Q and E zoom, hold Shift to pan.');

  const scene = new THREE.Scene();
  let wakeRef = () => {};
  const sky = createSkyEnvironment(renderer, scene, SUN, () => wakeRef());
  scene.fog = new THREE.FogExp2(sky.fogColor.clone(), 0.0007);
  scene.environmentIntensity = 1;

  const camera = new THREE.PerspectiveCamera(TOWER_FOV, 1, 0.5, 4000);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.09;
  controls.enablePan = false;

  const hemiSky = new THREE.Color('#dceaff');
  const hemiWarm = new THREE.Color('#fff1de');
  const hemi = new THREE.HemisphereLight(hemiSky, '#9b9a82', 0.45);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff3e2', 3.1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.00025;
  sun.shadow.normalBias = 0.035;
  sun.shadow.radius = 2.5;
  scene.add(sun, sun.target);
  const towerShadow = { c: new THREE.Vector3(0, 22, 4), r: 62 };
  const unitShadow = { c: new THREE.Vector3(), r: 12 };
  const shadowC = new THREE.Vector3();
  const setShadow = (k: number) => {
    shadowC.lerpVectors(towerShadow.c, unitShadow.c, k);
    const r = towerShadow.r + (unitShadow.r - towerShadow.r) * k;
    sun.target.position.copy(shadowC);
    sun.position.copy(shadowC).addScaledVector(SUN, 160);
    const sc = sun.shadow.camera;
    sc.left = -r;
    sc.right = r;
    sc.top = r;
    sc.bottom = -r;
    sc.near = 60;
    sc.far = 280;
    sc.updateProjectionMatrix();
    sun.shadow.normalBias = 0.035 + (0.012 - 0.035) * k;
  };
  setShadow(0);

  const clip = new THREE.Plane(new THREE.Vector3(0, -1, 0), CROWN_TOP + 20);
  const clipList = [clip];
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(o: T) => {
    disposables.push(o);
    return o;
  };

  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const site = buildSite(() => wakeRef(), anisotropy);
  scene.add(site.group);
  const tower = buildTower(clipList);
  scene.add(tower.group);

  const hoverGroup = new THREE.Group();
  scene.add(hoverGroup);
  const bandMat = track(new THREE.MeshBasicMaterial({ color: '#d8f6ff', transparent: true, opacity: 0.3, depthWrite: false, toneMapped: false }));
  const bandEdgeMat = track(new THREE.MeshBasicMaterial({ color: '#16b3e8', transparent: true, opacity: 0.95, toneMapped: false }));
  const band = new THREE.Group();
  const bandBody = new THREE.Mesh(track(new THREE.BoxGeometry(FW + 1.2, FH - SLAB_T, FD + 1.2)), bandMat);
  const bandTop = new THREE.Mesh(track(new THREE.BoxGeometry(FW + 1.5, 0.2, FD + 1.5)), bandEdgeMat);
  const bandBot = new THREE.Mesh(track(new THREE.BoxGeometry(FW + 1.5, 0.2, FD + 1.5)), bandEdgeMat);
  bandBody.position.y = (FH - SLAB_T) / 2;
  bandTop.position.y = FH - SLAB_T + 0.06;
  bandBot.position.y = -SLAB_T + 0.06;
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

  const peers = createPeerLayer(scene);

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

  const texLoader = new THREE.TextureLoader();
  const floorTex = new Map<string, THREE.Texture>();
  const loadTex = (name: string, srgb: boolean) => {
    let t = floorTex.get(name);
    if (!t) {
      t = texLoader.load(`/assets/tower/textures/${name}.jpg`, () => wakeRef(), undefined, () => undefined);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = anisotropy;
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      floorTex.set(name, t);
    }
    return t;
  };
  const floorMats = new Map<string, THREE.MeshStandardMaterial>();
  const floorMat = (kind: FloorTex, color: string) => {
    const k = `${kind}|${color}`;
    let m = floorMats.get(k);
    if (!m) {
      m = new THREE.MeshStandardMaterial({
        color,
        map: loadTex(`${kind}_diff`, true),
        normalMap: loadTex(`${kind}_nor`, false),
        roughnessMap: loadTex(`${kind}_rough`, false),
        roughness: kind === 'tile' ? 0.7 : 0.85,
        normalScale: new THREE.Vector2(0.6, 0.6),
      });
      floorMats.set(k, m);
    }
    return m;
  };
  const wallMat = track(new THREE.MeshStandardMaterial({ color: '#f5f2ec', roughness: 0.92 }));
  const wallCapMat = track(new THREE.MeshStandardMaterial({ color: '#d9d4cc', roughness: 0.9 }));
  const railMat = track(new THREE.MeshPhysicalMaterial({ color: '#d7ecf2', roughness: 0.05, metalness: 0, transparent: true, opacity: 0.3, depthWrite: false }));
  const paneMat = track(new THREE.MeshPhysicalMaterial({ color: '#cfe6f2', roughness: 0.03, metalness: 0.1, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }));
  const frameMat = track(new THREE.MeshStandardMaterial({ color: '#3b3f45', roughness: 0.45, metalness: 0.5 }));
  const plateMat = track(new THREE.MeshStandardMaterial({ color: '#77736d', roughness: 0.95 }));
  const otherMat = track(new THREE.MeshStandardMaterial({ color: '#6a665f', roughness: 0.95 }));
  const kit = createFurnitureKit();
  const transparentInterior: THREE.Object3D[] = [];

  const clearInterior = () => {
    while (interior.children.length) interior.remove(interior.children[0]);
    interiorDisposables.forEach((d) => d.dispose());
    interiorDisposables = [];
    transparentInterior.length = 0;
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
    const plateGeo = new THREE.BoxGeometry(FW + 0.6, 0.06, FD + 0.6);
    plateGeo.translate(0, 0.0, 0);
    const plate = new THREE.Mesh(plateGeo, plateMat);
    plate.receiveShadow = true;
    floors.add(plate);
    const hallGeo = new THREE.PlaneGeometry(unit.size.w, unit.size.d);
    const huv = hallGeo.attributes.uv;
    for (let i = 0; i < huv.count; i++) huv.setXY(i, (huv.getX(i) * unit.size.w) / 2.2, (huv.getY(i) * unit.size.d) / 2.2);
    hallGeo.rotateX(-Math.PI / 2);
    const hall = new THREE.Mesh(hallGeo, floorMat('wood', '#efe6da'));
    hall.position.set(cx, 0.04, -cy);
    hall.receiveShadow = true;
    floors.add(hall);
    interiorDisposables.push(plateGeo, hallGeo);
    for (const r of unit.rooms) {
      const st = FLOOR_STYLE[r.kind];
      const g = new THREE.PlaneGeometry(r.rect.w, r.rect.d);
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * r.rect.w) / st.size, (uv.getY(i) * r.rect.d) / st.size);
      g.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(g, floorMat(st.tex, st.color));
      mesh.position.set(r.rect.x + r.rect.w / 2, 0.05, -(r.rect.y + r.rect.d / 2));
      mesh.receiveShadow = true;
      floors.add(mesh);
      interiorDisposables.push(g);
    }
    const core = new THREE.Mesh(box(0, 0.4, 0, 8, 0.8, 6), otherMat);
    core.receiveShadow = true;
    core.castShadow = true;
    floors.add(core);
    interiorDisposables.push(core.geometry);
    interior.add(floors);

    const walls: THREE.BufferGeometry[] = [];
    const caps: THREE.BufferGeometry[] = [];
    const rails: THREE.BufferGeometry[] = [];
    const panes: THREE.BufferGeometry[] = [];
    const frames: THREE.BufferGeometry[] = [];
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
          if (o.axis !== dir) continue;
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
      const putWall = (s0: number, s1: number, h0: number, h1: number) => {
        put(walls, s0, s1, h0, h1);
        if (h1 >= H - 0.001 && !rail) put(caps, s0, s1, h1, h1 + 0.012, WALL_T + 0.002);
      };
      let cur = a;
      for (const cut of cuts) {
        if (rail) put(rails, cur, cut.a, 0, H, 0.03);
        else putWall(cur, cut.a, 0, H);
        if (cut.kind === 'door') putWall(cut.a, cut.b, 2.1, low ? 2.1 : H);
        else if (!low) {
          putWall(cut.a, cut.b, 0, 0.9);
          putWall(cut.a, cut.b, 2.1, H);
          put(panes, cut.a, cut.b, 0.9, 2.1, 0.03);
          put(frames, cut.a, cut.b, 0.88, 0.92, 0.07);
          put(frames, cut.a, cut.b, 2.08, 2.12, 0.07);
          const mid = (cut.a + cut.b) / 2;
          put(frames, mid - 0.02, mid + 0.02, 0.9, 2.1, 0.07);
        } else putWall(cut.a, cut.b, 0, H);
        cur = cut.b;
      }
      if (rail) put(rails, cur, b, 0, H, 0.03);
      else putWall(cur, b, 0, H);
      if (rail) put(frames, a, b, H, H + 0.04, 0.06);
    };
    for (const r of unit.rooms) {
      const { x, y, w, d } = r.rect;
      const rail = r.kind === 'balcony';
      segment('x', y, x, x + w, rail);
      segment('x', y + d, x, x + w, rail);
      segment('y', x, y, y + d, rail);
      segment('y', x + w, y, y + d, rail);
    }
    const addMerged = (list: THREE.BufferGeometry[], m: THREE.Material, cast: boolean, transparent = false) => {
      const g = mergeAll(list);
      if (!g) return;
      const mesh = new THREE.Mesh(g, m);
      mesh.castShadow = cast;
      mesh.receiveShadow = !transparent;
      interior.add(mesh);
      interiorDisposables.push(g);
      if (transparent) transparentInterior.push(mesh);
    };
    addMerged(walls, wallMat, true);
    addMerged(caps, wallCapMat, false);
    addMerged(frames, frameMat, true);
    addMerged(rails, railMat, false, true);
    addMerged(panes, paneMat, false, true);
    interior.position.y = base;
    furnGroup.position.y = base + 0.06;
  };

  const towerPose = (): Pose => {
    const aspect = width / height;
    const tanH = Math.tan((TOWER_FOV * Math.PI) / 360);
    const dv = ((CROWN_TOP + 8) / 2 / tanH) * 1.0;
    const dh = (Math.hypot(FW, FD) * (aspect < 1 ? 1.08 : 0.8)) / (tanH * aspect);
    const dist = Math.max(dv, dh, 70);
    const el = (8 * Math.PI) / 180;
    const az = (36 * Math.PI) / 180;
    const target = new THREE.Vector3(0, CROWN_TOP * 0.5, 0);
    const pos = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(dist).add(target);
    return { pos, target, fov: TOWER_FOV };
  };

  const fitCam = new THREE.PerspectiveCamera(UNIT_FOV, 1, 0.5, 3000);

  const unitPose = (unit: Unit): Pose => {
    const aspect = width / height;
    const base = floorBase(unit.floor);
    const el = (60 * Math.PI) / 180;
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
        return Math.abs(q.x) < 0.95 && Math.abs(q.y) < 0.93;
      });
    };
    const right = new THREE.Vector3();
    const up = new THREE.Vector3();
    let hi = 220;
    for (let pass = 0; pass < 4; pass++) {
      let lo = 6;
      hi = 220;
      for (let i = 0; i < 22; i++) {
        const mid = (lo + hi) / 2;
        if (fits(mid)) hi = mid;
        else lo = mid;
      }
      fitCam.position.copy(target).addScaledVector(dir, hi);
      fitCam.lookAt(target);
      fitCam.updateMatrixWorld(true);
      let x0 = Infinity;
      let x1 = -Infinity;
      let y0 = Infinity;
      let y1 = -Infinity;
      for (const p of pts) {
        const q = p.clone().project(fitCam);
        x0 = Math.min(x0, q.x);
        x1 = Math.max(x1, q.x);
        y0 = Math.min(y0, q.y);
        y1 = Math.max(y1, q.y);
      }
      const tanV = Math.tan((UNIT_FOV * Math.PI) / 360) * hi;
      right.setFromMatrixColumn(fitCam.matrixWorld, 0);
      up.setFromMatrixColumn(fitCam.matrixWorld, 1);
      target.addScaledVector(right, ((x0 + x1) / 2) * tanV * aspect).addScaledVector(up, ((y0 + y1) / 2) * tanV);
    }
    const pos = target.clone().addScaledVector(dir, hi);
    return { pos, target, fov: UNIT_FOV };
  };

  let flightU = 0;
  let flightDir: 0 | 1 = 0;
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
      controls.minDistance = 55;
      controls.maxDistance = 360;
      controls.minPolarAngle = 0.5;
      controls.maxPolarAngle = 1.5;
    }
  };

  const post = createPost(renderer, scene, camera, clipList, () => [hoverGroup, peers.group, ...tower.noAO, ...transparentInterior, site.water]);
  canvas.dataset.ao = post.ao ? '1' : '0';
  if (post.software) {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2) * 0.6);
    renderer.shadowMap.enabled = false;
    sun.castShadow = false;
    tower.glassMat.clearcoat = 0;
  }

  const applyFlight = () => {
    const t = easeInOut(flightU);
    const topClip = CROWN_TOP + 20;
    const unitClip = activeUnit ? floorBase(activeUnit.floor) + 0.01 : topClip;
    const cut = smooth(0.08, 0.5, flightU);
    clip.constant = topClip + (unitClip - topClip) * cut;
    hoverGroup.visible = flightU < 0.02;
    const w = smooth(0.3, 0.85, flightU);
    renderer.toneMappingExposure = 0.62 + 0.1 * w;
    hemi.intensity = 0.45 + 0.8 * w;
    hemi.color.copy(hemiSky).lerp(hemiWarm, w);
    scene.environmentIntensity = 1 - 0.45 * w;
    setShadow(smooth(0.35, 0.75, flightU));
    post.setRadius(AO_TOWER + (AO_UNIT - AO_TOWER) * w);
    interior.visible = (!!activeUnit && flightU > 0) || (!!activeUnit && mode === 'tower');
    furnGroup.visible = flightU > 0.3;
    if (flightU > 0 && pathPos && pathTgt) {
      const pos = pathPos.getPoint(t);
      const tg = pathTgt.getPoint(t);
      placeCamera(pos, tg, pathFov[0] + (pathFov[1] - pathFov[0]) * smooth(0, 1, t));
    }
  };

  const setSunFor = (unit: Unit) => {
    const base = floorBase(unit.floor);
    unitShadow.c.set(unit.origin.x + unit.size.w / 2, base + 1, -(unit.origin.y + unit.size.d / 2));
    unitShadow.r = Math.hypot(unit.size.w, unit.size.d) * 0.62 + 2;
  };

  const entries = new Map<string, FurnEntry>();
  const pendingDrops: FurnEntry[] = [];
  const ringGeo = track(new THREE.RingGeometry(0.82, 1, 40));
  let lastFurnish: FurnishResult | null = null;
  let furnResult: FurnishResult | null = null;
  let highlightIds: string[] = [];
  let highlightSince = 0;
  let morph = 2000;

  const pieceSig = (p: Piece) => `${p.kind}|${p.roomId}|${p.x.toFixed(3)}|${p.y.toFixed(3)}|${p.rotation}|${p.color}|${p.w}|${p.d}|${p.h}`;

  const freeGlow = (obj: THREE.Object3D) =>
    obj.traverse((o) => {
      if (o.userData.glow) {
        const m = o as THREE.Mesh;
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    });

  const removeEntry = (e: FurnEntry) => {
    furnGroup.remove(e.obj);
    furnGroup.remove(e.ring);
    freeGlow(e.obj);
    (e.ring.material as THREE.Material).dispose();
    const i = pendingDrops.indexOf(e);
    if (i >= 0) pendingDrops.splice(i, 1);
  };

  const clearFurniture = () => {
    entries.forEach(removeEntry);
    entries.clear();
  };

  const placeObj = (obj: THREE.Group, p: Piece) => {
    obj.position.set(p.x, 0, -p.y);
    obj.rotation.y = FRONT_YAW - (p.rotation * Math.PI) / 180;
  };

  const upgradeModels = () => {
    entries.forEach((e) => {
      if (e.obj.userData.model || !kit.hasModel(e.piece.kind)) return;
      const next = kit.build(e.piece, true);
      placeObj(next, e.piece);
      next.position.y = e.obj.position.y;
      next.scale.copy(e.obj.scale);
      next.visible = e.obj.visible;
      const glowOn = highlightIds.includes(e.id);
      next.traverse((o) => {
        if (o.userData.glow) o.visible = glowOn;
      });
      furnGroup.remove(e.obj);
      freeGlow(e.obj);
      furnGroup.add(next);
      e.obj = next;
    });
    wake();
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
      placeObj(obj, p);
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
      const e: FurnEntry = { id: p.id, sig: pieceSig(p), piece: p, obj, ring, startAt: i * stagger, dur, state: 'hidden' };
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
        const r = Math.max(e.piece.w, e.piece.d) * 0.62;
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
    band.position.y = floorBase(f);
    band.scale.set(1 + (1 - bandLift) * 0.03, 1, 1 + (1 - bandLift) * 0.03);
    bandMat.opacity = 0.3 * bandLift;
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
      mat.opacity = sel ? Math.min(0.85, STATUS_OPACITY[u.status] + 0.25) : STATUS_OPACITY[u.status];
      t.visible = true;
      t.scale.set(u.size.w + 0.5, FH - SLAB_T - 0.1, u.size.d + 0.5);
      t.position.set(u.origin.x + u.size.w / 2, floorBase(f) + (FH - SLAB_T) / 2, -(u.origin.y + u.size.d / 2));
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
  const towerBox = new THREE.Box3(new THREE.Vector3(-FW / 2 - 0.4, LOBBY, -FD / 2 - 0.4), new THREE.Vector3(FW / 2 + 0.4, TOP, FD / 2 + 0.4));
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
      b3.min.set(u.origin.x - 0.4, y0, -(u.origin.y + u.size.d) - 0.4);
      b3.max.set(u.origin.x + u.size.w + 0.4, y0 + FH, -u.origin.y + 0.4);
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
    viewTween = null;
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
  let viewTween: { p0: THREE.Vector3; t0: THREE.Vector3; p1: THREE.Vector3; t1: THREE.Vector3; start: number; dur: number } | null = null;
  const lastView = { p: new THREE.Vector3(Infinity, 0, 0), t: new THREE.Vector3() };
  const flying = () => flightU !== flightDir;

  const keys = createKeyControls(container, camera, controls, () => wake(), () => !flying());

  function wake() {
    if (!raf && !disposed) raf = requestAnimationFrame(tick);
  }
  wakeRef = wake;

  const emitView = () => {
    if (!callbacks.onViewChange) return;
    if (lastView.p.distanceToSquared(camera.position) < 1e-6 && lastView.t.distanceToSquared(controls.target) < 1e-6) return;
    lastView.p.copy(camera.position);
    lastView.t.copy(controls.target);
    callbacks.onViewChange(getView());
  };

  function tick(now: number) {
    raf = 0;
    if (disposed) return;
    const dt = lastTs ? Math.min(0.12, (now - lastTs) / 1000) : 0.016;
    lastTs = now;
    let busy = false;

    const goal = flightDir;
    if (flightU !== goal) {
      viewTween = null;
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
    if (viewTween) {
      const k = Math.min(1, (now - viewTween.start) / viewTween.dur);
      const e = easeInOut(k);
      camera.position.lerpVectors(viewTween.p0, viewTween.p1, e);
      controls.target.lerpVectors(viewTween.t0, viewTween.t1, e);
      camera.lookAt(controls.target);
      if (k >= 1) viewTween = null;
      busy = true;
    }
    if (!flying() && keys.step(dt)) busy = true;
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
    if (peers.step(dt, camera)) busy = true;
    post.render();
    canvas.dataset.ao = post.ao ? '1' : '0';
    canvas.dataset.flight = flightU.toFixed(3);
    canvas.dataset.calls = String(renderer.info.render.calls);
    canvas.dataset.tris = String(renderer.info.render.triangles);
    emitView();
    if (busy) wake();
  }

  controls.addEventListener('change', () => wake());
  controls.addEventListener('start', () => {
    viewTween = null;
  });

  const resize = () => {
    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    width = w;
    height = h;
    renderer.setSize(w, h, false);
    post.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (flightDir === 0 && flightU === 0) {
      const p = towerPose();
      startPose = p;
      if (!viewTween) placeCamera(p.pos, p.target, p.fov);
    } else if (activeUnit && flightDir === 1 && flightU === 1) {
      if (axisFor(activeUnit) !== outAxis) buildInterior(activeUnit);
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
    if (wantFly) kit.load().then(() => !disposed && upgradeModels());

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
        setShadow(1);
      }
    } else if (!unit && builtFor && flightU === 0 && !wantFly) {
      clearInterior();
      builtFor = null;
      activeUnit = null;
      clearFurniture();
    }

    furnResult = s.furnish;
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
      viewTween = null;
      configureControls();
    } else if (!wantFly && flightDir === 1) {
      endPose = { pos: camera.position.clone(), target: controls.target.clone(), fov: camera.fov };
      buildPath();
      flightDir = 0;
      viewTween = null;
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
    viewTween = null;
    const target = flightDir === 1 && activeUnit ? unitPose(activeUnit) : towerPose();
    if (flightDir === 1 && activeUnit) endPose = target;
    else startPose = target;
    if (flightDir === 1) buildPath();
    placeCamera(target.pos, target.target, target.fov);
    controls.update();
    wake();
  };

  function getView(): CameraPose {
    const r = (n: number) => Math.round(n * 1000) / 1000;
    return { p: [r(camera.position.x), r(camera.position.y), r(camera.position.z)], t: [r(controls.target.x), r(controls.target.y), r(controls.target.z)] };
  }

  const setView = (pose: CameraPose, opts: { smooth?: boolean } = {}) => {
    if (disposed || flying() || !validPose(pose)) return;
    const p1 = new THREE.Vector3(...pose.p);
    const t1 = new THREE.Vector3(...pose.t);
    if (p1.distanceToSquared(t1) < 1e-6) return;
    if (opts.smooth && !reduced) {
      viewTween = { p0: camera.position.clone(), t0: controls.target.clone(), p1, t1, start: performance.now(), dur: 250 };
    } else {
      viewTween = null;
      camera.position.copy(p1);
      controls.target.copy(t1);
      camera.lookAt(t1);
    }
    wake();
  };

  const setPeers = (list: PeerMarker[]) => {
    if (disposed) return;
    peers.set(Array.isArray(list) ? list : []);
    wake();
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(raf);
    ro.disconnect();
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointermove', onDragMove);
    canvas.removeEventListener('pointerleave', onLeave);
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointerup', onUp);
    keys.dispose();
    controls.dispose();
    clearFurniture();
    kit.dispose();
    clearInterior();
    peers.dispose();
    floorMats.forEach((m) => m.dispose());
    floorTex.forEach((t) => t.dispose());
    labelCache.forEach((t) => t.dispose());
    disposables.forEach((d) => d.dispose());
    tower.dispose();
    site.dispose();
    post.dispose();
    sky.dispose();
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    renderer.dispose();
    canvas.remove();
    if (addedTab) container.removeAttribute('tabindex');
    if (addedLabel) container.removeAttribute('aria-label');
  };

  wake();
  return { update, resetView, dispose, getView, setView, setPeers };
}
