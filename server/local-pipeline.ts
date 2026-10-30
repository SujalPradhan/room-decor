import type { OperationRecord, ProductDraft } from '../src/product-types';
import type { PipelineJob } from '../src/pipeline-types';
import { validateProductDraft } from '../src/product-domain';
import { validateOperationRecord } from '../src/ledger';
import { validateGLB, MAX_LOCAL_MODEL_BYTES } from '../src/local-assets';
import { normalizeRetailerUrl } from './retailers';
import { StudioError, type StudioEnv, type Database } from './types';

type Helpers = {
  ownerOf(request: Request): string | null;
  readJson(request: Request, max?: number): Promise<Record<string, unknown>>;
  json(value: unknown, status?: number): Response;
};
type Row = {
  id: string; owner_id: string; product_id: string; room_id: string;
  requested_revision: number; idempotency_key: string; request_hash: string;
  product_json: string; status: PipelineJob['status']; stage: string;
  lease_token: string | null; lease_expires_at: string | null;
  result_json: string | null; operations_json: string | null; error: string | null;
  created_at: string; updated_at: string;
};
const LEASE_MS = 180_000;
const ONLINE_MS = 90_000;
const QUEUE_MS = 15 * 60_000;
const stages = new Set(['reading', 'analyzing', 'preparing', 'reconstructing', 'converting', 'uploading', 'ready']);
const now = () => new Date().toISOString();
const before = (ms: number) => new Date(Date.now() - ms).toISOString();
function problem(status: number, code: string, message: string): never { throw new StudioError(status, code, message); }
function identifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[\w.-]{1,128}$/.test(value)) problem(400, 'INVALID_INPUT', 'Use a valid job identifier.');
  return value;
}
function configured(env: StudioEnv): boolean {
  return env.STUDIO_LOCAL_PIPELINE_ENABLED === 'true' && !!env.DB && !!env.BUCKET && typeof env.ROOMSHIFT_WORKER_TOKEN === 'string' && env.ROOMSHIFT_WORKER_TOKEN.length >= 32;
}
function publicJob(row: Row): PipelineJob {
  return {
    id: row.id, productId: row.product_id, roomId: row.room_id,
    requestedRevision: row.requested_revision, status: row.status, stage: row.stage,
    createdAt: row.created_at, updatedAt: row.updated_at,
    ...(row.result_json ? { result: JSON.parse(row.result_json) } : {}),
    ...(row.operations_json ? { operations: JSON.parse(row.operations_json) } : {}),
    ...(row.error ? { error: row.error } : {}),
  };
}
async function digest(value: string) { return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))); }
async function workerAuth(request: Request, env: StudioEnv) {
  const supplied = request.headers.get('authorization') ?? '';
  const a = await digest(supplied.length <= 1024 ? supplied : ''), b = await digest(`Bearer ${env.ROOMSHIFT_WORKER_TOKEN}`);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  if (difference !== 0) problem(401, 'WORKER_UNAUTHORIZED', 'Worker authentication failed.');
}
async function sweep(db: Database) {
  const timestamp = now();
  await db.prepare(`UPDATE studio_pipeline_jobs SET status='failed', stage='failed', error='The laptop worker stopped responding. Review and start a new job; this job will not run again.', lease_expires_at=NULL, updated_at=? WHERE (status='running' AND lease_expires_at < ?) OR (status='queued' AND created_at < ?)`)
    .bind(timestamp, timestamp, before(QUEUE_MS)).run();
}
async function rowById(db: Database, id: string, owner?: string) {
  return await db.prepare(`SELECT * FROM studio_pipeline_jobs WHERE id=?${owner ? ' AND owner_id=?' : ''}`).bind(...(owner ? [id, owner] : [id])).first<Row>();
}
async function workerOnline(db: Database) {
  return !!await db.prepare("SELECT id FROM studio_pipeline_workers WHERE id='local' AND online=1 AND updated_at>=?").bind(before(ONLINE_MS)).first();
}
async function remaining(db: Database, owner: string) {
  const midnight = now().slice(0, 10) + 'T00:00:00.000Z';
  const counts = await db.prepare('SELECT COUNT(*) AS total, SUM(CASE WHEN owner_id=? THEN 1 ELSE 0 END) AS personal FROM studio_pipeline_jobs WHERE created_at>=?').bind(owner, midnight).first<{total: number; personal: number | null}>();
  return Math.max(0, Math.min(3 - (counts?.personal ?? 0), 6 - (counts?.total ?? 0)));
}
function operationsFor(raw: unknown, row: Row): OperationRecord[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > 20) problem(400, 'INVALID_OPERATIONS', 'The processing report is invalid.');
  try {
    return raw.map((op, index) => validateOperationRecord({ ...op, id: `${row.id}-${index}`, roomId: row.room_id, productId: row.product_id }));
  } catch { return problem(400, 'INVALID_OPERATIONS', 'The processing report is invalid.'); }
}
function saveOperationWhen(db: Database, row: Row, op: OperationRecord, condition: string, args: unknown[]) {
  return db.prepare(`INSERT INTO studio_operations(id,owner_id,room_id,product_id,record_json,submitted_at) SELECT ?,?,?,?,?,? WHERE ${condition}
    ON CONFLICT(id) DO UPDATE SET record_json=excluded.record_json WHERE studio_operations.owner_id=excluded.owner_id AND studio_operations.room_id=excluded.room_id AND studio_operations.product_id=excluded.product_id`)
    .bind(op.id, row.owner_id, row.room_id, row.product_id, JSON.stringify(op), op.submittedAt, ...args);
}
async function leasedRow(request: Request, db: Database, id: string) {
  const row = await rowById(db, id), token = request.headers.get('x-roomshift-lease');
  if (!row || row.status !== 'running' || !token || token !== row.lease_token || !row.lease_expires_at || row.lease_expires_at <= now())
    problem(409, 'STALE_LEASE', 'This job has stopped or was cancelled. Its result will not be applied.');
  return row;
}
async function boundedMultipart(request: Request) {
  const max = MAX_LOCAL_MODEL_BYTES + 500_000;
  if (!request.headers.get('content-type')?.startsWith('multipart/form-data;')) problem(415, 'INVALID_CONTENT_TYPE', 'Upload a model and its report.');
  if (Number(request.headers.get('content-length')) > max) problem(413, 'MODEL_TOO_LARGE', 'Choose a model smaller than 30 MB.');
  const reader = request.body?.getReader();
  if (!reader) problem(400, 'INVALID_MODEL', 'Upload a model and its report.');
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      length += part.value.length;
      if (length > max) { await reader.cancel(); problem(413, 'MODEL_TOO_LARGE', 'Choose a model smaller than 30 MB.'); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const buffer = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length; }
  try { return await new Response(buffer, { headers: { 'Content-Type': request.headers.get('content-type')! } }).formData(); }
  catch { return problem(400, 'INVALID_MODEL', 'The model upload could not be read.'); }
}
async function complete(request: Request, env: StudioEnv, row: Row) {
  const db = env.DB!, form = await boundedMultipart(request), file = form.get('model'), metadata = form.get('metadata');
  if (!(file instanceof File) || file.size > MAX_LOCAL_MODEL_BYTES || typeof metadata !== 'string' || metadata.length > 200_000)
    problem(400, 'INVALID_MODEL', 'Upload a GLB model and its processing report.');
  let data: {product?: unknown; warnings?: unknown; operations?: unknown};
  let product: ProductDraft;
  try { data = JSON.parse(metadata); product = validateProductDraft(data.product); }
  catch { return problem(400, 'INVALID_PRODUCT', 'The generated product report is invalid.'); }
  if (product.id !== row.product_id || product.roomId !== row.room_id || product.revision < row.requested_revision)
    problem(409, 'STALE_PRODUCT', 'The result does not match the requested product revision.');
  const warnings = data.warnings;
  if (!Array.isArray(warnings) || warnings.length > 30 || warnings.some(w => typeof w !== 'string' || w.length > 1000))
    problem(400, 'INVALID_REPORT', 'The model warnings are invalid.');
  const operations = operationsFor(data.operations, row), bytes = await file.arrayBuffer();
  try { validateGLB(bytes); } catch { return problem(400, 'INVALID_GLB', 'The generated file must be a self-contained GLB 2 model.'); }
  const assetId = crypto.randomUUID(), key = `studio/${row.owner_id}/${assetId}`, timestamp = now();
  product.model = { state: 'ready', appearance: 'ai-generated', remoteAssetId: assetId, draftRevision: product.revision };
  const result = JSON.stringify({ product, assetId, url: `/api/assets/${assetId}`, warnings });
  await env.BUCKET!.put(key, bytes, { httpMetadata: { contentType: 'model/gltf-binary' } });
  try {
    // The completion and owner-scoped asset registration share one transaction. Cancellation wins if it reached D1 first.
    const condition = "EXISTS(SELECT 1 FROM studio_pipeline_jobs WHERE id=? AND status='succeeded' AND result_json=?)";
    const statements = [
      db.prepare("UPDATE studio_pipeline_jobs SET status='succeeded',stage='ready',result_json=?,operations_json=?,lease_token=NULL,lease_expires_at=NULL,updated_at=? WHERE id=? AND status='running' AND lease_token=? AND lease_expires_at>?")
        .bind(result, JSON.stringify(operations), timestamp, row.id, row.lease_token, timestamp),
      db.prepare(`INSERT INTO studio_assets(id,owner_id,room_id,product_id,object_key,mime,size,name,generation_allowed,created_at) SELECT ?,?,?,?,?,?,?,?,0,? WHERE ${condition}`)
        .bind(assetId, row.owner_id, row.room_id, row.product_id, key, 'model/gltf-binary', bytes.byteLength, 'Generated product.glb', timestamp, row.id, result),
      ...operations.map(op => saveOperationWhen(db, row, op, condition, [row.id, result])),
    ];
    await db.batch(statements);
    const saved = await rowById(db, row.id);
    if (saved?.result_json !== result) { await env.BUCKET!.delete(key); problem(409, 'STALE_LEASE', 'This result was cancelled or superseded.'); }
    return publicJob(saved!);
  } catch (error) { await env.BUCKET!.delete(key); throw error; }
}

