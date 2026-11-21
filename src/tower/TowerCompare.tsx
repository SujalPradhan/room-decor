import { PinOff } from 'lucide-react';
import { useMemo } from 'react';
import { furnish } from './furnish';
import { formatINR } from './tower';
import type { Brief, Unit } from './model';

export default function TowerCompare({ units, brief, onUnpin }: { units: Unit[]; brief: Brief; onUnpin: (id: string) => void }) {
  const costs = useMemo(() => units.map(u => furnish(u, brief).costINR), [units, brief]);
  const perSqft = (u: Unit) => `₹${Math.round(u.priceINR / u.carpetSqft).toLocaleString('en-IN')}`;
  const rows: [string, (u: Unit, i: number) => string][] = [
    ['Type', u => u.type],
    ['Carpet', u => `${u.carpetSqft.toLocaleString('en-IN')} sq ft`],
    ['Price', u => formatINR(u.priceINR)],
    ['Per sq ft', perSqft],
    ['Facing', u => u.facing],
    ['Sun', u => `${u.sunHours} h a day`],
    ['View', u => u.view],
    ['Furnishing', (_, i) => formatINR(costs[i])],
    ['Flat plus furnishing', (u, i) => formatINR(u.priceINR + costs[i])],
  ];
  return <section className="tower-compare" aria-label="Compare units">
    <h2>Compare{units.length < 2 ? ' (pin one more unit)' : ''}</h2>
    <table>
      <thead><tr><th scope="col"><span className="sr-only">Measure</span></th>{units.map(u => <th key={u.id} scope="col">Unit {u.id}<button type="button" className="lab-icon" aria-label={`Unpin ${u.id}`} onClick={() => onUnpin(u.id)}><PinOff size={12} aria-hidden /></button></th>)}</tr></thead>
      <tbody>{rows.map(([label, fn]) => <tr key={label}><th scope="row">{label}</th>{units.map((u, i) => <td key={u.id}>{fn(u, i)}</td>)}</tr>)}</tbody>
    </table>
    <p className="lab-note">Furnishing is the rule-based layout for the current brief.</p>
  </section>;
}
