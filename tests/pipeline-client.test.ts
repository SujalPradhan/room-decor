import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProductDraft } from '../src/product-domain';
import { createPipelineJob, getPipelineJob, getPipelineSession, validatePipelineJob } from '../src/pipeline-client';

const product = createProductDraft('room-a', {retailer:'flipkart',submittedUrl:'https://www.flipkart.com/example/p/itmexample'});
const job = () => ({id:'job-a',productId:product.id,roomId:product.roomId,requestedRevision:product.revision,status:'queued',stage:'queued',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
afterEach(()=>vi.unstubAllGlobals());
describe('private local pipeline client',()=>{
  it('enqueues a listing without requiring confirmed dimensions or paid generation',async()=>{
    const fetch=vi.fn(async()=>Response.json({job:job()}));vi.stubGlobal('fetch',fetch);
    expect((await createPipelineJob(product,'one-attempt')).status).toBe('queued');
    const [path,options]=fetch.mock.calls[0] as unknown as [string,RequestInit];
    expect(path).toBe('/api/pipeline/jobs');
    expect(JSON.parse(String(options.body))).toMatchObject({product:{dimensions:{width:{metres:null,confirmed:false}}},idempotencyKey:'one-attempt'});
    expect(options.credentials).toBe('same-origin');
    expect(fetch.mock.calls).toHaveLength(1);
  });
  it('refuses output for a different room or external asset URL',()=>{
    const result={product,assetId:'asset-a',url:'/api/assets/asset-a',warnings:[]};
    expect(validatePipelineJob({...job(),status:'succeeded',result}).result?.product.id).toBe(product.id);
    expect(()=>validatePipelineJob({...job(),result:{...result,url:'https://other.example/model.glb'}})).toThrow('invalid');
    expect(()=>validatePipelineJob({...job(),result:{...result,product:{...product,roomId:'room-b'}}})).toThrow('different product');
  });
  it('keeps sign-in and quota errors readable without retrying a generation',async()=>{
    const fetch=vi.fn(async()=>Response.json({error:'Sign in to create a model.'},{status:401}));vi.stubGlobal('fetch',fetch);
    await expect(createPipelineJob(product,'same-attempt')).rejects.toThrow('Sign in');expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('reads availability without starting work and rejects malformed progress',async()=>{
    const fetch=vi.fn(async()=>Response.json({enabled:false,online:false,remainingJobs:0}));vi.stubGlobal('fetch',fetch);
    expect((await getPipelineSession()).enabled).toBe(false);
    vi.stubGlobal('fetch',vi.fn(async()=>Response.json({job:{...job(),requestedRevision:-1}})));
    await expect(getPipelineJob('job-a')).rejects.toThrow('progress');
  });
});
