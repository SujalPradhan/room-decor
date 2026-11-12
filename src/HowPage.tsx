import { ArrowLeft, Check, Eye, Ruler, ScanSearch, ShieldCheck, Sparkles, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { readRun, type AgentRunRecord } from './agent-run';
import { GOALS } from './layout-goals';
import './how-page.css';

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const when = (at: number) => new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

interface Stage { icon: ReactNode; title: string; body: string; run?: ReactNode; skipped?: boolean }

function stages(run: AgentRunRecord | null): Stage[] {
  const place = run?.space === 'room' ? 'room' : 'store', agent = run?.source === 'agent', checked = agent && run.outcome !== 'decline';
  const lastAttemptFailed = agent && run.rejected.length >= (run.attempts ?? 0);
  return [
    {
      icon: <Eye size={18} />, title: 'Reads what you asked',
      body: place === 'room' ? 'The agent works out what you are really after, such as more space, a place to work or less clutter, and changes only what serves that.' : 'The agent works out what you are really after and names the goals it can measure: sales, browsing, finding products, stock, checkout or wheelchair access. It also says plainly what a floor plan cannot tell it, such as theft, how a store feels, or footfall and sales figures.',
      run: run && <>
        <p className="hp-quote">“{run.request}”</p>
        <p>{run.goals.length ? <>Goals it will measure: {run.goals.map(goal => <span key={goal} className="hp-chip">{GOALS[goal].heading.replace(/^Toward /, '')}</span>)}</> : 'No measurable goal named, so changes are explained by open floor, crowded spots and how far shoppers walk.'}</p>
        {run.limits.map(limit => <p key={limit} className="hp-limit"><strong>Not measured</strong> {limit}</p>)}
      </>,
    },
    {
      icon: <ScanSearch size={18} />, title: `Looks at your ${place}`,
      body: `Your browser sends a compact description of the ${place}: its size and door, each piece’s position and size, and your saved layouts. No images and nothing about you.`,
      run: run && <p>{run.size.width} × {run.size.depth} m {run.space === 'room' ? 'room' : 'store'} · {run.pieces} pieces · {run.layouts} saved {run.layouts === 1 ? 'layout' : 'layouts'}</p>,
    },
    {
      icon: <Sparkles size={18} />, title: 'Proposes changes',
      body: 'A language model suggests moves, removals, additions and colours. Each change comes with a reason and a short why, or it picks a saved layout that already does the job.',
      skipped: run?.source === 'rules',
      run: run && (agent ? <p>{run.model} via {run.provider}{run.elapsedMs !== undefined && ` · answered in ${seconds(run.elapsedMs)}`}</p> : <p>The agent was not available ({run.note?.toLowerCase()}), so fixed keyword rules answered instead.</p>),
    },
    {
      icon: <ShieldCheck size={18} />, title: 'Checks every change in your browser',
      body: `Nothing the model says is taken on trust. Each proposal is checked here: ${place === 'room' ? 'no overlapping pieces, the chair kept at the desk, walking space in front of the wardrobe and door' : 'no overlapping pieces, a 1.2 m aisle from the door to every counter, bar and cabin, room in front of displays, the checkout kept'} and locked pieces left alone. Pieces are nudged to the nearest clear spot. Problems go back to the model, up to three tries within 30 seconds.`,
      skipped: run?.source === 'rules',
      run: run && agent && <>
        {run.rejected.map((problems, index) => <p key={index} className="hp-attempt is-rejected"><X size={14} aria-hidden /> <span><strong>Try {index + 1} sent back:</strong> {problems.join(' ')}</span></p>)}
        {checked && !lastAttemptFailed && <p className="hp-attempt is-passed"><Check size={14} aria-hidden /> <span><strong>Try {run.attempts} passed</strong>{run.changes ? `: ${run.changes} ${run.changes === 1 ? 'change' : 'changes'} cleared the checks.` : '.'}</span></p>}
        {lastAttemptFailed && <p className="hp-attempt is-rejected"><X size={14} aria-hidden /> <span>No try passed, so {run.outcome === 'use_layout' ? `it chose the saved layout with the most open floor${run.layoutName ? `: ${run.layoutName}` : ''}` : 'nothing changed'}.</span></p>}
        {run.outcome === 'decline' && !run.rejected.length && <p className="hp-attempt"><span>The agent declined, so there was nothing to check.</span></p>}
      </>,
    },
    {
      icon: <Ruler size={18} />, title: 'Measures and explains',
      body: 'Every step is measured as it plays: open floor, crowded spots and the measures for each goal. The walkthrough shows a short why on every step, and a fuller reason when you open it. Costs are labelled as trade-offs, never as reasons.',
      run: run && <p>{run.layoutName ? <>Result: <strong>{run.layoutName}</strong>. </> : null}{run.reply}</p>,
    },
  ];
}

export default function HowPage() {
  const [run, setRun] = useState<AgentRunRecord | null>(null);
  useEffect(() => { setRun(readRun()); document.title = 'How the agent works · Roomshift'; }, []);
  return <main className="how-page">
    <header className="hp-header">
      <a className="hp-back" href="/"><ArrowLeft size={16} aria-hidden /> Back to the studio</a>
      <span className="hp-eyebrow">How it works</span>
      <h1>How the agent turns a request into a layout</h1>
      <p className="hp-lede">Five steps, from your words to a walkthrough you approve. {run ? <>Below each step is what happened on your latest request, {when(run.at)}.</> : 'Ask the agent something in the studio to see your own request traced here.'}</p>
    </header>
    <ol className="hp-stages">
      {stages(run).map((stage, index) => <li key={stage.title} className={stage.skipped ? 'is-skipped' : ''}>
        <span className="hp-number" aria-hidden>{stage.icon}</span>
        <div>
          <h2><span className="hp-step">Step {index + 1}</span> {stage.title}{stage.skipped && <span className="hp-skipped">Skipped this time</span>}</h2>
          <p className="hp-body">{stage.body}</p>
          {stage.run && <div className="hp-run" aria-label={`Your request, step ${index + 1}`}><span className="hp-run-label">Your request</span>{stage.run}</div>}
        </div>
      </li>)}
    </ol>
    <footer className="hp-footer">
      <p><strong>You decide.</strong> Nothing is saved until the walkthrough finishes, and undo brings back the layout you had.</p>
    </footer>
  </main>;
}
