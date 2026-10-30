import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import { RectAreaLightUniformsLib } from "three/addons/lights/RectAreaLightUniformsLib.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { SSAOPass } from "three/addons/postprocessing/SSAOPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { createSurfaceLibrary, type SurfaceKind } from "./realism-surfaces";
import { getLocalModel } from "./local-assets";
import { getCatalogAsset } from "./catalog";
import { canStand } from "./domain";
import type {
  FurnitureItem,
  ItemKind,
  Position,
  SceneCallbacks,
  SceneController,
  SceneState,
} from "./types";

const UP = new THREE.Vector3(0, 1, 0);
const palette = {
  wood: "#82583c",
  oak: "#b48960",
  dark: "#33332e",
  metal: "#424b43",
  cream: "#e8dfcf",
  teal: "#285952",
};
const material = (color: string | number, roughness = 0.8, metalness = 0) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness });

function mesh(
  group: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  mat: THREE.Material,
  x = 0,
  y = 0,
  z = 0,
): THREE.Mesh {
  const o = new THREE.Mesh(geometry, mat);
  o.position.set(x, y, z);
  o.castShadow = true;
  o.receiveShadow = true;
  group.add(o);
  return o;
}
function box(
  group: THREE.Object3D,
  size: number[],
  mat: THREE.Material,
  pos: number[] = [0, 0, 0],
  rounded = 0,
): THREE.Mesh {
  return mesh(
    group,
    rounded
      ? new RoundedBoxGeometry(size[0], size[1], size[2], 2, rounded)
      : new THREE.BoxGeometry(size[0], size[1], size[2]),
    mat,
    pos[0],
    pos[1],
    pos[2],
  );
}
function cylinder(
  group: THREE.Object3D,
  top: number,
  bottom: number,
  height: number,
  mat: THREE.Material,
  x = 0,
  y = 0,
  z = 0,
  segments = 24,
) {
  return mesh(
    group,
    new THREE.CylinderGeometry(top, bottom, height, segments),
    mat,
    x,
    y,
    z,
  );
}
function sphere(
  group: THREE.Object3D,
  radius: number,
  mat: THREE.Material,
  x: number,
  y: number,
  z: number,
) {
  return mesh(group, new THREE.SphereGeometry(radius, 16, 12), mat, x, y, z);
}
function rod(
  group: THREE.Object3D,
  a: THREE.Vector3,
  b: THREE.Vector3,
  radius: number,
  mat: THREE.Material,
) {
  const o = cylinder(group, radius, radius, a.distanceTo(b), mat);
  o.position.copy(a).add(b).multiplyScalar(0.5);
  o.quaternion.setFromUnitVectors(UP, b.clone().sub(a).normalize());
  return o;
}

