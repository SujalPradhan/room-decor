import { Check, Copy, Eye, Link2, Users } from 'lucide-react';
import { useState } from 'react';
import { shareLink, type RoomStatus } from './tower-share';

export function SharePanel({ code, guests, status }: { code: string; guests: number; status: RoomStatus }) {
  const [copied, setCopied] = useState(false);
  const link = shareLink(window.location.origin, code);
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); } catch {
      const el = document.getElementById('tower-share-link') as HTMLInputElement | null;
      el?.select(); try { document.execCommand('copy'); } catch { }
    }
    setCopied(true); setTimeout(() => setCopied(false), 1600);
  };
  return <section className="tower-share" aria-label="Share tour">
    <Link2 size={14} aria-hidden />
    <input id="tower-share-link" className="tower-share-link" readOnly value={link} aria-label="Share link" onFocus={e => e.currentTarget.select()} />
    <button type="button" className="lab-ghost" onClick={copy}>{copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}{copied ? 'Copied' : 'Copy link'}</button>
    <span className="tower-share-count" role="status"><Users size={14} aria-hidden />{status === 'open' ? `${guests} ${guests === 1 ? 'guest' : 'guests'}` : status === 'failed' ? 'Offline' : 'Connecting'}</span>
  </section>;
}

export function GuestBanner({ status, following, hostPresent, onToggle }: { status: RoomStatus; following: boolean; hostPresent: boolean; onToggle(): void }) {
  const failed = status === 'failed' || status === 'closed';
  const text = failed ? 'Could not join this tour. The link may have expired.'
    : status !== 'open' ? 'Joining the tour'
      : !hostPresent ? 'Host left. You can keep exploring.'
        : following ? 'Following the host' : 'Exploring on your own';
  return <section className={`tower-guest${hostPresent && !failed ? '' : ' is-off'}`} aria-label="Guest tour">
    <Eye size={14} aria-hidden /><b role="status">{text}</b>
    {failed ? <a className="lab-ghost" href="/tower">Open Tower Lab</a>
      : <button type="button" className="lab-primary" disabled={status !== 'open'} aria-pressed={!following} onClick={onToggle}>{following ? 'Explore on my own' : 'Follow host'}</button>}
  </section>;
}
