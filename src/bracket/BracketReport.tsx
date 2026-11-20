import { ChevronDown, ChevronRight, Download, Printer } from 'lucide-react';
import { Fragment, useState } from 'react';
import { ASSUMPTIONS, MASS_TARGET_G } from './spec';
import { STATUS_WORD, referenceMassG, tally, type Approval } from './engine';
import type { BracketId, CheckResult, Status, Verification } from './model';

const SECTIONS: { key: string; title: string }[] = [
  { key: '1', title: '1 Packaging and interfaces' },
  { key: '2', title: '2 Load cases' },
  { key: '3', title: '3 Durability' },
  { key: '4', title: '4 Material, process and cost' },
  { key: 'AM', title: 'AM Additive manufacturing (firm rules)' },
];
const DELIVERABLES = [
  '3D CAD: STL of RH and LH supplied. Native CATIA V5 / NX and the 2D GD&T drawing are not produced yet.',
  'LS-DYNA crash report: not produced; hand analysis only.',
  'AutoForm formability: not applicable to a printed part (see the process deviation).',
  'DFMEA and tolerance stack-up: not produced yet.',
];
const sectionOf = (check: CheckResult) => check.clause === 'AM' ? 'AM' : check.clause[0];

export function summaryLine(verification: Verification) {
  const n = tally(verification);
  return `${n.pass} pass · ${n.fail} fail · ${n.test} need test · ${n.deviation} deviation${n.deviation === 1 ? '' : 's'}`;
}

function ReportTable({ title, checks }: { title: string; checks: CheckResult[] }) {
  const [open, setOpen] = useState<string[]>([]);
  const toggle = (id: string) => setOpen(list => list.includes(id) ? list.filter(each => each !== id) : [...list, id]);
  return <div className="bracket-report-block">
    <h3>{title}</h3>
    <div className="bracket-table-wrap">
      <table className="bracket-table">
        <thead><tr><th scope="col">CTS clause</th><th scope="col">Requirement</th><th scope="col">Method</th><th scope="col">Result</th><th scope="col">Limit</th><th scope="col">Status</th></tr></thead>
        <tbody>
          {checks.map(check => {
            const expanded = open.includes(check.id);
            return <Fragment key={check.id}>
              <tr className={`bracket-row is-${check.status}`}>
                <td data-label="CTS clause">{check.clause}</td>
                <td data-label="Requirement">
                  <button type="button" className="bracket-expand" aria-expanded={expanded} onClick={() => toggle(check.id)}>
                    {expanded ? <ChevronDown size={13} aria-hidden /> : <ChevronRight size={13} aria-hidden />}
                    <span><b>{check.title}</b><small>{check.id}</small></span>
                  </button>
                </td>
                <td data-label="Method">{check.method}</td>
                <td data-label="Result">{check.value}</td>
                <td data-label="Limit">{check.limit}</td>
                <td data-label="Status"><span className={`bracket-badge is-${check.status}`}>{STATUS_WORD[check.status]}</span></td>
              </tr>
              {expanded && <tr className="bracket-working">
                <td colSpan={6}>
                  <p className="bracket-working-title">Working</p>
                  {check.working.length > 0 ? <ul>{check.working.map((line, index) => <li key={index}>{line}</li>)}</ul> : <p>No calculation needed.</p>}
                  <p className="bracket-basis">Basis: {check.basis}</p>
                </td>
              </tr>}
            </Fragment>;
          })}
        </tbody>
      </table>
    </div>
  </div>;
}

interface Props {
  verification: Verification;
  label: string;
  approval: Approval | null;
  canDecide: boolean;
  onDecide: (decision: Approval['decision'], by: string, note: string) => void;
  onClearApproval: () => void;
  onStl: (bracket: BracketId) => void;
  onMarkdown: () => void;
}

