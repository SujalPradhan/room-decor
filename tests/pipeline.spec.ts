import {test,expect,type Page} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createProductDraft,updateProductDraft,applySpecifications} from '../src/product-domain';
import type {PipelineJob} from '../src/pipeline-types';
import type {ProductDraft} from '../src/product-types';

async function mockPipeline(page:Page, assetFails=false){
 let product:ProductDraft|undefined,job:PipelineJob|undefined,complete=false,cancelled=false,downloaded=0,paid=0,lookups=0,jobs=0;
 const finish=()=>{complete=true;};
 await page.route('**/api/**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname;
  let data:unknown;
  if(path==='/api/studio/session')data={user:{id:'pipeline-test-user',name:'Test designer'},storageAvailable:true,generation:{enabled:false,available:false,provider:'Meshy',model:'meshy-6',estimatedCredits:null,creditUnit:'Meshy credits',remainingCredits:null}};
  else if(path==='/api/pipeline/session')data={enabled:true,online:true,remainingJobs:3};
  else if(path==='/api/products/resolve'){
   lookups++;const input=request.postDataJSON();product=applySpecifications(updateProductDraft(createProductDraft(input.roomId,{retailer:'flipkart',submittedUrl:input.url}),{title:'Test fabric recliner',kind:'chair'}),'Width: 83.56 cm; Depth: 82.55 cm; Height: 109 cm');
   data={product,operation:{id:'lookup-pipeline',roomId:product.roomId,productId:product.id,attempt:1,kind:'product-lookup',name:'Read test listing',status:'succeeded',engine:'Listing parser',submittedAt:new Date().toISOString(),timing:{source:'observed',elapsedMs:12,processingMs:12},usage:{},cost:{basis:'local'}}};
  }else if(path==='/api/products')data=request.method()==='POST'?request.postDataJSON():{products:[]};
  else if(path==='/api/operations')data={operations:[]};
  else if(path==='/api/pipeline/jobs'&&request.method()==='POST'){
   jobs++;product=request.postDataJSON().product;job={id:'pipeline-test-job',productId:product!.id,roomId:product!.roomId,requestedRevision:product!.revision,status:'queued',stage:'queued',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};data={job};
  }else if(path==='/api/pipeline/jobs/pipeline-test-job/cancel'){cancelled=true;job={...job!,status:'cancelled',stage:'cancelled',updatedAt:new Date().toISOString()};data={job};}
  else if(path==='/api/pipeline/jobs/pipeline-test-job'){
   job={...job!,status:cancelled?'cancelled':complete?'succeeded':'running',stage:cancelled?'cancelled':complete?'ready':'reconstructing',updatedAt:new Date().toISOString(),...(complete?{result:{product:product!,assetId:'pipeline-test-model',url:'/api/assets/pipeline-test-model',warnings:['Hidden surfaces are inferred. Check dimensions before use.']},operations:[{id:'foundry-pipeline-operation',roomId:product!.roomId,productId:product!.id,attempt:1,kind:'validation',name:'Review test photos',status:'succeeded',engine:'Vision review',provider:'Test vision provider',model:'fixture-vision',submittedAt:new Date().toISOString(),timing:{source:'observed',elapsedMs:5436,processingMs:5436},usage:{inputTokens:1752,outputTokens:490,credits:0.5,creditUnit:'credits'},cost:{basis:'unknown'}}]}:{})};data={job};
  }else if(path==='/api/assets/pipeline-test-model'){downloaded++;if(assetFails){await route.fulfill({status:503,json:{error:'Temporary download failure'}});return;}await route.fulfill({status:200,contentType:'model/gltf-binary',body:readFileSync(resolve('public/assets/furniture.glb'))});return;}
  else if(path==='/api/generations'){paid++;await route.fulfill({status:403,json:{error:'Paid generation paused'}});return;}
  else{await route.continue();return;}
  await route.fulfill({status:200,json:data});
 });
 return {finish,get downloaded(){return downloaded;},get paid(){return paid;},get jobs(){return jobs;},get lookups(){return lookups;},get product(){return product;}};
}
async function room(page:Page){await page.goto('/');await expect(page.locator('canvas')).toBeVisible();await expect(page.locator('.stage-loading')).toHaveCount(0,{timeout:30000});await expect.poll(()=>page.evaluate(()=>localStorage.getItem('roomshift-project-v1'))).not.toBeNull();}
async function workbench(page:Page){if((page.viewportSize()?.width??1512)<800)await page.getByRole('button',{name:'Furniture',exact:true}).click();await page.getByRole('button',{name:/Add furniture/}).click();await page.getByRole('button',{name:/Try a product link/}).click();}
async function layouts(page:Page){return page.evaluate(()=>JSON.parse(localStorage.getItem('roomshift-project-v1')!).layouts);}

