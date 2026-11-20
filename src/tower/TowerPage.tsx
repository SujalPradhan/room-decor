import { ArrowLeft, BedDouble, Box, Building2, CheckCircle2, FlaskConical, Loader2, Pin, PinOff, Plane, RotateCcw, Sparkles, Square, Store, Wrench } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CATALOG, furnish, parseBriefDefaults } from './furnish';
import { runTowerAgent, type TowerStep } from './tower-agent';
import { createTowerScene } from './tower-scene';
import { TOWER, formatINR, unitById, unitsOnFloor } from './tower';
import type { Brief, Facing, FurnishResult, Piece, Style, Unit, UnitType } from './model';
import TowerCompare from './TowerCompare';
import { StepList } from './TowerSteps';
import './tower.css';
import '../lab/lab.css';

const KEY = 'roomshift-tower-v1';
const MORPH_MS = 2400;
const STYLES: { id: Style; label: string }[] = [
  { id: 'warm-minimal', label: 'Warm minimal' }, { id: 'scandi', label: 'Scandi' },
  { id: 'indian-modern', label: 'Indian modern' }, { id: 'industrial', label: 'Industrial' },
];
const TYPES: ('all' | UnitType)[] = ['all', '1BHK', '2BHK', '3BHK'];
const FACINGS: ('all' | Facing)[] = ['all', 'NE', 'NW', 'SW', 'SE'];
const SUGGESTIONS = ['Couple, both WFH, one cat, 6 lakh', 'Family of four with a toddler, 9 lakh', 'Single, no desk needed, 3 lakh'];
const PRICES = TOWER.units.map(u => u.priceINR);
const PRICE_MIN = Math.floor(Math.min(...PRICES) / 500000) * 500000;
const PRICE_MAX = Math.ceil(Math.max(...PRICES) / 500000) * 500000;
const FLOORS = Array.from({ length: TOWER.floors }, (_, i) => TOWER.floors - i);
const SQFT = 10.764;

interface Filters { type: 'all' | UnitType; facing: 'all' | Facing; maxPrice: number }
interface Saved { filters: Filters; brief: Brief; pins: string[] }

const DEFAULT_BRIEF: Brief = parseBriefDefaults({ occupants: 2, wfh: 1, kids: 0, pets: [], budgetINR: 600000, style: 'warm-minimal', notes: '' });

function load(): Saved {
  const base: Saved = { filters: { type: 'all', facing: 'all', maxPrice: PRICE_MAX }, brief: DEFAULT_BRIEF, pins: [] };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (!raw) return base;
    const f = raw.filters ?? {};
    const filters: Filters = {
      type: TYPES.includes(f.type) ? f.type : 'all',
      facing: FACINGS.includes(f.facing) ? f.facing : 'all',
      maxPrice: typeof f.maxPrice === 'number' ? Math.min(PRICE_MAX, Math.max(PRICE_MIN, f.maxPrice)) : PRICE_MAX,
    };
    const pins = Array.isArray(raw.pins) ? raw.pins.filter((id: unknown) => typeof id === 'string' && unitById(id)).slice(0, 2) : [];
    const brief = raw.brief && typeof raw.brief === 'object' ? parseBriefDefaults(raw.brief) : DEFAULT_BRIEF;
    return { filters, brief, pins };
  } catch { return base; }
}

const sqft = (m2: number) => Math.round(m2 * SQFT).toLocaleString('en-IN');
const rupees = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const matches = (u: Unit, f: Filters) => (f.type === 'all' || u.type === f.type) && (f.facing === 'all' || u.facing === f.facing) && u.priceINR <= f.maxPrice;

