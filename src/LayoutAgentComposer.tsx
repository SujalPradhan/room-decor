import { ArrowUp, Loader2, Sparkles, Square, X } from 'lucide-react';
import { forwardRef, useRef, useImperativeHandle, type FormEvent } from 'react';

export interface LayoutAgentReply { text: string; meta?: string }
export interface LayoutAgentComposerProps {
  value: string;
  busy: boolean;
  disabled: boolean;
  hidden: boolean;
  reply: LayoutAgentReply | null;
  canReset: boolean;
  onChange: (value: string) => void;
  onAsk: (request: string) => void;
  onDismiss: () => void;
  onStop: () => void;
}
// Checked against the live agent; wording that repeatedly fails the room checks does not belong here.
const SUGGESTIONS = ['I need more space', 'More walking room around the desk', 'Set it up for work and rest'];

const LayoutAgentComposer = forwardRef<HTMLInputElement, LayoutAgentComposerProps>(function LayoutAgentComposer({ value, busy, disabled, hidden, reply, canReset, onChange, onAsk, onDismiss, onStop }, ref) {
  const input = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => input.current!);
  const submit = (event: FormEvent) => { event.preventDefault(); onAsk(value); };
  return <form className="layout-prompt" onSubmit={submit} hidden={hidden} aria-label="Room agent">
    <div className="lp-live" aria-live="polite">
      {busy ? <div className="lp-card"><p className="lp-reply is-busy"><Loader2 size={14} className="lp-spin" aria-hidden /> Working out the room…</p><button type="button" className="lp-stop" aria-label="Stop the room agent" onClick={() => { onStop(); input.current?.focus(); }}><Square size={10} /> Stop</button></div>
        : reply && <div className="lp-card"><p className="lp-reply">{reply.text}{reply.meta && <small>{reply.meta}</small>}</p><button type="button" className="lp-dismiss" aria-label="Dismiss agent reply" onClick={() => { onDismiss(); input.current?.focus(); }}><X size={14} /></button></div>}
    </div>
    {!busy && !value && <div className="lp-suggestions">
      {[...SUGGESTIONS, ...(canReset ? ['Back to the original'] : [])].map(text => <button key={text} type="button" disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={() => { onChange(text); onAsk(text); }}>{text}</button>)}
    </div>}
    <div className="lp-bar">
      <Sparkles size={16} className="lp-mark" aria-hidden />
      <input ref={input} aria-label="Describe what you want from this room" value={value} maxLength={200} disabled={disabled} readOnly={busy} placeholder="Ask the room agent…" autoComplete="off" onChange={event => onChange(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { if (busy) onStop(); else event.currentTarget.blur(); } }} />
      {!value && <kbd aria-hidden>/</kbd>}
      <button type="submit" className="lp-send" aria-label="Rearrange the room" aria-disabled={busy} disabled={!busy && (!value.trim() || disabled)}><ArrowUp size={16} /></button>
    </div>
  </form>;
});
export default LayoutAgentComposer;
