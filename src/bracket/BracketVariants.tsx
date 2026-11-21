import { Check } from 'lucide-react';
import { AVG_HEIGHT_MM, heightAt, sameDesign, tally, type Variant } from './engine';
import { windowsOf } from './mesh';
import type { BracketDesign } from './model';
import { BOSS_OD_MM, END_MARGIN_MM, LENGTH_MM, MATERIALS, NUT_SPACING_MM } from './spec';

const fmt = (value: number) => Math.round(value).toLocaleString('en-US');

function Section({ design }: { design: BracketDesign }) {
  const { thickness: t, topWidth: b, lipWidth: f } = design;
  const h = AVG_HEIGHT_MM;
  const half = b / 2 + t / 2;
  const points = [[-half - f, h - t / 2], [-half, h - t / 2], [-half, t / 2], [half, t / 2], [half, h - t / 2], [half + f, h - t / 2]];
  const w = half + f + 4;
  return <svg className="bracket-variant-section" viewBox={`${-w} -4 ${2 * w} ${h + 8}`} aria-hidden>
    <polyline points={points.map(([x, y]) => `${x},${y}`).join(' ')} fill="none" stroke="currentColor" strokeWidth={t} strokeLinejoin="miter" />
  </svg>;
}

function Elevation({ design }: { design: BracketDesign }) {
  const t = design.thickness;
  const top = (x: number) => 80 - heightAt(x);
  const base = 80;
  const outline = `M0,${base} L0,${top(0)} L${LENGTH_MM},${top(LENGTH_MM)} L${LENGTH_MM},${base} Z`;
  const windows = windowsOf(design).map(win => {
    const hc = heightAt(win.xc) - t;
    const hh = win.frac * hc;
    const cy = base - t - hc / 2;
    return { x: win.xc - win.w / 2, y: cy - hh / 2, w: win.w, h: hh, r: win.r };
  });
  const bosses = [END_MARGIN_MM, END_MARGIN_MM + NUT_SPACING_MM];
  return <svg className="bracket-variant-elevation" viewBox={`-6 0 ${LENGTH_MM + 12} ${base + 18}`} aria-hidden>
    <path d={outline} fill="currentColor" fillOpacity={0.22} stroke="currentColor" strokeWidth={1.6} />
    {windows.map((win, i) => <rect key={i} x={win.x} y={win.y} width={win.w} height={win.h} rx={win.r} className="bracket-variant-window" />)}
    {bosses.map(x => <rect key={x} x={x - BOSS_OD_MM / 2} y={base} width={BOSS_OD_MM} height={design.bossHeight} fill="currentColor" />)}
  </svg>;
}

interface Props {
  variants: Variant[];
  current: BracketDesign;
  disabled: boolean;
  onPick: (variant: Variant) => void;
}

export default function BracketVariants({ variants, current, disabled, onPick }: Props) {
  const max = {
    mass: Math.max(...variants.map(v => v.verification.derived.massG)),
    cost: Math.max(...variants.map(v => v.verification.derived.unitCostUSD)),
    margin: Math.max(...variants.map(v => v.weakest.ratio)),
  };
  const bar = (value: number, top: number) => <span className="bracket-variant-bar" aria-hidden><i style={{ width: `${Math.max(4, (value / top) * 100)}%` }} /></span>;
  return <section className="bracket-variants" aria-label="Variations">
    <div className="bracket-variants-head">
      <h2>Three ready-made variations</h2>
      <p>All three clear every analysis check. They trade grams for headroom, because the belt pull, rear impact and fatigue clauses still need physical tests and hand analysis can be optimistic. Only {MATERIALS['ti64-lpbf'].short} clears every check within the mass target; aluminium, 316L and PA12 each fail at least one clause.</p>
    </div>
    <ul className="bracket-variant-list">
      {variants.map(variant => {
        const v = variant.verification;
        const d = v.derived;
        const n = tally(v);
        const active = sameDesign(v.design, current);
        return <li key={variant.id} className={`bracket-variant is-${variant.id}${active ? ' is-active' : ''}`}>
          <button type="button" aria-pressed={active} disabled={disabled} onClick={() => onPick(variant)} aria-label={`${variant.name}: ${fmt(d.massG)} g, ${variant.weakest.ratio.toFixed(1)}× weakest margin`}>
            <span className="bracket-variant-title"><b>{variant.name}</b>{active && <span className="bracket-variant-on"><Check size={12} aria-hidden /> In 3D</span>}</span>
            <span className="bracket-variant-pics"><Section design={v.design} /><Elevation design={v.design} /></span>
            <span className="bracket-variant-spec">{v.design.thickness} mm wall · {Math.round(v.design.cutout * 100)}% cut-outs · {v.design.bossHeight} mm bosses</span>
            <dl>
              <div><dt>Mass</dt><dd>{fmt(d.massG)} g</dd>{bar(d.massG, max.mass)}</div>
              <div><dt>Weakest margin</dt><dd>{variant.weakest.ratio.toFixed(2)}×</dd>{bar(variant.weakest.ratio, max.margin)}<small>{variant.weakest.label}</small></div>
              <div><dt>Prototype cost</dt><dd>${fmt(d.unitCostUSD)}</dd>{bar(d.unitCostUSD, max.cost)}</div>
              <div><dt>First mode</dt><dd>{d.frequencyHz.toFixed(0)} Hz</dd></div>
            </dl>
            <span className="bracket-variant-tally">{n.pass} pass · {n.fail} fail · {n.test} need test · {n.deviation} deviation{n.deviation === 1 ? '' : 's'}</span>
            <span className="bracket-variant-why">{variant.why}</span>
          </button>
        </li>;
      })}
    </ul>
  </section>;
}
