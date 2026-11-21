export type UnitType = '1BHK' | '2BHK' | '3BHK';
export type Facing = 'N' | 'E' | 'S' | 'W' | 'NE' | 'NW' | 'SE' | 'SW';
export type UnitStatus = 'available' | 'reserved' | 'sold';
export type RoomKind = 'living' | 'kitchen' | 'bedroom' | 'master' | 'bath' | 'balcony' | 'study';
export type Style = 'warm-minimal' | 'scandi' | 'indian-modern' | 'industrial';

export interface Rect { x: number; y: number; w: number; d: number }

export interface Opening { kind: 'door' | 'window' | 'entry'; x: number; y: number; width: number; axis: 'x' | 'y' }

export interface Room { id: string; kind: RoomKind; name: string; rect: Rect }

export interface Unit {
  id: string;
  floor: number;
  slot: 'A' | 'B' | 'C' | 'D';
  type: UnitType;
  carpetSqft: number;
  facing: Facing;
  status: UnitStatus;
  priceINR: number;
  sunHours: number;
  view: string;
  viewScore: number;
  origin: { x: number; y: number };
  size: { w: number; d: number };
  rooms: Room[];
  openings: Opening[];
}

export interface Tower { name: string; city: string; floors: number; floorHeight: number; footprint: { w: number; d: number }; units: Unit[] }

export type FurnitureKind =
  | 'sofa' | 'armchair' | 'coffee-table' | 'tv-unit' | 'rug' | 'dining-table' | 'dining-chair' | 'bed-double' | 'bed-queen' | 'bed-single'
  | 'wardrobe' | 'side-table' | 'desk' | 'office-chair' | 'bookshelf' | 'plant' | 'floor-lamp' | 'cat-tree' | 'crib' | 'bean-bag' | 'shoe-rack';

export interface Piece {
  id: string;
  kind: FurnitureKind;
  roomId: string;
  x: number;
  y: number;
  rotation: 0 | 90 | 180 | 270;
  w: number;
  d: number;
  h: number;
  priceINR: number;
  color: string;
}

export interface Brief { occupants: number; budgetINR: number; style: Style; wfh: number; kids: number; pets: string[]; notes: string }

export interface FurnishIssue { pieceId?: string; roomId?: string; kind: 'overlap' | 'blocks-door' | 'tight-walkway' | 'outside-room' | 'over-budget' | 'missing-need'; message: string }

export interface FurnishResult { unitId: string; brief: Brief; pieces: Piece[]; costINR: number; issues: FurnishIssue[]; ok: boolean }
