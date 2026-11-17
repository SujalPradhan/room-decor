import { Play, Undo2 } from 'lucide-react';
import type { LabAgentRun } from './lab-agent';
import type { LabReport } from './model';

export interface ChangeSummary { run: LabAgentRun; before: LabReport; after: LabReport; local: boolean }

const money = (value: number) => `£${Math.round(value).toLocaleString('en-GB')}`;
const kg = (value: number) => `${Math.round(value).toLocaleString('en-GB')} kg`;
const key = (issue: LabReport['issues'][number]) => `${issue.rule}|${issue.message}`;
const plain = (line: string) => !/^(Cost|Carbon)\b/.test(line) && !/ issues: /.test(line);

export interface LabChangesProps { summary: ChangeSummary; active: number | null; playing: boolean; onShow(index: number | null): void; onReplay(): void; onUndo(): void }

export default function LabChanges({ summary, active, playing, onShow, onReplay, onUndo }: LabChangesProps) {
  const { run, before, after } = summary;
  const now = new Set(after.issues.map(key)), then = new Set(before.issues.map(key));
  const fixed = before.issues.filter(issue => !now.has(key(issue))).length, added = after.issues.filter(issue => !then.has(key(issue))).length;
  const steps = run.steps;
  return <section className="lab-changes" aria-label="What the agent changed" aria-live="polite">
    <div className="lab-changes-head">
      <h3>{steps.length ? `The agent made ${steps.length} ${steps.length === 1 ? 'change' : 'changes'}` : 'No changes made'}</h3>
      <div className="lab-changes-actions">
        {steps.length > 0 && <button type="button" className="lab-ghost" onClick={onReplay} disabled={playing}><Play size={12} /> Replay</button>}
        {steps.length > 0 && <button type="button" className="lab-ghost" onClick={onUndo}><Undo2 size={12} /> Undo</button>}
      </div>
    </div>
    <p className="lab-changes-reply">{run.reply}</p>
    {steps.length > 0 && <p className="lab-changes-totals">
      {fixed > 0 && <span className="is-good">Fixed {fixed} {fixed === 1 ? 'problem' : 'problems'}</span>}
      {added > 0 && <span className="is-bad">{added} new {added === 1 ? 'problem' : 'problems'}</span>}
      <span>Cost {money(before.meters.costGBP)} → {money(after.meters.costGBP)}</span>
      <span>Carbon {kg(before.meters.carbonKg)} → {kg(after.meters.carbonKg)}</span>
    </p>}
    {steps.length > 0 && <ol className="lab-change-list">
      {steps.map((step, index) => {
        const detail = step.numbers.filter(plain).slice(0, 2);
        return <li key={step.id} className={active === index ? 'is-active' : ''}>
          <button type="button" aria-pressed={active === index} onClick={() => onShow(active === index ? null : index)}>
            <span className="lab-change-n" aria-hidden>{index + 1}</span>
            <span className="lab-change-body">
              <strong>{step.title}</strong>
              <span className="lab-change-why">{step.why}</span>
              {detail.length > 0 && <span className="lab-change-detail">{detail.join(' · ')}</span>}
              {step.tradeOff && <span className="lab-change-cost">Costs {step.tradeOff}</span>}
            </span>
          </button>
        </li>;
      })}
    </ol>}
    {run.limits.length > 0 && <p className="lab-changes-limit"><strong>Not checked</strong> {run.limits.join(' ')}</p>}
    {run.source === 'rules' && !summary.local && <small className="lab-changes-note">Answered by fixed rules because the agent's tries did not pass the checks.</small>}
  </section>;
}