function buildFurniture(item: FurnitureItem): THREE.Group {
  const g = new THREE.Group(),
    { width: w, depth: d, height: h } = item.dimensions;
  const wood = material(palette.wood),
    lightWood = material(palette.oak),
    body = material(item.color),
    dark = material(palette.dark),
    cream = material(palette.cream),
    metal = material(palette.metal, 0.55, 0.3);
  if (item.kind === "bed") {
    const baseH = Math.min(h * 0.48, 0.3),
      mattressH = Math.min(h * 0.3, 0.18),
      top = baseH + mattressH;
    box(g, [w, baseH, d], wood, [0, baseH / 2, 0], 0.035);
    for (const x of [-w / 2 + 0.07, w / 2 - 0.07])
      for (const z of [-d / 2 + 0.09, d / 2 - 0.09])
        box(g, [0.09, 0.12, 0.09], dark, [x, 0.06, z]);
    box(
      g,
      [w - 0.045, mattressH, d - 0.06],
      cream,
      [0, baseH + mattressH / 2, 0],
      0.055,
    );
    box(
      g,
      [w + 0.03, h * 0.9, 0.075],
      wood,
      [0, h * 0.45, -d / 2 + 0.03],
      0.025,
    );
    box(
      g,
      [w + 0.025, h * 0.55, 0.065],
      wood,
      [0, h * 0.275, d / 2 - 0.025],
      0.02,
    );
    box(
      g,
      [w - 0.075, 0.035, d * 0.72],
      body,
      [0, top + 0.018, d * 0.08],
      0.025,
    );
    const patchMat = material("#ddd3c4"),
      patchDark = material("#705f55");
    for (let row = 0; row < 4; row++)
      for (let col = 0; col < 3; col++) {
        const px = ((col - 1) * (w - 0.12)) / 3,
          pz = -d * 0.22 + row * d * 0.165;
        box(
          g,
          [(w - 0.16) / 3, 0.004, d * 0.14],
          (row + col) % 2 ? patchMat : patchDark,
          [px, top + 0.039, pz],
        );
        if ((row + col) % 2 === 0) {
          const floral = mesh(
            g,
            new THREE.CircleGeometry(0.035, 6),
            cream,
            px,
            top + 0.042,
            pz,
          );
          floral.rotation.x = -Math.PI / 2;
        }
      }
    const pillow = material("#cfa19e");
    for (const x of [-w * 0.24, w * 0.24])
      box(
        g,
        [w * 0.4, 0.11, d * 0.18],
        pillow,
        [x, top + 0.06, -d * 0.32],
        0.05,
      );
    const throwMat = material("#518ea1");
    const throwMesh = box(
      g,
      [w * 0.48, 0.055, d * 0.32],
      throwMat,
      [w * 0.17, top + 0.075, d * 0.2],
      0.035,
    );
    throwMesh.rotation.y = 0.12;
  } else if (item.kind === "wardrobe") {
    box(g, [w, h, d], body, [0, h / 2, 0], 0.022);
    const doorMat = material(
      new THREE.Color(item.color).offsetHSL(0, 0, 0.035).getHex(),
    );
    for (const side of [-1, 1]) {
      box(
        g,
        [w * 0.482, h - 0.12, 0.028],
        doorMat,
        [side * w * 0.25, h / 2 + 0.015, d / 2 + 0.018],
        0.008,
      );
      cylinder(
        g,
        0.009,
        0.009,
        0.105,
        material("#b3b7ac", 0.3, 0.7),
        side * 0.045,
        h * 0.47,
        d / 2 + 0.045,
        10,
      );
    }
    box(g, [w + 0.05, 0.045, d + 0.04], dark, [0, h + 0.016, 0], 0.006);
    const luggage = material("#526e7c");
    box(g, [w * 0.62, 0.2, d * 0.76], luggage, [-w * 0.1, h + 0.13, 0], 0.045);
    box(g, [w * 0.2, 0.24, d * 0.5], cream, [w * 0.31, h + 0.14, 0], 0.01);
    box(g, [w * 0.15, 0.015, 0.025], dark, [-w * 0.1, h + 0.24, 0]);
  } else if (item.kind === "desk") {
    box(g, [w, 0.045, d], body, [0, h - 0.022, 0], 0.014);
    for (const x of [-w / 2 + 0.045, w / 2 - 0.045])
      for (const z of [-d / 2 + 0.045, d / 2 - 0.045])
        box(g, [0.035, h - 0.045, 0.035], metal, [x, (h - 0.045) / 2, z]);
    for (const x of [-w / 2 + 0.045, w / 2 - 0.045])
      box(g, [0.035, 0.03, d - 0.06], metal, [x, 0.12, 0]);
    box(g, [w * 0.53, 0.012, d * 0.58], dark, [w * 0.08, h + 0.008, 0], 0.01);
    box(
      g,
      [w * 0.34, 0.018, d * 0.31],
      material("#646b65"),
      [w * 0.08, h + 0.026, -d * 0.02],
      0.008,
    );
    const screen = box(
      g,
      [w * 0.34, h * 0.28, 0.014],
      dark,
      [w * 0.08, h + h * 0.15, -d * 0.14],
      0.008,
    );
    screen.rotation.x = -0.18;
    const display = box(g, [w * 0.31, h * 0.24, 0.004], material("#354c4c"), [
      w * 0.08,
      h + h * 0.15,
      -d * 0.125,
    ]);
    display.rotation.x = -0.18;
    for (let line = 0; line < 5; line++)
      box(
        g,
        [w * (0.09 + (line % 2) * 0.08), 0.003, 0.005],
        material("#92aaa1"),
        [w * 0.045, h + 0.06 + line * 0.026, -d * 0.096 - line * 0.004],
      );
    cylinder(
      g,
      0.034,
      0.035,
      0.16,
      material("#383e3c"),
      -w * 0.36,
      h + 0.08,
      -d * 0.1,
      16,
    );
    cylinder(g, 0.038, 0.038, 0.045, cream, w * 0.37, h + 0.023, -d * 0.11, 16);
  } else if (item.kind === "chair") {
    const seatY = h * 0.46;
    cylinder(g, 0.04, 0.045, seatY, metal, 0, seatY / 2, 0, 16);
    for (let i = 0; i < 5; i++) {
      const a = (i * Math.PI * 2) / 5,
        x = Math.sin(a) * w * 0.42,
        z = Math.cos(a) * d * 0.42;
      rod(
        g,
        new THREE.Vector3(0, 0.13, 0),
        new THREE.Vector3(x, 0.07, z),
        0.018,
        metal,
      );
      sphere(g, 0.033, dark, x, 0.042, z);
    }
    box(g, [w * 0.83, 0.08, d * 0.78], body, [0, seatY, 0], 0.045);
    const back = box(
      g,
      [w * 0.78, h * 0.47, 0.09],
      body,
      [0, h * 0.72, -d * 0.34],
      0.05,
    );
    back.rotation.x = -0.08;
    for (const x of [-w * 0.46, w * 0.46]) {
      box(g, [0.028, h * 0.19, 0.035], metal, [x, seatY + h * 0.12, 0]);
      box(g, [0.055, 0.03, d * 0.55], dark, [x, seatY + h * 0.22, 0], 0.014);
    }
  } else if (item.kind === "floor-bed") {
    box(g, [w, h, d], body, [0, h / 2, 0], Math.min(0.035, h * 0.2));
    const line = material("#dbc9ae");
    for (const inset of [0.05, 0.075]) {
      box(g, [w - inset * 2, 0.004, 0.012], line, [
        0,
        h + 0.003,
        -d / 2 + inset,
      ]);
      box(g, [w - inset * 2, 0.004, 0.012], line, [
        0,
        h + 0.003,
        d / 2 - inset,
      ]);
      box(g, [0.012, 0.004, d - inset * 2], line, [
        -w / 2 + inset,
        h + 0.003,
        0,
      ]);
      box(g, [0.012, 0.004, d - inset * 2], line, [
        w / 2 - inset,
        h + 0.003,
        0,
      ]);
    }
    const motif = mesh(
      g,
      new THREE.RingGeometry(Math.min(w, d) * 0.16, Math.min(w, d) * 0.175, 32),
      line,
      0,
      h + 0.006,
      0,
    );
    motif.rotation.x = -Math.PI / 2;
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4,
        o = box(g, [0.035, 0.004, 0.08], line, [
          Math.sin(a) * w * 0.13,
          h + 0.007,
          Math.cos(a) * w * 0.13,
        ]);
      o.rotation.y = a;
    }
    box(
      g,
      [w * 0.42, 0.09, d * 0.17],
      material("#697d77"),
      [w * 0.1, h + 0.045, -d * 0.3],
      0.04,
    );
  } else if (item.kind === "pedestal-fan") {
    const fanCream = material("#d9d6c5"),
      orange = material("#ab7950");
    cylinder(g, w * 0.34, w * 0.43, 0.05, fanCream, 0, 0.025, 0, 32);
    cylinder(g, 0.022, 0.032, h * 0.68, fanCream, 0, h * 0.34, 0, 16);
    const head = new THREE.Group();
    head.position.set(0, h * 0.79, 0);
    g.add(head);
    const face = cylinder(head, w * 0.49, w * 0.49, 0.075, orange, 0, 0, 0, 40);
    face.rotation.x = Math.PI / 2;
    const inner = cylinder(
      head,
      w * 0.465,
      w * 0.465,
      0.08,
      material("#e7e5d6", 0.9),
      0,
      0,
      0.006,
      40,
    );
    inner.rotation.x = Math.PI / 2;
    const rim = mesh(
      head,
      new THREE.TorusGeometry(w * 0.47, 0.008, 6, 40),
      fanCream,
      0,
      0,
      0.052,
    );
    for (let i = 0; i < 16; i++) {
      const a = (i * Math.PI) / 8;
      rod(
        head,
        new THREE.Vector3(0, 0, 0.061),
        new THREE.Vector3(
          Math.cos(a) * w * 0.45,
          Math.sin(a) * w * 0.45,
          0.061,
        ),
        0.0025,
        fanCream,
      );
    }
    for (const rr of [0.16, 0.29, 0.4])
      mesh(
        head,
        new THREE.TorusGeometry(w * rr, 0.0025, 4, 40),
        fanCream,
        0,
        0,
        0.062,
      );
    cylinder(head, 0.04, 0.04, 0.012, fanCream, 0, 0, 0, 16).rotation.x =
      Math.PI / 2;
    rim.castShadow = false;
  } else if (item.kind === "stool") {
    box(g, [w, 0.045, d], body, [0, h - 0.022, 0], 0.016);
    for (const x of [-w * 0.37, w * 0.37])
      for (const z of [-d * 0.37, d * 0.37])
        box(g, [0.035, h - 0.045, 0.035], wood, [x, (h - 0.045) / 2, z]);
    for (const x of [-w * 0.37, w * 0.37])
      box(g, [0.025, 0.025, d * 0.78], wood, [x, h * 0.3, 0]);
  } else if (item.kind === "plant") {
    cylinder(g, w * 0.3, w * 0.22, h * 0.31, body, 0, h * 0.155, 0, 24);
    cylinder(
      g,
      w * 0.285,
      w * 0.285,
      0.018,
      material("#403b2c"),
      0,
      h * 0.31,
      0,
      24,
    );
    const leaf = material("#4c704e");
    for (let i = 0; i < 9; i++) {
      const a = i * 2.4,
        y = h * (0.35 + i * 0.055),
        r = w * (0.2 + (i % 3) * 0.055),
        x = Math.sin(a) * r,
        z = Math.cos(a) * r;
      rod(
        g,
        new THREE.Vector3(0, h * 0.27, 0),
        new THREE.Vector3(x, y, z),
        0.007,
        leaf,
      );
      const l = sphere(g, 1, leaf, x, y, z);
      l.scale.set(w * 0.13, h * 0.14, w * 0.045);
      l.rotation.z = Math.sin(a) * 0.6;
      l.rotation.y = a;
    }
  } else if (item.kind === "shelf") {
    for (const x of [-w / 2 + 0.025, w / 2 - 0.025])
      box(g, [0.04, h, d], body, [x, h / 2, 0]);
    for (let i = 0; i < 5; i++)
      box(g, [w, 0.035, d], lightWood, [0, 0.04 + ((h - 0.08) * i) / 4, 0]);
    for (let row = 0; row < 3; row++)
      for (let i = 0; i < 4; i++)
        box(
          g,
          [0.045, 0.2 + Math.sin(i + row) * 0.04, d * 0.65],
          material(["#c1ab85", "#65716b", "#9d7865", "#d6d1bb"][i]),
          [-w * 0.34 + i * 0.075, 0.07 + (row * (h - 0.08)) / 4 + 0.12, 0],
        );
  }
  g.name = item.kind;
  g.userData.itemId = item.id;
  return g;
}

