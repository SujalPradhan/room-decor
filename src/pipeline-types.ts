import type { OperationRecord, ProductDraft } from './product-types';

export interface PipelineSession {
  enabled: boolean;
  online: boolean;
  remainingJobs: number;
  reason?: string;
}

/** A generated result is a review artifact. It never changes a room placement. */
export interface PipelineJob {
  id: string;
  productId: string;
  roomId: string;
  requestedRevision: number;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  stage: string;
  createdAt: string;
  updatedAt: string;
  result?: { product: ProductDraft; assetId: string; url: string; warnings: string[] };
  error?: string;
  operations?: OperationRecord[];
}
