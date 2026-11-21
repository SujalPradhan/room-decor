export type MaterialId = 'ti64-lpbf' | 'alsi10mg-lpbf' | 'ss316l-lpbf' | 'pa12-sls';
export type Orientation = 'upright' | 'pads-down';
export type Finish = 'as-printed' | 'machined';
export type BracketId = 'rh' | 'lh';

export interface BracketDesign {
  material: MaterialId;
  orientation: Orientation;
  finish: Finish;
  thickness: number;
  topWidth: number;
  lipWidth: number;
  cutout: number;
  bossHeight: number;
}

export type Status = 'pass' | 'fail' | 'test' | 'deviation';
export type Method = 'analysis' | 'inspection' | 'datasheet' | 'test' | 'review';

export interface CheckResult {
  id: string;
  clause: string;
  title: string;
  method: Method;
  status: Status;
  value: string;
  limit: string;
  working: string[];
  basis: string;
}

export interface Derived {
  inertialN: number;
  shearPerRiserN: number;
  upliftN: number;
  lipMomentNmm: number;
  lipCapacityNmm: number;
  kickCapacityN: number;
  slamElasticN: number;
  pushOutN: number;
  frequencyHz: number;
  halfWidthMm: number;
  harnessClearanceMm: number;
  toolClearanceMm: number;
  volumeMm3: number;
  massG: number;
  unitCostUSD: number;
  envelopeMm: [number, number, number];
}

export interface Verification { design: BracketDesign; derived: Derived; checks: CheckResult[]; passed: boolean }
