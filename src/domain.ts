import type {
  Dimensions,
  FurnitureItem,
  ItemKind,
  Layout,
  PlacementIssue,
  Position,
  Project,
  RoomSpec,
} from "./types";
import { isSupportedAssetId } from './catalog';

const EPS = 1e-6;
export const MAX_ITEMS = 80;
export const KINDS: ItemKind[] = [
  "bed",
  "wardrobe",
  "desk",
  "chair",
  "floor-bed",
  "pedestal-fan",
  "stool",
  "plant",
  "shelf",
];
const DEFAULTS: Record<
  ItemKind,
  { name: string; dimensions: Dimensions; color: string }
> = {
  bed: {
    name: "Wooden bed",
    dimensions: { width: 1.4, depth: 2.05, height: 0.85 },
    color: "#9b8d80",
  },
  wardrobe: {
    name: "Wardrobe",
    dimensions: { width: 1.25, depth: 0.55, height: 2.05 },
    color: "#524b43",
  },
  desk: {
    name: "Work desk",
    dimensions: { width: 1.2, depth: 0.6, height: 0.76 },
    color: "#365d50",
  },
  chair: {
    name: "Office chair",
    dimensions: { width: 0.62, depth: 0.62, height: 1.08 },
    color: "#3d4541",
  },
  "floor-bed": {
    name: "Floor mattress",
    dimensions: { width: 1.05, depth: 1.65, height: 0.14 },
    color: "#944c45",
  },
  "pedestal-fan": {
    name: "Standing fan",
    dimensions: { width: 0.5, depth: 0.5, height: 1.25 },
    color: "#dfd7c5",
  },
  stool: {
    name: "Small stool",
    dimensions: { width: 0.35, depth: 0.35, height: 0.42 },
    color: "#7f6248",
  },
  plant: {
    name: "Potted plant",
    dimensions: { width: 0.42, depth: 0.42, height: 0.88 },
    color: "#5a7650",
  },
  shelf: {
    name: "Open shelf",
    dimensions: { width: 0.8, depth: 0.35, height: 1.65 },
    color: "#ad835b",
  },
};

let fallbackId = 0;
function newId() {
  return (
    globalThis.crypto?.randomUUID?.() ?? `item-${Date.now()}-${++fallbackId}`
  );
}
export function createFurnitureItem(kind: ItemKind): FurnitureItem {
  if (!KINDS.includes(kind))
    throw new Error("Choose a supported furniture type.");
  const spec = DEFAULTS[kind];
  return {
    id: newId(),
    name: spec.name,
    kind,
    dimensions: { ...spec.dimensions },
    position: { x: 0, z: 0 },
    rotation: 0,
    color: spec.color,
    visible: true,
    locked: false,
    dimensionSource: "estimated",
  };
}

export function cloneProject(project: Project): Project {
  return structuredClone(project);
}

export function createInitialProject(): Project {
  const room: RoomSpec = {
    width: 4.2,
    depth: 4.8,
    height: 2.85,
    door: { wall: "front", offset: 1.3, width: 0.85, height: 2.1 },
  };
  const item = (
    id: string,
    kind: ItemKind,
    x: number,
    z: number,
    rotation = 0,
  ): FurnitureItem => ({
    ...createFurnitureItem(kind),
    id,
    position: { x, z },
    rotation,
  });
  const original: Layout = {
    id: "original",
    name: "Original",
    description: "A familiar starting point",
    wallColor: "#e9dfce",
    accentColor: "#e9dfce",
    items: [
      item("bed", "bed", -0.5, 0.05, Math.PI / 2),
      item("wardrobe", "wardrobe", -1.37, -2.05),
      item("desk", "desk", -1.72, 1.35, Math.PI / 2),
      item("chair", "chair", -0.95, 1.5, Math.PI / 2),
      item("floor-bed", "floor-bed", 0.95, -1.5),
      item("fan", "pedestal-fan", 1.55, 0.3),
      item("stool", "stool", -0.25, -1.45),
    ],
  };
  const airy: Layout = structuredClone(original);
  airy.id = "open-airy";
  airy.name = "Open & airy";
  airy.description = "A little more breathing room";
  airy.wallColor = "#e5e5d9";
  airy.accentColor = "#80917c";
  const airyPositions: Record<string, [number, number, number]> = {
    bed: [-1.4, -0.45, 0],
    wardrobe: [1.15, -2.05, 0],
    desk: [-1.72, 1.3, Math.PI / 2],
    chair: [-0.95, 1.4, Math.PI / 2],
    "floor-bed": [1.57, 0, 0],
    fan: [-1.8, -2.1, 0],
    stool: [-0.1, -1.95, 0],
  };
  airy.items = airy.items.map((i) => {
    const [x, z, rotation] = airyPositions[i.id];
    return { ...i, position: { x, z }, rotation };
  });
  const work: Layout = structuredClone(original);
  work.id = "work-rest";
  work.name = "Work & rest";
  work.description = "Two corners, two different moods";
  work.wallColor = "#e4dacb";
  work.accentColor = "#a57960";
  const workPositions: Record<string, [number, number, number]> = {
    bed: [0.95, -0.9, 0],
    wardrobe: [-1.37, -2.05, 0],
    desk: [-1.72, 0.4, Math.PI / 2],
    chair: [-0.95, 0.4, Math.PI / 2],
    "floor-bed": [-0.8, 1.65, Math.PI / 2],
    fan: [1.7, 0.65, 0],
    stool: [0.2, -2.1, 0],
  };
  work.items = work.items.map((i) => {
    const [x, z, rotation] = workPositions[i.id];
    return { ...i, position: { x, z }, rotation };
  });
  return {
    version: 1,
    room,
    layouts: [original, airy, work],
    activeLayoutId: "original",
    unit: "cm",
  };
}

