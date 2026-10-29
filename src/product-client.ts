import type { GenerationJob, OperationRecord, ProductDraft, ProductResolveInput, ProductResolveResult, StudioSession } from './product-types';
import { validateProductDraft } from './product-domain';
import { validateOperationRecord } from './ledger';

export class StudioApiError extends Error { constructor(message: string, public readonly status: number, public readonly code?: string) { super(message); this.name = 'StudioApiError'; } }
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  if (!path.startsWith('/api/')) throw new Error('Studio requests must stay on this site.');
  let response: Response;
  try { response = await fetch(path, { ...options, credentials: 'same-origin', headers: { ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...options.headers }, signal: options.signal ?? AbortSignal.timeout(20_000) }); }
  catch { throw new StudioApiError('The studio connection was interrupted. Your local product draft was kept.', 0, 'NETWORK'); }
  const result: unknown = await response.json().catch(() => null);
  const body = (result && typeof result === 'object' ? result : {}) as Record<string, unknown>;
  const detail = (body.error && typeof body.error === 'object' ? body.error : {}) as Record<string, unknown>;
  if (!response.ok) throw new StudioApiError(typeof body.error === 'string' ? body.error : typeof detail.message === 'string' ? detail.message : typeof body.message === 'string' ? body.message : 'This studio action could not finish. Please try again.', response.status, typeof detail.code === 'string' ? detail.code : typeof body.code === 'string' ? body.code : undefined);
  if (result === null) throw new StudioApiError('The studio returned an unreadable response.', response.status, 'INVALID_RESPONSE');
  return result as T;
}
export async function getStudioSession(): Promise<StudioSession> { return request('/api/studio/session'); }
export async function resolveProduct(input: ProductResolveInput): Promise<ProductResolveResult> {
  const result = await request<ProductResolveResult>('/api/products/resolve', { method: 'POST', body: JSON.stringify(input) });
  return { ...result, product: validateProductDraft(result.product), operation: validateOperationRecord(result.operation) };
}
export async function listRemoteProducts(roomId?: string): Promise<ProductDraft[]> {
  const result = await request<ProductDraft[] | { products: ProductDraft[] }>(`/api/products${roomId ? `?roomId=${encodeURIComponent(roomId)}` : ''}`);
  return (Array.isArray(result) ? result : result.products).map(validateProductDraft);
}
export async function saveRemoteProduct(product: ProductDraft): Promise<ProductDraft> {
  const safe = validateProductDraft(product), result = await request<ProductDraft | { product: ProductDraft }>('/api/products', { method: 'POST', body: JSON.stringify(safe) });
  return validateProductDraft('product' in result ? result.product : result);
}
export async function listRemoteOperations(roomId?: string): Promise<OperationRecord[]> {
  const result = await request<OperationRecord[] | { operations: OperationRecord[] }>(`/api/operations${roomId ? `?roomId=${encodeURIComponent(roomId)}` : ''}`);
  return (Array.isArray(result) ? result : result.operations).map(validateOperationRecord);
}
export interface RemoteProductAsset { id: string; assetId?: string; url: string; name?: string; mime?: string; size?: number; generationAllowed?: boolean; operation?: OperationRecord }
export async function uploadAsset(file: File, input: { productId?: string; roomId: string; kind?: 'image' | 'model'; generationAllowed?: boolean }): Promise<RemoteProductAsset> {
  const form = new FormData(); form.set('file', file); form.set('roomId', input.roomId); if (input.productId) form.set('productId', input.productId); form.set('kind', input.kind ?? (file.type.startsWith('image/') ? 'image' : 'model'));
  form.set('generationAllowed', input.generationAllowed === true ? 'true' : 'false');
  return request('/api/assets', { method: 'POST', body: form });
}
export async function requestGeneration(product: ProductDraft, session: StudioSession): Promise<GenerationJob> {
  // An explicit client gate complements the server's immutable disabled flag. No background paid requests.
  if (!session.generation.enabled || !session.generation.available) throw new StudioApiError(session.generation.reason ?? 'Detailed model generation is paused. You can still try the product dimensions or import a GLB.', 403, 'GENERATION_DISABLED');
  const result = await request<{ job: GenerationJob }>('/api/generations', { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ productId: product.id, draftRevision: product.revision, roomId: product.roomId, imageId: product.selectedImageId }) });
  return result.job;
}
export async function getGeneration(jobId: string): Promise<GenerationJob> { return (await request<{ job: GenerationJob }>(`/api/generations/${encodeURIComponent(jobId)}`)).job; }
export async function downloadAsset(assetId: string): Promise<Blob> {
  const response = await fetch(`/api/assets/${encodeURIComponent(assetId)}`, { credentials: 'same-origin', signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new StudioApiError('This saved asset could not be downloaded. Keep your original file.', response.status);
  return response.blob();
}