export default function TowerPage() {
  const [saved, setSaved] = useState<Saved>(load);
  const { filters, brief, pins } = saved;
  const [hoverFloor, setHoverFloor] = useState<number | null>(null);
  const [floor, setFloor] = useState<number | null>(null);
  const [unitId, setUnitId] = useState<string | null>(null);
  const [mode, setMode] = useState<'tower' | 'unit'>('tower');
  const [result, setResult] = useState<FurnishResult | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<TowerStep[]>([]);
  const [reply, setReply] = useState<string | null>(null);
  const [whys, setWhys] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [morph, setMorph] = useState<{ key: string; ms: number } | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const scene = useRef<ReturnType<typeof createTowerScene> | null>(null);
  const runCount = useRef(0);

  const unit = unitId ? unitById(unitId) ?? null : null;
  const shownFloor = mode === 'tower' ? hoverFloor ?? floor : unit?.floor ?? null;
  const flat = unit ? unit.priceINR : 0;

  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch { } }, [saved]);

  useEffect(() => {
    if (!container.current) return;
    const instance = createTowerScene(container.current, {
      onHoverFloor: f => setHoverFloor(f),
      onPickUnit: id => { setUnitId(id); setFloor(unitById(id)?.floor ?? null); },
    });
    scene.current = instance;
    return () => { scene.current = null; instance.dispose(); };
  }, []);

  const highlight = useMemo(() => result?.issues.flatMap(i => i.pieceId ? [i.pieceId] : []) ?? [], [result]);

  useEffect(() => {
    scene.current?.update({
      mode, floor: shownFloor, unitId, furnish: mode === 'unit' ? result : null,
      highlight: focus ? [focus] : highlight,
      key: morph?.key ?? `${mode}-${unitId ?? 'none'}`, morphMs: morph?.ms,
    });
  }, [mode, shownFloor, unitId, result, highlight, focus, morph]);

  const setBrief = (patch: Partial<Brief>) => setSaved(s => {
    const next = { ...s.brief, ...patch };
    next.wfh = Math.min(next.wfh, next.occupants);
    return { ...s, brief: next };
  });
  const setFilters = (patch: Partial<Filters>) => setSaved(s => ({ ...s, filters: { ...s.filters, ...patch } }));
  const togglePin = (id: string) => setSaved(s => ({ ...s, pins: s.pins.includes(id) ? s.pins.filter(p => p !== id) : [...s.pins.slice(-1), id] }));

  const stop = () => { abort.current?.abort(); abort.current = null; setBusy(false); };

  const flyIn = () => {
    if (!unit) return;
    stop(); setResult(null); setSteps([]); setReply(null); setWhys([]); setError(null); setFocus(null); setMorph(null);
    setMode('unit');
  };
  const back = () => { stop(); setMode('tower'); setResult(null); setMorph(null); };
  const reset = () => { stop(); setMode('tower'); setUnitId(null); setFloor(null); setResult(null); setSteps([]); setReply(null); setError(null); scene.current?.resetView(); };

  const ask = async (extra: string) => {
    if (!unit || busy) return;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true); setError(null); setReply(null); setWhys([]); setSteps([]); setFocus(null);
    try {
      const run = await runTowerAgent(extra.trim() || 'Furnish the flat to my brief', unit, furnish(unit, brief), {
        signal: controller.signal,
        onStep: step => setSteps(list => [...list, step]),
      });
      if (controller.signal.aborted) return;
      runCount.current += 1;
      setResult(run.result);
      setMorph({ key: `run-${runCount.current}`, ms: MORPH_MS });
      setReply(run.reply); setWhys(run.steps[run.steps.length - 1]?.whys ?? []);
      setSaved(s => ({ ...s, brief: run.brief }));
    } catch (problem) {
      if (!controller.signal.aborted) setError(problem instanceof Error ? problem.message : 'The agent could not answer.');
    } finally {
      if (abort.current === controller) { abort.current = null; setBusy(false); }
    }
  };

  const floorUnits = floor ? unitsOnFloor(floor) : [];
  const availableOn = (f: number) => unitsOnFloor(f).filter(u => u.status === 'available' && matches(u, filters)).length;
  const grouped = useMemo(() => {
    if (!unit || !result) return [];
    return unit.rooms.map(room => ({ room, pieces: result.pieces.filter(p => p.roomId === room.id) })).filter(g => g.pieces.length > 0);
  }, [unit, result]);
  const pinned = pins.map(id => unitById(id)).filter((u): u is Unit => !!u);

  return <div className="lab-page tower-page">
    <header className="lab-top">
      <a className="brand" href="/" aria-label="Roomshift home"><Box size={22} strokeWidth={1.3} /><span>ROOMSHIFT<span className="brand-dot">®</span></span></a>
      <div className="space-switch" role="group" aria-label="Space">
        <a className="space-link" href="/" aria-label="Bedroom"><BedDouble size={13} /><span>Bedroom</span></a>
        <a className="space-link" href="/?space=retail" aria-label="Store"><Store size={13} /><span>Store</span></a>
        <a className="space-link" href="/lab" aria-label="Design Lab"><FlaskConical size={13} /><span>Design Lab</span></a>
        <a className="space-link" href="/bracket" aria-label="Bracket Lab"><Wrench size={13} /><span>Bracket Lab</span></a>
        <a className="space-link active" href="/tower" aria-label="Tower Lab" aria-current="page"><Building2 size={13} /><span>Tower Lab</span></a>
      </div>
      <h1>Tower Lab</h1>
      <div className="lab-top-actions">
        <button type="button" className="lab-ghost" onClick={reset}><RotateCcw size={14} /> Start over</button>
      </div>
    </header>
    <p className="lab-intro">{TOWER.name}, {TOWER.city}. Pick a floor, pick a flat and fly in. The agent furnishes it to your brief, checks that every piece fits and shows the furnishing cost next to the flat price.</p>
    <main className={`lab-main tower-main${mode === 'unit' ? ' is-unit' : ''}`}>
      <div className="lab-left">
        {mode === 'tower' ? <div className="lab-toolbar tower-filters" role="toolbar" aria-label="Filters">
          <div className="lab-seg" role="group" aria-label="Type">
            {TYPES.map(t => <button key={t} type="button" aria-pressed={filters.type === t} className={filters.type === t ? 'active' : ''} onClick={() => setFilters({ type: t })}>{t === 'all' ? 'All' : t}</button>)}
          </div>
          <label className="lab-select">Facing
            <select value={filters.facing} onChange={e => setFilters({ facing: e.target.value as Filters['facing'] })}>
              {FACINGS.map(f => <option key={f} value={f}>{f === 'all' ? 'Any' : f}</option>)}
            </select>
          </label>
          <label className="lab-select tower-range">Up to
            <input type="range" min={PRICE_MIN} max={PRICE_MAX} step={500000} value={filters.maxPrice} aria-label="Maximum price" onChange={e => setFilters({ maxPrice: Number(e.target.value) })} />
            <output>{filters.maxPrice >= PRICE_MAX ? 'Any price' : formatINR(filters.maxPrice)}</output>
          </label>
          <button type="button" className="lab-ghost" onClick={() => scene.current?.resetView()}>Reset view</button>
        </div> : <div className="lab-toolbar" role="toolbar" aria-label="Flat view">
          <button type="button" className="lab-ghost" onClick={back}><ArrowLeft size={14} /> Back to tower</button>
          <button type="button" className="lab-ghost" onClick={() => scene.current?.resetView()}>Reset view</button>
          {unit && <span className="tower-crumb">{TOWER.name} / Floor {unit.floor} / {unit.id} {unit.type}</span>}
        </div>}
        <div className="tower-stage">
          <div className="tower-frame">
          <div className="lab-scene tower-scene" ref={container} role="img" aria-label={mode === 'tower' ? 'Interactive 3D tower' : `3D view of flat ${unit?.id ?? ''}`} />
          {mode === 'tower' && <nav className="tower-rail" aria-label="Floors">
            <span className="tower-rail-title">Floor</span>
            <ol>
              {FLOORS.map(f => {
                const n = availableOn(f);
                return <li key={f}><button type="button" className={`${shownFloor === f ? 'is-on' : ''}${n === 0 ? ' is-none' : ''}`} aria-pressed={floor === f} aria-label={`Floor ${f}, ${n} available`}
                  onMouseEnter={() => setHoverFloor(f)} onMouseLeave={() => setHoverFloor(null)} onFocus={() => setHoverFloor(f)} onBlur={() => setHoverFloor(null)}
                  onClick={() => { setFloor(f); if (unit && unit.floor !== f) setUnitId(null); }}>
                  <b>{f}</b><i>{n}</i>
                </button></li>;
              })}
            </ol>
          </nav>}
          {mode === 'tower' && <p className="tower-legend" aria-hidden><span className="is-available">Available</span><span className="is-reserved">Reserved</span><span className="is-sold">Sold</span></p>}
          {mode === 'unit' && busy && <div className="lab-scene-tag"><Loader2 size={12} className="lab-spin" aria-hidden /> Furnishing</div>}
          </div>
        {mode === 'tower' && unit && <section className="tower-card" aria-label={`Unit ${unit.id}`}>
          <div className="tower-card-head">
            <h2>Unit {unit.id} <small>{unit.type}</small></h2>
            <span className={`tower-status is-${unit.status}`}>{unit.status}</span>
          </div>
          <dl>
            <div><dt>Carpet</dt><dd>{unit.carpetSqft.toLocaleString('en-IN')} sq ft</dd></div>
            <div><dt>Facing</dt><dd>{unit.facing}</dd></div>
            <div><dt>Sun</dt><dd>{unit.sunHours} h a day</dd></div>
            <div><dt>View</dt><dd>{unit.view}</dd></div>
            <div><dt>Price</dt><dd>{formatINR(unit.priceINR)}</dd></div>
            <div><dt>Per sq ft</dt><dd>{rupees(unit.priceINR / unit.carpetSqft)}</dd></div>
          </dl>
          <div className="tower-card-actions">
            <button type="button" className="lab-primary" onClick={flyIn}><Plane size={14} aria-hidden /> Fly in</button>
            <button type="button" className="lab-ghost" aria-pressed={pins.includes(unit.id)} onClick={() => togglePin(unit.id)}>{pins.includes(unit.id) ? <PinOff size={14} aria-hidden /> : <Pin size={14} aria-hidden />}{pins.includes(unit.id) ? 'Unpin' : 'Pin to compare'}</button>
          </div>
        </section>}
        </div>
        <p className="lab-note tower-note">Fictional tower, illustrative prices.</p>
        {mode === 'tower' && floor && <section className="tower-units" aria-label={`Floor ${floor} units`}>
          <h2>Floor {floor}</h2>
          <ul>
            {floorUnits.map(u => {
              const ok = matches(u, filters);
              return <li key={u.id}><button type="button" className={`tower-unit is-${u.status}${unitId === u.id ? ' is-picked' : ''}${ok ? '' : ' is-filtered'}`} aria-pressed={unitId === u.id} onClick={() => setUnitId(u.id)}>
                <b>{u.id}</b><span>{u.type}, {u.carpetSqft.toLocaleString('en-IN')} sq ft</span><span>{formatINR(u.priceINR)}</span><em>{u.status}</em>
              </button></li>;
            })}
          </ul>
        </section>}
        {pinned.length > 0 && <TowerCompare units={pinned} brief={brief} onUnpin={togglePin} />}
        {mode === 'unit' && unit && <section className="tower-rooms" aria-label="Rooms">
          <h2>Rooms</h2>
          <ul>
            {unit.rooms.map(r => <li key={r.id}><span>{r.name}</span><b>{sqft(r.rect.w * r.rect.d)} sq ft</b></li>)}
          </ul>
        </section>}
      </div>
      {mode === 'unit' && unit && <aside className="lab-side" aria-label="Agent">
        <form className="lab-agent tower-agent" onSubmit={e => { e.preventDefault(); void ask(text); }}>
          <label htmlFor="tower-request"><Sparkles size={14} aria-hidden /> Furnishing agent</label>
          <div className="tower-brief">
            <div className="tower-field"><span>People</span><div className="lab-seg" role="group" aria-label="People">{[1, 2, 3, 4, 5].map(n => <button key={n} type="button" aria-pressed={brief.occupants === n} className={brief.occupants === n ? 'active' : ''} onClick={() => setBrief({ occupants: n })}>{n}</button>)}</div></div>
            <div className="tower-field"><span>Work from home</span><div className="lab-seg" role="group" aria-label="Work from home">{[0, 1, 2].map(n => <button key={n} type="button" disabled={n > brief.occupants} aria-pressed={brief.wfh === n} className={brief.wfh === n ? 'active' : ''} onClick={() => setBrief({ wfh: n })}>{n}</button>)}</div></div>
            <div className="tower-field"><span>Kids</span><div className="lab-seg" role="group" aria-label="Kids">{[0, 1, 2].map(n => <button key={n} type="button" aria-pressed={brief.kids === n} className={brief.kids === n ? 'active' : ''} onClick={() => setBrief({ kids: n })}>{n}</button>)}</div></div>
            <div className="tower-field"><span>Pets</span><div className="tower-pets">{['cat', 'dog'].map(p => <button key={p} type="button" className={`lab-toggle${brief.pets.includes(p) ? ' active' : ''}`} aria-pressed={brief.pets.includes(p)} onClick={() => setBrief({ pets: brief.pets.includes(p) ? brief.pets.filter(x => x !== p) : [...brief.pets, p] })}>{p === 'cat' ? 'Cat' : 'Dog'}</button>)}</div></div>
            <label className="tower-field tower-budget"><span>Budget <output>{formatINR(brief.budgetINR)}</output></span>
              <input type="range" min={100000} max={1500000} step={25000} value={brief.budgetINR} aria-label="Furnishing budget" onChange={e => setBrief({ budgetINR: Number(e.target.value) })} /></label>
            <label className="tower-field"><span>Style</span>
              <select value={brief.style} onChange={e => setBrief({ style: e.target.value as Style })}>{STYLES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
          </div>
          <textarea id="tower-request" rows={2} value={text} maxLength={300} readOnly={busy} placeholder="Or describe it: Couple, both WFH, one cat, ₹6 lakh" onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void ask(text); } }} />
          <div className="lab-suggestions" aria-label="Suggestions">{SUGGESTIONS.map(s => <button key={s} type="button" disabled={busy} onClick={() => { setText(s); void ask(s); }}>{s}</button>)}</div>
          {busy ? <div className="tower-busy"><span className="lab-busy" role="status"><Loader2 size={14} className="lab-spin" aria-hidden />The agent is furnishing and checking…</span><button type="button" className="lab-ghost" onClick={stop}><Square size={11} /> Stop</button></div>
            : <button type="submit" className="lab-primary tower-go">Furnish it for me</button>}
          {error && <p className="tower-error" role="alert">{error}</p>}
        </form>
        <StepList steps={steps} running={busy} />
        {result && !busy && <section className="tower-result" aria-label="Furnishing result">
          <h3>Furnishing</h3>
          <dl className="tower-totals">
            <div><dt>Flat</dt><dd>{formatINR(flat)}</dd></div>
            <div><dt>Furnishing</dt><dd>{formatINR(result.costINR)}</dd></div>
            <div><dt>Total</dt><dd>{formatINR(flat + result.costINR)}</dd></div>
          </dl>
          <p className={`tower-verdict ${result.issues.length === 0 ? 'is-ok' : 'is-bad'}`}>{result.issues.length === 0 ? <><CheckCircle2 size={14} aria-hidden /> Every piece fits, nothing blocks a door, within budget.</> : `${result.issues.length} ${result.issues.length === 1 ? 'issue' : 'issues'} to look at`}</p>
          {result.issues.length > 0 && <ul className="tower-issues">{result.issues.map((i, n) => <li key={n}><button type="button" disabled={!i.pieceId} onClick={() => setFocus(f => f === i.pieceId ? null : i.pieceId ?? null)}>{i.message}</button></li>)}</ul>}
          {reply && <p className="tower-reply">{reply}</p>}
          {whys.length > 0 && <ul className="tower-whys">{whys.map((w, i) => <li key={i}>{w}</li>)}</ul>}
          <div className="tower-pieces">
            {grouped.map(({ room, pieces }) => <div key={room.id}>
              <h4>{room.name}</h4>
              <ul>{pieces.map((p: Piece) => <li key={p.id}><button type="button" className={focus === p.id ? 'is-on' : ''} onClick={() => setFocus(f => f === p.id ? null : p.id)}><span>{CATALOG[p.kind].name}</span><b>{rupees(p.priceINR)}</b></button></li>)}</ul>
            </div>)}
          </div>
        </section>}
      </aside>}
    </main>
  </div>;
}
