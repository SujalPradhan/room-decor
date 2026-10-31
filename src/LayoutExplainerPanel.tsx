import { Check, ChevronLeft, ChevronRight, Pause, Play, RotateCcw, SkipForward, X } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { LayoutExplanationPlan } from './layout-explainer';
import './layout-explainer.css';

export interface LayoutExplainerPanelProps {
  plan: LayoutExplanationPlan;
  stepIndex: number;
  elapsedMs: number;
  playing: boolean;
  finished: boolean;
  speed: number;
  onToggle: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onReplay: () => void;
  onClose: () => void;
  onFinish: () => void;
  onSeek: (ms: number) => void;
  onSpeed: (speed: number) => void;
}

function seconds(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
}

export default function LayoutExplainerPanel({plan,stepIndex,elapsedMs,playing,finished,speed,onToggle,onNext,onPrevious,onReplay,onClose,onFinish,onSeek,onSpeed}:LayoutExplainerPanelProps) {
  const total=Math.max(0,plan.totalDurationMs),elapsed=Math.min(total,Math.max(0,elapsedMs));
  const current=Math.max(0,Math.min(plan.steps.length-1,stepIndex));
  const step=plan.steps[current];
  const percent=total>0?Math.round(elapsed/total*100):finished?100:0;
  const announcement=finished?'Layout ready. The walkthrough is complete.':step?`Step ${current+1} of ${plan.steps.length}. ${step.title}. ${step.description} ${step.agentReason??''} ${step.why??''}`:'No furniture moves to show.';
  let offset=0;
  const offsets=plan.steps.map(item=>{const start=offset;offset+=Math.max(0,item.durationMs);return start;});
  return <section className="layout-explainer" aria-labelledby="layout-walkthrough-heading">
    <header className="le-header">
      <span className="le-eyebrow">Layout walkthrough</span>
      <button className="le-icon" type="button" onClick={onClose} aria-label={finished?'Close layout walkthrough':'Cancel layout walkthrough'}><X size={18}/></button>
      <h2 id="layout-walkthrough-heading">{plan.title}</h2>
      {plan.request&&<blockquote className="le-request">“{plan.request}”</blockquote>}
    </header>
    <div className="le-scroll">
      <div className={`le-current-step ${finished?'is-finished':''}`}>
        <span className="le-step-tag">{finished?<><Check size={14}/> Complete</>:step?<>Step {current+1} <span>/ {plan.steps.length}</span></>:'Ready to switch'}</span>
        <h3>{finished?'Layout ready':step?.title??'No moves to show'}</h3>
        <p>{finished?'Your layout is in place. Replay the moves whenever you want a closer look.':step?.description??'This layout has no furniture movements to animate.'}</p>
        {!finished&&step?.agentReason&&<p className="le-why"><strong>Agent</strong> {step.agentReason}</p>}
        {!finished&&step?.why&&<p className="le-why"><strong>{step.agentReason?'Measured':'Why'}</strong> {step.why}</p>}
        <p className="le-floor"><span>Largest open floor</span> <strong>{plan.startOpenFloor.toFixed(2)} → {plan.endOpenFloor.toFixed(2)} m²</strong></p>
      </div>
      {/* Only the text changes with a step or completion, never with animation frames. */}
      <span className="le-sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</span>
      <div className="le-timeline">
        <div className="le-progress-caption"><label htmlFor="layout-walkthrough-progress">Walkthrough progress</label><span>{seconds(elapsed)} <span>/ {seconds(total)}</span></span></div>
        <input id="layout-walkthrough-progress" className="le-range" type="range" min={0} max={Math.max(1,total)} step={1} value={elapsed} disabled={!total} onChange={event=>onSeek(Number(event.target.value))} aria-valuetext={`${percent}% complete, ${seconds(elapsed)} of ${seconds(total)}`} style={{'--le-progress':`${percent}%`} as CSSProperties}/>
        <div className="le-player" aria-label="Walkthrough playback controls">
          <button className="le-icon" type="button" onClick={onPrevious} disabled={!plan.steps.length||(!finished&&current===0&&elapsed===0)} aria-label="Previous walkthrough step"><ChevronLeft size={20}/></button>
          <button className="le-play" type="button" onClick={finished?onReplay:onToggle} disabled={!plan.steps.length} aria-label={finished?'Replay layout walkthrough':playing?'Pause layout walkthrough':'Play layout walkthrough'}>{finished?<RotateCcw size={17}/>:playing?<Pause size={17}/>:<Play size={17}/>} {finished?'Replay':playing?'Pause':'Play'}</button>
          <button className="le-icon" type="button" onClick={onNext} disabled={!plan.steps.length||finished} aria-label="Next walkthrough step"><ChevronRight size={20}/></button>
        </div>
        <div className="le-playback-options"><button className="le-text-button" type="button" onClick={onReplay} disabled={!plan.steps.length} aria-label="Restart layout walkthrough"><RotateCcw size={13}/> Replay</button><label className="le-speed">Speed<select value={speed} onChange={event=>onSpeed(Number(event.target.value))} aria-label="Walkthrough playback speed"><option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option></select></label></div>
      </div>
      {plan.steps.length>0&&<ol className="le-step-list" aria-label="Layout changes">{plan.steps.map((item,index)=><li key={item.id??index}><button type="button" onClick={()=>onSeek(offsets[index])} className={index===current&&!finished?'is-current':''} aria-current={index===current&&!finished?'step':undefined} aria-label={`Go to step ${index+1}: ${item.title}`}><span className={`le-step-number ${index<current||finished?'is-done':''}`}>{index<current||finished?<Check size={12}/>:index+1}</span><span>{item.title}</span><span className="le-step-duration">{seconds(item.durationMs)}</span></button></li>)}</ol>}
      {(plan.summary||plan.warnings.length>0)&&<div className="le-notes"><strong>Keep in mind</strong><ul><li>{plan.summary}</li>{plan.warnings.map((warning,index)=><li key={index}>{warning}</li>)}</ul></div>}
      <p className="le-local-note">{plan.steps.some(item=>item.agentReason)?<>Arranged by the room agent.<br/>Every move passed the room checks; figures are measured here.</>:<>Prepared layouts · plays on your device.<br/>No AI calls for layout playback.</>}</p>
    </div>
    <footer className="le-footer">{finished?<button className="le-finish" type="button" onClick={onClose}>Close walkthrough <Check size={16}/></button>:<><button className="le-finish" type="button" onClick={onFinish}>{plan.steps.length?'Skip to layout':'Use this layout'} <SkipForward size={16}/></button><button className="le-text-button" type="button" onClick={onClose}>Cancel walkthrough</button></>}</footer>
  </section>;
}
