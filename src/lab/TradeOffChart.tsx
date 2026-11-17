import type { MaterialGroup } from './model';

export interface TradeOffPoint { materials: Record<MaterialGroup, string>; costGBP: number; carbonKg: number; feasible: boolean; pareto: boolean }

const W = 560, H = 270, L = 62, R = 18, T = 14, B = 46;
const span = (values: number[]) => {
  const low = Math.min(...values), high = Math.max(...values), pad = (high - low || high || 1) * 0.1;
  return [Math.max(0, low - pad), high + pad] as const;
};
const ticks = (low: number, high: number) => [0, 1, 2, 3, 4].map(index => low + ((high - low) * index) / 4);

export default function TradeOffChart({ options, current, onPick }: { options: TradeOffPoint[]; current: { costGBP: number; carbonKg: number }; onPick: (option: TradeOffPoint) => void }) {
  const xs = [...options.map(option => option.costGBP), current.costGBP], ys = [...options.map(option => option.carbonKg), current.carbonKg];
  const [x0, x1] = span(xs), [y0, y1] = span(ys);
  const x = (value: number) => L + ((value - x0) / (x1 - x0)) * (W - L - R);
  const y = (value: number) => H - B - ((value - y0) / (y1 - y0)) * (H - T - B);
  const front = options.filter(option => option.pareto).sort((a, b) => a.costGBP - b.costGBP);
  const same = (option: TradeOffPoint) => Math.abs(option.costGBP - current.costGBP) < 0.5 && Math.abs(option.carbonKg - current.carbonKg) < 0.5;
  return <section className="lab-chart" aria-label="Cost vs carbon">
    <h3>Cost vs carbon</h3>
    <svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label="Every material option by cost and carbon">
      {ticks(x0, x1).map(value => <g key={`x${value}`}><line className="lab-grid" x1={x(value)} x2={x(value)} y1={T} y2={H - B} /><text className="lab-tick" x={x(value)} y={H - B + 16} textAnchor="middle">£{Math.round(value).toLocaleString('en-GB')}</text></g>)}
      {ticks(y0, y1).map(value => <g key={`y${value}`}><line className="lab-grid" x1={L} x2={W - R} y1={y(value)} y2={y(value)} /><text className="lab-tick" x={L - 8} y={y(value) + 4} textAnchor="end">{Math.round(value)}</text></g>)}
      <text className="lab-axis" x={(L + W - R) / 2} y={H - 8} textAnchor="middle">Cost (£)</text>
      <text className="lab-axis" transform={`translate(14 ${(T + H - B) / 2}) rotate(-90)`} textAnchor="middle">Carbon (kgCO2e)</text>
      {front.length > 1 && <polyline className="lab-front" points={front.map(option => `${x(option.costGBP)},${y(option.carbonKg)}`).join(' ')} />}
      {options.map((option, index) => {
        const pick = option.pareto && option.feasible && !same(option);
        const label = `${option.feasible ? '' : 'Not feasible. '}Cost £${Math.round(option.costGBP)}, carbon ${Math.round(option.carbonKg)} kg${option.pareto ? ', on the best-trade-off line' : ''}`;
        return <circle key={index} className={`lab-dot${option.feasible ? option.pareto ? ' is-pareto' : '' : ' is-infeasible'}${pick ? ' is-pick' : ''}`} cx={x(option.costGBP)} cy={y(option.carbonKg)} r={option.pareto ? 6 : 4.5} role={pick ? 'button' : undefined} tabIndex={pick ? 0 : undefined} aria-label={pick ? `Apply this material set. ${label}` : label} onClick={pick ? () => onPick(option) : undefined} onKeyDown={pick ? event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onPick(option); } } : undefined}><title>{label}</title></circle>;
      })}
      <circle className="lab-now" cx={x(current.costGBP)} cy={y(current.carbonKg)} r={10} aria-label="Current design"><title>Current design</title></circle>
    </svg>
    <p className="lab-legend"><span><i className="lab-key is-pareto" /> Best trade-off, click to apply</span><span><i className="lab-key" /> Other</span><span><i className="lab-key is-infeasible" /> Not feasible</span><span><i className="lab-key is-now" /> Current</span></p>
  </section>;
}
