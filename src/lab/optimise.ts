import type { LabDesign, MaterialGroup } from './model';
import { evaluate } from './checks';
import { MATERIALS } from './rules';

export interface MaterialOption { materials: Record<MaterialGroup, string>; costGBP: number; carbonKg: number; feasible: boolean; pareto: boolean }

const idsFor = (group: MaterialGroup) => MATERIALS.filter(each => each.group === group).map(each => each.id);

function dominates(a: MaterialOption, b: MaterialOption): boolean {
  return a.costGBP <= b.costGBP && a.carbonKg <= b.carbonKg && (a.costGBP < b.costGBP || a.carbonKg < b.carbonKg);
}

export function materialOptions(design: LabDesign): MaterialOption[] {
  const options: MaterialOption[] = [];
  for (const desk of idsFor('desk')) for (const shelf of idsFor('shelf')) for (const floor of idsFor('floor')) {
    const materials = { desk, shelf, floor };
    const report = evaluate({ ...design, materials });
    const feasible = !report.issues.some(each => each.rule === 'shelf-load');
    options.push({ materials, costGBP: report.meters.costGBP, carbonKg: report.meters.carbonKg, feasible, pareto: false });
  }
  const feasible = options.filter(each => each.feasible);
  return options.map(option => ({ ...option, pareto: option.feasible && !feasible.some(other => dominates(other, option)) }));
}

export function cheapestWithin(design: LabDesign, carbonLimitKg: number): MaterialOption | null {
  const within = materialOptions(design).filter(each => each.feasible && each.carbonKg <= carbonLimitKg);
  return within.reduce<MaterialOption | null>((best, each) => (!best || each.costGBP < best.costGBP || (each.costGBP === best.costGBP && each.carbonKg < best.carbonKg) ? each : best), null);
}

export function lowestCarbon(design: LabDesign): MaterialOption {
  const options = materialOptions(design);
  const pool = options.some(each => each.feasible) ? options.filter(each => each.feasible) : options;
  return pool.reduce((best, each) => (each.carbonKg < best.carbonKg || (each.carbonKg === best.carbonKg && each.costGBP < best.costGBP) ? each : best));
}
