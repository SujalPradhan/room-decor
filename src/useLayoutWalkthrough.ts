import {useEffect,useRef,useState} from 'react';
import {buildLayoutExplanation,sampleLayoutExplanation,type LayoutExplanationPlan,type LayoutExplanationStep} from './layout-explainer';
import {goalsOf,limitsOf,type LayoutGoal} from './layout-goals';
import type {Layout,RoomSpec,SpaceType} from './types';

export interface LayoutWalkthroughView {plan:LayoutExplanationPlan;elapsedMs:number;stepIndex:number;playing:boolean;finished:boolean;speed:number;preparationMs:number;completed:boolean}
type Session=LayoutWalkthroughView&{from:Layout;to:Layout};
/** Agent reasons are keyed by item ID, plus 'finish' for colours. A chapter step gathers the distinct reasons of every piece it moves. */
export function agentReasonFor(step:LayoutExplanationStep,reasons?:Record<string,string>):string|undefined{
 if(!reasons)return undefined;
 const keys=step.parts?[...step.parts.map(part=>part.itemId),...(step.kind==='finish'?['finish']:[])]:[step.itemId??'finish'];
 const found=[...new Set(keys.map(key=>reasons[key]?.trim()).filter((reason):reason is string=>Boolean(reason)))];
 return found.length?found.join(' '):undefined;
}
export function agentShortFor(step:LayoutExplanationStep,shorts?:Record<string,string>):string|undefined{
 if(!shorts)return undefined;
 const keys=step.parts?[...new Set([step.itemId,...step.parts.map(part=>part.itemId),...(step.kind==='finish'?['finish']:[])])]:[step.itemId??'finish'];
 const found=keys.map(key=>key&&shorts[key]?.trim()).filter((short):short is string=>Boolean(short)),tally=new Map<string,number>();
 for(const short of found)tally.set(short,(tally.get(short)??0)+1);
 return [...tally].sort((a,b)=>b[1]-a[1])[0]?.[0];
}
/** The piece to outline while a step plays. A chapter moves several pieces at once, so it outlines none rather than one of them. */
export function highlightFor(step?:LayoutExplanationStep):string|undefined{return step&&!(step.parts&&step.parts.length>1)?step.itemId:undefined;}
export function useLayoutWalkthrough(onFrame:(layout:Layout|null,itemId?:string)=>void,onComplete:(targetId:string)=>boolean){
 const [view,setView]=useState<LayoutWalkthroughView|null>(null);
 const current=useRef<Session|null>(null),callbacks=useRef({onFrame,onComplete}),lastPublish=useRef(0);callbacks.current={onFrame,onComplete};
 function publish(){const s=current.current;if(s)setView({plan:s.plan,elapsedMs:s.elapsedMs,stepIndex:s.stepIndex,playing:s.playing,finished:s.finished,speed:s.speed,preparationMs:s.preparationMs,completed:s.completed});else setView(null);}
 function draw(){
  const s=current.current;if(!s)return;
  const sampled=sampleLayoutExplanation(s.from,s.to,s.plan,s.elapsedMs);s.stepIndex=sampled.stepIndex;s.finished=sampled.finished;
  callbacks.current.onFrame(sampled.layout,highlightFor(s.plan.steps[s.stepIndex]));
  if(s.finished){s.playing=false;if(!s.completed){s.completed=true;if(!callbacks.current.onComplete(s.to.id)){current.current=null;callbacks.current.onFrame(null);setView(null);return;}}}
 }
 function seek(ms:number){const s=current.current;if(!s)return;s.elapsedMs=Math.max(0,Math.min(s.plan.totalDurationMs,Number.isFinite(ms)?ms:0));s.playing=false;draw();publish();}
 useEffect(()=>{
  if(!view?.playing)return;
  let raf=0,previous=performance.now(),disposed=false;
  const tick=(now:number)=>{
   if(disposed)return;const s=current.current;if(!s?.playing)return;
   const delta=Math.max(0,Math.min(100,now-previous));previous=now;
   s.elapsedMs=Math.min(s.plan.totalDurationMs,s.elapsedMs+delta*s.speed);draw();
   if(!s.playing||now-lastPublish.current>=80){lastPublish.current=now;publish();}
   if(s.playing)raf=requestAnimationFrame(tick);
  };
  raf=requestAnimationFrame(tick);
  const pauseWhenHidden=()=>{if(document.hidden&&current.current){current.current.playing=false;publish();}};
  document.addEventListener('visibilitychange',pauseWhenHidden);
  return()=>{disposed=true;cancelAnimationFrame(raf);document.removeEventListener('visibilitychange',pauseWhenHidden);};
 },[view?.playing,view?.plan.id]);
 useEffect(()=>()=>{current.current=null;},[]);
 return {view,current,
  start(from:Layout,to:Layout,room:RoomSpec,request?:string,reasons?:Record<string,string>,byAgent=false,space?:SpaceType,reading:{goals?:LayoutGoal[];limits?:string;shorts?:Record<string,string>}={}){const begin=performance.now(),goals=[...new Set([...(reading.goals??[]),...goalsOf(request,space)])],limits=reading.limits?.trim()?[reading.limits.trim()]:limitsOf(request,space,goals),built=buildLayoutExplanation(from,to,room,space,goals,limits),plan={...built,request,byAgent,steps:built.steps.map(step=>{const short=agentShortFor(step,reading.shorts);return {...step,agentReason:agentReasonFor(step,reasons),...(short&&{short:{text:short}})};})},reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;current.current={from:structuredClone(from),to:structuredClone(to),plan,elapsedMs:reduced?plan.totalDurationMs:0,stepIndex:0,playing:!reduced,finished:false,speed:1,completed:false,preparationMs:performance.now()-begin};draw();publish();},
  close(){current.current=null;callbacks.current.onFrame(null);setView(null);},
  toggle(){const s=current.current;if(!s)return;if(s.finished){s.elapsedMs=0;s.finished=false;}s.playing=!s.playing;draw();publish();},
  replay(){const s=current.current;if(!s)return;s.elapsedMs=0;s.finished=false;s.playing=!window.matchMedia('(prefers-reduced-motion: reduce)').matches;draw();publish();},
  seek,
  next(){const s=current.current;if(!s)return;seek(s.plan.steps.slice(0,s.stepIndex+1).reduce((sum,item)=>sum+item.durationMs,0));},
  previous(){const s=current.current;if(!s)return;const start=s.plan.steps.slice(0,s.stepIndex).reduce((sum,item)=>sum+item.durationMs,0);seek(s.elapsedMs>start+50?start:s.plan.steps.slice(0,Math.max(0,s.stepIndex-1)).reduce((sum,item)=>sum+item.durationMs,0));},
  finish(){if(current.current)seek(current.current.plan.totalDurationMs);},
  speed(value:number){if(current.current&&[.5,1,2].includes(value)){current.current.speed=value;publish();}},
  snapshot(){const s=current.current;return s?sampleLayoutExplanation(s.from,s.to,s.plan,s.elapsedMs).layout:null;}
 };
}
