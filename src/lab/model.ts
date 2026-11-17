export type LabKind = 'desk' | 'chair' | 'pc' | 'printer' | 'coffee' | 'heater' | 'fridge' | 'shelf' | 'router' | 'ac' | 'extinguisher';
export type Rotation = 0 | 90 | 180 | 270;
export type Wall = 'back' | 'left' | 'right' | 'front';
export type Channel = 'wall' | 'floor' | 'loose';
export type ExtinguisherType = 'co2' | 'water' | 'foam' | 'powder';
export type MaterialGroup = 'desk' | 'shelf' | 'floor';

export interface LabItem {
  id: string;
  name: string;
  kind: LabKind;
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  rotation: Rotation;
  watts: number;
  data: boolean;
  socketId: string | null;
  channel: Channel;
  via?: [number, number];
  dataChannel?: Channel;
  loadKg?: number;
  seats?: number;
  extinguisher?: ExtinguisherType;
  locked?: boolean;
}

export interface LabSocket { id: string; name: string; wall: Wall; x: number; z: number; circuitId: string }
export interface LabCircuit { id: string; name: string; breakerA: number }
export interface LabRect { x: number; z: number; w: number; d: number }

export interface LabRoom {
  width: number;
  depth: number;
  height: number;
  door: { x: number; width: number };
  vent?: { wall: Wall; x: number; z: number };
  dataPoint: { wall: Wall; x: number; z: number };
}

export interface LabDesign {
  id: string;
  name: string;
  room: LabRoom;
  items: LabItem[];
  sockets: LabSocket[];
  circuits: LabCircuit[];
  materials: Record<MaterialGroup, string>;
  acId: string;
  fireStart?: [number, number];
}

export interface CablePath { id: string; itemId: string; kind: 'power' | 'data'; channel: Channel; points: [number, number][]; length: number }

export type Severity = 'error' | 'warning';
export interface LabIssue { rule: string; severity: Severity; message: string; itemIds: string[] }

export interface SocketLoad { socketId: string; name: string; watts: number; limitW: number; itemIds: string[] }
export interface CircuitLoad { circuitId: string; name: string; watts: number; limitW: number }
export interface LabMeters {
  sockets: SocketLoad[];
  circuits: CircuitLoad[];
  heatW: number;
  coolingW: number;
  people: number;
  costGBP: number;
  carbonKg: number;
  cableM: number;
  looseM: number;
}

export interface LabReport { issues: LabIssue[]; meters: LabMeters; cables: CablePath[] }
