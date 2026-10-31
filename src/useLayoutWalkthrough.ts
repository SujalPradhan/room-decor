import {useEffect,useRef,useState} from 'react';
import {buildLayoutExplanation,sampleLayoutExplanation,type LayoutExplanationPlan} from './layout-explainer';
import type {Layout,RoomSpec} from './types';

export interface LayoutWalkthroughView {plan:LayoutExplanationPlan;elapsedMs:number;stepIndex:number;playing:boolean;finished:boolean;speed:number;preparationMs:number;completed:boolean}
type Session=LayoutWalkthroughView&{from:Layout;to:Layout};
export function useLayoutWalkthrough(onFrame:(layout:Layout|null,itemId?:string)=>void,onComplete:(targetId:string)=>boolean){
 const [view,setView]=useState<LayoutWalkthroughView|null>(null);
 const current=useRef<Session|null>(null),callbacks=useRef({onFrame,onComplete}),lastPublish=useRef(0);callbacks.current={onFrame,onComplete};
 function publish(){const s=current.current;if(s)setView({plan:s.plan,elapsedMs:s.elapsedMs,stepIndex:s.stepIndex,playing:s.playing,finished:s.finished,speed:s.speed,preparationMs:s.preparationMs,completed:s.completed});else setView(null);}
 function draw(){
  const s=current.current;if(!s)return;
  const sampled=sampleLayoutExplanation(s.from,s.to,s.plan,s.elapsedMs);s.stepIndex=sampled.stepIndex;s.finished=sampled.finished;
  callbacks.current.onFrame(sampled.layout,s.plan.steps[s.stepIndex]?.itemId);
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
  start(from:Layout,to:Layout,room:RoomSpec,request?:string,reasons?:Record<string,string>,byAgent=false){const begin=performance.now(),built=buildLayoutExplanation(from,to,room),plan={...built,request,byAgent,steps:built.steps.map(step=>({...step,agentReason:reasons?.[step.itemId??'finish']}))},reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;current.current={from:structuredClone(from),to:structuredClone(to),plan,elapsedMs:reduced?plan.totalDurationMs:0,stepIndex:0,playing:!reduced,finished:false,speed:1,completed:false,preparationMs:performance.now()-begin};draw();publish();},
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
