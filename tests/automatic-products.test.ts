import{describe,it,expect,afterEach,vi}from'vitest';
import{productIdentity,reusableProduct,readPlacementIntents,placeProduct,WALL_KINDS}from'../src/automatic-products';
import{createFurnitureItem,createInitialProject,createRetailProject,getFootprint,kindsForSpace,validateLayout}from'../src/domain';
import type{FurnitureItem,Layout,RoomSpec}from'../src/types';
import{createProductDraft}from'../src/product-domain';
afterEach(()=>vi.unstubAllGlobals());
const draft=()=>({...createProductDraft('room-a',{retailer:'flipkart',submittedUrl:'https://www.flipkart.com/chair/p/itm123?pid=ABC&tracking=old'}),variant:'Brown'});
describe('automatic product identity and placement recovery',()=>{
 it('reuses a current model across tracking links but keeps variants separate',()=>{
  const saved=draft();saved.model={state:'ready',appearance:'ai-generated',remoteAssetId:'private-model',draftRevision:saved.revision};
  const next=draft();next.source.submittedUrl='https://www.flipkart.com/chair/p/itm123?tracking=new&pid=ABC';
  expect(productIdentity(saved)).toBe(productIdentity(next));expect(reusableProduct([saved],next)?.id).toBe(saved.id);
  expect(reusableProduct([saved],{...next,variant:'Blue'})).toBeUndefined();expect(reusableProduct([{...saved,revision:2}],next)).toBeUndefined();
 });
 it('restores only valid recent intents for the requested room',()=>{
  const valid={id:'intent',productId:'product',revision:1,roomId:'room-a',layoutId:'original',targetId:null,createdAt:Date.now()};
  vi.stubGlobal('localStorage',{getItem:()=>JSON.stringify([valid,{...valid,id:'another-room',roomId:'room-b'},{...valid,id:'expired',createdAt:0},{...valid,id:'invalid',revision:-1}])});
  expect(readPlacementIntents('account-private-key','room-a')).toEqual([valid]);
 });
});
/** Metres from the piece's back edge to the wall it faces away from, and whether its front looks into the space. */
function againstWall(item:FurnitureItem,room:RoomSpec){
 const footprint=getFootprint(item),xs=footprint.map(p=>p.x),zs=footprint.map(p=>p.z),front={x:Math.sin(item.rotation),z:Math.cos(item.rotation)};
 const walls=[{gap:Math.min(...zs)+room.depth/2,into:front.z},{gap:room.depth/2-Math.max(...zs),into:-front.z},{gap:Math.min(...xs)+room.width/2,into:front.x},{gap:room.width/2-Math.max(...xs),into:-front.x}];
 return walls.some(wall=>wall.gap<.05&&wall.into>.99);
}
describe('placing a new piece',()=>{
 it('finds every flagship kind a spot with no errors and no access warnings, one after another, with wall kinds on a wall',()=>{
  const store=createRetailProject();let layout:Layout=structuredClone(store.layouts[0]);
  for(const kind of kindsForSpace('retail')){
   const began=performance.now(),placed=placeProduct(createFurnitureItem(kind),layout,store.room,{space:'retail'});
   expect(performance.now()-began,kind).toBeLessThan(400);
   expect([placed.errors,placed.warnings],kind).toEqual([0,0]);
   const after={...layout,items:[...layout.items,placed.item]};
   expect(validateLayout(after,store.room,'retail').filter(i=>i.itemIds.includes(placed.item.id)),kind).toEqual([]);
   if(WALL_KINDS.includes(kind))expect(againstWall(placed.item,store.room),kind).toBe(true);
   layout=after;
  }
 });
 it('prefers the clear spot nearest to where the person is working',()=>{
  const store=createRetailProject(),layout=store.layouts[0];
  const near={x:6,z:-8},placed=placeProduct(createFurnitureItem('plant'),layout,store.room,{space:'retail',near});
  const centred=placeProduct(createFurnitureItem('plant'),layout,store.room,{space:'retail'});
  expect(Math.hypot(placed.item.position.x-near.x,placed.item.position.z-near.z)).toBeLessThan(Math.hypot(centred.item.position.x-near.x,centred.item.position.z-near.z));
  expect([placed.errors,placed.warnings]).toEqual([0,0]);
 });
 it('says honestly when the only spot left is crowded',()=>{
  const store=createRetailProject(),room={...store.room,width:3,depth:3},table=createFurnitureItem('display-table');
  const full={...store.layouts[0],items:[{...table,id:'filler',dimensions:{...table.dimensions,width:2.9,depth:2.9}}]};
  expect(placeProduct(createFurnitureItem('testing-bar'),full,room,{space:'retail'}).errors).toBeGreaterThan(0);
 });
 it('in the bedroom, puts a wardrobe or shelf against a wall and keeps clear of access spaces',()=>{
  const bedroom=createInitialProject(),layout=bedroom.layouts[0];
  for(const kind of['wardrobe','shelf'] as const){
   const placed=placeProduct(createFurnitureItem(kind),layout,bedroom.room);
   expect(againstWall(placed.item,bedroom.room),kind).toBe(true);
   expect([placed.errors,placed.warnings],kind).toEqual([0,0]);
  }
  const plant=placeProduct(createFurnitureItem('plant'),layout,bedroom.room);
  expect(validateLayout({...layout,items:[...layout.items,plant.item]},bedroom.room).filter(i=>i.itemIds.includes(plant.item.id))).toEqual([]);
 });
});
