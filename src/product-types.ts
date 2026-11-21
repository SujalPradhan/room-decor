import type { PipelineJob, PipelineSession } from './pipeline-types';
import type { Dimensions, ItemKind, FurnitureItem } from './types';
export type ProductAxis = keyof Dimensions;
export interface ProductMeasurement { metres: number | null; origin: 'listing' | 'user' | 'unknown'; evidence?: string; confirmed: boolean }
export interface ProductImage { id: string; url: string; source: 'listing' | 'upload'; generationAllowed: boolean; assetId?: string; name?: string }
export interface ProductDraft {
 id: string; revision: number; roomId: string; createdAt: string; updatedAt: string;
 source: { retailer: 'amazon' | 'flipkart' | 'manual'; submittedUrl?: string; canonicalUrl?: string; productId?: string };
 title: string; kind: ItemKind | null; variant: string; images: ProductImage[]; selectedImageId?: string; specificationWarnings?: string[];
 dimensions: Record<ProductAxis, ProductMeasurement>;
 model: { state: 'proxy' | 'queued' | 'running' | 'ready' | 'failed'; appearance: 'size-preview' | 'ai-generated' | 'seller-model'; jobId?: string; localAssetId?: string; remoteAssetId?: string; error?: string; draftRevision?: number; placementDimensions?:Dimensions; scaleSource?:'listing'|'estimated' };
}
export type OperationKind = 'product-lookup' | 'room-analysis' | 'image-preparation' | 'model-generation' | 'model-import' | 'asset-download' | 'render' | 'validation';
export interface OperationRecord {
 id: string; roomId: string; roomName?: string; productId?: string; componentId?: string; parentId?: string; attempt: number;
 kind: OperationKind; name: string; status: 'queued' | 'running' | 'succeeded' | 'failed' | 'unknown';
 engine: string; provider?: string; model?: string; submittedAt: string; startedAt?: string; finishedAt?: string;
 timing: { queueMs?: number; processingMs?: number; transferMs?: number; elapsedMs?: number; source: 'local' | 'provider' | 'observed' | 'unknown' };
 usage: { credits?: number; creditUnit?: string; inputTokens?: number; outputTokens?: number; cachedTokens?: number; imageCount?: number; bytes?: number };
 cost: { basis: 'local' | 'estimated' | 'reported' | 'reconciled' | 'unknown'; amountMicros?: number | null; currency?: string; reservedCredits?: number; refundedCredits?: number; rateId?: string; note?: string };
 estimate?: {credits:number;creditUnit:string;rateId?:string;rateSource?:string;rateCheckedAt?:string};
 inputImageIds?: string[]; outputAssetIds?: string[]; errorCode?: string; reusedFrom?: string;
}
export interface GenerationJob {
 id: string; productId: string; draftRevision: number; roomId: string; status: 'queued' | 'running' | 'preparing' | 'succeeded' | 'failed' | 'unknown';
 provider: string; model: string; createdAt: string; startedAt?: string; finishedAt?: string; outputAssetId?: string; error?: string; operationId: string;
}
export interface StudioSession {
 user: { id: string; name: string } | null;
 generation: { enabled: boolean; available: boolean; provider: string; model: string; estimatedCredits: number | null; creditUnit: string; remainingCredits: number | null; reason?: string };
 storageAvailable: boolean;
}
export interface ProductResolveInput { url?: string; specifications?: string; roomId: string; roomName?: string; componentId?: string }
export interface ProductResolveResult { product: ProductDraft; operation: OperationRecord; notice?: string }
export interface ProductWorkbenchProps {
 initialProductId?: string; autoStart?:boolean; onSourceChange?:()=>void;
 pipelineSession?: PipelineSession | null; pipelineJobs?: PipelineJob[]; onCancelGeneration?: (jobId:string)=>Promise<void>;
 storageNote?: string;
 original: FurnitureItem | null; roomId: string; roomName: string; products: ProductDraft[]; session: StudioSession | null;
 onResolve: (input: ProductResolveInput) => Promise<ProductResolveResult>;
 onSave: (product: ProductDraft) => void; onTry: (product: ProductDraft) => void; onClose: () => void;
 onImportModel: (product: ProductDraft, file: File) => Promise<ProductDraft>;
 onAddImage: (product: ProductDraft, file: File) => Promise<ProductDraft>;
 onGenerate: (product: ProductDraft) => Promise<void>;
}
export interface CostTimePanelProps { storageNote?: string; operations: OperationRecord[]; products: ProductDraft[]; roomId: string; roomName: string; onClose: () => void }
