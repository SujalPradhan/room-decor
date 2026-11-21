import type { LabReport } from './model';

const tone = (ratio: number) => (ratio > 1 ? 'is-red' : ratio >= 0.8 ? 'is-amber' : 'is-green');
const kw = (watts: number) => `${(watts / 1000).toFixed(2)} kW`;

function Bar({ label, value, limit, note }: { label: string; value: number; limit: number; note?: string }) {
  const ratio = limit > 0 ? value / limit : 0;
  return <div className={`lab-meter ${tone(ratio)}`}>
    <div className="lab-meter-head"><span>{label}</span><b>{kw(value)} / {kw(limit)}{note ? ` ${note}` : ''}</b></div>
    <div className="lab-bar" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={limit} aria-valuenow={Math.round(value)}><i style={{ width: `${Math.min(100, ratio * 100)}%` }} /></div>
  </div>;
}

export default function LabMeters({ report }: { report: LabReport }) {
  const { circuits, heatW, coolingW, costGBP, carbonKg, people } = report.meters;
  return <section className="lab-meters" aria-label="Meters">
    <div className="lab-meter-bars">
      {circuits.map(circuit => <Bar key={circuit.circuitId} label={circuit.name} value={circuit.watts} limit={circuit.limitW} />)}
      <Bar label="Heat vs cooling" value={heatW} limit={coolingW} note="AC" />
    </div>
    <dl className="lab-totals">
      <div><dt>Cost</dt><dd>£{Math.round(costGBP).toLocaleString('en-GB')}</dd></div>
      <div><dt>Carbon</dt><dd>{Math.round(carbonKg).toLocaleString('en-GB')} <small>kgCO2e</small></dd></div>
      <div><dt>People</dt><dd>{people}</dd></div>
    </dl>
  </section>;
}
