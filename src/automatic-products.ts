import type {ProductDraft} from './product-types';
import type {FurnitureItem,ItemKind,Layout,Position,RoomSpec,SpaceType} from './types';
import {usageFootprint,validatePlacement} from './domain';

export interface ProductPlacementIntent {
 id:string;productId:string;revision:number;roomId:string;layoutId:string;
 targetId:string|null;targetFingerprint?:string;createdAt:number;
}
export function productIdentity(product:ProductDraft):string|null{
 const source=product.source;let url:URL;try{url=new URL(source.canonicalUrl??source.submittedUrl??'');}catch{return null;}
 if(url.protocol!=='https:')return null;
 const host=url.hostname.toLowerCase(),id=source.productId??(/(^|\.)flipkart\.com$/.test(host)?url.searchParams.get('pid'):url.pathname.match(/\/(?:dp|gp\/product)\/([a-z\d]{10})(?:\/|$)/i)?.[1]);
 const identity=id?.toUpperCase()??url.origin+url.pathname.replace(/\/$/,'');
 return `${source.retailer}:${identity}:${product.variant.trim().toLowerCase()}`;
}
export function reusableProduct(products:ProductDraft[],requested:ProductDraft):ProductDraft|undefined{
 const identity=productIdentity(requested);if(!identity)return;
 return products.find(p=>p.id!==requested.id&&productIdentity(p)===identity&&p.model.state==='ready'&&p.model.draftRevision===p.revision&&Boolean(p.model.remoteAssetId||p.model.localAssetId));
}
export function readPlacementIntents(key:string,roomId:string):ProductPlacementIntent[]{
 try{const parsed:unknown=JSON.parse(localStorage.getItem(key)??'[]');if(!Array.isArray(parsed))return[];
 return parsed.filter((p):p is ProductPlacementIntent=>p&&typeof p==='object'&&['id','productId','layoutId'].every(k=>typeof p[k]==='string'&&p[k].length>0&&p[k].length<160)&&p.roomId===roomId&&Number.isSafeInteger(p.revision)&&p.revision>0&&(p.targetId===null||typeof p.targetId==='string')&&typeof p.createdAt==='number'&&Date.now()-p.createdAt>=0&&Date.now()-p.createdAt<86_400_000).slice(0,10);
 }catch{return[];}
}
/** Kinds that stand with their back to a wall and face into the space. */
export const WALL_KINDS:ItemKind[]=['wall-display','digital-wall','mirror-station','service-cabin','shelf','wardrobe'];
/** Metres of floor a free-standing piece should leave around itself: a customer aisle in a store, a walkway at home. */
const GAP:Record<SpaceType,number>={retail:1.2,room:.6};
/** Metres between candidate spots. The deepest access space any piece needs, which bounds who can be affected. */
const STEP=.3,MAX_ACCESS=1.5;
export interface ProductPlacement{item:FurnitureItem;errors:number;warnings:number;
 /** Clear, but closer to other pieces than the space's walking gap. */
 tight:boolean}
const radius=(item:FurnitureItem)=>Math.hypot(item.dimensions.width,item.dimensions.depth)/2;
/** Spots with the piece's back to each wall, facing into the space. Rotation 0 faces +z, the front wall. */
function wallSpots(item:FurnitureItem,room:RoomSpec){
 const {width,depth}=item.dimensions,inset=.02,spots:{x:number;z:number;rotation:number}[]=[];
 const along=(length:number)=>{const out:number[]=[];for(let t=-length/2+width/2+.05;t<=length/2-width/2-.05+1e-9;t+=STEP)out.push(t);return out;};
 for(const x of along(room.width))spots.push({x,z:-room.depth/2+depth/2+inset,rotation:0},{x,z:room.depth/2-depth/2-inset,rotation:Math.PI});
 for(const z of along(room.depth))spots.push({x:-room.width/2+depth/2+inset,z,rotation:Math.PI/2},{x:room.width/2-depth/2-inset,z,rotation:Math.PI*1.5});
 return spots;
}
function floorSpots(item:FurnitureItem,room:RoomSpec){
 const spots=[{x:0,z:0,rotation:item.rotation}];
 for(let x=-room.width/2+item.dimensions.width/2+.08;x<=room.width/2-item.dimensions.width/2;x+=STEP)
  for(let z=-room.depth/2+item.dimensions.depth/2+.08;z<=room.depth/2-item.dimensions.depth/2;z+=STEP)spots.push({x,z,rotation:item.rotation});
 return spots;
}
/**
 * The best free spot for a new piece. Every spot is scored by the errors and access warnings it would add, then by
 * whether it leaves the walking gap, then by distance from near (the piece the person is working on, or the centre).
 * Wall kinds only go against a wall. A crowded result is still returned, with its counts, so the caller can say so.
 */
export function placeProduct(item:FurnitureItem,layout:Layout,room:RoomSpec,{space='room',near={x:0,z:0}}:{space?:SpaceType;near?:Position}={}):ProductPlacement{
 const others=layout.items.filter(other=>other.visible&&other.id!==item.id),gap=GAP[space],wall=WALL_KINDS.includes(item.kind);
 const spots=(wall?wallSpots(item,room):floorSpots(item,room)).map(spot=>({...spot,distance:Math.hypot(spot.x-near.x,spot.z-near.z)})).sort((a,b)=>a.distance-b.distance);
 // A roomy spot anywhere beats a tight one, and a clear one anywhere beats any that crowds a piece.
 const tightCost=Math.hypot(room.width,room.depth);
 let best:ProductPlacement|null=null,bestScore=Infinity;
 for(const spot of spots){
  if(spot.distance>=bestScore)break;
  const placed={...item,position:{x:Math.round(spot.x*100)/100,z:Math.round(spot.z*100)/100},rotation:spot.rotation};
  // Only pieces within reach of each other's access space can be affected, so only they are checked.
  const nearby=others.filter(other=>Math.hypot(other.position.x-placed.position.x,other.position.z-placed.position.z)<=radius(other)+radius(placed)+MAX_ACCESS+gap);
  const issues=[...validatePlacement(placed,[...nearby,placed],room,space),...nearby.flatMap(other=>usageFootprint(other)?validatePlacement(other,[other,placed],room,space).filter(issue=>issue.code==='clearance'):[])];
  const errors=issues.filter(issue=>issue.severity==='error').length,warnings=issues.length-errors;
  // A wall piece's sides may meet its neighbours along the wall; its access space already keeps its front clear.
  const roomy={...placed,dimensions:{...placed.dimensions,width:placed.dimensions.width+2*gap,depth:placed.dimensions.depth+2*gap}};
  const tight=!wall&&!errors&&validatePlacement(roomy,[...nearby,roomy],room,space).some(issue=>issue.code==='overlap');
  const score=errors*1000+warnings*100+(tight?tightCost:0)+spot.distance;
  if(score<bestScore){best={item:placed,errors,warnings,tight};bestScore=score;}
 }
 return best??{item:{...item,position:{x:0,z:0}},errors:1,warnings:0,tight:false};
}
export function chooseProductPosition(item:FurnitureItem,layout:Layout,room:RoomSpec,options?:{space?:SpaceType;near?:Position}):FurnitureItem{
 return placeProduct(item,layout,room,options).item;
}
