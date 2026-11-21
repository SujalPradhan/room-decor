import type {
  Dimensions,
  FurnitureItem,
  ItemKind,
  Layout,
  PlacementIssue,
  Position,
  Project,
  RoomSpec,
  SpaceType,
} from "./types";
import { isSupportedAssetId } from './catalog';

const EPS = 1e-6;
export const MAX_ITEMS = 80;
export const ROOM_KINDS: ItemKind[] = [
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
const RETAIL_ONLY_KINDS: ItemKind[] = [
  "display-table",
  "wall-display",
  "testing-bar",
  "consultation-station",
  "hero-plinth",
  "checkout-counter",
  "lounge-bench",
  "fragrance-tower",
  "skin-analyzer",
  "beauty-chair",
  "service-cabin",
  "digital-wall",
  "gift-station",
  "mirror-station",
];
export const RETAIL_KINDS: ItemKind[] = [
  ...RETAIL_ONLY_KINDS,
  "plant",
  "stool",
  "chair",
  "shelf",
];
const ROOM_ONLY_KINDS = ROOM_KINDS.filter((kind) => !RETAIL_KINDS.includes(kind));
export const KINDS: ItemKind[] = [...ROOM_KINDS, ...RETAIL_ONLY_KINDS];
export function kindsForSpace(space: SpaceType | undefined): ItemKind[] {
  return [...(space === "retail" ? RETAIL_KINDS : ROOM_KINDS)];
}
export function spaceOf(project: Pick<Project, "space">): SpaceType {
  return project.space ?? "room";
}
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
  "display-table": {
    name: "Display table",
    dimensions: { width: 1.6, depth: 0.9, height: 0.95 },
    color: "#d8c7b6",
  },
  "wall-display": {
    name: "Wall display",
    dimensions: { width: 1.8, depth: 0.45, height: 2.4 },
    color: "#efe6da",
  },
  "testing-bar": {
    name: "Testing bar",
    dimensions: { width: 2.4, depth: 0.75, height: 1.35 },
    color: "#c9988a",
  },
  "consultation-station": {
    name: "Consultation station",
    dimensions: { width: 1.5, depth: 0.65, height: 1.9 },
    color: "#e4d6c8",
  },
  "hero-plinth": {
    name: "Hero plinth",
    dimensions: { width: 1.1, depth: 1.1, height: 1.7 },
    color: "#b9826f",
  },
  "checkout-counter": {
    name: "Checkout counter",
    dimensions: { width: 2.8, depth: 0.8, height: 1.1 },
    color: "#4a4140",
  },
  "lounge-bench": {
    name: "Lounge bench",
    dimensions: { width: 2, depth: 0.7, height: 0.8 },
    color: "#8c5f5c",
  },
  "fragrance-tower": {
    name: "Fragrance tower",
    dimensions: { width: 0.9, depth: 0.9, height: 2.2 },
    color: "#d8c3a0",
  },
  "skin-analyzer": {
    name: "Skin analyzer",
    dimensions: { width: 0.8, depth: 0.6, height: 1.95 },
    color: "#ece6de",
  },
  "beauty-chair": {
    name: "Beauty chair",
    dimensions: { width: 0.62, depth: 0.7, height: 1.15 },
    color: "#5a4a4c",
  },
  "service-cabin": {
    name: "Service cabin",
    dimensions: { width: 2.6, depth: 2.4, height: 2.8 },
    color: "#e8ddd2",
  },
  "digital-wall": {
    name: "Digital wall",
    dimensions: { width: 4.8, depth: 0.3, height: 3 },
    color: "#c98f86",
  },
  "gift-station": {
    name: "Gift station",
    dimensions: { width: 1.8, depth: 0.8, height: 1.05 },
    color: "#c9a99a",
  },
  "mirror-station": {
    name: "Mirror station",
    dimensions: { width: 1.2, depth: 0.45, height: 2 },
    color: "#efe6da",
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

/** Rotations turn an item's usable front: 0 faces the entrance, the others face into the store from a wall. */
const FACE_ENTRANCE = 0,
  FACE_BACK = Math.PI,
  FACE_RIGHT = Math.PI / 2,
  FACE_LEFT = -Math.PI / 2;
const FLAGSHIP: Dimensions = { width: 20, depth: 28, height: 4.5 };
const WALL_GAP = 0.05;
const SCENT_WALL = "Fragrance wall",
  SKIN_WALL = "Skincare wall",
  COLOUR_WALL = "Colour cosmetics wall",
  HAIR_WALL = "Haircare wall",
  BODY_WALL = "Body care wall";
/** Every preset places the same pieces, so switching layouts animates each one across the floor. */
const FLAGSHIP_PIECES: Record<string, [ItemKind, string]> = {
  hero: ["hero-plinth", "Arrival hero plinth"],
  "hero-l": ["hero-plinth", "Doorway plinth left"],
  "hero-r": ["hero-plinth", "Doorway plinth right"],
  "screen-arrival": ["digital-wall", "Arrival digital wall"],
  "table-new": ["display-table", "New arrivals table"],
  "table-edit": ["display-table", "Editor's picks table"],
  "table-1": ["display-table", "Discovery table A"],
  "table-2": ["display-table", "Discovery table B"],
  "ft-1": ["fragrance-tower", "Fragrance tower 1"],
  "ft-2": ["fragrance-tower", "Fragrance tower 2"],
  "ft-3": ["fragrance-tower", "Fragrance tower 3"],
  "ft-4": ["fragrance-tower", "Fragrance tower 4"],
  "ft-5": ["fragrance-tower", "Fragrance tower 5"],
  "ft-6": ["fragrance-tower", "Fragrance tower 6"],
  "ft-7": ["fragrance-tower", "Fragrance tower 7"],
  "ft-8": ["fragrance-tower", "Fragrance tower 8"],
  "ft-9": ["fragrance-tower", "Fragrance tower 9"],
  "wall-left-0": ["wall-display", BODY_WALL],
  "wall-left-1": ["wall-display", SCENT_WALL],
  "wall-left-2": ["wall-display", SCENT_WALL],
  "wall-left-3": ["wall-display", SKIN_WALL],
  "wall-left-4": ["wall-display", SKIN_WALL],
  "wall-right-1": ["wall-display", COLOUR_WALL],
  "wall-right-2": ["wall-display", COLOUR_WALL],
  "wall-right-3": ["wall-display", HAIR_WALL],
  "sa-1": ["skin-analyzer", "Skin analyzer 1"],
  "sa-2": ["skin-analyzer", "Skin analyzer 2"],
  "sa-3": ["skin-analyzer", "Skin analyzer 3"],
  "bar-skin": ["testing-bar", "Skin testing bar"],
  "consult-a": ["consultation-station", "Consultation vanity A"],
  "consult-b": ["consultation-station", "Consultation vanity B"],
  "seat-a": ["chair", "Consultation chair A"],
  "seat-b": ["chair", "Consultation chair B"],
  "bar-colour": ["testing-bar", "Colour testing bar"],
  "bar-colour-2": ["testing-bar", "Lip and cheek testing bar"],
  "ms-1": ["mirror-station", "Mirror station 1"],
  "ms-2": ["mirror-station", "Mirror station 2"],
  "ms-3": ["mirror-station", "Mirror station 3"],
  "ms-4": ["mirror-station", "Mirror station 4"],
  "bc-1": ["beauty-chair", "Beauty chair 1"],
  "bc-2": ["beauty-chair", "Beauty chair 2"],
  "bc-3": ["beauty-chair", "Beauty chair 3"],
  "bc-4": ["beauty-chair", "Beauty chair 4"],
  "cabin-1": ["service-cabin", "Facial cabin 1"],
  "cabin-2": ["service-cabin", "Facial cabin 2"],
  "cabin-3": ["service-cabin", "Brow and lash cabin"],
  "cabin-4": ["service-cabin", "Makeover cabin"],
  "screen-back": ["digital-wall", "Feature digital wall"],
  gift: ["gift-station", "Gift wrapping station"],
  "gift-2": ["gift-station", "Gift set station"],
  checkout: ["checkout-counter", "Checkout counter"],
  "backbar-1": ["shelf", "Back-bar shelf"],
  "backbar-2": ["shelf", "Back-bar shelf"],
  bench: ["lounge-bench", "Lounge bench A"],
  "bench-2": ["lounge-bench", "Lounge bench B"],
  "bench-3": ["lounge-bench", "Lounge bench C"],
  "plant-front": ["plant", "Entrance plant"],
  "plant-door-l": ["plant", "Doorway plant left"],
  "plant-door-r": ["plant", "Doorway plant right"],
  "plant-lounge": ["plant", "Lounge plant"],
  "plant-back-l": ["plant", "Back wall plant left"],
  "plant-back-r": ["plant", "Back wall plant right"],
};
type Wall = "left" | "right" | "back" | "front";
/** A free-standing piece at x, z, or a piece against a wall at a distance along it. */
type Placement = [x: number, z: number, rotation?: number] | [wall: Wall, along: number];
function place(id: string, spot: Placement): [number, number, number] {
  if (typeof spot[0] === "number") return [spot[0], spot[1], spot[2] ?? FACE_ENTRANCE];
  const inset = DEFAULTS[FLAGSHIP_PIECES[id][0]].dimensions.depth / 2 + WALL_GAP,
    along = spot[1],
    x = FLAGSHIP.width / 2 - inset,
    z = FLAGSHIP.depth / 2 - inset;
  const round = (value: number) => Math.round(value * 1000) / 1000;
  if (spot[0] === "left") return [round(-x), along, FACE_RIGHT];
  if (spot[0] === "right") return [round(x), along, FACE_LEFT];
  if (spot[0] === "front") return [along, round(z), FACE_BACK];
  return [along, round(-z), FACE_ENTRANCE];
}
/**
 * The build keeps one finish in every layout: cabins, wall units, mirror stations, the checkout and seating.
 * Layout finishes go on the pieces that move, so a walkthrough shows moves rather than a repaint of every fixture.
 */
const STORE_FINISHES: Partial<Record<ItemKind, string>> = { chair: "#b39a8e" };
function retailLayout(
  details: Pick<Layout, "id" | "name" | "description" | "wallColor" | "accentColor">,
  spots: Record<string, Placement>,
  finishes: Partial<Record<ItemKind, string>> = {},
): Layout {
  return {
    ...details,
    items: Object.entries(spots).map(([id, spot]) => {
      const [kind, name] = FLAGSHIP_PIECES[id],
        [x, z, rotation] = place(id, spot);
      return {
        ...createFurnitureItem(kind),
        id,
        name,
        ...(PRESET_SIZES[id] ? { dimensions: { ...PRESET_SIZES[id] } } : {}),
        position: { x, z },
        rotation,
        ...(finishes[kind] ?? STORE_FINISHES[kind] ? { color: finishes[kind] ?? STORE_FINISHES[kind] } : {}),
      };
    }),
  };
}
/** The fixed build: treatment cabins and the feature screen on the back wall. */
const BACK_BUILD: Record<string, Placement> = {
  "cabin-1": ["back", -8.55],
  "cabin-2": ["back", -5.75],
  "cabin-3": ["back", 5.75],
  "cabin-4": ["back", 8.55],
  "screen-back": ["back", 0],
  "plant-back-l": [-3.4, -13.4],
  "plant-back-r": [3.4, -13.4],
};
/** Mirror stations and their chairs along the right wall, the makeup studio's working edge. */
const MAKEUP_WALL: Record<string, Placement> = {
  "ms-1": ["right", -8.4],
  "ms-2": ["right", -7.1],
  "ms-3": ["right", -5.8],
  "ms-4": ["right", -4.5],
  "bc-1": [9.1, -8.4, FACE_RIGHT],
  "bc-2": [9.1, -7.1, FACE_RIGHT],
  "bc-3": [9.1, -5.8, FACE_RIGHT],
  "bc-4": [9.1, -4.5, FACE_RIGHT],
};
/** Checkout against the right wall near the exit, with its back-bar shelves behind the staff aisle. */
const CHECKOUT_WALL: Record<string, Placement> = {
  checkout: [8.4, 9.4, FACE_LEFT],
  "backbar-1": ["right", 9.2],
  "backbar-2": ["right", 10],
  "wall-right-3": ["right", 12.95],
};
const SKIN_CORNER: Record<string, Placement> = {
  "bar-skin": [-5.4, -5.4],
  "sa-1": [-7.4, -8.9],
  "sa-2": [-6.5, -8.9],
  "sa-3": [-5.6, -8.9],
  "consult-a": [-3.2, -8.875],
  "consult-b": [-1.5, -8.875],
  "seat-a": [-3.2, -8.19, FACE_BACK],
  "seat-b": [-1.5, -8.19, FACE_BACK],
};
const GRAND_FLAGSHIP: Record<string, Placement> = {
  // Arrival: a large hero plinth on the axis, a pair at the doors and the digital wall on the left.
  hero: [0, 7],
  "hero-l": [-3.4, 11.2],
  "hero-r": [3.4, 11.2],
  "table-new": [-3.6, 6.8],
  "table-edit": [3.6, 6.8],
  "screen-arrival": ["left", 8.4],
  "wall-left-0": ["left", 12.95],
  "plant-front": [-9.4, 11.4],
  "plant-door-l": [-2.6, 13.3],
  "plant-door-r": [2.6, 13.3],
  // Fragrance hall: a three by three grid of towers before the fragrance walls.
  "ft-1": [-7.6, 2.6],
  "ft-2": [-5.4, 2.6],
  "ft-3": [-3.2, 2.6],
  "ft-4": [-7.6, 0.2],
  "ft-5": [-5.4, 0.2],
  "ft-6": [-3.2, 0.2],
  "ft-7": [-7.6, -2.2],
  "ft-8": [-5.4, -2.2],
  "ft-9": [-3.2, -2.2],
  "wall-left-1": ["left", 2.2],
  "wall-left-2": ["left", 0.3],
  // Discovery spine down the centre to the feature screen.
  "table-1": [0, 2.6, FACE_RIGHT],
  "table-2": [0, -1.2, FACE_RIGHT],
  // Skin diagnostics.
  "wall-left-3": ["left", -3.8],
  "wall-left-4": ["left", -5.7],
  ...SKIN_CORNER,
  // Makeup studio.
  "bar-colour": [4.6, -8.6],
  "bar-colour-2": [4.6, -5],
  ...MAKEUP_WALL,
  "wall-right-1": ["right", -1.6],
  "wall-right-2": ["right", 0.3],
  // Lounge.
  bench: [5.6, -0.4],
  "bench-2": [5.6, 3.2, FACE_BACK],
  "bench-3": [3, 1.4, FACE_RIGHT],
  "plant-lounge": [5.6, 1.4],
  // Gifting and checkout.
  gift: ["right", 4.8],
  "gift-2": [6.6, 6.4],
  ...CHECKOUT_WALL,
  ...BACK_BUILD,
};
const DISCOVERY_JOURNEY: Record<string, Placement> = {
  // A runway of tables leads from the hero plinth to a pair of back-to-back testing bars.
  hero: [0, 8],
  "hero-l": [-3.4, 11.2],
  "hero-r": [3.4, 11.2],
  "table-new": [0, 5.2, FACE_RIGHT],
  "table-edit": [0, 3.4, FACE_RIGHT],
  "table-1": [0, 1.6, FACE_RIGHT],
  "table-2": [0, -0.2, FACE_RIGHT],
  "bar-skin": [-0.425, -3.5, FACE_LEFT],
  "bar-colour": [0.425, -3.5, FACE_RIGHT],
  // A staggered avenue of fragrance towers turns visitors left, then back.
  "ft-1": [-3.6, 6.4],
  "ft-2": [-3.6, 3.8],
  "ft-3": [-3.6, 1.2],
  "ft-4": [-3.6, -1.4],
  "ft-5": [-3.6, -4],
  "ft-6": [-6.4, 5.1],
  "ft-7": [-6.4, 2.5],
  "ft-8": [-6.4, -0.1],
  "ft-9": [-6.4, -2.7],
  "screen-arrival": ["left", 9.4],
  "wall-left-0": ["left", 13.05],
  "plant-front": [-9.4, 6.2],
  "wall-left-1": ["left", 4.6],
  "wall-left-2": ["left", 2.7],
  "wall-left-3": ["left", 0.8],
  "wall-left-4": ["left", -1.1],
  // Diagnostics along the left wall, consultation by the cabins.
  "sa-1": ["left", -4.4],
  "sa-2": ["left", -5.3],
  "sa-3": ["left", -6.2],
  "consult-a": [-5.6, -9],
  "consult-b": [-3.9, -9],
  "seat-a": [-5.6, -8.29, FACE_BACK],
  "seat-b": [-3.9, -8.29, FACE_BACK],
  ...BACK_BUILD,
  // Back down the right: makeup, a pause in the lounge, then gifts and the checkout by the door.
  "bar-colour-2": [5, -8.6],
  ...MAKEUP_WALL,
  "wall-right-1": ["right", -1.6],
  "wall-right-2": ["right", 0.3],
  bench: [3.6, 1.4, FACE_RIGHT],
  "bench-2": [6.8, 1.4, FACE_LEFT],
  "bench-3": [5.2, -1.2],
  "plant-lounge": [5.2, 1.4],
  gift: ["right", 5],
  "gift-2": [6, 6.6],
  ...CHECKOUT_WALL,
  "plant-door-l": [-2.6, 13.3],
  "plant-door-r": [2.6, 13.3],
};
const OPEN_EVENT: Record<string, Placement> = {
  // A stage of three plinths before the feature screen, with benches either side.
  ...BACK_BUILD,
  hero: [0, -11.6],
  "hero-l": [-2.7, -11.8],
  "hero-r": [2.7, -11.8],
  bench: [-4.6, -8.6, FACE_RIGHT],
  "bench-2": [4.6, -8.6, FACE_LEFT],
  "bench-3": [0, -9.2, FACE_BACK],
  // Left band: walls, then a single file of towers.
  "wall-left-0": ["left", 12.95],
  "screen-arrival": ["left", 9.2],
  "wall-left-1": ["left", 5.7],
  "wall-left-2": ["left", 3.8],
  "wall-left-3": ["left", 1.9],
  "wall-left-4": ["left", 0],
  "sa-1": ["left", -2.6],
  "sa-2": ["left", -3.5],
  "sa-3": ["left", -4.4],
  "consult-a": ["left", -6.9],
  "consult-b": ["left", -8.6],
  "seat-a": [-8.94, -6.9, FACE_LEFT],
  "seat-b": [-8.94, -8.6, FACE_LEFT],
  "ft-1": [-7.2, 4.6],
  "ft-2": [-7.2, 2.2],
  "ft-3": [-7.2, -0.2],
  "ft-4": [-7.2, -2.6],
  "ft-5": [-7.2, -5],
  "bar-skin": [-7.2, -8.4, FACE_RIGHT],
  // Right band.
  ...MAKEUP_WALL,
  "wall-right-1": ["right", -1.6],
  "wall-right-2": ["right", 0.3],
  "bar-colour": [7.2, -0.65, FACE_LEFT],
  "bar-colour-2": [7, -7, FACE_LEFT],
  "ft-6": [7.2, 2.4],
  "ft-9": [7.2, 4.8],
  gift: ["right", 4.8],
  ...CHECKOUT_WALL,
  // Front band beside the doors.
  "table-new": [-5.6, 9.6],
  "table-1": [-5.6, 12.6],
  "table-edit": [5.6, 12.6],
  "table-2": [5.6, 9.8],
  "gift-2": [-5.6, 7.4],
  "ft-7": [-3, 12.4],
  "ft-8": [3, 12.4],
  "plant-front": [-9.4, 7.8],
  "plant-lounge": [9.4, 7.2],
  "plant-door-l": [-2.6, 10.6],
  "plant-door-r": [2.6, 10.6],
};
const LAUNCH_DAY: Record<string, Placement> = {
  // The feature screen moves to the centre as a stage backdrop, the hero plinths in front of it.
  "screen-back": [0, -1],
  hero: [0, 1.4],
  "hero-l": [-3.4, 1.4],
  "hero-r": [3.4, 1.4],
  // Audience benches face the stage, with a centre aisle from the door.
  bench: [-2.4, 5, FACE_BACK],
  "bench-2": [2.4, 5, FACE_BACK],
  "bench-3": [-2.4, 7.2, FACE_BACK],
  "plant-lounge": [2.4, 7.2],
  // A ring of fragrance towers around the stage.
  "ft-1": [-5.6, 4.6],
  "ft-2": [-6.4, 2],
  "ft-3": [-6.4, -0.6],
  "ft-4": [-5.6, -3.2],
  "ft-5": [5.6, 4.2],
  "ft-6": [6.4, 2],
  "ft-7": [6.4, -0.6],
  "ft-8": [5.6, -3.2],
  "ft-9": [-5.6, 7.2],
  "table-new": [-4.6, 9.4],
  "table-edit": [4.6, 9.4],
  "table-1": [0, -11.8],
  "table-2": [0, -6.6],
  "screen-arrival": ["left", 8.4],
  "wall-left-0": ["left", 12.95],
  "plant-front": [-9.4, 11.4],
  "wall-left-1": ["left", 2.2],
  "wall-left-2": ["left", 0.3],
  "wall-left-3": ["left", -3.8],
  "wall-left-4": ["left", -5.7],
  ...SKIN_CORNER,
  "bar-colour": [4.6, -8.6],
  "bar-colour-2": [4.6, -5.4],
  ...MAKEUP_WALL,
  "wall-right-1": ["right", -1.6],
  "wall-right-2": ["right", 0.3],
  gift: ["right", 4.8],
  "gift-2": [6.6, 6.4],
  ...CHECKOUT_WALL,
  "cabin-1": ["back", -8.55],
  "cabin-2": ["back", -5.75],
  "cabin-3": ["back", 5.75],
  "cabin-4": ["back", 8.55],
  "plant-back-l": [-3.4, -13.4],
  "plant-back-r": [3.4, -13.4],
  "plant-door-l": [-2.6, 13.3],
  "plant-door-r": [2.6, 13.3],
};
const SERVICES_FIRST: Record<string, Placement> = {
  // Treatment cabins line the left wall from the door, so services are the first thing a visitor meets.
  "cabin-1": ["left", 12.4],
  "cabin-2": ["left", 9.6],
  "cabin-3": ["left", 6.8],
  "cabin-4": ["left", 4],
  // A diagnostics bar and consultation facing the entrance.
  "sa-1": [-4.5, 9.6],
  "sa-2": [-3.6, 9.6],
  "sa-3": [-2.7, 9.6],
  "consult-a": [-4.1, 5.6],
  "consult-b": [-2.4, 5.6],
  "seat-a": [-4.1, 6.29, FACE_BACK],
  "seat-b": [-2.4, 6.29, FACE_BACK],
  // The makeup studio on the right, by the door.
  "ms-1": ["right", 10.2],
  "ms-2": ["right", 8.9],
  "ms-3": ["right", 7.6],
  "ms-4": ["right", 6.3],
  "bc-1": [9.1, 10.2, FACE_RIGHT],
  "bc-2": [9.1, 8.9, FACE_RIGHT],
  "bc-3": [9.1, 7.6, FACE_RIGHT],
  "bc-4": [9.1, 6.3, FACE_RIGHT],
  "bar-colour": [4.4, 9.4],
  "bar-colour-2": [4.4, 6],
  "wall-right-3": ["right", 12.95],
  hero: [0, 1.6],
  "plant-door-l": [-2.6, 13.3],
  "plant-door-r": [2.6, 13.3],
  // Products and the hall behind: fragrance, skin walls, the lounge, then gifts and checkout.
  "screen-arrival": ["left", -2],
  "wall-left-0": ["left", 1.4],
  "wall-left-1": ["left", -5.6],
  "wall-left-2": ["left", -7.5],
  "wall-left-3": ["left", -9.4],
  "wall-left-4": ["left", -11.3],
  "ft-1": [-6.8, -2.4],
  "ft-2": [-4.6, -2.4],
  "ft-3": [-2.4, -2.4],
  "ft-4": [-6.8, -4.8],
  "ft-5": [-4.6, -4.8],
  "ft-6": [-2.4, -4.8],
  "ft-7": [-6.8, -7.2],
  "ft-8": [-4.6, -7.2],
  "ft-9": [-2.4, -7.2],
  "bar-skin": [-4.6, -10.6],
  "hero-l": [-3, 1.6],
  "hero-r": [3, 3.8],
  "table-new": [0, -2.4, FACE_RIGHT],
  "table-1": [0, -5.8, FACE_RIGHT],
  "table-edit": [0, -9.2, FACE_RIGHT],
  "table-2": [0, -12.4],
  "screen-back": ["back", 4.8],
  "wall-right-1": ["right", 1.6],
  "wall-right-2": ["right", 3.5],
  bench: [5.6, -1.4],
  "bench-2": [5.6, 2.2, FACE_BACK],
  "bench-3": [3, 0.4, FACE_RIGHT],
  "plant-lounge": [5.6, 0.4],
  gift: ["right", -5.4],
  "gift-2": [5.8, -6.6],
  checkout: [8.4, -9.8, FACE_LEFT],
  "backbar-1": ["right", -10.2],
  "backbar-2": ["right", -9.4],
  "plant-front": [-9.4, -13.4],
  "plant-back-l": [-3.4, -13.4],
  "plant-back-r": [9.4, -13.4],
};
/** Larger than the catalogue piece: the arrival plinth is the store's centrepiece. */
const PRESET_SIZES: Partial<Record<string, Dimensions>> = {
  hero: { width: 1.5, depth: 1.5, height: 2.1 },
};
export function createRetailProject(): Project {
  const room: RoomSpec = {
    ...FLAGSHIP,
    door: { wall: "front", offset: 0, width: 4, height: 3.2 },
  };
  return {
    name: "Experiential store",
    space: "retail",
    version: 1,
    room,
    layouts: [
      retailLayout(
        {
          id: "original",
          name: "Grand flagship",
          description:
            "Seven clear zones: a hero arrival with a digital wall, a fragrance hall, skin diagnostics, a makeup studio, treatment cabins, a lounge, and gifting by the checkout",
          wallColor: "#efe6dc",
          accentColor: "#b5806f",
        },
        GRAND_FLAGSHIP,
      ),
      retailLayout(
        {
          id: "discovery-journey",
          name: "Discovery journey",
          description:
            "A guided loop: a runway of tables and an avenue of fragrance towers lead left, through diagnostics and the cabins, then back past makeup and the lounge to the checkout",
          wallColor: "#dfe4d9",
          accentColor: "#5f7f6f",
        },
        DISCOVERY_JOURNEY,
        {
          "testing-bar": "#8fa796",
          "hero-plinth": "#6f8f7f",
          "display-table": "#c6cfc2",
          "lounge-bench": "#5f7f6f",
          "fragrance-tower": "#c9d2c0",
          "digital-wall": "#7fa48f",
          "gift-station": "#a9bba9",
        },
      ),
      retailLayout(
        {
          id: "open-event",
          name: "Open event",
          description:
            "Everything pulled back to the walls around a stage before the feature screen, leaving one large central floor for launches, masterclasses and community events",
          wallColor: "#ebe7ee",
          accentColor: "#4b4560",
        },
        OPEN_EVENT,
        {
          "testing-bar": "#8a80a3",
          "hero-plinth": "#5a5275",
          "display-table": "#cfc8d8",
          "lounge-bench": "#4b4560",
          "fragrance-tower": "#cfc6dc",
          "digital-wall": "#8a7fd0",
          "gift-station": "#a79cc0",
        },
      ),
      retailLayout(
        {
          id: "launch-day",
          name: "Launch day",
          description:
            "A centre-stage reveal: the feature screen and hero plinths stand in the middle of the store, ringed by fragrance towers, with audience benches facing them",
          wallColor: "#ece4e2",
          accentColor: "#7a2f3d",
        },
        LAUNCH_DAY,
        {
          "testing-bar": "#a35a63",
          "hero-plinth": "#7a2f3d",
          "display-table": "#d9c3bf",
          "lounge-bench": "#7a2f3d",
          "fragrance-tower": "#c9a46a",
          "digital-wall": "#d0506a",
          "gift-station": "#b98a5a",
        },
      ),
      retailLayout(
        {
          id: "services-first",
          name: "Services first",
          description:
            "Appointments up front: treatment cabins, skin analyzers, consultation and the makeup studio meet visitors at the door, with fragrance, products and the checkout behind",
          wallColor: "#e3ebea",
          accentColor: "#4f7c7a",
        },
        SERVICES_FIRST,
        {
          "testing-bar": "#86aeab",
          "hero-plinth": "#4f7c7a",
          "display-table": "#c4d6d3",
          "lounge-bench": "#4f7c7a",
          "fragrance-tower": "#d6dfdc",
          "digital-wall": "#5fa8a2",
          "gift-station": "#9fbdb9",
        },
      ),
    ],
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
export function distanceToPolygon(p: Position, polygon: Position[]): number {
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
/** Metres of floor a person needs in front of a piece. Retail depths allow for browsing and queueing. */
const ACCESS_CLEARANCE: Partial<Record<ItemKind, number>> = {
  wardrobe: 0.6,
  shelf: 0.6,
  desk: 0.75,
  "wall-display": 1.2,
  "testing-bar": 1.2,
  "checkout-counter": 1.5,
  "consultation-station": 1,
  "display-table": 1,
  "skin-analyzer": 1,
  "mirror-station": 1,
  "gift-station": 1.2,
  // A treatment room is entered from its door side, so that side keeps a clear approach.
  "service-cabin": 1.2,
  // Shoppers circle a fragrance tower, so its access space runs all the way round.
  "fragrance-tower": 0.9,
};
/** Pieces browsed from every side rather than from a front. */
const ALL_ROUND: ItemKind[] = ["fragrance-tower"];
/** Seats belong in the access space of what they serve. */
const SEATED_AT: Partial<Record<ItemKind, ItemKind[]>> = {
  desk: ["chair"],
  "consultation-station": ["chair", "stool"],
  "mirror-station": ["beauty-chair", "chair", "stool"],
};
export function usageFootprint(item: FurnitureItem): Position[] | null {
  const clearance = ACCESS_CLEARANCE[item.kind];
  if (clearance === undefined) return null;
  const round = ALL_ROUND.includes(item.kind),
    w = item.dimensions.width / 2 + (round ? clearance : 0),
    start = item.dimensions.depth / 2,
    // Display tables stand free and are browsed from both long sides.
    near = item.kind === "display-table" || round ? -start - clearance : start;
  return [
    { x: -w, z: near },
    { x: w, z: near },
    { x: w, z: start + clearance },
    { x: -w, z: start + clearance },
  ].map((p) => localToWorld(item, p));
}

export function validatePlacement(
  item: FurnitureItem,
  items: FurnitureItem[],
  room: RoomSpec,
  space?: SpaceType,
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
    // Without an explicit space, a retail-only piece in the layout is what marks a store.
    const retail = (space ?? (items.some((other) => RETAIL_ONLY_KINDS.includes(other.kind)) ? "retail" : "room")) === "retail";
    issues.push({
      code: "outside",
      severity: "error",
      message: `${item.name} extends outside the ${retail ? "store" : "room"}.`,
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
        !SEATED_AT[item.kind]?.includes(other.kind) &&
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
  space?: SpaceType,
): PlacementIssue[] {
  const seen = new Set<string>();
  return layout.items
    .flatMap((item) => validatePlacement(item, layout.items, room, space))
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

const FAILED_ROOM = "Could not open this room: ";
function fail(message: string): never {
  throw new Error(`${FAILED_ROOM}${message}`);
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

function itemKinds(raw: unknown): unknown[] {
  const layouts = (raw as { layouts?: unknown } | null)?.layouts;
  return Array.isArray(layouts)
    ? layouts.flatMap((layout) => {
        const items = (layout as { items?: unknown } | null)?.items;
        return Array.isArray(items) ? items.map((item) => (item as { kind?: unknown } | null)?.kind) : [];
      })
    : [];
}
/**
 * Contents decide the space. `space` says which space is open, so a file that cannot even be read
 * still reports its failure as a store.
 */
export function parseProject(text: string, space?: SpaceType): Project {
  let store = space === "retail";
  try {
    if (text.length > 2_000_000) fail("The project is too large (maximum 2 MB).");
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      fail("The file is not valid JSON.");
    }
    store ||=
      (raw as { space?: unknown } | null)?.space === "retail" ||
      itemKinds(raw).some((kind) => RETAIL_ONLY_KINDS.includes(kind as ItemKind));
    return readProject(raw);
  } catch (error) {
    if (store && error instanceof Error && error.message.startsWith(FAILED_ROOM))
      throw new Error(`Could not open this store: ${error.message.slice(FAILED_ROOM.length)}`);
    throw error;
  }
}
function readProject(raw: unknown): Project {
  const p = object(raw, "Project");
  if (p.version !== 1) fail("This project version is not supported.");
  if (p.space !== undefined && p.space !== "room" && p.space !== "retail")
    fail("Unknown space type.");
  const r = object(p.room, "Room"),
    d = object(r.door, "Door");
  const room: RoomSpec = {
    width: number(r.width, "Room width", 2, 30),
    depth: number(r.depth, "Room depth", 2, 30),
    height: number(r.height, "Room height", 1.8, 8),
    door: {
      wall: "front",
      offset: number(d.offset, "Door offset", -15, 15),
      width: number(d.width, "Door width", 0.6, 6),
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
  const kinds = new Set(layouts.flatMap((l) => l.items.map((i) => i.kind))),
    bedroomPiece = ROOM_ONLY_KINDS.find((kind) => kinds.has(kind)),
    storePiece = RETAIL_ONLY_KINDS.find((kind) => kinds.has(kind));
  if (bedroomPiece && storePiece)
    fail(`A project cannot mix bedroom furniture (${bedroomPiece}) with store fixtures (${storePiece}).`);
  if (bedroomPiece && p.space === "retail")
    fail(`A store cannot hold bedroom furniture (${bedroomPiece}).`);
  const space = storePiece ? "retail" : p.space;
  return { version: 1, ...(p.id === undefined ? {} : { id: string(p.id, "Room ID") }), ...(p.name === undefined ? {} : { name: string(p.name, "Room name") }), ...(space === undefined ? {} : { space: space as SpaceType }), room, layouts, activeLayoutId, unit: p.unit };
}
export function serializeProject(project: Project): string {
  return JSON.stringify(parseProject(JSON.stringify(project)), null, 2);
}
