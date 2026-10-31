import type {ProductDraft} from './product-types';
import type {FurnitureItem,Layout,RoomSpec} from './types';
import {validateLayout} from './domain';

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
export function chooseProductPosition(item:FurnitureItem,layout:Layout,room:RoomSpec):FurnitureItem{
 const positions=[{x:0,z:0}];
 for(let x=-room.width/2+item.dimensions.width/2+.08;x<=room.width/2-item.dimensions.width/2;x+=.3)
  for(let z=-room.depth/2+item.dimensions.depth/2+.08;z<=room.depth/2-item.dimensions.depth/2;z+=.3)positions.push({x,z});
 positions.sort((a,b)=>Math.hypot(a.x,a.z)-Math.hypot(b.x,b.z));
 for(const position of positions.slice(0,2500)){
  const placed={...item,position};const problems=validateLayout({...layout,items:[...layout.items,placed]},room);
  if(!problems.some(p=>p.itemIds.includes(item.id)&&p.severity==='error'))return placed;
 }
 return {...item,position:{x:0,z:0}};
}