function localToWorld(item: FurnitureItem, p: Position): Position {
  const c = Math.cos(item.rotation),
    s = Math.sin(item.rotation);
  return {
    x: item.position.x + c * p.x + s * p.z,
    z: item.position.z - s * p.x + c * p.z,
  };
}
export function getFootprint(item: FurnitureItem): Position[] {
  const w = item.dimensions.width / 2,
    d = item.dimensions.depth / 2;
  return [
    { x: -w, z: -d },
    { x: w, z: -d },
    { x: w, z: d },
    { x: -w, z: d },
  ].map((p) => localToWorld(item, p));
}
function polygonsOverlap(a: Position[], b: Position[]): boolean {
  for (const polygon of [a, b])
    for (let i = 0; i < polygon.length; i++) {
      const p = polygon[i],
        q = polygon[(i + 1) % polygon.length],
        axis = { x: -(q.z - p.z), z: q.x - p.x };
      const aa = a.map((v) => v.x * axis.x + v.z * axis.z),
        bb = b.map((v) => v.x * axis.x + v.z * axis.z);
      if (
        Math.max(...aa) <= Math.min(...bb) + EPS ||
        Math.max(...bb) <= Math.min(...aa) + EPS
      )
        return false;
    }
  return true;
}
function pointInPolygon(p: Position, polygon: Position[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j];
    if (
      a.z > p.z !== b.z > p.z &&
      p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x
    )
      inside = !inside;
  }
  return inside;
}
function distanceToSegment(p: Position, a: Position, b: Position): number {
  const dx = b.x - a.x,
    dz = b.z - a.z;
  const t = Math.max(
    0,
    Math.min(
      1,
      ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1),
    ),
  );
  return Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz);
}
function distanceToPolygon(p: Position, polygon: Position[]): number {
  if (pointInPolygon(p, polygon)) return 0;
  return Math.min(
    ...polygon.map((v, i) =>
      distanceToSegment(p, v, polygon[(i + 1) % polygon.length]),
    ),
  );
}
function clipPolygon(
  poly: Position[],
  axis: "x" | "z",
  boundary: number,
  keepGreater: boolean,
): Position[] {
  if (!poly.length) return [];
  const result: Position[] = [];
  const inside = (p: Position) =>
    keepGreater ? p[axis] >= boundary : p[axis] <= boundary;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i],
      b = poly[(i + 1) % poly.length],
      ai = inside(a),
      bi = inside(b);
    if (ai) result.push(a);
    if (ai !== bi) {
      const t = (boundary - a[axis]) / (b[axis] - a[axis]);
      result.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    }
  }
  return result;
}
function obstructsDoor(item: FurnitureItem, room: RoomSpec): boolean {
  const hinge = {
    x: room.door.offset - room.door.width / 2,
    z: room.depth / 2,
  };
  let polygon = clipPolygon(getFootprint(item), "x", hinge.x, true);
  polygon = clipPolygon(polygon, "z", hinge.z, false);
  return (
    polygon.length > 0 &&
    distanceToPolygon(hinge, polygon) < room.door.width - EPS
  );
}
function usageFootprint(item: FurnitureItem): Position[] | null {
  if (item.kind !== "wardrobe" && item.kind !== "desk" && item.kind !== "shelf")
    return null;
  const clearance = item.kind === "desk" ? 0.75 : 0.6;
  const w = item.dimensions.width / 2,
    start = item.dimensions.depth / 2;
  return [
    { x: -w, z: start },
    { x: w, z: start },
    { x: w, z: start + clearance },
    { x: -w, z: start + clearance },
  ].map((p) => localToWorld(item, p));
}

