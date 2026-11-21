import { CheckCircle2, XCircle } from 'lucide-react';
import type { Iteration } from './bracket-agent';

export function headline(iteration: Iteration) {
  if (iteration.failed.length === 0) return `Try ${iteration.n}: no failed clauses`;
  const first = iteration.failed[0];
  const more = iteration.failed.length > 1 ? ` and ${iteration.failed.length - 1} more` : '';
  return `Try ${iteration.n}: failed ${first.title} (${first.value} vs ${first.limit})${more}`;
}

export default function BracketIterations({ iterations, active, running, onPick }: { iterations: Iteration[]; active: number | null; running: boolean; onPick: (index: number) => void }) {
  if (iterations.length === 0) return null;
  return <section className="bracket-iterations" aria-label="Iterations">
    <h3>Iterations{running ? ' (live)' : ''}</h3>
    <ol>
      {iterations.map((iteration, index) => {
        const ok = iteration.failed.length === 0;
        const whys = iteration.whys.slice(0, 4);
        return <li key={iteration.n}>
          <button type="button" className={`bracket-iteration ${ok ? 'is-ok' : 'is-bad'}`} aria-pressed={active === index} onClick={() => onPick(index)}>
            <span className="bracket-iteration-head">{ok ? <CheckCircle2 size={14} aria-hidden /> : <XCircle size={14} aria-hidden />}<b>{headline(iteration)}</b></span>
            {whys.length > 0 && <ul>{whys.map((why, i) => <li key={i}>{why}</li>)}</ul>}
          </button>
        </li>;
      })}
    </ol>
  </section>;
}
