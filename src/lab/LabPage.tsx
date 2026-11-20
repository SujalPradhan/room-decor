import { BedDouble, Box, Building2, Eye, FlaskConical, Footprints, Layers, Loader2, Map as MapIcon, Pause, Play, RotateCcw, Sparkles, Square, Store, Trash2, Undo2, Flame, CheckCircle2, Wrench } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { evaluate } from './checks';
import { runLabAgent, type LabAgentRun, type LabStep } from './lab-agent';
import { createLabScene, type LabPlay } from './lab-scene';
import LabChanges, { type ChangeSummary } from './LabChanges';
import LabMeters from './LabMeters';
import type { Channel, LabDesign, LabItem, LabReport } from './model';
import { materialOptions } from './optimise';
import { MATERIALS, RULES } from './rules';
import { createOffice } from './scenario';
import { defaultFireStart, runDrill, type DrillResult } from './smoke';
import TradeOffChart from './TradeOffChart';
import './lab.css';

const KEY = 'roomshift-lab-design-v2';
const SUGGESTIONS = ['Untangle the wiring', 'Fix every problem', 'Add 2 desks and wire them up', 'Add a 2 kW space heater', 'Make the room safer in a fire', 'Make it as low carbon as possible', 'Is this fire safe?'];
const NEXT_CHANNEL: Record<Channel, Channel> = { loose: 'wall', wall: 'floor', floor: 'loose' };
const MODES = [{ id: 'plan', label: '2D plan', Icon: MapIcon }, { id: 'orbit', label: '3D', Icon: Box }, { id: 'walk', label: 'Walk inside', Icon: Footprints }] as const;
const STEP_MS = 2600, WIRING_MS = 3600, HOLD_MS = 700;
const SPEEDS = [0.5, 0.75, 1];
type Mode = (typeof MODES)[number]['id'];

function load(): LabDesign {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (parsed && Array.isArray(parsed.items) && Array.isArray(parsed.sockets) && parsed.room) return parsed as LabDesign;
  } catch { }
  return createOffice();
}

const money = (value: number) => `£${Math.round(value).toLocaleString('en-GB')}`;
const kg = (value: number) => `${Math.round(value).toLocaleString('en-GB')} kg`;
const seconds = (value: number) => `${Math.round(value)} s`;

