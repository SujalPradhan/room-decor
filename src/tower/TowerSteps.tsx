import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { formatINR } from './tower';
import type { TowerStep } from './tower-agent';

export function StepList({ steps, running }: { steps: TowerStep[]; running: boolean }) {
  if (steps.length === 0) return null;
  return <section className="tower-steps" aria-label="Steps">
    <h3>Steps{running ? ' (live)' : ''}</h3>
    <ol>
      {steps.map(step => {
        const ok = step.problems.length === 0;
        return <li key={step.n} className={ok ? 'is-ok' : 'is-bad'}>
          {ok ? <CheckCircle2 size={13} aria-hidden /> : <AlertCircle size={13} aria-hidden />}
          <span>Try {step.n} ({step.source === 'agent' ? 'agent plan' : 'built-in rules'}): {step.result.pieces.length} pieces, {formatINR(step.result.costINR)}, {ok ? 'every check passed' : `${step.problems.length} to fix`}
            {step.problems.slice(0, 3).map((p, i) => <small key={i}>{p}</small>)}
          </span>
        </li>;
      })}
      {running && <li><Loader2 size={13} className="lab-spin" aria-hidden /><span>Checking the next layout</span></li>}
    </ol>
  </section>;
}
