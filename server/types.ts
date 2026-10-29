/** Minimal structural bindings let the service be tested without a Workers runtime. */
export interface Statement {
  bind(...values: unknown[]): Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ success?: boolean; meta?: { changes?: number } }>;
}
export interface Database {
  prepare(sql: string): Statement;
  batch<T = unknown>(statements: Statement[]): Promise<T[]>;
}
export interface StoredObject {
  body: ReadableStream<Uint8Array>;
  arrayBuffer(): Promise<ArrayBuffer>;
}
export interface Bucket {
  put(
    key: string,
    value: ArrayBuffer | Uint8Array | ReadableStream,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  get(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<unknown>;
}
export interface StudioEnv {
  DB?: Database;
  BUCKET?: Bucket;
  MESHY_API_KEY?: string;
  STUDIO_PAID_GENERATION_ENABLED?: string;
}
export interface RequestContext {
  waitUntil(promise: Promise<unknown>): void;
}
export class StudioError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export const PAUSED_MESSAGE =
  "Detailed AI generation is paused. You can try dimensions or import a 3D model.";
