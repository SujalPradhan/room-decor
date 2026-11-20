import { BedDouble, Box, ChevronDown, FlaskConical, Loader2, RotateCcw, Sparkles, Square, Store, Undo2, Wrench } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import BracketIterations from './BracketIterations';
import BracketReport from './BracketReport';
import { runBracketAgent, type Iteration } from './bracket-agent';
import { createBracketScene } from './bracket-scene';
import { clampDesign, reportMarkdown, verify, type Approval } from './engine';
import { exportStl } from './mesh';
import type { BracketDesign, BracketId } from './model';
import { ASSUMPTIONS, CTS, MASS_TARGET_G, MATERIALS, MIN_FREQ_HZ, KICK_N, STARTING } from './spec';
import './bracket.css';
import '../lab/lab.css';

const KEY = 'roomshift-bracket-v2';
const HOLD_MS = 3000;
const MORPH_MS = 2600;
const SUGGESTIONS = ['Make it lighter', 'Use aluminium', 'Why not stamped steel?'];
const SIDES: { id: BracketId; label: string }[] = [{ id: 'rh', label: 'RH' }, { id: 'lh', label: 'LH' }];
const CTS_NUMBERS: [string, string][] = [
  ['Seat inertia (20G)', '7,456 N'],
  ['Belt pulls', '13.5 kN lap + 13.5 kN shoulder'],
  ['Foot kick', '3,500 N'],
  ['First mode', '32 Hz'],
  ['Mass', '0.68 kg'],
  ['Piece price', '$2.45'],
  ['Reference material', 'HSLA 420, 2.5 mm'],
];

interface Saved { design: BracketDesign; approval: Approval | null }