function ApprovalPanel({ verification, approval, canDecide, onDecide, onClearApproval }: Pick<Props, 'verification' | 'approval' | 'canDecide' | 'onDecide' | 'onClearApproval'>) {
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const failing = !verification.passed;
  const blocked = failing || !canDecide;
  const reason = failing ? 'Approval is switched off while any clause fails. Ask the agent to fix the failures first.' : !canDecide ? 'Go back to the final design to record a decision.' : '';
  return <section className="bracket-approval" aria-label="Client approval">
    <h3>Client approval</h3>
    {approval && <p className={`bracket-decision is-${approval.decision}`} role="status">
      {approval.decision === 'approved' ? 'Approved' : 'Changes requested'} by {approval.by} on {approval.date}.{approval.note ? ` Note: ${approval.note}` : ''}
      <button type="button" className="lab-ghost" onClick={onClearApproval}>Clear decision</button>
    </p>}
    <div className="bracket-approval-form">
      <label htmlFor="bracket-approver">Your name</label>
      <input id="bracket-approver" type="text" value={name} maxLength={80} autoComplete="name" onChange={event => setName(event.target.value)} />
      <label htmlFor="bracket-approval-note">Note (for changes)</label>
      <textarea id="bracket-approval-note" rows={2} value={note} maxLength={300} onChange={event => setNote(event.target.value)} />
    </div>
    <div className="bracket-approval-actions">
      <button type="button" className="lab-primary" disabled={blocked || !name.trim()} aria-describedby="bracket-approval-why" onClick={() => onDecide('approved', name.trim(), note.trim())}>Approve design</button>
      <button type="button" className="lab-ghost" disabled={!canDecide || !name.trim() || !note.trim()} onClick={() => onDecide('changes', name.trim(), note.trim())}>Request changes</button>
    </div>
    <p id="bracket-approval-why" className="lab-note">{reason || (!name.trim() ? 'Enter your name to record a decision. Requesting changes also needs a note.' : 'Approving covers the analysis and inspection results; open tests and deviations remain yours to close.')}</p>
  </section>;
}

export default function BracketReport({ verification, label, approval, canDecide, onDecide, onClearApproval, onStl, onMarkdown }: Props) {
  const n = tally(verification);
  const chips: { status: Status; count: number; text: string }[] = [
    { status: 'pass', count: n.pass, text: 'PASS' },
    { status: 'fail', count: n.fail, text: 'FAIL' },
    { status: 'test', count: n.test, text: 'NEEDS TEST' },
    { status: 'deviation', count: n.deviation, text: 'DEVIATION' },
  ];
  return <section className="bracket-report" aria-label="Verification report">
    <div className="bracket-report-head">
      <div>
        <h2>Verification report</h2>
        <p className="bracket-report-for">{label}</p>
      </div>
      <div className="bracket-report-actions">
        <button type="button" className="lab-ghost" onClick={onMarkdown}><Download size={14} aria-hidden /> Download report (.md)</button>
        <button type="button" className="lab-ghost" onClick={() => onStl('rh')}><Download size={14} aria-hidden /> Download STL RH</button>
        <button type="button" className="lab-ghost" onClick={() => onStl('lh')}><Download size={14} aria-hidden /> Download STL LH</button>
        <button type="button" className="lab-ghost" onClick={() => window.print()}><Printer size={14} aria-hidden /> Print report</button>
      </div>
    </div>
    <ul className="bracket-summary" aria-label="Summary">
      {chips.map(chip => <li key={chip.status} className={`is-${chip.status}`}>{chip.count} {chip.text}</li>)}
    </ul>
    <p className="bracket-summary-line">{summaryLine(verification)}</p>
    <p className="bracket-caveat"><strong>Analysis and inspection only.</strong> Not a claim of compliance: tests need CAE or physical testing, deviations need your approval.</p>
    <p className="bracket-query"><strong>Query to the client.</strong> The CTS steel reference part weighs about {Math.round(referenceMassG())} g at this riser size, against the {MASS_TARGET_G} g target. Please confirm the target or the riser size.</p>
    {SECTIONS.map(section => {
      const checks = verification.checks.filter(check => sectionOf(check) === section.key);
      return checks.length ? <ReportTable key={section.key} title={section.title} checks={checks} /> : null;
    })}
    <div className="bracket-report-block">
      <h3>Deliverables against CTS section 5</h3>
      <ul className="bracket-list">{DELIVERABLES.map(text => <li key={text}>{text}</li>)}</ul>
    </div>
    <div className="bracket-report-block">
      <h3>Assumptions</h3>
      <ul className="bracket-list">{ASSUMPTIONS.map(text => <li key={text}>{text}</li>)}</ul>
    </div>
    <ApprovalPanel verification={verification} approval={approval} canDecide={canDecide} onDecide={onDecide} onClearApproval={onClearApproval} />
  </section>;
}
