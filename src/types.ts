export type ItemKind =
  | "bed"
  | "wardrobe"
  | "desk"
  | "chair"
  | "floor-bed"
  | "pedestal-fan"
  | "stool"
  | "plant"
  | "shelf";
export type ViewMode = "orbit" | "plan" | "walk";
export interface Dimensions {
  width: number;
  depth: number;
  height: number;
}
export interface Position {
  x: number;
  z: number;
}
export interface FurnitureItem {
  productId?: string;
  assetId?: string;
  id: string;
  name: string;
  kind: ItemKind;
  dimensions: Dimensions;
  position: Position;
  rotation: number;
  color: string;
  visible: boolean;
  locked: boolean;
  dimensionSource: "estimated" | "measured" | "product";
}
export interface RoomSpec {
  width: number;
  depth: number;
  height: number;
  door: { wall: "front"; offset: number; width: number; height: number };
}
export interface Layout {
  id: string;
  name: string;
  description: string;
  items: FurnitureItem[];
  wallColor: string;
  accentColor: string;
}
export interface Project {
  id?: string;
  name?: string;
  version: 1;
  room: RoomSpec;
  layouts: Layout[];
  activeLayoutId: string;
  unit: "cm" | "in";
}
export interface PlacementIssue {
  code: "overlap" | "outside" | "door" | "clearance";
  severity: "error" | "warning";
  message: string;
  itemIds: string[];
}
export interface SceneState {
  ghostItem?: FurnitureItem | null;
  room: RoomSpec;
  layout: Layout;
  selectedId: string | null;
  mode: ViewMode;
  wallsVisible: boolean;
  showClearances: boolean;
}
export interface SceneCallbacks {
  onSelect: (id: string | null) => void;
  onMove: (id: string, position: Position) => boolean | void;
  onReady?: () => void;
  onError?: (message: string) => void;
}
export interface SceneController {
  focusItem?: (id: string) => void;
  update: (state: SceneState) => void;
  resetView: () => void;
  capture: () => string;
  dispose: () => void;
}
