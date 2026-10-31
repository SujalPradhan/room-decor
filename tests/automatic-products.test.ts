import{describe,it,expect,afterEach,vi}from'vitest';
import{productIdentity,reusableProduct,readPlacementIntents}from'../src/automatic-products';
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
