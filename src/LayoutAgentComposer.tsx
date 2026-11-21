import { ArrowUp, Loader2, Sparkles, Square, X } from 'lucide-react';
import { forwardRef, useEffect, useRef, useImperativeHandle, useState, type FormEvent } from 'react';
import type { SpaceType } from './types';

export interface LayoutAgentReply { text: string; meta?: string; how?: boolean }
export interface LayoutAgentComposerProps {
  value: string;
  busy: boolean;
  /** Which of the agent's attempts is running. A retry gets a progress line, because it means the checks sent one back. */
  attempt?: number;
  disabled: boolean;
  space: SpaceType;
  hidden: boolean;
  reply: LayoutAgentReply | null;
  canReset: boolean;
  onChange: (value: string) => void;
  onAsk: (request: string) => void;
  onDismiss: () => void;
  onStop: () => void;
}
// Checked against the live agent; wording that repeatedly fails the room checks does not belong here.
const ROOM_SUGGESTIONS = ['I need more space', 'More walking room around the desk', 'Set it up for work and rest'];
const STORE_SUGGESTIONS = ['Make room for an event', 'Guide customers past the testing bars', 'Add another testing bar'];
/** Most answers come within 10 s. Past this, the busy card says the wait is unusual. The agent gives up at 30 s. */
export const SLOW_MS = 12_000;

const LayoutAgentComposer = forwardRef<HTMLInputElement, LayoutAgentComposerProps>(function LayoutAgentComposer({ value, busy, attempt = 1, disabled, space, hidden, reply, canReset, onChange, onAsk, onDismiss, onStop }, ref) {
  const input = useRef<HTMLInputElement>(null);
  const place = space === 'retail' ? 'store' : 'room', suggestions = space === 'retail' ? STORE_SUGGESTIONS : ROOM_SUGGESTIONS;
  const [slow, setSlow] = useState(false);
  useImperativeHandle(ref, () => input.current!);
  useEffect(() => {
    setSlow(false);
    if (!busy) return;
    const timer = setTimeout(() => setSlow(true), SLOW_MS);
    return () => clearTimeout(timer);
  }, [busy]);
  const submit = (event: FormEvent) => { event.preventDefault(); onAsk(value); };
  return <form className="layout-prompt" onSubmit={submit} hidden={hidden} aria-label={place === 'store' ? 'Store agent' : 'Room agent'}>
    <div className="lp-live" aria-live="polite">
      {busy ? <div className="lp-card"><p className="lp-reply is-busy"><Loader2 size={14} className="lp-spin" aria-hidden /> <span>{slow ? 'This is taking longer than usual…' : `Working out the ${place}…`}{attempt > 1 ? <small>Try {attempt} of 3 · fixing what the {place} checks found</small> : slow && <small>Stop any time, or wait a few more seconds.</small>}</span></p><button type="button" className="lp-stop" aria-label={`Stop the ${place} agent`} onClick={() => { onStop(); input.current?.focus(); }}><Square size={10} /> Stop</button></div>
        : reply && <div className="lp-card"><p className="lp-reply">{reply.text}{(reply.meta || reply.how) && <small>{reply.meta}{reply.meta && reply.how && ' · '}{reply.how && <a className="lp-how" href="/how" target="_blank" rel="noopener">How the agent did this</a>}</small>}</p><button type="button" className="lp-dismiss" aria-label="Dismiss agent reply" onClick={() => { onDismiss(); input.current?.focus(); }}><X size={14} /></button></div>}
    </div>
    {!busy && !value && <div className="lp-suggestions">
      {[...suggestions, ...(canReset ? ['Back to the original'] : [])].map(text => <button key={text} type="button" disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={() => { onChange(text); onAsk(text); }}>{text}</button>)}
    </div>}
    <div className="lp-bar">
      <Sparkles size={16} className="lp-mark" aria-hidden />
      <input ref={input} aria-label={`Describe what you want from this ${place}`} value={value} maxLength={200} disabled={disabled} readOnly={busy} placeholder={`Ask the ${place} agent…`} autoComplete="off" onChange={event => onChange(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { if (busy) onStop(); else event.currentTarget.blur(); } }} />
      {!value && <kbd aria-hidden>/</kbd>}
      <button type="submit" className="lp-send" aria-label={`Rearrange the ${place}`} aria-disabled={busy} disabled={!busy && (!value.trim() || disabled)}><ArrowUp size={16} /></button>
    </div>
  </form>;
});
export default LayoutAgentComposer;
