import { useCallback, useEffect, useRef, useState } from 'react';
import type { OperationRecord, ProductDraft, ProductResolveInput, StudioSession } from './product-types';
import { createProductDraft, applySpecifications, updateProductDraft, validateProductDraft } from './product-domain';
import { createLocalOperation, mergeOperations } from './ledger';
import { getStudioSession, listRemoteProducts, listRemoteOperations, resolveProduct, saveRemoteProduct, uploadAsset, requestGeneration, downloadAsset, StudioApiError } from './product-client';
import { loadProductWorkspace, setProductStorageScope, saveProduct, saveOperation, saveProductImage, hydrateProductImages } from './product-storage';
import { storeLocalModel, getLocalModel } from './local-assets';

const PAUSED: StudioSession = { user:null,storageAvailable:false,generation:{enabled:false,available:false,provider:'Meshy',model:'meshy-6',estimatedCredits:null,creditUnit:'Meshy credits',remainingCredits:null,reason:'Detailed AI generation is paused. You can try dimensions or import a 3D model.'} };
function mergeProducts(...groups:ProductDraft[][]):ProductDraft[]{const map=new Map<string,ProductDraft>();for(const group of groups)for(const p of group){const old=map.get(p.id);if(!old||Date.parse(p.updatedAt)>=Date.parse(old.updatedAt))map.set(p.id,p);}return [...map.values()].sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt));}
function cloudDraft(product:ProductDraft):ProductDraft{
 const copy=structuredClone(product);
 // Device blob URLs never become broken or cross-account links in the online library.
 copy.images=copy.images.filter(i=>i.source==='listing'||(i.assetId&&i.url.startsWith('/api/assets/')));
 if(!copy.images.some(i=>i.id===copy.selectedImageId))delete copy.selectedImageId;
 return copy;
}
export function useProductStudio(roomId:string, roomName:string, notify:(message:string)=>void){
 const [products,setProducts]=useState<ProductDraft[]>([]),[operations,setOperations]=useState<OperationRecord[]>([]),[session,setSession]=useState<StudioSession|null>(null),[loaded,setLoaded]=useState(false),[storageNote,setStorageNote]=useState('');
 const boot=useRef<Promise<StudioSession>|null>(null),alive=useRef(true),sessionRef=useRef<StudioSession>(PAUSED),context=useRef({roomId,roomName,notify});context.current={roomId,roomName,notify};
 const initialize=useCallback(()=>{
  if(boot.current)return boot.current;
  boot.current=(async()=>{
   let current=PAUSED;
   try{current=await Promise.race([getStudioSession(),new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error('Session unavailable')),3500))]);}catch{/* Local editing does not depend on an online account. */}
   sessionRef.current=current;setProductStorageScope(current.user?.id??'device');
   const local=await loadProductWorkspace();let remoteProducts:ProductDraft[]=[],remoteOperations:OperationRecord[]=[];
   if(current.user&&current.storageAvailable){const remote=await Promise.allSettled([listRemoteProducts(),listRemoteOperations()]);if(remote[0].status==='fulfilled')remoteProducts=remote[0].value;if(remote[1].status==='fulfilled')remoteOperations=remote[1].value;}
   const hydrated=await hydrateProductImages(mergeProducts(remoteProducts,local.products));
   if(alive.current){setSession(current);setProducts(old=>mergeProducts(hydrated,old));setOperations(old=>mergeOperations([...remoteOperations,...local.operations],old));setStorageNote(local.status.message??'');setLoaded(true);}
   return current;
  })().catch(()=>{if(alive.current){setSession(PAUSED);setLoaded(true);setStorageNote('Product storage is unavailable. Keep a copy of your files; this tab can still show your current work.');}return PAUSED;});
  return boot.current;
 },[]);
 useEffect(()=>{alive.current=true;void initialize();return()=>{alive.current=false;};},[initialize]);
 const record=useCallback(async(operation:OperationRecord)=>{setOperations(old=>mergeOperations(old,operation));await initialize();const result=await saveOperation(operation);if(alive.current&&!result.persistent)setStorageNote(result.message??'History is available only in this tab.');},[initialize]);
 const persist=useCallback((product:ProductDraft)=>{
  const safe=validateProductDraft(product);setProducts(old=>mergeProducts(old,[safe]));
  void(async()=>{const current=await initialize();const status=await saveProduct(safe);if(alive.current&&!status.persistent){setStorageNote(status.message??'This product is available only in this tab.');context.current.notify(status.message??'Product storage is unavailable. Keep a copy of your files.');}
   if(current.user&&current.storageAvailable){try{await saveRemoteProduct(cloudDraft(safe));}catch{if(alive.current)setStorageNote('Your device copy was kept. The online copy could not be updated.');}}
  })().catch(()=>context.current.notify('This product could not be saved. Keep a copy of your files.'));
 },[initialize]);
 const resolve=useCallback(async(input:ProductResolveInput)=>{
  await initialize();const startedAt=new Date().toISOString(),start=performance.now();
  try{const result=await resolveProduct(input);persist(result.product);await record(result.operation);return result;}
  catch(error){if(error instanceof StudioApiError&&error.status!==0&&error.status<500)throw error;
   let source:ProductDraft['source']={retailer:'manual'};
   if(input.url?.trim()){let u:URL;try{u=new URL(input.url.trim());}catch{throw new Error('Paste a valid Amazon or Flipkart product link, or leave it blank and enter specifications.');}if(u.protocol!=='https:')throw new Error('Use an HTTPS product link.');source={retailer:/amazon\.in$|^amzn\.(?:in|to)$/.test(u.hostname)?'amazon':/flipkart\.com$/.test(u.hostname)?'flipkart':'manual',submittedUrl:u.href};}
   const parseStart=performance.now();let product=createProductDraft(input.roomId,source);if(input.specifications)product=applySpecifications(product,input.specifications);
   const operation=createLocalOperation({roomId:input.roomId,roomName:input.roomName,componentId:input.componentId,productId:product.id,kind:'product-lookup',name:'Read product specifications',engine:'Local specification parser',startedAt,elapsedMs:performance.now()-start});
   operation.timing={elapsedMs:performance.now()-start,processingMs:performance.now()-parseStart,transferMs:parseStart-start,source:'observed'};persist(product);await record(operation);
   return {product,operation,notice:'The page could not be read. Paste its specifications or add a product photo; your draft is kept on this device.'};
  }
 },[initialize,persist,record]);
 const addImage=useCallback(async(product:ProductDraft,file:File)=>{
  const startedAt=new Date().toISOString(),start=performance.now(),current=await initialize();
  try{const image=await saveProductImage(file,product.id);let url=image.url,assetId:string|undefined;
   if(current.user&&current.storageAvailable){try{const remote=await uploadAsset(file,{roomId:product.roomId,productId:product.id,kind:'image',generationAllowed:false});assetId=remote.assetId??remote.id;url=remote.url;if(remote.operation)await record(remote.operation);}catch{setStorageNote('The photo is saved on this device. Its online copy is unavailable.');}}
   const next=updateProductDraft(product,{images:[...product.images,{id:image.id,url,assetId,source:'upload',generationAllowed:false,name:image.name}],selectedImageId:image.id});persist(next);
   await record({...createLocalOperation({roomId:product.roomId,roomName:context.current.roomName,productId:product.id,kind:'image-preparation',name:'Add product photo',engine:'Browser image import',startedAt,elapsedMs:performance.now()-start,imageCount:1,bytes:file.size}),inputImageIds:[image.id]});return next;
  }catch(error){const op=createLocalOperation({roomId:product.roomId,productId:product.id,kind:'image-preparation',name:'Add product photo',engine:'Browser image import',startedAt,elapsedMs:performance.now()-start,bytes:file.size});await record({...op,status:'failed',errorCode:'IMAGE_IMPORT'});throw error;}
 },[initialize,persist,record]);
 const importModel=useCallback(async(product:ProductDraft,file:File)=>{
  const startedAt=new Date().toISOString(),start=performance.now(),current=await initialize();
  try{const local=await storeLocalModel(file);let remoteAssetId:string|undefined;
   if(current.user&&current.storageAvailable){try{const remote=await uploadAsset(file,{roomId:product.roomId,productId:product.id,kind:'model'});remoteAssetId=remote.assetId??remote.id;if(remote.operation)await record(remote.operation);}catch{setStorageNote('The model is saved on this device. Keep its original GLB when moving to another browser.');}}
   const next=updateProductDraft(product,{model:{state:'ready',appearance:'seller-model',localAssetId:local.assetId,remoteAssetId,draftRevision:product.revision}});persist(next);
   await record({...createLocalOperation({roomId:product.roomId,roomName:context.current.roomName,productId:product.id,kind:'model-import',name:'Import and validate 3D model',engine:'Local GLB validator',startedAt,elapsedMs:performance.now()-start,bytes:file.size}),outputAssetIds:[local.assetId]});return next;
  }catch(error){await record({...createLocalOperation({roomId:product.roomId,productId:product.id,kind:'model-import',name:'Import and validate 3D model',engine:'Local GLB validator',startedAt,elapsedMs:performance.now()-start,bytes:file.size}),status:'failed',errorCode:'MODEL_IMPORT'});throw error;}
 },[initialize,persist,record]);
 const prepareModel=useCallback(async(product:ProductDraft)=>{
  if(product.model.state!=='ready'||!product.model.remoteAssetId||product.model.draftRevision!==product.revision)return product;
  if(product.model.localAssetId&&await getLocalModel(product.model.localAssetId))return product;
  context.current.notify('Loading your saved 3D model…');
  const startedAt=new Date().toISOString(),start=performance.now();
  const blob=await downloadAsset(product.model.remoteAssetId);
  const local=await storeLocalModel(new File([blob],`${product.title.slice(0,70)||'product'}.glb`,{type:'model/gltf-binary'}));
  const next={...product,model:{...product.model,localAssetId:local.assetId}};persist(next);
  await record(createLocalOperation({roomId:product.roomId,productId:product.id,kind:'asset-download',name:'Restore saved 3D model',engine:'Private asset download and local GLB validation',startedAt,elapsedMs:performance.now()-start,bytes:blob.size}));
  return next;
 },[persist,record]);
 const generate=useCallback(async(product:ProductDraft)=>{const current=await initialize();await requestGeneration(product,current);},[initialize]);
 return {products,operations,session,loaded,storageNote,save:persist,record,resolve,addImage,importModel,prepareModel,generate};
}