export function validatePlacement(
  item: FurnitureItem,
  items: FurnitureItem[],
  room: RoomSpec,
): PlacementIssue[] {
  if (!item.visible) return [];
  const issues: PlacementIssue[] = [],
    footprint = getFootprint(item);
  if (
    footprint.some(
      (p) =>
        Math.abs(p.x) > room.width / 2 + EPS ||
        Math.abs(p.z) > room.depth / 2 + EPS,
    ) ||
    item.dimensions.height > room.height + EPS
  ) {
    issues.push({
      code: "outside",
      severity: "error",
      message: `${item.name} extends outside the room.`,
      itemIds: [item.id],
    });
  }
  if (obstructsDoor(item, room))
    issues.push({
      code: "door",
      severity: "error",
      message: `${item.name} blocks the entrance door's opening space.`,
      itemIds: [item.id],
    });
  for (const other of items) {
    if (other.id === item.id || !other.visible) continue;
    if (polygonsOverlap(footprint, getFootprint(other))) {
      issues.push({
        code: "overlap",
        severity: "error",
        message: `${item.name} overlaps ${other.name.toLowerCase()}.`,
        itemIds: [item.id, other.id],
      });
    } else {
      const usage = usageFootprint(item);
      if (
        usage &&
        !(item.kind === "desk" && other.kind === "chair") &&
        polygonsOverlap(usage, getFootprint(other))
      ) {
        issues.push({
          code: "clearance",
          severity: "warning",
          message: `Leave room to use ${item.name.toLowerCase()}; ${other.name.toLowerCase()} is in its access space.`,
          itemIds: [item.id, other.id],
        });
      }
    }
  }
  return issues;
}
export function validateLayout(
  layout: Layout,
  room: RoomSpec,
): PlacementIssue[] {
  const seen = new Set<string>();
  return layout.items
    .flatMap((item) => validatePlacement(item, layout.items, room))
    .filter((issue) => {
      const key = `${issue.code}:${issue.code === "clearance" ? issue.itemIds.join(":") : [...issue.itemIds].sort().join(":")}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
export function canStand(
  position: Position,
  items: FurnitureItem[],
  room: RoomSpec,
  radius = 0.22,
): boolean {
  if (
    !Number.isFinite(position.x) ||
    !Number.isFinite(position.z) ||
    !Number.isFinite(radius) ||
    radius < 0
  )
    return false;
  if (
    Math.abs(position.x) > room.width / 2 - radius ||
    position.z < -room.depth / 2 + radius
  )
    return false;
  if (position.z > room.depth / 2 - radius) {
    if (
      Math.abs(position.x - room.door.offset) > room.door.width / 2 - radius ||
      position.z > room.depth / 2 + 0.8 - radius
    )
      return false;
  }
  return !items.some(
    (i) =>
      i.visible && distanceToPolygon(position, getFootprint(i)) < radius + EPS,
  );
}

function fail(message: string): never {
  throw new Error(`Could not open this room: ${message}`);
}
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(`${label} must be an object.`);
  return value as Record<string, unknown>;
}
function number(
  value: unknown,
  label: string,
  min: number,
  max: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    fail(`${label} must be a finite number between ${min} and ${max}.`);
  return value as number;
}
function string(value: unknown, label: string, max = 80): string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    fail(`${label} must be a nonempty string up to ${max} characters.`);
  return value as string;
}
function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") fail(`${label} must be true or false.`);
  return value as boolean;
}
function color(value: unknown): string {
  if (typeof value !== "string" || !/^#[a-f\d]{6}$/i.test(value))
    fail("Colors must use six-digit hex values.");
  return value as string;
}
function parseItem(value: unknown): FurnitureItem {
  const i = object(value, "Furniture"),
    d = object(i.dimensions, "Furniture dimensions"),
    p = object(i.position, "Furniture position");
  if (!KINDS.includes(i.kind as ItemKind)) fail("Unknown furniture type.");
  if (
    !["estimated", "measured", "product"].includes(i.dimensionSource as string)
  )
    fail("Unknown dimension source.");
  if(i.assetId!==undefined&&!isSupportedAssetId(i.assetId))fail('Unknown or invalid furniture asset ID.');
  return {
    ...(i.assetId===undefined?{}:{assetId:i.assetId as string}),
    ...(i.productId === undefined ? {} : { productId: string(i.productId, "Product ID") }),
    id: string(i.id, "Furniture ID"),
    name: string(i.name, "Furniture name"),
    kind: i.kind as ItemKind,
    dimensions: {
      width: number(d.width, "Width", 0.05, 20),
      depth: number(d.depth, "Depth", 0.05, 20),
      height: number(d.height, "Height", 0.02, 10),
    },
    position: {
      x: number(p.x, "X position", -50, 50),
      z: number(p.z, "Z position", -50, 50),
    },
    rotation: number(i.rotation, "Rotation", -Math.PI * 200, Math.PI * 200),
    color: color(i.color),
    visible: boolean(i.visible, "Visibility"),
    locked: boolean(i.locked, "Lock"),
    dimensionSource: i.dimensionSource as FurnitureItem["dimensionSource"],
  };
}
const RETIRED_AIRY: Record<string, [number, number]> = {
  bed: [-0.95, -0.7],
  wardrobe: [1.32, -2.05],
  desk: [-1.72, 1.3],
  chair: [-0.95, 1.4],
  "floor-bed": [0.8, 0.35],
  fan: [1.65, -0.6],
  stool: [-0.2, 2.05],
};
/** The first Open & airy preset reduced open floor. Replaces saved copies only while they are unedited. */
export function upgradeRetiredPresets(project: Project): Project {
  const saved = project.layouts.find((layout) => layout.id === "open-airy");
  const current = createInitialProject().layouts.find((layout) => layout.id === "open-airy");
  if (!saved || !current || saved.items.length !== current.items.length) return project;
  const untouched = saved.items.every((item) => {
    const retired = RETIRED_AIRY[item.id];
    return retired && item.position.x === retired[0] && item.position.z === retired[1];
  });
  if (!untouched) return project;
  saved.items = saved.items.map((item) => {
    const target = current.items.find((candidate) => candidate.id === item.id)!;
    return { ...item, position: target.position, rotation: target.rotation };
  });
  return project;
}

export function parseProject(text: string): Project {
  if (text.length > 2_000_000) fail("The project is too large (maximum 2 MB).");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    fail("The file is not valid JSON.");
  }
  const p = object(raw, "Project");
  if (p.version !== 1) fail("This project version is not supported.");
  const r = object(p.room, "Room"),
    d = object(r.door, "Door");
  const room: RoomSpec = {
    width: number(r.width, "Room width", 2, 30),
    depth: number(r.depth, "Room depth", 2, 30),
    height: number(r.height, "Room height", 1.8, 8),
    door: {
      wall: "front",
      offset: number(d.offset, "Door offset", -15, 15),
      width: number(d.width, "Door width", 0.6, 3),
      height: number(d.height, "Door height", 1.5, 4),
    },
  };
  if (
    d.wall !== "front" ||
    Math.abs(room.door.offset) + room.door.width / 2 > room.width / 2 ||
    room.door.height > room.height
  )
    fail("The entrance must fit on the front wall.");
  if (
    !Array.isArray(p.layouts) ||
    p.layouts.length < 1 ||
    p.layouts.length > 12
  )
    fail("A project needs between 1 and 12 layouts.");
  const layouts: Layout[] = p.layouts.map((value) => {
    const l = object(value, "Layout");
    if (!Array.isArray(l.items) || l.items.length > MAX_ITEMS)
      fail(`A layout may contain up to ${MAX_ITEMS} furniture items.`);
    const items = l.items.map(parseItem),
      ids = new Set(items.map((i) => i.id));
    if (ids.size !== items.length)
      fail("Furniture IDs must be unique within each layout.");
    return {
      id: string(l.id, "Layout ID"),
      name: string(l.name, "Layout name"),
      description:
        typeof l.description === "string" && l.description.length <= 240
          ? l.description
          : fail("Layout description is invalid."),
      items,
      wallColor: color(l.wallColor),
      accentColor: color(l.accentColor),
    };
  });
  if (new Set(layouts.map((l) => l.id)).size !== layouts.length)
    fail("Layout IDs must be unique.");
  const activeLayoutId = string(p.activeLayoutId, "Active layout");
  if (!layouts.some((l) => l.id === activeLayoutId))
    fail("The active layout does not exist.");
  if (p.unit !== "cm" && p.unit !== "in") fail("Use centimetres or inches.");
  return { version: 1, ...(p.id === undefined ? {} : { id: string(p.id, "Room ID") }), ...(p.name === undefined ? {} : { name: string(p.name, "Room name") }), room, layouts, activeLayoutId, unit: p.unit };
}
export function serializeProject(project: Project): string {
  return JSON.stringify(parseProject(JSON.stringify(project)), null, 2);
}