function curtain(
  parent: THREE.Group,
  width: number,
  height: number,
  color: string,
  x: number,
) {
  const geo = new THREE.PlaneGeometry(width, height, 14, 16),
    pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++)
    pos.setZ(i, Math.sin((pos.getX(i) / width + 0.5) * Math.PI * 10) * 0.027);
  geo.computeVertexNormals();
  const sheer = color === "#dedfd0";
  const mat = new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.94,
    side: THREE.DoubleSide,
    sheen: 0.65,
    sheenRoughness: 0.86,
    sheenColor: new THREE.Color("#e0e4d8"),
    transparent: sheer,
    opacity: sheer ? 0.76 : 1,
    depthWrite: !sheer,
  });
  mat.name = "FABRIC_Curtain";
  mat.userData.surface = "fabric";
  mesh(parent, geo, mat, x, height / 2, 0);
}
function windowGroup(
  width: number,
  height: number,
  sill: number,
  wallH: number,
): THREE.Group {
  const g = new THREE.Group(),
    frame = material("#eee9dc"),
    glass = new THREE.MeshPhysicalMaterial({
      color: "#e4eeeb",
      roughness: 0.12,
      metalness: 0,
      transmission: 0.2,
      thickness: 0.012,
      ior: 1.46,
      transparent: true,
      opacity: 0.28,
      side: THREE.DoubleSide,
    });
  box(g, [width + 0.1, 0.055, 0.11], frame, [0, sill - 0.025, 0]);
  box(g, [width, height, 0.025], glass, [0, sill + height / 2, -0.04]);
  for (const x of [-width / 2, width / 2, 0])
    box(g, [0.032, height, 0.06], frame, [x, sill + height / 2, 0]);
  for (const y of [sill, sill + height])
    box(g, [width + 0.04, 0.04, 0.06], frame, [0, y, 0]);
  // A softly lit exterior plane avoids inventing a detailed outdoor scene.
  const daylight = box(
    g,
    [width - 0.02, height - 0.02, 0.015],
    new THREE.MeshBasicMaterial({ color: "#dbe4df" }),
    [0, sill + height / 2, -0.09],
  );
  daylight.castShadow = false;
  const rodMat = material("#777c6c", 0.4, 0.5);
  rod(
    g,
    new THREE.Vector3(-width * 0.68, sill + height + 0.13, 0.1),
    new THREE.Vector3(width * 0.68, sill + height + 0.13, 0.1),
    0.012,
    rodMat,
  );
  const curtainH = Math.min(wallH - 0.17, sill + height + 0.08);
  for (const side of [-1, 1]) {
    const c = new THREE.Group();
    c.position.set(side * width * 0.48, 0.1, 0.14);
    curtain(c, width * 0.32, curtainH, palette.teal, 0);
    g.add(c);
  }
  const sheer = new THREE.Group();
  sheer.position.set(0, 0.15, 0.12);
  curtain(sheer, width * 0.35, curtainH - 0.05, "#dedfd0", 0);
  g.add(sheer);
  return g;
}

function disposeTree(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(),
    materials = new Set<THREE.Material>();
  root.traverse((o) => {
    if (
      o instanceof THREE.Mesh ||
      o instanceof THREE.LineSegments ||
      o instanceof THREE.Line
    ) {
      geometries.add(o.geometry);
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      ms.forEach((m) => materials.add(m));
    }
  });
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
}

