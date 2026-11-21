import { studioRequest, StudioApiError } from './product-client';
import { validateProductDraft } from './product-domain';
import { validateOperationRecord } from './ledger';
import type { ProductDraft } from './product-types';
import type { PipelineJob, PipelineSession } from './pipeline-types';

export function validatePipelineJob(value: unknown): PipelineJob {
  const job = value as PipelineJob;
  if (!job || typeof job !== 'object' || !['queued','running','succeeded','failed','cancelled'].includes(job.status)
    || ![job.id,job.productId,job.roomId,job.stage].every(v=>typeof v === 'string' && v.length > 0 && v.length < 1000)
    || !Number.isSafeInteger(job.requestedRevision) || job.requestedRevision < 1
    || !Number.isFinite(Date.parse(job.createdAt)) || !Number.isFinite(Date.parse(job.updatedAt)))
    throw new StudioApiError('Model progress could not be read. Your product is safe.', 200, 'INVALID_RESPONSE');
  const result = job.result;
  if(job.status==='succeeded'&&!result) throw new StudioApiError('The generated model response is incomplete.',200,'INVALID_RESPONSE');
  if (result && (typeof result.assetId !== 'string' || !/^[a-z\d_-]{1,160}$/i.test(result.assetId)
    || result.url !== `/api/assets/${result.assetId}` || !Array.isArray(result.warnings) || result.warnings.some(w=>typeof w!=='string')))
    throw new StudioApiError('The generated model response is invalid.', 200, 'INVALID_RESPONSE');
  const product = result ? validateProductDraft(result.product) : undefined;
  if (product && (product.id !== job.productId || product.roomId !== job.roomId || product.revision < job.requestedRevision)) throw new StudioApiError('This model belongs to a different product.', 200, 'INVALID_RESPONSE');
  return {...job, ...(result && product ? {result:{...result,product}} : {}), ...(job.operations ? {operations:job.operations.map(validateOperationRecord)} : {})};
}
export async function getPipelineSession(): Promise<PipelineSession> {
  const session = await studioRequest<PipelineSession>('/api/pipeline/session');
  if (typeof session.enabled!=='boolean'||typeof session.online!=='boolean'||!Number.isSafeInteger(session.remainingJobs)||session.remainingJobs<0) throw new Error('Model availability is unavailable.');
  return session;
}
export async function createPipelineJob(product:ProductDraft,idempotencyKey:string):Promise<PipelineJob>{
  const result=await studioRequest<{job:PipelineJob}>('/api/pipeline/jobs',{method:'POST',body:JSON.stringify({product:validateProductDraft(product),idempotencyKey})});
  return validatePipelineJob(result.job);
}
export async function getPipelineJob(id:string):Promise<PipelineJob>{return validatePipelineJob((await studioRequest<{job:PipelineJob}>(`/api/pipeline/jobs/${encodeURIComponent(id)}`)).job);}
export async function cancelPipelineJob(id:string):Promise<PipelineJob>{return validatePipelineJob((await studioRequest<{job:PipelineJob}>(`/api/pipeline/jobs/${encodeURIComponent(id)}/cancel`,{method:'POST',body:'{}'})).job);}
export function pipelineStageLabel(stage:string):string{
  return ({queued:'Waiting for the model studio',reading:'Reading product details',lookup:'Reading product details',extracting:'Collecting product photos',foundry:'Reviewing photos and dimensions',analysis:'Reviewing photos and dimensions',analyzing:'Reviewing photos and dimensions',preparing:'Preparing the best product photo',segmentation:'Separating the product from its background',generating:'Creating the 3D shape',reconstruction:'Creating the 3D shape',reconstructing:'Creating the 3D shape',converting:'Finishing colour and size',uploading:'Saving your private model',downloading:'Opening your model',ready:'Ready to review',complete:'Ready to review',completed:'Ready to review',failed:'Model needs attention',cancelled:'Cancelled'} as Record<string,string>)[stage]??'Preparing your model';
}