async function pasteLink(page:Page){await page.getByLabel('Amazon or Flipkart product link',{exact:true}).fill('https://www.flipkart.com/test-recliner/p/itmtest');await expect(page.getByRole('button',{name:'Cancel model creation',exact:true})).toBeVisible();}
async function optionalDetails(page:Page){await page.getByText('Edit details or import a model',{exact:true}).click();}
async function currentItems(page:Page){return page.evaluate(()=>{const p=JSON.parse(localStorage.getItem('roomshift-project-v1')!);return p.layouts.find((l:{id:string})=>l.id===p.activeLayoutId).items;});}

test('pasting one product link creates and links the generated shape with no further steps',async({page})=>{
 const api=await mockPipeline(page);await room(page);const before=await layouts(page),beforeItems=await currentItems(page);await workbench(page);await pasteLink(page);
 await expect(page.getByRole('textbox',{name:'Product name',exact:true})).not.toBeVisible();await expect(page.getByRole('checkbox',{name:/I checked all three/})).not.toBeVisible();await expect(page.getByRole('button',{name:'Try in room',exact:true})).not.toBeVisible();expect(api.lookups).toBe(1);expect(api.jobs).toBe(1);
 await page.getByRole('button',{name:'Close product workbench',exact:true}).click();api.finish();
 await expect.poll(()=>api.downloaded,{timeout:15000}).toBe(1);
 await expect.poll(async()=>{const items=await currentItems(page);return items.filter((item:{assetId:string})=>item.assetId?.startsWith('local:')).length;},{timeout:15000}).toBe(1);
 const items=await currentItems(page);expect(items.length).toBe(beforeItems.length+1);expect(items.find((item:{assetId:string})=>item.assetId?.startsWith('local:')).dimensions).toEqual({width:.8356,depth:.8255,height:1.09});
 expect((await layouts(page)).find((l:{id:string})=>l.id==='original')).toEqual(before.find((l:{id:string})=>l.id==='original'));expect(api.paid).toBe(0);expect(api.jobs).toBe(1);
 await expect(page.getByRole('button',{name:'Add to room',exact:true})).toHaveCount(0);await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByRole('button',{name:'Undo',exact:true})).toBeEnabled();await page.keyboard.press('Control+z');await expect.poll(async()=>(await currentItems(page)).length).toBe(beforeItems.length);
 await page.getByRole('button',{name:'Cost & time',exact:true}).click();const usage=page.locator('.ct-summary-card').filter({hasText:'Processing usage'});await expect(usage).toContainText('2,242 tokens');await expect(usage).toContainText('0.5 Test vision provider:credits');
});

test('optional material edits during reconstruction preserve values and discard the older model',async({page})=>{
 const api=await mockPipeline(page);await room(page);const before=await layouts(page);await workbench(page);await pasteLink(page);await optionalDetails(page);
 const width=page.getByRole('spinbutton',{name:'Product width',exact:true});await width.fill('150');await width.press('Enter');api.finish();await page.waitForTimeout(3500);await expect(width).toHaveValue('150');expect(api.downloaded).toBe(0);expect(api.paid).toBe(0);expect(await layouts(page)).toEqual(before);expect(api.jobs).toBe(1);
});

test('cancel stops a model without restarting or losing the product details',async({page})=>{
 const api=await mockPipeline(page);await room(page);await workbench(page);await pasteLink(page);await page.getByRole('button',{name:'Cancel model creation',exact:true}).click();await expect(page.getByText('Model creation was cancelled.',{exact:true})).toBeVisible();await optionalDetails(page);await expect(page.getByRole('textbox',{name:'Product name',exact:true})).toHaveValue('Test fabric recliner');expect(api.downloaded).toBe(0);expect(api.paid).toBe(0);expect(api.jobs).toBe(1);
});