export function createRoomScene(
  host: HTMLElement,
  initialState: SceneState,
  callbacks: SceneCallbacks,
): SceneController {
  let state = initialState,
    disposed = false,
    ready = false,
    dirty = true,
    raf = 0,
    dragging = false,
    pointerMoved = false;
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.domElement.style.cssText =
    "display:block;width:100%;height:100%;touch-action:none;outline:none";
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute(
    "aria-label",
    "Interactive 3D room. Select furniture, drag to rearrange, or change view.",
  );
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog("#344139", 18, 38);
  const perspective = new THREE.PerspectiveCamera(52, 1, 0.03, 100),
    plan = new THREE.OrthographicCamera(-4, 4, 4, -4, 0.01, 60);
  let camera: THREE.PerspectiveCamera | THREE.OrthographicCamera = perspective;
  const controls = new OrbitControls(perspective, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;
  controls.minDistance = 1.15;
  controls.maxDistance = 18;
  controls.maxPolarAngle = Math.PI * 0.475;
  controls.minPolarAngle = 0.18;
  controls.target.set(0, 0.8, 0);
  controls.addEventListener("change", () => {
    dirty = true;
  });
  scene.add(new THREE.HemisphereLight("#e5eff4", "#8d7f65", 0.55));
  const sun = new THREE.DirectionalLight("#fff4de", 1.9);
  sun.position.set(3.5, 4.5, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, {
    left: -5,
    right: 5,
    top: 5,
    bottom: -5,
    near: 0.2,
    far: 22,
  });
  sun.shadow.normalBias = 0.012;
  sun.shadow.bias = -0.0002;
  sun.shadow.radius = 2;
  scene.add(sun);
  const fill = new THREE.DirectionalLight("#d8e4e0", 0.38);
  fill.position.set(5, 5, -3);
  scene.add(fill);
  const ground = mesh(
    scene,
    new THREE.PlaneGeometry(200, 200),
    material("#747568"),
    0,
    -0.2,
    0,
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  const roomRoot = new THREE.Group(),
    furnitureRoot = new THREE.Group(),
    overlayRoot = new THREE.Group(),
    ghostRoot = new THREE.Group();
  scene.add(roomRoot, furnitureRoot, overlayRoot, ghostRoot);
  let objectMap = new Map<string, THREE.Group>(),
    roomSignature = "",
    furnitureSignature = "",
    overlaySignature = "";
  const glbTemplates = new Map<string, THREE.Object3D>(),
    sourceRoots: THREE.Object3D[] = [],
    sourceTextures = new Set<THREE.Texture>(),
    pendingLocal = new Set<string>(),
    failedLocal = new Set<string>();
  const assetWarnings = new Set<string>();
  let ghostSignature = "",
    environmentReady = false,
    environmentTarget: THREE.WebGLRenderTarget | null = null,
    lastRenderMs = 0,
    renderedFrames = 0;
  const renderTimings: number[] = [];
  renderer.info.autoReset = false;
  const composer = new EffectComposer(
    renderer,
    new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: 2,
    }),
  );
  const ssao = new SSAOPass(scene, perspective, 1, 1);
  ssao.kernelRadius = 0.16;
  ssao.minDistance = 0.001;
  ssao.maxDistance = 0.08;
  composer.addPass(new RenderPass(scene, perspective));
  composer.addPass(ssao);
  composer.addPass(new OutputPass());
  composer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  const surfaces = createSurfaceLibrary(renderer, () => {
    roomSignature = "";
    furnitureSignature = "";
    buildRoom();
    buildFurnitureGroups();
    ghostSignature = "";
    buildGhost();
    dirty = true;
  });
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  new HDRLoader().load(
    "/assets/environment/studio_small_09_1k.hdr",
    (texture) => {
      if (disposed) {
        texture.dispose();
        return;
      }
      environmentTarget = pmrem.fromEquirectangular(texture);
      scene.environment = environmentTarget.texture;
      scene.environmentIntensity = 0.75;
      texture.dispose();
      pmrem.dispose();
      environmentReady = true;
      dirty = true;
    },
    undefined,
    () => {
      pmrem.dispose();
    },
  );
  RectAreaLightUniformsLib.init();
  const windowLight = new THREE.RectAreaLight("#fff5e6", 4.0, 1.5, 1.5);
  windowLight.position.set(
    state.room.width * 0.17,
    1.6,
    -state.room.depth / 2 + 0.16,
  );
  windowLight.lookAt(0, 0.7, 0);
  scene.add(windowLight);
  const sideLight = new THREE.RectAreaLight("#e3edf1", 3.1, 1.42, 1.5);
  sideLight.position.set(
    -state.room.width / 2 + 0.16,
    1.6,
    -state.room.depth * 0.12,
  );
  sideLight.lookAt(0, 0.65, 0.4);
  scene.add(sideLight);
  function registerSource(root: THREE.Object3D) {
    sourceRoots.push(root);
    root.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of ms)
          for (const value of Object.values(m))
            if (value instanceof THREE.Texture) sourceTextures.add(value);
      }
    });
  }
  function refreshAssets() {
    furnitureSignature = "";
    buildFurnitureGroups();
    overlaySignature = "";
    buildOverlays();
    ghostSignature = "";
    buildGhost();
    dirty = true;
  }
  const assetLoader = new GLTFLoader();
  function loadBuiltin(url: string, fallback = false) {
    assetLoader.load(
      url,
      (gltf) => {
        if (disposed) {
          disposeTree(gltf.scene);
          return;
        }
        registerSource(gltf.scene);
        const names = new Set([
          "bed",
          "wardrobe",
          "desk",
          "chair",
          "floor-bed",
          "pedestal-fan",
          "stool",
          "plant",
          "shelf",
          "bed-platform",
          "bed-upholstered",
          "wardrobe-sliding",
          "desk-oak",
          "chair-task",
        ]);
        gltf.scene.traverse((o) => {
          const kind = String(o.userData.kind || o.name);
          if (names.has(kind)) glbTemplates.set(kind, o);
        });
        refreshAssets();
      },
      undefined,
      () => {
        if (!fallback) loadBuiltin("/assets/furniture.glb", true);
      },
    );
  }
  loadBuiltin("/assets/furniture-realistic.glb");
  function ensureLocalTemplate(assetId: string) {
    if (
      pendingLocal.has(assetId) ||
      failedLocal.has(assetId) ||
      glbTemplates.has(assetId)
    )
      return;
    pendingLocal.add(assetId);
    getLocalModel(assetId)
      .then((buffer) => {
        if (!buffer)
          throw new Error("This imported model is not stored on this device.");
        return assetLoader.parseAsync(buffer, "");
      })
      .then((gltf) => {
        pendingLocal.delete(assetId);
        if (disposed) {
          disposeTree(gltf.scene);
          return;
        }
        const bounds = new THREE.Box3().setFromObject(gltf.scene),
          size = bounds.getSize(new THREE.Vector3());
        if (
          ![size.x, size.y, size.z].every(
            (v) => Number.isFinite(v) && v > 0.00001,
          )
        ) {
          disposeTree(gltf.scene);
          throw new Error("The imported model has no usable 3D bounds.");
        }
        const center = bounds.getCenter(new THREE.Vector3()),
          normalized = new THREE.Group();
        gltf.scene.position.sub(
          new THREE.Vector3(center.x, bounds.min.y, center.z),
        );
        normalized.add(gltf.scene);
        normalized.scale.set(1 / size.x, 1 / size.y, 1 / size.z);
        registerSource(normalized);
        glbTemplates.set(assetId, normalized);
        refreshAssets();
      })
      .catch(() => {
        pendingLocal.delete(assetId);
        failedLocal.add(assetId);
        assetWarnings.add(
          "An imported model is unavailable here; its dimensioned placeholder remains editable.",
        );
        dirty = true;
      });
  }
  function surfaceOf(
    mat: THREE.Material,
    item: FurnitureItem,
  ): SurfaceKind | undefined {
    if (mat.userData.surface) return mat.userData.surface as SurfaceKind;
    if (/wood|oak|walnut|timber/i.test(mat.name)) return "wood";
    if (/fabric|cotton|linen|pillow|throw|upholster|cloth/i.test(mat.name))
      return "fabric";
    if (/metal|brass|steel/i.test(mat.name)) return "metal";
    if (mat.name.startsWith("BODY_"))
      return ["bed", "chair", "floor-bed"].includes(item.kind)
        ? "fabric"
        : "paint";
    return undefined;
  }
  function instantiateFurniture(item: FurnitureItem): THREE.Group {
    const key = item.assetId?.startsWith("local:")
      ? item.assetId
      : item.assetId?.replace(/^builtin:/, "") || item.kind;
    if (key.startsWith("local:")) {
      ensureLocalTemplate(key);
      if (!glbTemplates.has(key)) {
        const pending = new THREE.Group();
        pending.userData.assetId = item.assetId;
        const outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(item.dimensions.width,item.dimensions.height,item.dimensions.depth)),new THREE.LineBasicMaterial({color:0xdcc18c,transparent:true,opacity:.3}));
        outline.position.y=item.dimensions.height/2;pending.add(outline);
        return pending;
      }
    }
    const template = glbTemplates.get(key) || glbTemplates.get(item.kind);
    if (!template) return buildFurniture(item);
    const root = new THREE.Group(),
      scaled = new THREE.Group(),
      model = template.clone(true);
    const defaultColor = getCatalogAsset(
      item.assetId ?? `builtin:${item.kind}`,
    )?.color;
    const customTint =
      item.color.toLowerCase() !== defaultColor?.toLowerCase() &&
      item.color.toLowerCase() !== "#ffffff";
    model.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.geometry = o.geometry.clone();
      o.castShadow = true;
      o.receiveShadow = true;
      const cloneMaterial = (m: THREE.Material) => {
        const copy = m.clone();
        if (copy instanceof THREE.MeshStandardMaterial) {
          const surface = surfaceOf(copy, item);
          if (surface)
            surfaces.apply(copy, surface, { albedo: surface === "wood" });
          if (
            customTint &&
            (copy.name.startsWith("BODY_") || copy.userData.editableColor)
          )
            copy.color.set(item.color);
          copy.envMapIntensity = 0.75;
        }
        return copy;
      };
      o.material = Array.isArray(o.material)
        ? o.material.map(cloneMaterial)
        : cloneMaterial(o.material);
    });
    scaled.scale.set(
      item.dimensions.width,
      item.dimensions.height,
      item.dimensions.depth,
    );
    scaled.add(model);
    root.add(scaled);
    root.name = item.kind;
    root.userData.itemId = item.id;
    root.userData.assetId = item.assetId ?? `builtin:${item.kind}`;
    root.userData.assetSource = glbTemplates.has(key)
      ? key.startsWith("local:")
        ? "local"
        : "builtin"
      : "fallback";
    return root;
  }
  function buildGhost() {
    const signature = JSON.stringify(state.ghostItem);
    if (signature === ghostSignature) return;
    ghostSignature = signature;
    disposeTree(ghostRoot);
    ghostRoot.clear();
    const item = state.ghostItem;
    if (!item) return;
    const model = instantiateFurniture(item);
    model.position.set(item.position.x, 0.027, item.position.z);
    model.rotation.y = item.rotation;
    model.updateMatrixWorld(true);
    model.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        const line = new THREE.LineSegments(
          new THREE.EdgesGeometry(o.geometry, 28),
          new THREE.LineBasicMaterial({
            color: "#a9c7ba",
            transparent: true,
            opacity: 0.22,
            depthWrite: false,
          }),
        );
        line.applyMatrix4(o.matrixWorld);
        line.renderOrder = 5;
        ghostRoot.add(line);
      }
    });
    disposeTree(model);
    dirty = true;
  }
  function renderScene() {
    renderer.info.reset();
    const before = performance.now();
    const ceiling = roomRoot.getObjectByName("room-ceiling");
    if (ceiling) {
      const show =
        state.mode === "walk" ||
        perspective.position.y < state.room.height - 0.12;
      if (ceiling.visible !== show) {
        ceiling.visible = show;
        renderer.shadowMap.needsUpdate = true;
      }
    }
    if (
      host.clientWidth >= 700 &&
      state.mode === "orbit" &&
      !dragging &&
      !pointer
    ) {
      ssao.camera = perspective;
      composer.render();
    } else renderer.render(scene, camera);
    lastRenderMs = performance.now() - before;
    renderedFrames++;
    renderTimings.push(lastRenderMs);
    if (renderTimings.length > 60) renderTimings.shift();
  }

  function buildRoom() {
    const { width: w, depth: d, height: h, door } = state.room;
    const signature = JSON.stringify([
      state.room,
      state.layout.wallColor,
      state.layout.accentColor,
      state.wallsVisible,
      state.mode === "walk",
    ]);
    if (signature === roomSignature) return;
    roomSignature = signature;
    disposeTree(roomRoot);
    roomRoot.clear();
    const base = material("#615343"),
      plaster = material(state.layout.wallColor),
      accent = material(state.layout.accentColor),
      trim = material("#d4cbbb");
    surfaces.apply(plaster, "plaster");
    surfaces.apply(accent, "plaster");
    windowLight.position.set(w * 0.17, 1.6, -d / 2 + 0.16);
    sideLight.position.set(-w / 2 + 0.16, 1.6, -d * 0.12);
    box(roomRoot, [w + 0.18, 0.15, d + 0.18], base, [0, -0.075, 0], 0.025);
    const plankCount = Math.ceil(w / 0.2),
      plankW = w / plankCount;
    for (let i = 0; i < plankCount; i++) {
      const color = new THREE.Color(
        i % 3 === 0 ? "#9e7551" : i % 3 === 1 ? "#cfb18b" : "#e0c69f",
      );
      color.offsetHSL(0, 0, Math.sin(i * 5) * 0.025);
      const mat = material(color.getHex(), 0.64);
      surfaces.apply(mat, "wood", { normalScale: 0.16 });
      box(roomRoot, [plankW - 0.004, 0.022, d], mat, [
        -w / 2 + plankW * (i + 0.5),
        0.01,
        0,
      ]);
      for (let j = 0; j < 3; j++)
        box(
          roomRoot,
          [0.0015, 0.001, d * 0.19],
          material(color.clone().multiplyScalar(0.82).getHex()),
          [
            -w / 2 + plankW * (i + 0.2 + j * 0.2),
            0.022,
            -d * 0.32 + (((i * 7 + j * 3) % 13) / 13) * d * 0.6,
          ],
        );
    }
    // Subtle perimeter trim outlines the room even with the cutaway walls hidden.
    box(roomRoot, [w, 0.065, 0.025], trim, [0, 0.052, -d / 2]);
    box(roomRoot, [0.025, 0.065, d], trim, [-w / 2, 0.052, 0]);
    if (state.wallsVisible || state.mode === "walk") {
      const ww = Math.min(1.55, w * 0.4),
        wh = Math.min(1.55, h * 0.55),
        sill = 0.84,
        wx = w * 0.17;
      const backParts = [
        [-w / 2, wx - ww / 2],
        [wx + ww / 2, w / 2],
      ];
      for (const [left, right] of backParts)
        if (right > left)
          box(roomRoot, [right - left, h, 0.1], accent, [
            (left + right) / 2,
            h / 2,
            -d / 2,
          ]);
      box(roomRoot, [ww, sill, 0.1], accent, [wx, sill / 2, -d / 2]);
      box(roomRoot, [ww, Math.max(0.1, h - sill - wh), 0.1], accent, [
        wx,
        (h + sill + wh) / 2,
        -d / 2,
      ]);
      const backWindow = windowGroup(ww, wh, sill, h);
      backWindow.position.set(wx, 0, -d / 2 + 0.06);
      roomRoot.add(backWindow);
      const lww = Math.min(1.42, d * 0.35),
        lwz = -d * 0.12;
      for (const [back, front] of [
        [-d / 2, lwz - lww / 2],
        [lwz + lww / 2, d / 2],
      ])
        if (front > back)
          box(roomRoot, [0.1, h, front - back], plaster, [
            -w / 2,
            h / 2,
            (back + front) / 2,
          ]);
      box(roomRoot, [0.1, sill, lww], plaster, [-w / 2, sill / 2, lwz]);
      box(roomRoot, [0.1, Math.max(0.1, h - sill - wh), lww], plaster, [
        -w / 2,
        (h + sill + wh) / 2,
        lwz,
      ]);
      const leftWindow = windowGroup(lww, wh, sill, h);
      leftWindow.rotation.y = Math.PI / 2;
      leftWindow.position.set(-w / 2 + 0.06, 0, lwz);
      roomRoot.add(leftWindow);
      box(roomRoot, [w + 0.12, 0.16, 0.17], material("#e2dccd"), [
        0,
        h - 0.08,
        -d / 2 + 0.025,
      ]);
      if (state.mode === "walk") {
        box(roomRoot, [0.1, h, d], plaster, [w / 2, h / 2, 0]);
        const left = door.offset - door.width / 2,
          right = door.offset + door.width / 2;
        box(roomRoot, [Math.max(0.01, left + w / 2), h, 0.1], plaster, [
          (-w / 2 + left) / 2,
          h / 2,
          d / 2,
        ]);
        box(roomRoot, [Math.max(0.01, w / 2 - right), h, 0.1], plaster, [
          (right + w / 2) / 2,
          h / 2,
          d / 2,
        ]);
        box(roomRoot, [door.width, h - door.height, 0.1], plaster, [
          door.offset,
          (h + door.height) / 2,
          d / 2,
        ]);
        box(roomRoot, [w, 0.07, d], material("#e5dfd3"), [0, h + 0.015, 0]);
      }
    }
    if (
      (state.wallsVisible || state.mode === "walk") &&
      state.mode !== "plan"
    ) {
      const ceiling = box(roomRoot, [w, 0.045, d], material("#eae7df", 0.94), [
        0,
        h,
        0,
      ]);
      ceiling.name = "room-ceiling";
      ceiling.castShadow = true;
    }
    // Door frame is visible in plan and cutaway view; the opening stays usable.
    const doorMat = material("#786047");
    for (const x of [
      door.offset - door.width / 2,
      door.offset + door.width / 2,
    ])
      box(roomRoot, [0.045, 0.055, 0.2], doorMat, [x, 0.028, d / 2]);
    box(roomRoot, [door.width, 0.018, 0.7], material("#b29a77"), [
      door.offset,
      -0.004,
      d / 2 + 0.35,
    ]);
    if (state.mode !== "plan") {
      const fan = new THREE.Group();
      fan.position.set(0, h - 0.25, -0.05);
      cylinder(fan, 0.09, 0.075, 0.12, material("#463f32"), 0, 0, 0);
      for (let i = 0; i < 3; i++) {
        const blade = box(
          fan,
          [0.12, 0.012, 0.53],
          material("#4c4436"),
          [
            Math.sin((i * Math.PI * 2) / 3) * 0.3,
            -0.02,
            Math.cos((i * Math.PI * 2) / 3) * 0.3,
          ],
          0.02,
        );
        blade.rotation.y = (i * Math.PI * 2) / 3;
      }
      roomRoot.add(fan);
    }
    roomRoot.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of ms)
          if (m.userData.surface === "fabric") surfaces.apply(m, "fabric");
      }
    });
    renderer.shadowMap.needsUpdate = true;
    dirty = true;
  }
  function buildFurnitureGroups() {
    const signature = JSON.stringify(state.layout.items);
    if (signature === furnitureSignature) return;
    furnitureSignature = signature;
    disposeTree(furnitureRoot);
    furnitureRoot.clear();
    objectMap = new Map();
    state.layout.items
      .filter((i) => i.visible)
      .forEach((item) => {
        const g = instantiateFurniture(item);
        g.position.set(item.position.x, 0.025, item.position.z);
        g.rotation.y = item.rotation;
        furnitureRoot.add(g);
        objectMap.set(item.id, g);
      });
    renderer.shadowMap.needsUpdate = true;
    dirty = true;
  }
  function buildOverlays() {
    const signature = JSON.stringify([
      state.selectedId,
      state.showClearances,
      state.layout.items,
      state.mode,
    ]);
    if (signature === overlaySignature) return;
    overlaySignature = signature;
    disposeTree(overlayRoot);
    overlayRoot.clear();
    for (const item of state.layout.items) {
      if (!item.visible) continue;
      const selected = item.id === state.selectedId;
      if (!selected && !state.showClearances) continue;
      const pad = selected ? 0.04 : 0.11,
        w = item.dimensions.width + pad * 2,
        d = item.dimensions.depth + pad * 2;
      const points = [
        [-w / 2, -d / 2],
        [w / 2, -d / 2],
        [w / 2, d / 2],
        [-w / 2, d / 2],
        [-w / 2, -d / 2],
      ].map(([x, z]) => new THREE.Vector3(x, 0.035, z));
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({
          color: selected ? "#eacb88" : "#e3a768",
          transparent: true,
          opacity: selected ? 1 : 0.45,
        }),
      );
      line.position.set(item.position.x, 0.025, item.position.z);
      line.rotation.y = item.rotation;
      overlayRoot.add(line);
      if (selected) {
        const helper = new THREE.BoxHelper(objectMap.get(item.id)!, 0xe6c78b);
        helper.material.transparent = true;
        helper.material.opacity = 0.85;
        overlayRoot.add(helper);
      }
    }
    dirty = true;
  }
  let yaw = 0,
    pitch = -0.04,
    lastMode = state.mode,
    lastAspect = 0;
  function resetView() {
    const scale = Math.max(state.room.width, state.room.depth);
    if (state.mode === "walk") {
      const entry = {
        x: state.room.door.offset,
        z: state.room.depth / 2 + 0.38,
      };
      perspective.position.set(entry.x, 1.6, entry.z);
      yaw = 0.12;
      pitch = -0.05;
      perspective.rotation.order = "YXZ";
      perspective.rotation.set(pitch, yaw, 0);
    } else if (state.mode === "plan") {
      plan.position.set(0, 12, 0.001);
      plan.up.set(0, 0, -1);
      plan.lookAt(0, 0, 0);
      plan.zoom = 1;
      plan.updateProjectionMatrix();
    } else {
      const aspect = Math.max(
          0.5,
          host.clientWidth / Math.max(1, host.clientHeight),
        ),
        fit = Math.max(1, 1.05 / aspect);
      controls.target.set(
        -state.room.width * 0.08,
        1.03,
        -state.room.depth * 0.12,
      );
      perspective.up.set(0, 1, 0);
      perspective.position.set(
        state.room.width * 0.59 * fit,
        1.78 + (fit - 1) * 0.6,
        state.room.depth * 0.77 * fit,
      );
      controls.maxDistance = scale * 4.6;
      perspective.far = Math.max(100, scale * 10);
      perspective.updateProjectionMatrix();
      controls.update();
    }
    dirty = true;
  }
  function resize() {
    const width = Math.max(1, host.clientWidth),
      height = Math.max(1, host.clientHeight),
      aspect = width / height;
    renderer.setSize(width, height);
    composer.setSize(width, height);
    if (
      lastAspect &&
      Math.abs(lastAspect - aspect) > 0.005 &&
      state.mode === "orbit"
    ) {
      const previous = Math.max(1, 1.12 / lastAspect),
        next = Math.max(1, 1.12 / aspect);
      perspective.position
        .sub(controls.target)
        .multiplyScalar(next / previous)
        .add(controls.target);
    }
    lastAspect = aspect;
    perspective.aspect = aspect;
    perspective.updateProjectionMatrix();
    const extent = Math.max(
      state.room.depth * 0.67,
      (state.room.width * 0.67) / aspect,
    );
    plan.left = -extent * aspect;
    plan.right = extent * aspect;
    plan.top = extent;
    plan.bottom = -extent;
    plan.updateProjectionMatrix();
    dirty = true;
  }
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  const raycaster = new THREE.Raycaster(),
    cursor = new THREE.Vector2(),
    floorPlane = new THREE.Plane(UP, 0),
    floorPoint = new THREE.Vector3();
  let pointer: {
    id: number;
    x: number;
    y: number;
    lastX: number;
    lastY: number;
    selected: string | null;
    start: Position | null;
    offset: Position;
  } | null = null;
  const keys = new Set<string>(),
    activePointers = new Map<number, { x: number; y: number }>();
  let planPinch: { distance: number; zoom: number } | null = null;
  function ray(event: PointerEvent) {
    const rect = renderer.domElement.getBoundingClientRect();
    cursor.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      (-(event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(cursor, camera);
  }
  function pick(event: PointerEvent): string | null {
    ray(event);
    const hit = raycaster.intersectObjects(furnitureRoot.children, true)[0];
    if (!hit) return null;
    let o: THREE.Object3D | null = hit.object;
    while (o && !o.userData.itemId) o = o.parent;
    return o?.userData.itemId ?? null;
  }
  function cancelDrag() {
    if (pointer?.selected && pointer.start) {
      const g = objectMap.get(pointer.selected);
      if (g) g.position.set(pointer.start.x, 0.025, pointer.start.z);
    }
    pointer = null;
    dragging = false;
    overlayRoot.visible = true;
    controls.enabled = state.mode === "orbit";
    renderer.shadowMap.needsUpdate = true;
    dirty = true;
  }
  function pinchDistance() {
    const [a, b] = [...activePointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }
  function setPlanZoom(value: number) {
    plan.zoom = THREE.MathUtils.clamp(value, 0.55, 4);
    plan.updateProjectionMatrix();
    dirty = true;
  }
  function onPointerDown(event: PointerEvent) {
    if (event.button !== 0) return;
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (state.mode === "plan")
      renderer.domElement.setPointerCapture(event.pointerId);
    if (activePointers.size > 1) {
      cancelDrag();
      if (state.mode === "plan")
        planPinch = { distance: Math.max(1, pinchDistance()), zoom: plan.zoom };
      return;
    }
    renderer.domElement.focus({ preventScroll: true });
    const selected = pick(event),
      item = state.layout.items.find((i) => i.id === selected);
    pointer = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      selected,
      start: item ? { ...item.position } : null,
      offset: { x: 0, z: 0 },
    };
    pointerMoved = false;
    if (state.mode === "walk") {
      renderer.domElement.setPointerCapture(event.pointerId);
      return;
    }
    if (item && selected === state.selectedId && !item.locked) {
      ray(event);
      raycaster.ray.intersectPlane(floorPlane, floorPoint);
      pointer.offset = {
        x: item.position.x - floorPoint.x,
        z: item.position.z - floorPoint.z,
      };
      controls.enabled = false;
      renderer.domElement.setPointerCapture(event.pointerId);
    }
  }
  function onPointerMove(event: PointerEvent) {
    if (activePointers.has(event.pointerId))
      activePointers.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      });
    if (state.mode === "plan" && activePointers.size > 1 && planPinch) {
      setPlanZoom((planPinch.zoom * pinchDistance()) / planPinch.distance);
      return;
    }
    if (!pointer || pointer.id !== event.pointerId) return;
    if (Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 5)
      pointerMoved = true;
    if (state.mode === "walk") {
      yaw -= (event.clientX - pointer.lastX) * 0.004;
      pitch = THREE.MathUtils.clamp(
        pitch - (event.clientY - pointer.lastY) * 0.004,
        -1.1,
        1.1,
      );
      perspective.rotation.set(pitch, yaw, 0);
      dirty = true;
    } else if (
      pointerMoved &&
      pointer.selected === state.selectedId &&
      pointer.start &&
      !state.layout.items.find((i) => i.id === pointer!.selected)?.locked
    ) {
      ray(event);
      if (raycaster.ray.intersectPlane(floorPlane, floorPoint)) {
        const g = objectMap.get(pointer.selected!);
        if (g) {
          dragging = true;
          g.position.x =
            Math.round((floorPoint.x + pointer.offset.x) * 100) / 100;
          g.position.z =
            Math.round((floorPoint.z + pointer.offset.z) * 100) / 100;
          renderer.shadowMap.needsUpdate = true;
          overlayRoot.visible = false;
          dirty = true;
        }
      }
    }
    pointer.lastX = event.clientX;
    pointer.lastY = event.clientY;
  }
  function onPointerUp(event: PointerEvent) {
    activePointers.delete(event.pointerId);
    if (activePointers.size < 2) planPinch = null;
    if (!pointer || pointer.id !== event.pointerId) return;
    if (dragging && pointer.selected) {
      const g = objectMap.get(pointer.selected),
        start = pointer.start;
      if (
        g &&
        callbacks.onMove(pointer.selected, {
          x: g.position.x,
          z: g.position.z,
        }) === false &&
        start
      ) {
        g.position.set(start.x, 0.025, start.z);
        overlaySignature = "";
        buildOverlays();
        renderer.shadowMap.needsUpdate = true;
      }
    } else if (!pointerMoved) callbacks.onSelect(pointer.selected);
    pointer = null;
    dragging = false;
    overlayRoot.visible = true;
    controls.enabled = state.mode === "orbit";
    dirty = true;
  }
  function onPointerCancel(event?: PointerEvent) {
    if (event) activePointers.delete(event.pointerId);
    else activePointers.clear();
    planPinch = null;
    cancelDrag();
  }
  function onWheel(event: WheelEvent) {
    if (state.mode !== "plan") return;
    event.preventDefault();
    const delta =
      event.deltaY *
      (event.deltaMode === 1
        ? 16
        : event.deltaMode === 2
          ? host.clientHeight
          : 1);
    setPlanZoom(plan.zoom * Math.exp(-delta * 0.0014));
  }
  renderer.domElement.addEventListener("pointerdown", onPointerDown);
  renderer.domElement.addEventListener("pointermove", onPointerMove);
  renderer.domElement.addEventListener("pointerup", onPointerUp);
  renderer.domElement.addEventListener("pointercancel", onPointerCancel);
  renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
  function keydown(event: KeyboardEvent) {
    if (
      state.mode !== "walk" ||
      (event.target as HTMLElement)?.matches("input,textarea,select")
    )
      return;
    const key = event.key.toLowerCase();
    if (
      [
        "w",
        "a",
        "s",
        "d",
        "arrowup",
        "arrowdown",
        "arrowleft",
        "arrowright",
        "shift",
      ].includes(key)
    ) {
      event.preventDefault();
      keys.add(key);
      dirty = true;
    }
  }
  function keyup(event: KeyboardEvent) {
    keys.delete(event.key.toLowerCase());
  }
  function blur() {
    keys.clear();
    onPointerCancel();
  }
  window.addEventListener("keydown", keydown);
  window.addEventListener("keyup", keyup);
  window.addEventListener("blur", blur);
  const walkPad = document.createElement("div");
  walkPad.setAttribute("aria-label", "Walk movement controls");
  walkPad.style.cssText =
    "position:absolute;bottom:108px;left:20px;display:none;grid-template-columns:repeat(3,44px);gap:5px;z-index:3";
  for (const [label, key, column, row] of [
    ["Forward", "w", "2", "1"],
    ["Left", "a", "1", "2"],
    ["Back", "s", "2", "2"],
    ["Right", "d", "3", "2"],
  ]) {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-label", `Walk ${label.toLowerCase()}`);
    button.textContent = (
      { w: "↑", a: "←", s: "↓", d: "→" } as Record<string, string>
    )[key];
    button.style.cssText = `grid-column:${column};grid-row:${row};width:44px;height:44px;border:1px solid #e8ddc04d;background:#25382be8;color:#e8ddc0;border-radius:8px;font-size:18px;touch-action:none;cursor:pointer`;
    button.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      keys.add(key);
      button.setPointerCapture(e.pointerId);
    });
    for (const event of ["pointerup", "pointercancel", "lostpointercapture"])
      button.addEventListener(event, () => keys.delete(key));
    walkPad.appendChild(button);
  }
  host.appendChild(walkPad);
  const observables = {
    get ready() {
      return ready;
    },
    get assetSource() {
      return glbTemplates.size ? "blender" : "procedural";
    },
    get assetWarnings() {
      return [...assetWarnings];
    },
    get environmentReady() {
      return environmentReady;
    },
    get surfaceMaps() {
      return surfaces.loaded;
    },
    get lastRenderMs() {
      return lastRenderMs;
    },
    get renderedFrames() {
      return renderedFrames;
    },
    get renderTimings() {
      return [...renderTimings];
    },
    get resources() {
      return { ...renderer.info.memory };
    },
    get itemDimensions() {
      return Object.fromEntries(
        [...objectMap].map(([id, g]) => {
          g.updateMatrixWorld(true);
          const inverse = g.matrixWorld.clone().invert(),
            bounds = new THREE.Box3();
          g.traverse((o) => {
            if (o instanceof THREE.Mesh) {
              if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
              bounds.union(
                o.geometry
                  .boundingBox!.clone()
                  .applyMatrix4(inverse.clone().multiply(o.matrixWorld)),
              );
            }
          });
          const size = bounds.getSize(new THREE.Vector3());
          return [id, { width: size.x, depth: size.z, height: size.y }];
        }),
      );
    },
    get itemAssets() {
      return Object.fromEntries(
        [...objectMap].map(([id, g]) => [
          id,
          {
            assetId: g.userData.assetId ?? `builtin:${g.name}`,
            source: g.userData.assetSource ?? "fallback",
            pending: pendingLocal.has(g.userData.assetId),
          },
        ]),
      );
    },
    get projectedItems() {
      const rect = renderer.domElement.getBoundingClientRect();
      return Object.fromEntries(
        [...objectMap].map(([id, g]) => {
          const p = new THREE.Box3()
            .setFromObject(g)
            .getCenter(new THREE.Vector3())
            .project(camera);
          return [
            id,
            {
              x: rect.left + ((p.x + 1) * rect.width) / 2,
              y: rect.top + ((1 - p.y) * rect.height) / 2,
            },
          ];
        }),
      );
    },
    get mode() {
      return state.mode;
    },
    get planZoom() {
      return plan.zoom;
    },
    get cameraPosition() {
      return perspective.position.toArray();
    },
    get items() {
      return Object.fromEntries(
        [...objectMap].map(([id, g]) => [
          id,
          { x: g.position.x, z: g.position.z },
        ]),
      );
    },
    get drawCalls() {
      return renderer.info.render.calls;
    },
    get triangles() {
      return renderer.info.render.triangles;
    },
  };
  (window as unknown as Record<string, unknown>).__roomshiftScene = observables;
  function update(next: SceneState) {
    if (lastMode !== next.mode) onPointerCancel();
    state = next;
    camera = state.mode === "plan" ? plan : perspective;
    controls.enabled = state.mode === "orbit";
    if (lastMode !== state.mode) {
      keys.clear();
      pointer = null;
      lastMode = state.mode;
      resetView();
    }
    walkPad.style.display = state.mode === "walk" ? "grid" : "none";
    buildRoom();
    buildFurnitureGroups();
    buildOverlays();
    buildGhost();
    resize();
    dirty = true;
  }
  let last = performance.now();
  function frame(now: number) {
    if (disposed) return;
    const dt = Math.min((now - last) / 1000, 0.045);
    last = now;
    if (state.mode === "orbit") controls.update();
    if (state.mode === "walk") {
      const f =
          Number(keys.has("w") || keys.has("arrowup")) -
          Number(keys.has("s") || keys.has("arrowdown")),
        s =
          Number(keys.has("d") || keys.has("arrowright")) -
          Number(keys.has("a") || keys.has("arrowleft"));
      if (f || s) {
        const speed =
          (dt * (keys.has("shift") ? 2 : 1.1)) / Math.max(1, Math.hypot(f, s));
        const dx = (-Math.sin(yaw) * f + Math.cos(yaw) * s) * speed,
          dz = (-Math.cos(yaw) * f - Math.sin(yaw) * s) * speed;
        const x = perspective.position.x,
          z = perspective.position.z;
        if (canStand({ x: x + dx, z }, state.layout.items, state.room, 0.18))
          perspective.position.x += dx;
        if (
          canStand(
            { x: perspective.position.x, z: z + dz },
            state.layout.items,
            state.room,
            0.18,
          )
        )
          perspective.position.z += dz;
        dirty = true;
      }
    }
    if (dirty) {
      renderScene();
      dirty = false;
      if (!ready) {
        ready = true;
        callbacks.onReady?.();
      }
    }
    raf = requestAnimationFrame(frame);
  }
  update(initialState);
  resetView();
  resize();
  raf = requestAnimationFrame(frame);
  function focusItem(id: string) {
    const item = state.layout.items.find((i) => i.id === id);
    if (!item) return;
    if (state.mode === "plan") {
      plan.position.set(item.position.x, 12, item.position.z + 0.001);
      plan.lookAt(item.position.x, 0, item.position.z);
      setPlanZoom(1.6);
    } else {
      const distance =
        Math.max(item.dimensions.width, item.dimensions.depth) * 1.4 + 0.8;
      controls.target.set(
        item.position.x,
        item.dimensions.height * 0.45,
        item.position.z,
      );
      perspective.position.set(
        item.position.x + distance * 0.7,
        item.dimensions.height * 0.45 + distance * 0.45,
        item.position.z + distance,
      );
      controls.update();
    }
    dirty = true;
  }
  return {
    focusItem,
    update,
    resetView,
    capture() {
      renderScene();
      return renderer.domElement.toDataURL("image/png");
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      controls.dispose();
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
      window.removeEventListener("blur", blur);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointercancel", onPointerCancel);
      renderer.domElement.removeEventListener("wheel", onWheel);
      disposeTree(scene);
      sourceRoots.forEach(disposeTree);
      sourceTextures.forEach((t) => t.dispose());
      surfaces.dispose();
      environmentTarget?.dispose();
      pmrem.dispose();
      composer.passes.forEach((pass) => pass.dispose());
      composer.dispose();
      glbTemplates.clear();
      renderer.dispose();
      renderer.domElement.remove();
      walkPad.remove();
      if (
        (window as unknown as Record<string, unknown>).__roomshiftScene ===
        observables
      )
        delete (window as unknown as Record<string, unknown>).__roomshiftScene;
    },
  };
}