function load(): Saved {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (parsed?.design) {
      const a = parsed.approval;
      const approval = a && (a.decision === 'approved' || a.decision === 'changes') && typeof a.by === 'string' && typeof a.date === 'string' ? a as Approval : null;
      return { design: clampDesign(parsed.design), approval };
    }
  } catch { }
  return { design: { ...STARTING }, approval: null };
}

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const download = (name: string, data: BlobPart, type: string) => {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement('a');
  link.href = url; link.download = name;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
const fmt = (value: number) => Math.round(value).toLocaleString('en-US');

export default function BracketPage() {
  const [saved, setSaved] = useState<Saved>(load);
  const { design, approval } = saved;
  const [undo, setUndo] = useState<BracketDesign[]>([]);
  const [side, setSide] = useState<BracketId>('rh');
  const [showLoad, setShowLoad] = useState(true);
  const [showPrint, setShowPrint] = useState(false);
  const [request, setRequest] = useState('');
  const [busy, setBusy] = useState(false);
  const [iterations, setIterations] = useState<Iteration[]>([]);
  const [active, setActive] = useState<number | null>(null);
  const [reply, setReply] = useState<string | null>(null);
  const [limits, setLimits] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [morph, setMorph] = useState<{ key: string; ms: number } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const queue = useRef<Iteration[]>([]);
  const pumping = useRef(false);
  const runId = useRef(0);
  const iterationCount = useRef(0);
  const container = useRef<HTMLDivElement>(null);
  const scene = useRef<ReturnType<typeof createBracketScene> | null>(null);

  const shownIteration = active !== null ? iterations[active] : null;
  const shownDesign = shownIteration ? shownIteration.design : design;
  const verification = useMemo(() => shownIteration ? shownIteration.verification : verify(design), [shownIteration, design]);
  const material = MATERIALS[shownDesign.material];
  const d = verification.derived;

  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch { } }, [saved]);

  useEffect(() => {
    if (!container.current) return;
    const instance = createBracketScene(container.current);
    scene.current = instance;
    return () => { scene.current = null; instance.dispose(); };
  }, []);

  useEffect(() => {
    scene.current?.update({
      design: shownDesign, side, verification, showLoad, showPrint,
      morphMs: morph?.ms, key: morph?.key ?? `${side}-${shownIteration ? shownIteration.n : 'base'}`,
    });
  }, [shownDesign, side, verification, showLoad, showPrint, morph, shownIteration]);

  const setDesign = (next: BracketDesign) => setSaved({ design: next, approval: null });

  const pump = async (id: number) => {
    if (pumping.current) return;
    pumping.current = true;
    while (queue.current.length && runId.current === id) {
      const next = queue.current.shift()!;
      setIterations(list => { setActive(list.length); return [...list, next]; });
      setMorph({ key: `run-${id}-${next.n}`, ms: MORPH_MS });
      await wait(HOLD_MS);
    }
    pumping.current = false;
  };
  const drained = async (id: number) => {
    while (runId.current === id && (queue.current.length || pumping.current)) await wait(100);
  };

  const ask = async (text: string) => {
    const trimmed = text.trim();
    if (busy) return;
    const prompt = trimmed || 'Design the riser pair';
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    runId.current += 1;
    const id = runId.current;
    queue.current = [];
    pumping.current = false;
    setBusy(true); setError(null); setReply(null); setIterations([]); setActive(null); setMorph(null);
    const before = design;
    try {
      const result = await runBracketAgent(prompt, before, { signal: controller.signal, onIteration: iteration => { queue.current.push(iteration); void pump(id); } });
      await drained(id);
      if (controller.signal.aborted) return;
      iterationCount.current += result.iterations.length;
      setUndo(list => [...list, before]);
      setDesign(result.design);
      setIterations(result.iterations);
      setActive(null);
      setMorph({ key: `run-${id}-final`, ms: MORPH_MS });
      setReply(result.reply); setLimits(result.limits);
    } catch (problem) {
      if (!controller.signal.aborted) setError(problem instanceof Error ? problem.message : 'The agent could not answer.');
    } finally {
      if (abort.current === controller) { abort.current = null; setBusy(false); }
    }
  };

  const stop = () => { abort.current?.abort(); abort.current = null; runId.current += 1; queue.current = []; pumping.current = false; setBusy(false); setActive(null); };
  const reset = () => { stop(); setDesign({ ...STARTING }); setUndo([]); setIterations([]); setReply(null); setError(null); setMorph(null); iterationCount.current = 0; };
  const undoLast = () => {
    const previous = undo[undo.length - 1];
    if (!previous) return;
    stop(); setDesign(previous); setUndo(list => list.slice(0, -1)); setIterations([]); setReply(null); setMorph({ key: `undo-${Date.now()}`, ms: 800 });
  };
  const pickIteration = (index: number) => { setActive(index); setMorph({ key: `pick-${iterations[index].n}-${Date.now()}`, ms: 900 }); };

  const decide = (decision: Approval['decision'], by: string, note: string) =>
    setSaved(s => ({ ...s, approval: { decision, by, date: new Date().toISOString().slice(0, 10), ...(note ? { note } : {}) } }));
  const clearApproval = () => setSaved(s => ({ ...s, approval: null }));

  const stl = (id: BracketId) => download(`riser-${id}.stl`, exportStl(shownDesign, id), 'model/stl');
  const markdown = () => download('riser-verification-report.md', reportMarkdown(verification, { date: new Date().toISOString().slice(0, 10), iterations: Math.max(iterationCount.current, iterations.length), approval: shownIteration ? null : approval }), 'text/markdown');

  const keyNumbers = [
    { label: 'Material', value: material.short, note: `${material.process}, ${shownDesign.orientation}`, bad: false },
    { label: 'Mass', value: `${fmt(d.massG)} g`, note: `target ${MASS_TARGET_G} g`, bad: d.massG > MASS_TARGET_G },
    { label: 'First mode', value: `${d.frequencyHz.toFixed(1)} Hz`, note: `at least ${MIN_FREQ_HZ} Hz`, bad: d.frequencyHz < MIN_FREQ_HZ },
    { label: 'Foot-kick capacity', value: `${fmt(d.kickCapacityN)} N`, note: `at least ${fmt(KICK_N)} N`, bad: d.kickCapacityN < KICK_N },
    { label: 'Prototype cost', value: `$${d.unitCostUSD.toFixed(2)}`, note: 'each, printed', bad: false },
  ];

  const reportLabel = shownIteration ? `Showing try ${shownIteration.n}` : iterations.length ? 'Showing the final design' : undo.length ? 'Showing the current design' : 'Showing the starting design';

  return <div className="lab-page bracket-page">
    <header className="lab-top">
      <a className="brand" href="/" aria-label="Roomshift home"><Box size={22} strokeWidth={1.3} /><span>ROOMSHIFT<span className="brand-dot">®</span></span></a>
      <div className="space-switch" role="group" aria-label="Space">
        <a className="space-link" href="/" aria-label="Bedroom"><BedDouble size={13} /><span>Bedroom</span></a>
        <a className="space-link" href="/?space=retail" aria-label="Store"><Store size={13} /><span>Store</span></a>
        <a className="space-link" href="/lab" aria-label="Design Lab"><FlaskConical size={13} /><span>Design Lab</span></a>
        <a className="space-link active" href="/bracket" aria-label="Bracket Lab" aria-current="page"><Wrench size={13} /><span>Bracket Lab</span></a>
      </div>
      <h1>Bracket Lab</h1>
      <div className="lab-top-actions">
        {undo.length > 0 && <button type="button" className="lab-ghost" onClick={undoLast}><Undo2 size={14} /> Undo</button>}
        <button type="button" className="lab-ghost" onClick={reset}><RotateCcw size={14} /> Start over</button>
      </div>
    </header>
    <p className="lab-intro">An automotive client sent a component spec ({CTS.id}) for a seat riser bracket pair and wants it 3D-printable. The design agent designs it, checks every clause and hands over a verification report for approval.</p>
    <main className="lab-main">
      <div className="lab-left">
        <div className="lab-toolbar" role="toolbar" aria-label="View">
          <div className="lab-seg" role="group" aria-label="Side">
            {SIDES.map(s => <button key={s.id} type="button" aria-pressed={side === s.id} className={side === s.id ? 'active' : ''} onClick={() => setSide(s.id)}>{s.label}</button>)}
          </div>
          <button type="button" className={`lab-toggle${showLoad ? ' active' : ''}`} aria-pressed={showLoad} onClick={() => setShowLoad(on => !on)}>Loads</button>
          <button type="button" className={`lab-toggle${showPrint ? ' active' : ''}`} aria-pressed={showPrint} onClick={() => setShowPrint(on => !on)}>Print view</button>
          <button type="button" className="lab-ghost" onClick={() => scene.current?.resetView()}>Reset view</button>
        </div>
        <div className="lab-scene-wrap">
          <div className="lab-scene bracket-scene" ref={container} role="img" aria-label={`3D view of the ${side.toUpperCase()} riser bracket`} />
          {shownIteration && <div className="lab-scene-tag">{busy ? 'Watching' : 'Showing'} try {shownIteration.n}</div>}
        </div>
        <section className="bracket-numbers" aria-label="Key numbers">
          <h2>Key numbers</h2>
          <dl>
            {keyNumbers.map(item => <div key={item.label} className={item.bad ? 'is-bad' : 'is-good'}>
              <dt>{item.label}</dt><dd>{item.value}</dd><small>{item.note}</small>
            </div>)}
          </dl>
        </section>
      </div>
      <aside className="lab-side" aria-label="Agent">
        <details className="lab-more bracket-brief" open>
          <summary>Client spec</summary>
          <dl>
            <div><dt>CTS</dt><dd>{CTS.id}</dd></div>
            <div><dt>Component</dt><dd>{CTS.component}</dd></div>
            <div><dt>Vehicle</dt><dd>{CTS.vehicle}</dd></div>
            <div><dt>Classification</dt><dd>{CTS.classification}</dd></div>
            <div><dt>Key numbers from the CTS</dt><dd className="bracket-cts">{CTS_NUMBERS.map(([k, v]) => <span key={k}><b>{k}</b> {v}</span>)}</dd></div>
            <div><dt>Our assumptions</dt><dd><ul className="bracket-list">{ASSUMPTIONS.map(text => <li key={text}>{text}</li>)}</ul></dd></div>
          </dl>
        </details>
        <form className="lab-agent" onSubmit={event => { event.preventDefault(); void ask(request); }}>
          <label htmlFor="bracket-request"><Sparkles size={14} aria-hidden /> Design agent</label>
          {busy ? <div className="bracket-busy">
            <span className="lab-busy" role="status"><Loader2 size={14} className="lab-spin" aria-hidden />The agent is designing and checking…</span>
            <button type="button" className="lab-ghost" onClick={stop}><Square size={11} /> Stop</button>
          </div> : <button type="submit" className="lab-primary bracket-go">Design the riser pair</button>}
          <div className="lab-suggestions" aria-label="Suggestions">{SUGGESTIONS.map(text => <button key={text} type="button" disabled={busy} onClick={() => { setRequest(text); void ask(text); }}>{text}</button>)}</div>
          <textarea id="bracket-request" rows={2} value={request} maxLength={300} readOnly={busy} placeholder="Or ask for something specific" onChange={event => setRequest(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void ask(request); } }} />
          {error && <p className="bracket-error" role="alert">{error}</p>}
        </form>
        <BracketIterations iterations={iterations} active={active} running={busy} onPick={pickIteration} />
        {reply && !busy && <section className="bracket-reply" aria-label="Agent reply"><h3>Agent reply</h3><p>{reply}</p>{limits && <p className="lab-note">{limits}</p>}{iterations.length > 0 && <p className="lab-note">Click a try above to see that version in 3D.</p>}</section>}
        {!busy && iterations.length > 0 && active !== null && <button type="button" className="lab-ghost" onClick={() => { setActive(null); setMorph({ key: `final-${Date.now()}`, ms: 900 }); }}><ChevronDown size={14} aria-hidden /> Back to the final design</button>}
      </aside>
      <BracketReport verification={verification} label={reportLabel} approval={shownIteration ? null : approval} canDecide={!shownIteration && !busy} onDecide={decide} onClearApproval={clearApproval} onStl={stl} onMarkdown={markdown} />
    </main>
  </div>;
}