export default function LabPage() {
  const [design, setDesign] = useState<LabDesign>(load);
  const [undo, setUndo] = useState<LabDesign[]>([]);
  const [mode, setMode] = useState<Mode>('plan');
  const [xray, setXray] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string[]>([]);
  const [request, setRequest] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(1);
  const [summary, setSummary] = useState<ChangeSummary | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(0.75);
  const [play, setPlay] = useState<LabPlay | null>(null);
  const [origin, setOrigin] = useState<LabDesign | null>(null);
  const runId = useRef(0);
  const [drillOn, setDrillOn] = useState(false);
  const [fireSel, setFireSel] = useState('auto');
  const [t, setT] = useState(0);
  const [drillPlaying, setDrillPlaying] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const scene = useRef<ReturnType<typeof createLabScene> | null>(null);

  const steps = summary?.run.steps ?? [];
  const shown = active !== null && steps[active] ? steps[active].design : design;
  const report = useMemo(() => evaluate(shown), [shown]);
  const options = useMemo(() => materialOptions(shown), [shown]);
  const changes = useMemo(() => {
    const visible = active === null ? steps.map((step, index) => ({ step, index })) : [{ step: steps[active], index: active }];
    return visible.flatMap(({ step, index }) => step ? step.itemIds.map(itemId => ({ itemId, label: String(index + 1) })) : []);
  }, [steps, active]);

  const fireStart = useMemo<[number, number]>(() => {
    if (fireSel !== 'auto') {
      const socket = shown.sockets.find(each => each.id === fireSel);
      if (socket) return [socket.x, socket.z];
      const item = shown.items.find(each => each.id === fireSel);
      if (item) return [item.x, item.z];
    }
    return shown.fireStart ?? defaultFireStart(shown, report);
  }, [shown, report, fireSel]);
  const drill = useMemo<DrillResult | null>(() => (drillOn ? runDrill(shown, fireStart) : null), [drillOn, shown, fireStart]);

  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(design)); } catch { } }, [design]);

  function edit(change: (items: LabItem[]) => LabItem[]) { setDesign(d => ({ ...d, items: change(d.items) })); }
  const handlers = useRef({
    select: (id: string | null) => setSelectedId(id),
    item: (id: string, x: number, z: number) => edit(items => items.map(each => each.id === id ? { ...each, x, z } : each)),
    socket: (id: string, x: number, z: number) => setDesign(d => ({ ...d, sockets: d.sockets.map(each => each.id === id ? { ...each, x, z } : each) })),
    via: (id: string, x: number, z: number) => edit(items => items.map(each => each.id === id ? { ...each, via: [x, z] as [number, number] } : each)),
    cable: (id: string, kind: 'power' | 'data') => edit(items => items.map(each => each.id !== id ? each : kind === 'data' ? { ...each, dataChannel: NEXT_CHANNEL[each.dataChannel ?? 'wall'] } : { ...each, channel: NEXT_CHANNEL[each.channel] })),
  });
  const stopShowing = useRef(() => { });
  stopShowing.current = () => { setPlaying(false); setActive(null); setPlay(null); };

  useEffect(() => {
    if (!container.current) return;
    const editing = <A extends unknown[]>(fn: (...args: A) => void) => (...args: A) => { stopShowing.current(); fn(...args); };
    const instance = createLabScene(container.current, {
      onSelect: id => handlers.current.select(id),
      onMoveItem: editing((id: string, x: number, z: number) => handlers.current.item(id, x, z)),
      onMoveSocket: editing((id: string, x: number, z: number) => handlers.current.socket(id, x, z)),
      onMoveVia: editing((id: string, x: number, z: number) => handlers.current.via(id, x, z)),
      onPickCable: editing((id: string, kind: 'power' | 'data') => handlers.current.cable(id, kind)),
      onPlayDone: key => onPlayDone.current(key),
    });
    scene.current = instance;
    return () => { scene.current = null; instance.dispose(); };
  }, []);

  useEffect(() => {
    scene.current?.update({
      design: shown, report, mode, xray, selectedId, highlight, changes, play,
      drill: drill ? { arrival: drill.arrival, cols: drill.cols, rows: drill.rows, cell: drill.cell, originX: drill.originX, originZ: drill.originZ, t, people: drill.people.map(({ itemId, path, exitS, blockedS }) => ({ itemId, path, exitS, blockedS })), start: drill.start } : null,
    });
  }, [shown, report, mode, xray, selectedId, highlight, changes, play, drill, t]);

  useEffect(() => {
    if (!drillPlaying || !drill) return;
    let last = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      setT(value => Math.min(drill.endS, value + ((now - last) / 1000) * 3));
      last = now;
    }, 50);
    return () => clearInterval(timer);
  }, [drillPlaying, drill]);
  useEffect(() => { if (drill && t >= drill.endS) setDrillPlaying(false); }, [t, drill]);

  const wiringStep = (index: number) => ['power', 'cables'].includes(steps[index]?.layer ?? '');
  const durationOf = (index: number) => Math.round((wiringStep(index) ? WIRING_MS : STEP_MS) / speed);
  const startPlay = (index: number) => {
    const step = steps[index], from = index === 0 ? origin : steps[index - 1]?.design;
    if (!step || !from) { setPlay(null); return; }
    const fromReport: LabReport = evaluate(from);
    setPlay({ key: `${runId.current}-${index}-${Date.now()}`, from, fromReport, durationMs: durationOf(index), focus: step.itemIds, wiring: wiringStep(index) });
  };
  const [finished, setFinished] = useState<string | null>(null);
  const onPlayDone = useRef((key: string) => setFinished(key));

  useEffect(() => {
    if (!playing || active === null || !play || finished !== play.key) return;
    const timer = setTimeout(() => {
      if (active >= steps.length - 1) { setPlaying(false); setActive(null); setPlay(null); }
      else { setActive(active + 1); startPlay(active + 1); }
    }, HOLD_MS);
    return () => clearTimeout(timer);
  }, [playing, active, play, finished, steps.length]);

  useEffect(() => {
    if (!playing || !play) return;
    const timer = setTimeout(() => setFinished(key => key ?? play.key), play.durationMs + 1500);
    return () => clearTimeout(timer);
  }, [playing, play]);

  const replay = () => { if (steps.length) { setActive(0); setPlaying(true); startPlay(0); } };
  const showOne = (index: number | null) => { setPlaying(false); setActive(index); if (index === null) setPlay(null); else startPlay(index); };
  const toggleDrill = () => { setDrillOn(on => !on); setT(0); setDrillPlaying(false); };
  const reset = () => { abort.current?.abort(); setDesign(createOffice()); setUndo([]); setSummary(null); setActive(null); setPlaying(false); setPlay(null); setSelectedId(null); setHighlight([]); setT(0); setBusy(false); };

  const apply = (run: LabAgentRun, before: LabDesign, local: boolean) => {
    const changed = run.outcome === 'changed' && run.steps.length > 0;
    setSummary({ run, before: evaluate(before), after: evaluate(changed ? run.final : before), local });
    if (!changed) { setActive(null); setPlaying(false); setPlay(null); return; }
    setUndo(list => [...list, before]);
    setDesign(run.final);
    setHighlight([]);
    setOrigin(before);
    runId.current += 1;
    setActive(0);
    setPlaying(true);
    const first = run.steps[0], wiring = ['power', 'cables'].includes(first.layer);
    setPlay({ key: `${runId.current}-0-${Date.now()}`, from: before, fromReport: evaluate(before), durationMs: Math.round((wiring ? WIRING_MS : STEP_MS) / speed), focus: first.itemIds, wiring });
  };

  const ask = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setRequest(trimmed);
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true); setAttempt(1); setPlaying(false); setActive(null); setPlay(null); setHighlight([]); setSelectedId(null);
    try {
      const result = await runLabAgent(trimmed, design, { signal: controller.signal, onAttempt: setAttempt });
      if (!controller.signal.aborted) apply(result, design, false);
    } catch (error) {
      if (!controller.signal.aborted) apply({ source: 'rules', reply: error instanceof Error ? error.message : 'The agent could not answer.', steps: [], attempts: 0, rejected: [], goals: [], limits: [], elapsedMs: 0, final: design, outcome: 'none' }, design, true);
    } finally {
      if (abort.current === controller) { abort.current = null; setBusy(false); }
    }
  }, [busy, design]);

  const stop = () => { abort.current?.abort(); abort.current = null; setBusy(false); };
  const undoLast = () => {
    const previous = undo[undo.length - 1];
    if (!previous) return;
    setDesign(previous); setUndo(list => list.slice(0, -1)); setSummary(null); setActive(null); setPlaying(false); setPlay(null);
  };

  const pickMaterials = (option: { materials: LabDesign['materials'] }) => {
    const before = evaluate(design).meters, final: LabDesign = { ...design, materials: option.materials }, after = evaluate(final).meters;
    const names = (['desk', 'shelf', 'floor'] as const).filter(group => design.materials[group] !== option.materials[group]).map(group => `${group} to ${MATERIALS.find(each => each.id === option.materials[group])?.name ?? group}`);
    const step: LabStep = {
      id: 'materials-switch', title: `Switched ${names.join(', ') || 'materials'}`, layer: 'materials', itemIds: design.items.filter(each => (each.kind === 'desk' && design.materials.desk !== option.materials.desk) || (each.kind === 'shelf' && design.materials.shelf !== option.materials.shelf)).map(each => each.id),
      why: 'You picked this point on the cost and carbon chart.',
      numbers: [`Cost: ${money(before.costGBP)} → ${money(after.costGBP)}`, `Carbon: ${kg(before.carbonKg)} → ${kg(after.carbonKg)}`],
      tradeOff: after.costGBP > before.costGBP ? `+${money(after.costGBP - before.costGBP)}` : undefined,
      design: final,
    };
    apply({ source: 'rules', reply: 'You switched materials from the chart.', steps: [step], attempts: 0, rejected: [], goals: [], limits: [], elapsedMs: 0, final, outcome: 'changed' }, design, true);
  };

  const selected = shown.items.find(each => each.id === selectedId) ?? null;
  const patch = (id: string, change: Partial<LabItem>) => { stopShowing.current(); edit(items => items.map(each => each.id === id ? { ...each, ...change } : each)); };
  const remove = (id: string) => { stopShowing.current(); edit(items => items.filter(each => each.id !== id)); setSelectedId(null); };
  const nameOf = (id: string) => shown.items.find(each => each.id === id)?.name ?? id;
  const problems = report.issues;

  return <div className="lab-page">
    <header className="lab-top">
      <a className="brand" href="/" aria-label="Roomshift home"><Box size={22} strokeWidth={1.3} /><span>ROOMSHIFT<span className="brand-dot">®</span></span></a>
      <div className="space-switch" role="group" aria-label="Space">
        <a className="space-link" href="/" aria-label="Bedroom"><BedDouble size={13} /><span>Bedroom</span></a>
        <a className="space-link" href="/?space=retail" aria-label="Store"><Store size={13} /><span>Store</span></a>
        <a className="space-link active" href="/lab" aria-label="Design Lab" aria-current="page"><FlaskConical size={13} /><span>Design Lab</span></a>
        <a className="space-link" href="/bracket" aria-label="Bracket Lab"><Wrench size={13} /><span>Bracket Lab</span></a>
        <a className="space-link" href="/tower" aria-label="Tower Lab"><Building2 size={13} /><span>Tower Lab</span></a>
      </div>
      <h1>Design Lab</h1>
      <div className="lab-top-actions">
        {undo.length > 0 && <button type="button" className="lab-ghost" onClick={undoLast}><Undo2 size={14} /> Undo</button>}
        <button type="button" className="lab-ghost" onClick={reset}><RotateCcw size={14} /> Start over</button>
      </div>
    </header>
    <p className="lab-intro">An open-plan office for 14 people where every piece uses power, makes heat and costs money and carbon. Ask the agent for a change. It checks the numbers, makes the change and shows you what it did.</p>
    <main className="lab-main">
      <div className="lab-left">
        <div className="lab-toolbar" role="toolbar" aria-label="View">
          <div className="lab-seg" role="group" aria-label="View mode">
            {MODES.map(({ id, label, Icon }) => <button key={id} type="button" aria-pressed={mode === id} className={mode === id ? 'active' : ''} onClick={() => setMode(id)}><Icon size={14} /><span>{label}</span></button>)}
          </div>
          <button type="button" className={`lab-toggle${xray ? ' active' : ''}`} aria-pressed={xray} onClick={() => setXray(on => !on)} title="See through walls to the cables and sockets"><Layers size={14} /><span>X-ray</span></button>
          <button type="button" className={`lab-toggle${drillOn ? ' active' : ''}`} aria-pressed={drillOn} onClick={toggleDrill} title="Watch smoke spread from a fire"><Flame size={14} /><span>Smoke drill</span></button>
          {xray && <ul className="lab-chips" aria-label="Cable colours">
            <li><i style={{ background: '#4fc477' }} />Power OK</li>
            <li><i style={{ background: '#f0b13d' }} />Nearly full</li>
            <li><i style={{ background: '#ee4b3f' }} />Overloaded</li>
            <li><i style={{ background: '#3da5ff' }} />Data</li>
          </ul>}
        </div>
        <div className="lab-scene-wrap">
          <div className="lab-scene" ref={container} aria-label="Office scene" />
          {active !== null && steps[active] && <div className="lab-scene-tag"><Eye size={12} /> Change {active + 1} of {steps.length}: {steps[active].title}</div>}
          {active === null && changes.length > 0 && <div className="lab-scene-tag is-changed">Green numbers mark what the agent changed</div>}
        </div>
        {drillOn && drill && <section className="lab-drill" aria-label="Smoke drill">
          <div className="lab-drill-bar">
            <button type="button" className="lab-icon" aria-label={drillPlaying ? 'Pause smoke drill' : 'Play smoke drill'} onClick={() => { if (!drillPlaying && t >= drill.endS) setT(0); setDrillPlaying(on => !on); }}>{drillPlaying ? <Pause size={14} /> : <Play size={14} />}</button>
            <input type="range" min={0} max={drill.endS} step={0.5} value={t} aria-label="Time in seconds" onChange={event => { setDrillPlaying(false); setT(Number(event.target.value)); }} />
            <output>{seconds(t)} / {seconds(drill.endS)}</output>
            <label className="lab-select">Fire starts at
              <select value={fireSel} onChange={event => { setFireSel(event.target.value); setT(0); }}>
                <option value="auto">Busiest socket</option>
                {shown.sockets.map(socket => <option key={socket.id} value={socket.id}>{socket.name}</option>)}
                {shown.items.filter(each => each.kind === 'coffee').map(each => <option key={each.id} value={each.id}>{each.name}</option>)}
              </select>
            </label>
          </div>
          <ul className="lab-people">
            {drill.people.map(person => {
              const text = person.safe ? `${person.name}: out in ${seconds(person.exitS)}` : person.blockedS !== null && Number.isFinite(person.exitS) ? `${person.name}: smoke reached their way out at ${seconds(person.blockedS)}, ${seconds(person.exitS - person.blockedS)} before they got out` : `${person.name}: no way out`;
              return <li key={person.itemId} className={person.safe ? 'is-safe' : 'is-unsafe'}>{text}</li>;
            })}
          </ul>
          <p className="lab-note">A simple model for showing direction and timing, not a fire safety assessment.</p>
        </section>}
        <LabMeters report={report} />
        <details className="lab-more">
          <summary>Cost vs carbon: every material mix</summary>
          <TradeOffChart options={options} current={report.meters} onPick={pickMaterials} />
        </details>
      </div>
      <aside className="lab-side" aria-label="Agent">
        <form className="lab-agent" onSubmit={event => { event.preventDefault(); void ask(request); }}>
          <label htmlFor="lab-request"><Sparkles size={14} aria-hidden /> Ask the agent</label>
          <textarea id="lab-request" rows={2} value={request} maxLength={300} readOnly={busy} placeholder="For example: add a 2 kW space heater" onChange={event => setRequest(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void ask(request); } }} />
          <div className="lab-agent-row">
            {busy ? <>
              <span className="lab-busy" role="status"><Loader2 size={14} className="lab-spin" aria-hidden />{attempt > 1 ? `Checking try ${attempt} of 3…` : 'Working it out…'}</span>
              <button type="button" className="lab-ghost" onClick={stop}><Square size={11} /> Stop</button>
            </> : <button type="submit" className="lab-primary" disabled={!request.trim()}>Ask</button>}
          </div>
          {!busy && <div className="lab-suggestions">{SUGGESTIONS.map(text => <button key={text} type="button" onClick={() => void ask(text)}>{text}</button>)}</div>}
        </form>
        {summary && !busy && <LabChanges summary={summary} active={active} playing={playing} speed={speed} speeds={SPEEDS} onSpeed={setSpeed} onShow={showOne} onReplay={replay} onUndo={undoLast} />}
        {selected && <section className="lab-inspector" aria-label="Selected piece">
          <h3>{selected.name}</h3>
          <label>Watts<input type="number" min={0} max={5000} step={10} value={selected.watts} onChange={event => patch(selected.id, { watts: Math.max(0, Number(event.target.value) || 0) })} /></label>
          {selected.kind !== 'chair' && selected.kind !== 'shelf' && selected.kind !== 'extinguisher' && selected.kind !== 'ac' && <>
            <label>Socket<select value={selected.socketId ?? ''} onChange={event => patch(selected.id, { socketId: event.target.value || null })}><option value="">Not plugged in</option>{shown.sockets.map(socket => <option key={socket.id} value={socket.id}>{socket.name}</option>)}</select></label>
            <label>Power cable<select value={selected.channel} onChange={event => patch(selected.id, { channel: event.target.value as Channel })}><option value="loose">Loose</option><option value="wall">Wall trunking</option><option value="floor">Under floor</option></select></label>
          </>}
          {selected.kind === 'extinguisher' && <label>Type<select value={selected.extinguisher ?? 'co2'} onChange={event => patch(selected.id, { extinguisher: event.target.value as LabItem['extinguisher'] })}><option value="co2">CO2</option><option value="water">Water</option><option value="foam">Foam</option><option value="powder">Dry powder</option></select></label>}
          {(selected.kind === 'desk' || selected.kind === 'shelf') && <label>{selected.kind === 'desk' ? 'Desk material' : 'Shelf material'}<select value={shown.materials[selected.kind]} onChange={event => { stopShowing.current(); setDesign(d => ({ ...d, materials: { ...d.materials, [selected.kind]: event.target.value } })); }}>{MATERIALS.filter(each => each.group === selected.kind).map(each => <option key={each.id} value={each.id}>{each.name}</option>)}</select></label>}
          {selected.kind === 'shelf' && <label>Load kg<input type="number" min={0} max={300} value={selected.loadKg ?? 0} onChange={event => patch(selected.id, { loadKg: Math.max(0, Number(event.target.value) || 0) })} /></label>}
          <button type="button" className="lab-ghost lab-danger" disabled={selected.locked} onClick={() => remove(selected.id)}><Trash2 size={13} /> Delete</button>
        </section>}
        <section className="lab-issues" aria-label="Problems">
          <h3>{problems.length ? `${problems.length} ${problems.length === 1 ? 'problem' : 'problems'} in this office` : <><CheckCircle2 size={14} aria-hidden /> No problems found</>}</h3>
          {problems.length > 0 && <ul>{problems.map((issue, index) => <li key={`${issue.rule}-${index}`}>
            <button type="button" className={`lab-issue is-${issue.severity}`} aria-pressed={issue.itemIds.length > 0 && issue.itemIds.every(id => highlight.includes(id))} disabled={issue.itemIds.length === 0} title={issue.itemIds.map(nameOf).join(', ')} onClick={() => setHighlight(current => issue.itemIds.every(id => current.includes(id)) ? [] : issue.itemIds)}>
              <b>{RULES[issue.rule]?.title ?? issue.rule}</b><span>{issue.message}</span>
            </button>
          </li>)}</ul>}
          <p className="lab-note">Click a problem to see it in the room. Figures are illustrative, not a code sign-off.</p>
        </section>
      </aside>
    </main>
  </div>;
}
