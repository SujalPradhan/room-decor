import { Check, ChevronDown, ChevronLeft, ChevronRight, Pause, Play, RotateCcw, SkipForward, X } from 'lucide-react';
import { useState, type CSSProperties } from 'react';
import type { SpaceType } from './types';
import type { LayoutExplanationPlan } from './layout-explainer';
import './layout-explainer.css';

export interface LayoutExplainerPanelProps {
  plan: LayoutExplanationPlan;
  space?: SpaceType;
  stepIndex: number;
  elapsedMs: number;
  playing: boolean;
  finished: boolean;
  completed: boolean;
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

/** "9 pieces" for a chapter step that moves several pieces together; nothing for a single-piece step. */
function piecesLabel(step: LayoutExplanationPlan['steps'][number]): string {
  return step.kind !== 'finish' && step.parts && step.parts.length > 1 ? `${step.parts.length} pieces` : '';
}
type Step = LayoutExplanationPlan['steps'][number];
function Reasons({plan,step}:{plan:LayoutExplanationPlan;step:Step}) {
  return <>
    {step.agentReason&&<p className="le-why"><strong>Agent</strong> {step.agentReason}</p>}
    {step.goalWhys?.map(item=><p key={item.goal} className="le-why"><strong>{item.label}</strong> {item.text}</p>)}
    {step.why&&<p className="le-why"><strong>{step.agentReason||step.goalWhys?.length?'Measured':'Why'}</strong> {step.why}</p>}
  </>;
}
function seconds(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
}

export default function LayoutExplainerPanel({plan,space,stepIndex,elapsedMs,playing,finished,completed,speed,onToggle,onNext,onPrevious,onReplay,onClose,onFinish,onSeek,onSpeed}:LayoutExplainerPanelProps) {
  const place=space==='retail'?'store':'room',total=Math.max(0,plan.totalDurationMs),elapsed=Math.min(total,Math.max(0,elapsedMs));
  const current=Math.max(0,Math.min(plan.steps.length-1,stepIndex));
  const step=plan.steps[current];
  const percent=total>0?Math.round(elapsed/total*100):finished?100:0;
  const [open,setOpen]=useState<{planId:string;ids:string[]}>({planId:plan.id,ids:[]}),opened=open.planId===plan.id?open.ids:[];
  const toggle=(id:string)=>setOpen({planId:plan.id,ids:opened.includes(id)?opened.filter(item=>item!==id):[...opened,id]});
  const announcement=finished?'Layout ready. The walkthrough is complete.':step?`Step ${current+1} of ${plan.steps.length}${piecesLabel(step)?`, ${piecesLabel(step)} together`:''}. ${step.title}. ${step.description} ${step.agentReason??''} ${step.goalWhys?.map(item=>`${item.label}: ${item.text}`).join(' ')??''} ${step.why??''}`:'No furniture moves to show.';
  let offset=0;
  const offsets=plan.steps.map(item=>{const start=offset;offset+=Math.max(0,item.durationMs);return start;});
  return <section className="layout-explainer" aria-labelledby="layout-walkthrough-heading">
    <header className="le-header">
      <span className="le-eyebrow">Layout walkthrough</span>
      <button className="le-icon" type="button" onClick={onClose} aria-label={completed?'Close layout walkthrough':'Cancel layout walkthrough'}><X size={18}/></button>
      <h2 id="layout-walkthrough-heading">{plan.title}</h2>
      {plan.request&&<blockquote className="le-request">“{plan.request}”</blockquote>}
      {plan.limits?.length?<div className="le-limits"><strong>Not measured</strong><ul>{plan.limits.map(limit=><li key={limit}>{limit}</li>)}</ul></div>:null}
    </header>
    <div className="le-scroll">
      <div className={`le-current-step ${finished?'is-finished':''}`}>
        <span className="le-step-tag">{finished?<><Check size={14}/> Complete</>:step?<>Step {current+1} <span>/ {plan.steps.length}</span></>:'Ready to switch'}</span>
        <h3>{finished?'Layout ready':step?.title??'No moves to show'}</h3>
        <p>{finished?'Your layout is in place. Replay the moves whenever you want a closer look.':step?.description??'This layout has no furniture movements to animate.'}</p>
        {!finished&&step&&<Reasons plan={plan} step={step}/>}
        {plan.goals?.length?plan.goals.map(goal=><div key={goal.id} className="le-goal"><span className="le-goal-heading">{goal.heading}</span>{goal.lines.map(([label,value])=><p key={label} className="le-floor"><span>{label}</span> <strong>{value}</strong></p>)}</div>):<p className="le-floor"><span>Largest open floor</span> <strong>{plan.startOpenFloor.toFixed(2)} → {plan.endOpenFloor.toFixed(2)} m²</strong></p>}
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
      {plan.steps.length>0&&<ol className="le-step-list" aria-label="Layout changes">{plan.steps.map((item,index)=>{const expanded=opened.includes(item.id),reasons=Boolean(item.agentReason||item.goalWhys?.length||item.why);return <li key={item.id??index}><button type="button" onClick={()=>{onSeek(offsets[index]);if(reasons)toggle(item.id);}} className={index===current&&!finished?'is-current':''} aria-current={index===current&&!finished?'step':undefined} aria-expanded={reasons?expanded:undefined} aria-controls={reasons?`le-step-why-${index}`:undefined} aria-label={`Go to step ${index+1}: ${item.title}${piecesLabel(item)?`, ${piecesLabel(item)}`:''}`}><span className={`le-step-number ${index<current||finished?'is-done':''}`}>{index<current||finished?<Check size={12}/>:index+1}</span><span className="le-step-title">{item.title}{piecesLabel(item)&&<small className="le-step-pieces">{piecesLabel(item)}</small>}</span><span className="le-step-duration">{seconds(item.durationMs)}</span>{reasons&&<ChevronDown className={`le-step-chevron ${expanded?'is-open':''}`} size={14} aria-hidden="true"/>}</button>{reasons&&expanded&&<div className="le-step-why" id={`le-step-why-${index}`}><Reasons plan={plan} step={item}/></div>}</li>;})}</ol>}
      {(plan.summary||plan.warnings.length>0)&&<div className="le-notes"><strong>Keep in mind</strong><ul><li>{plan.summary}</li>{plan.warnings.map((warning,index)=><li key={index}>{warning}</li>)}</ul></div>}
      <p className="le-local-note">{plan.byAgent?<>Chosen by the {place} agent.<br/>{plan.steps.some(item=>item.agentReason)?`Every change passed the ${place} checks; figures are measured here.`:'Figures are measured here.'}</>:<>Prepared layouts · plays on your device.<br/>No AI calls for layout playback.</>}</p>
    </div>
    <footer className="le-footer">{completed?<button className="le-finish" type="button" onClick={onClose}>Close walkthrough <Check size={16}/></button>:<><button className="le-finish" type="button" onClick={onFinish}>{plan.steps.length?'Skip to layout':'Use this layout'} <SkipForward size={16}/></button><button className="le-text-button" type="button" onClick={onClose}>Cancel walkthrough</button></>}</footer>
  </section>;
}