export async function handlePipelineRequest(request: Request, env: StudioEnv, helpers: Helpers): Promise<Response> {
  const { json, readJson, ownerOf } = helpers, path = new URL(request.url).pathname.replace(/\/$/, '');
  const ready = configured(env), owner = ownerOf(request);
  if (path === '/api/pipeline/session' && request.method === 'GET') {
    if (!ready) return json({ enabled: false, online: false, remainingJobs: 0, reason: 'The local model pilot is not configured yet.' });
    if (!owner) return json({ enabled: false, online: false, remainingJobs: 0, reason: 'Sign in to create a private product model.' });
    await sweep(env.DB!);
    const online = await workerOnline(env.DB!), remainingJobs = await remaining(env.DB!, owner);
    return json({ enabled: true, online, remainingJobs, ...(!online ? { reason: 'The laptop model worker is offline. You can still try product dimensions.' } : !remainingJobs ? { reason: 'The pilot’s daily processing limit has been reached. Try again tomorrow (UTC).' } : {}) });
  }
  if (!ready) problem(503, 'PIPELINE_UNAVAILABLE', 'The local model pilot is not configured yet.');
  const db = env.DB!;
  if (path.startsWith('/api/pipeline/worker/')) {
    await workerAuth(request, env); await sweep(db);
    if (path === '/api/pipeline/worker/heartbeat' && request.method === 'POST') {
      const body = await readJson(request, 2048);
      if (typeof body.online !== 'boolean') problem(400, 'INVALID_INPUT', 'Set the worker online state.');
      await db.prepare("INSERT INTO studio_pipeline_workers(id,online,updated_at) VALUES('local',?,?) ON CONFLICT(id) DO UPDATE SET online=excluded.online,updated_at=excluded.updated_at").bind(body.online ? 1 : 0, now()).run();
      return json({ ok: true });
    }
    if (path === '/api/pipeline/worker/claim' && request.method === 'POST') {
      const timestamp = now(), leaseToken = crypto.randomUUID() + crypto.randomUUID();
      const row = await db.prepare(`UPDATE studio_pipeline_jobs SET status='running',stage='reading',lease_token=?,lease_expires_at=?,updated_at=? WHERE id=(SELECT id FROM studio_pipeline_jobs WHERE status='queued' ORDER BY created_at,id LIMIT 1) AND status='queued' AND NOT EXISTS(SELECT 1 FROM studio_pipeline_jobs WHERE status='running') RETURNING *`)
        .bind(leaseToken, new Date(Date.now() + LEASE_MS).toISOString(), timestamp).first<Row>();
      return json(row ? { job: publicJob(row), product: JSON.parse(row.product_json), leaseToken } : { job: null });
    }
    const match = path.match(/^\/api\/pipeline\/worker\/jobs\/([\w.-]+)\/(progress|complete|fail|usage)$/);
    if (match && request.method === 'POST') {
      if (match[2] === 'usage') {
        const row = await rowById(db, identifier(match[1])), capability = request.headers.get('x-roomshift-lease');
        if (!row || !capability || capability !== row.lease_token || !['cancelled', 'failed'].includes(row.status) || row.created_at < before(2 * 60 * 60_000))
          problem(409, 'STALE_LEASE', 'This processing report is no longer accepted.');
        const body = await readJson(request, 200_000), operations = operationsFor(body.operations, row), encoded = JSON.stringify(operations);
        await db.batch([
          db.prepare("UPDATE studio_pipeline_jobs SET operations_json=?,updated_at=? WHERE id=? AND status IN ('cancelled','failed') AND lease_token=?").bind(encoded, now(), row.id, capability),
          ...operations.map(op => saveOperationWhen(db, row, op, "EXISTS(SELECT 1 FROM studio_pipeline_jobs WHERE id=? AND status IN ('cancelled','failed') AND lease_token=? AND operations_json=?)", [row.id, capability, encoded])),
        ]);
        return json({ job: publicJob((await rowById(db, row.id))!) });
      }
      const row = await leasedRow(request, db, identifier(match[1]));
      if (match[2] === 'complete') return json({ job: await complete(request, env, row) });
      const body = await readJson(request, 200_000), timestamp = now();
      if (match[2] === 'progress') {
        if (typeof body.stage !== 'string' || !stages.has(body.stage)) problem(400, 'INVALID_STAGE', 'Choose a supported processing stage.');
        const operations = body.operations === undefined ? JSON.parse(row.operations_json ?? '[]') as OperationRecord[] : operationsFor(body.operations, row);
        const encoded = JSON.stringify(operations);
        await db.batch([
          db.prepare("UPDATE studio_pipeline_jobs SET stage=?,operations_json=?,lease_expires_at=?,updated_at=? WHERE id=? AND status='running' AND lease_token=? AND lease_expires_at>?")
            .bind(body.stage, encoded, new Date(Date.now() + LEASE_MS).toISOString(), timestamp, row.id, row.lease_token, timestamp),
          ...operations.map(op => saveOperationWhen(db, row, op, "EXISTS(SELECT 1 FROM studio_pipeline_jobs WHERE id=? AND status='running' AND lease_token=? AND operations_json=?)", [row.id, row.lease_token, encoded])),
        ]);
      } else {
        const operations = operationsFor(body.operations, row);
        // Worker errors may contain local paths or provider details; keep public failure text fixed.
        const error = 'The product model could not be completed. Review the listing and dimensions, then start a new job.';
        await db.batch([
          db.prepare("UPDATE studio_pipeline_jobs SET status='failed',stage='failed',error=?,operations_json=?,lease_token=NULL,lease_expires_at=NULL,updated_at=? WHERE id=? AND status='running' AND lease_token=? AND lease_expires_at>?")
            .bind(error, JSON.stringify(operations), timestamp, row.id, row.lease_token, timestamp),
          ...operations.map(op => saveOperationWhen(db, row, op, "EXISTS(SELECT 1 FROM studio_pipeline_jobs WHERE id=? AND status='failed' AND operations_json=?)", [row.id, JSON.stringify(operations)])),
        ]);
      }
      const updated = await rowById(db, row.id);
      if (match[2] === 'progress' && updated?.status !== 'running') problem(409, 'STALE_LEASE', 'This job has stopped or was cancelled.');
      return json({ job: publicJob(updated!) });
    }
    return problem(404, 'NOT_FOUND', 'This worker action is unavailable.');
  }
  if (!owner) problem(401, 'SIGN_IN_REQUIRED', 'Sign in to create a private product model.');
  await sweep(db);
  if (path === '/api/pipeline/jobs' && request.method === 'POST') {
    const body = await readJson(request), idempotencyKey = identifier(body.idempotencyKey);
    let product: ProductDraft;
    try { product = validateProductDraft(body.product); } catch { return problem(400, 'INVALID_PRODUCT', 'Review this product before creating a model.'); }
    identifier(product.id); identifier(product.roomId);
    const source = product.source.canonicalUrl ?? product.source.submittedUrl;
    if (!source) problem(400, 'PRODUCT_LINK_REQUIRED', 'Add an Amazon or Flipkart product link first.');
    normalizeRetailerUrl(source);
    const productJson = JSON.stringify(product), hash = [...await digest(productJson)].map(v => v.toString(16).padStart(2, '0')).join('');
    const existing = await db.prepare('SELECT * FROM studio_pipeline_jobs WHERE owner_id=? AND idempotency_key=?').bind(owner, idempotencyKey).first<Row>();
    if (existing) {
      if (existing.request_hash !== hash) problem(409, 'IDEMPOTENCY_CONFLICT', 'This request identifier belongs to a different product revision.');
      return json({ job: publicJob(existing) });
    }
    if (!await workerOnline(db)) problem(503, 'WORKER_OFFLINE', 'The laptop model worker is offline. Try product dimensions meanwhile.');
    const id = crypto.randomUUID(), timestamp = now(), midnight = timestamp.slice(0, 10) + 'T00:00:00.000Z';
    // SQLite evaluates the quotas and insertion atomically, including competing requests.
    await db.prepare(`INSERT INTO studio_pipeline_jobs(id,owner_id,product_id,room_id,requested_revision,idempotency_key,request_hash,product_json,status,stage,created_at,updated_at)
      SELECT ?,?,?,?,?,?,?,?,'queued','queued',?,?
      WHERE NOT EXISTS(SELECT 1 FROM studio_pipeline_jobs WHERE owner_id=? AND status IN ('queued','running'))
      AND (SELECT COUNT(*) FROM studio_pipeline_jobs WHERE owner_id=? AND created_at>=?)<3
      AND (SELECT COUNT(*) FROM studio_pipeline_jobs WHERE created_at>=?)<6
      ON CONFLICT(owner_id,idempotency_key) DO NOTHING`)
      .bind(id, owner, product.id, product.roomId, product.revision, idempotencyKey, hash, productJson, timestamp, timestamp, owner, owner, midnight, midnight).run();
    const inserted = await db.prepare('SELECT * FROM studio_pipeline_jobs WHERE owner_id=? AND idempotency_key=?').bind(owner, idempotencyKey).first<Row>();
    if (!inserted) problem(429, 'PIPELINE_LIMIT', 'Only one active model per person is allowed. The pilot also limits each person to 3 jobs and all users to 6 jobs per UTC day.');
    if (inserted.request_hash !== hash) problem(409, 'IDEMPOTENCY_CONFLICT', 'This request identifier belongs to a different product revision.');
    return json({ job: publicJob(inserted) }, 202);
  }
  const match = path.match(/^\/api\/pipeline\/jobs\/([\w.-]+)(\/cancel)?$/);
  if (match && ((request.method === 'GET' && !match[2]) || (request.method === 'POST' && match[2]))) {
    const id = identifier(match[1]), row = await rowById(db, id, owner);
    if (!row) problem(404, 'JOB_NOT_FOUND', 'This product model job is unavailable.');
    if (match[2]) {
      await db.prepare("UPDATE studio_pipeline_jobs SET status='cancelled',stage='cancelled',lease_expires_at=NULL,updated_at=? WHERE id=? AND owner_id=? AND status IN ('queued','running')").bind(now(), id, owner).run();
      return json({ job: publicJob((await rowById(db, id, owner))!) });
    }
    return json({ job: publicJob(row) });
  }
  return problem(404, 'NOT_FOUND', 'This pipeline action is unavailable.');
}
