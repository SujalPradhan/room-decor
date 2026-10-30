import { useCallback, useEffect, useRef, useState } from 'react';
import type { OperationRecord, ProductDraft, ProductResolveInput, StudioSession } from './product-types';
import { createProductDraft, applySpecifications, updateProductDraft, validateProductDraft } from './product-domain';
import { createLocalOperation, mergeOperations } from './ledger';
import { getStudioSession, listRemoteProducts, listRemoteOperations, resolveProduct, saveRemoteProduct, uploadAsset, downloadAsset, StudioApiError } from './product-client';
import { loadProductWorkspace, setProductStorageScope, saveProduct, saveOperation, saveProductImage, hydrateProductImages } from './product-storage';
import { createPipelineJob, getPipelineJob, getPipelineSession, cancelPipelineJob } from './pipeline-client';
import type { PipelineJob, PipelineSession } from './pipeline-types';
import { storeLocalModel, getLocalModel } from './local-assets';
import { reusableProduct } from './automatic-products';

const PAUSED: StudioSession = { user:null,storageAvailable:false,generation:{enabled:false,available:false,provider:'Meshy',model:'meshy-6',estimatedCredits:null,creditUnit:'Meshy credits',remainingCredits:null,reason:'Detailed AI generation is paused. You can try dimensions or import a 3D model.'} };
function mergeProducts(...groups:ProductDraft[][]):ProductDraft[]{const map=new Map<string,ProductDraft>();for(const group of groups)for(const p of group){const old=map.get(p.id);if(!old||Date.parse(p.updatedAt)>=Date.parse(old.updatedAt))map.set(p.id,p);}return [...map.values()].sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt));}
function cloudDraft(product:ProductDraft):ProductDraft{
 const copy=structuredClone(product);
 // Device blob URLs never become broken or cross-account links in the online library.
 copy.images=copy.images.filter(i=>i.source==='listing'||(i.assetId&&i.url.startsWith('/api/assets/')));
 if(!copy.images.some(i=>i.id===copy.selectedImageId))delete copy.selectedImageId;
 return copy;
}
function mergePipelineResult(job:PipelineJob,latest:ProductDraft,localAssetId?:string):ProductDraft{
 const product=job.result!.product;
 return validateProductDraft({...product,title:latest.title||product.title,dimensions:Object.fromEntries((['width','depth','height'] as const).map(axis=>[axis,latest.dimensions[axis].origin==='user'||latest.dimensions[axis].confirmed?latest.dimensions[axis]:product.dimensions[axis]])),updatedAt:new Date().toISOString(),specificationWarnings:[...new Set([...(product.specificationWarnings??[]),...job.result!.warnings])].slice(0,30),model:{...product.model,state:'ready',appearance:'ai-generated',jobId:job.id,remoteAssetId:job.result!.assetId,...(localAssetId?{localAssetId}:{}),draftRevision:product.revision}});
}
export function useProductStudio(roomId:string, roomName:string, notify:(message:string)=>void){
 const [products,setProducts]=useState<ProductDraft[]>([]),[operations,setOperations]=useState<OperationRecord[]>([]),[session,setSession]=useState<StudioSession|null>(null),[loaded,setLoaded]=useState(false),[storageNote,setStorageNote]=useState('');
 const [pendingAutoProductId,setPendingAutoProductId]=useState<string|undefined>();
 const [pipelineSession,setPipelineSession]=useState<PipelineSession|null>(null),[pipelineJobs,setPipelineJobs]=useState<PipelineJob[]>([]);
 const productsRef=useRef<ProductDraft[]>([]);productsRef.current=products;
 const jobsRef=useRef<PipelineJob[]>([]);jobsRef.current=pipelineJobs;
 const completing=useRef(new Set<string>()),finished=useRef(new Set<string>()),enqueueKeys=useRef(new Map<string,string>());
 const boot=useRef<Promise<StudioSession>|null>(null),alive=useRef(true),sessionRef=useRef<StudioSession>(PAUSED),context=useRef({roomId,roomName,notify});context.current={roomId,roomName,notify};
 const initialize=useCallback(()=>{
  if(boot.current)return boot.current;
  boot.current=(async()=>{
   let current=PAUSED;
   try{current=await Promise.race([getStudioSession(),new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error('Session unavailable')),3500))]);}catch{/* Local editing does not depend on an online account. */}
   sessionRef.current=current;setProductStorageScope(current.user?.id??'device');
   const local=await loadProductWorkspace();let remoteProducts:ProductDraft[]=[],remoteOperations:OperationRecord[]=[];
   if(current.user&&current.storageAvailable){const remote=await Promise.allSettled([listRemoteProducts(),listRemoteOperations()]);if(remote[0].status==='fulfilled')remoteProducts=remote[0].value;if(remote[1].status==='fulfilled')remoteOperations=remote[1].value;}
   let pending:ProductDraft|undefined;
   if(current.user){try{const raw=sessionStorage.getItem('roomshift-pending-product-v1');if(raw){sessionStorage.removeItem('roomshift-pending-product-v1');const handoff=JSON.parse(raw);if(typeof handoff.savedAt==='number'&&Date.now()-handoff.savedAt>=0&&Date.now()-handoff.savedAt<3_600_000){pending=validateProductDraft(handoff.product);if(handoff.autoGenerate===true&&alive.current)setPendingAutoProductId(pending.id);await saveProduct(pending);if(current.storageAvailable){try{await saveRemoteProduct(cloudDraft(pending));}catch{/* The authenticated device copy remains available. */}}}}}catch{/* Invalid or expired handoffs never enter an account. */}}
   const hydrated=await hydrateProductImages(mergeProducts(remoteProducts,local.products,pending?[pending]:[]));
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
 const refreshPipeline=useCallback(async()=>{try{const availability=await getPipelineSession();if(alive.current)setPipelineSession(availability);return availability;}catch{const offline={enabled:false,online:false,remainingJobs:0,reason:'Model creation is temporarily unavailable. You can still import a model or try the dimensions.'};if(alive.current)setPipelineSession(offline);return offline;}},[]);
 useEffect(()=>{void refreshPipeline();const timer=setInterval(()=>void refreshPipeline(),30_000);return()=>clearInterval(timer);},[refreshPipeline]);
 const updateJob=useCallback((job:PipelineJob)=>{if(alive.current)setPipelineJobs(old=>[...old.filter(j=>j.id!==job.id),job]);},[]);
 const finishJob=useCallback(async(job:PipelineJob)=>{
  if(finished.current.has(job.id)||completing.current.has(job.id))return;
  if(job.operations)for(const operation of job.operations)await record(operation);
  const current=productsRef.current.find(p=>p.id===job.productId);
  if(!current||current.roomId!==job.roomId||current.revision!==job.requestedRevision||current.model.jobId!==job.id){finished.current.add(job.id);return;}
  if(job.status==='failed'||job.status==='cancelled'){
   enqueueKeys.current.delete(`${job.productId}:${job.requestedRevision}`);
   persist({...current,updatedAt:new Date().toISOString(),model:{state:'failed',appearance:'size-preview',draftRevision:current.revision,error:job.status==='cancelled'?'Model creation was cancelled.':job.error??'Model creation could not finish. You can try again.'}});
   finished.current.add(job.id);context.current.notify(job.status==='cancelled'?'Model creation cancelled. Your product details were kept.':'Model creation needs attention. Open My products to retry.');return;
  }
  if(job.status!=='succeeded'||!job.result)return;
  completing.current.add(job.id);
  const startedAt=new Date().toISOString(),start=performance.now();
  try{
   const blob=await downloadAsset(job.result.assetId);
   const local=await storeLocalModel(new File([blob],`${job.result.product.title.slice(0,70)||'product'}.glb`,{type:'model/gltf-binary'}));
   const latest=productsRef.current.find(p=>p.id===job.productId);
   if(!alive.current||latest?.revision!==job.requestedRevision||latest.model.jobId!==job.id){finished.current.add(job.id);return;}
   const result=mergePipelineResult(job,latest,local.assetId);
   persist(result);
   await record({...createLocalOperation({roomId:job.roomId,roomName:context.current.roomName,productId:job.productId,kind:'asset-download',name:'Open and validate generated model',engine:'Private asset download and local GLB validation',startedAt,elapsedMs:performance.now()-start,bytes:blob.size}),parentId:job.id,outputAssetIds:[local.assetId]});
   context.current.notify('Your product model is ready.');finished.current.add(job.id);
  }catch{
   await record({...createLocalOperation({roomId:job.roomId,productId:job.productId,kind:'asset-download',name:'Open generated model',engine:'Private asset download and local GLB validation',startedAt,elapsedMs:performance.now()-start}),parentId:job.id,status:'failed',errorCode:'MODEL_DOWNLOAD'});
   // Keep the private result retrievable. A later Try in room restores it through prepareModel.
   const latest=productsRef.current.find(p=>p.id===job.productId);
   if(alive.current&&latest?.revision===job.requestedRevision&&latest.model.jobId===job.id){persist(mergePipelineResult(job,latest));context.current.notify('Your model is saved. Open My products to load it again.');}
   finished.current.add(job.id);
  }finally{completing.current.delete(job.id);void refreshPipeline();}
 },[persist,record,refreshPipeline]);
 useEffect(()=>{
  if(!loaded||!session?.user)return;
  let stopped=false,polling=false;
  const poll=async()=>{if(polling)return;polling=true;try{
   const ids=[...new Set([...productsRef.current.filter(p=>p.model.jobId&&['queued','running'].includes(p.model.state)).map(p=>p.model.jobId!),...jobsRef.current.filter(j=>['queued','running'].includes(j.status)).map(j=>j.id)])];
   for(const id of ids){if(stopped)break;try{const job=await getPipelineJob(id);if(stopped)break;updateJob(job);if(job.operations)for(const operation of job.operations)await record(operation);if(['succeeded','failed','cancelled'].includes(job.status))await finishJob(job);}catch{/* An interrupted connection does not resubmit a job or discard its progress. */}}
  }finally{polling=false;}};
  void poll();const timer=setInterval(()=>void poll(),2500);return()=>{stopped=true;clearInterval(timer);};
 },[loaded,session?.user?.id,updateJob,record,finishJob]);
 const generate=useCallback(async(product:ProductDraft,signal?:AbortSignal)=>{
  const checkActive=()=>{if(signal?.aborted)throw new Error('This link was replaced by a newer one.');};checkActive();
  const current=await initialize();checkActive();if(!current.user)throw new Error('Sign in to create a private 3D model. Your room and product draft stay here.');
  if(product.model.state==='ready'&&product.model.draftRevision===product.revision){const prepared=await prepareModel(product);checkActive();persist(prepared);return;}
  const cached=reusableProduct(productsRef.current,product);if(cached){const restored=await prepareModel(cached);checkActive();persist({...product,specificationWarnings:cached.specificationWarnings,model:{...restored.model,draftRevision:product.revision},updatedAt:new Date().toISOString()});context.current.notify('Using the saved model for this product.');return;}
  const availability=await refreshPipeline();checkActive();if(!availability.enabled||!availability.online)throw new Error(availability.reason??'The model studio is offline. Save this product and return when it is available.');
  const existing=jobsRef.current.find(j=>j.productId===product.id&&['queued','running'].includes(j.status));if(existing)throw new Error('A model for this product is already being prepared.');
  if(availability.remainingJobs<1)throw new Error('You’ve used today’s model allowance. Your saved products are ready for tomorrow.');
  const key=`${product.id}:${product.revision}`;let idempotencyKey=enqueueKeys.current.get(key);if(!idempotencyKey){try{idempotencyKey=localStorage.getItem(`roomshift-job-key:${current.user.id}:${key}`)??undefined;}catch{}idempotencyKey??=crypto.randomUUID();enqueueKeys.current.set(key,idempotencyKey);try{localStorage.setItem(`roomshift-job-key:${current.user.id}:${key}`,idempotencyKey);}catch{}}
  checkActive();const job=await createPipelineJob(cloudDraft(product),idempotencyKey);if(signal?.aborted){await cancelPipelineJob(job.id);checkActive();}updateJob(job);
  const queued={...product,updatedAt:new Date().toISOString(),model:{state:job.status==='running'?'running':'queued',appearance:'ai-generated',jobId:job.id,draftRevision:product.revision}} as ProductDraft;
  persist(queued);if(job.operations)for(const operation of job.operations)await record(operation);
  if(['failed','cancelled'].includes(job.status))enqueueKeys.current.delete(key);
  if(['succeeded','failed','cancelled'].includes(job.status))setTimeout(()=>void finishJob(job),0);
  void refreshPipeline();
 },[initialize,refreshPipeline,updateJob,persist,record,finishJob,prepareModel]);
 const cancelGeneration=useCallback(async(id:string)=>{const job=await cancelPipelineJob(id);updateJob(job);await finishJob(job);enqueueKeys.current.delete(`${job.productId}:${job.requestedRevision}`);try{localStorage.removeItem(`roomshift-job-key:${sessionRef.current.user?.id}:${job.productId}:${job.requestedRevision}`);}catch{}void refreshPipeline();},[updateJob,finishJob,refreshPipeline]);
 return {products,operations,session,loaded,storageNote,save:persist,record,resolve,addImage,importModel,prepareModel,generate,pipelineSession,pipelineJobs,cancelGeneration,pendingAutoProductId,clearPendingAutoProduct:()=>setPendingAutoProductId(undefined)};
}