test('mobile sign-in retains the pasted link and resumes model creation automatically',async({page})=>{
 const api=await mockPipeline(page);await page.route('**/api/studio/session',route=>route.fulfill({status:200,json:{user:null,storageAvailable:true,generation:{enabled:false,available:false,provider:'Meshy',model:'meshy-6',estimatedCredits:null,creditUnit:'Meshy credits',remainingCredits:null}}}));
 await page.setViewportSize({width:390,height:844});await room(page);await workbench(page);const url='https://www.flipkart.com/test-recliner/p/itmtest';await page.getByLabel('Amazon or Flipkart product link',{exact:true}).fill(url);
 await expect(page.getByRole('alert')).toContainText('Sign in');expect(api.jobs).toBe(0);expect(api.lookups).toBe(0);await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const signIn=page.getByRole('link',{name:/Sign in to create a model/});await signIn.evaluate(el=>el.addEventListener('click',event=>event.preventDefault()));await signIn.click();await expect.poll(()=>page.evaluate(()=>JSON.parse(sessionStorage.getItem('roomshift-pending-product-v1')!).autoGenerate)).toBe(true);
 await page.route('**/api/studio/session',route=>route.fulfill({status:200,json:{user:{id:'new-signed-in-user',name:'New user'},storageAvailable:true,generation:{enabled:false,available:false,provider:'Meshy',model:'meshy-6',estimatedCredits:null,creditUnit:'Meshy credits',remainingCredits:null}}}));
 await page.reload();await expect(page.getByRole('button',{name:'Cancel model creation',exact:true})).toBeVisible({timeout:15000});await expect(page.getByLabel('Amazon or Flipkart product link',{exact:true})).toHaveValue(url);expect(api.lookups).toBe(1);expect(api.jobs).toBe(1);expect(api.paid).toBe(0);expect(await page.evaluate(()=>sessionStorage.getItem('roomshift-pending-product-v1'))).toBeNull();
});

test('a failed model download preserves optional name and dimension edits without adding a stock model',async({page})=>{
 await page.clock.setFixedTime(new Date('2030-01-01T00:00:00Z'));
 const api=await mockPipeline(page,true);await room(page);const before=await layouts(page);await workbench(page);await pasteLink(page);await optionalDetails(page);
 const name=page.getByRole('textbox',{name:'Product name',exact:true});await name.fill('My reading chair');await name.press('Tab');await page.getByRole('checkbox',{name:/I checked all three/}).check();api.finish();
 await expect.poll(()=>api.downloaded,{timeout:15000}).toBeGreaterThanOrEqual(1);await expect(page.getByRole('dialog').getByRole('status').filter({hasText:'Your product model is ready'})).toBeVisible();await expect(name).toHaveValue('My reading chair');await expect(page.getByRole('checkbox',{name:/I checked all three/})).toBeChecked();expect(api.paid).toBe(0);expect(api.jobs).toBe(1);expect(await layouts(page)).toEqual(before);
});

test('opening a ready product does not start a second generation',async({page})=>{
 const api=await mockPipeline(page);await room(page);await workbench(page);await pasteLink(page);api.finish();await expect.poll(()=>api.downloaded,{timeout:15000}).toBe(1);await expect(page.getByRole('dialog')).toHaveCount(0);await workbench(page);await page.getByRole('tab',{name:/My products/}).click();await page.getByRole('button',{name:'Review',exact:true}).click();await expect(page.getByRole('dialog').getByRole('status').filter({hasText:'Your product model is ready'})).toBeVisible();await expect(page.getByRole('button',{name:'Cancel model creation',exact:true})).toHaveCount(0);expect(api.jobs).toBe(1);
});


test('a queued pasted link survives reload and its automatic addition stays undone after another reload',async({page})=>{
 const api=await mockPipeline(page);await room(page);const before=await currentItems(page);await workbench(page);await pasteLink(page);
 await page.reload();await expect(page.locator('.stage-loading')).toHaveCount(0,{timeout:30000});api.finish();
 await expect.poll(async()=>(await currentItems(page)).length,{timeout:15000}).toBe(before.length+1);
 await expect(page.getByRole('button',{name:'Undo',exact:true})).toBeEnabled();await page.keyboard.press('Control+z');
 await expect.poll(async()=>(await currentItems(page)).length).toBe(before.length);await page.reload();
 await expect(page.locator('.stage-loading')).toHaveCount(0,{timeout:30000});expect((await currentItems(page)).length).toBe(before.length);expect(api.jobs).toBe(1);
});
