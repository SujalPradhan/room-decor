import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { handleStudioRequest } from "../server/studio";
import { createProductDraft } from "../src/product-domain";
import type { Bucket, Database, Statement, StudioEnv } from "../server/types";
import type { ProductDraft, OperationRecord } from "../src/product-types";
const schema = readFileSync(new URL("../drizzle/0000_worried_maelstrom.sql", import.meta.url), "utf8") + "\n" + readFileSync(new URL("../drizzle/0001_nebulous_marvel_boy.sql", import.meta.url), "utf8");
const python = `import sqlite3,json,sys
p=json.load(sys.stdin)
c=sqlite3.connect(p['file']);c.row_factory=sqlite3.Row
out=[]
try:
 if 'schema' in p:c.executescript(p['schema'])
 for q in p.get('queries',[]):
  cur=c.execute(q['sql'],q.get('args',[]))
  rows=[dict(r) for r in cur.fetchall()] if cur.description else []
  out.append({'results':rows,'meta':{'changes':max(0,cur.rowcount)},'success':True})
 c.commit();print(json.dumps(out))
except Exception:
 c.rollback();raise
finally:c.close()
`;
const directories: string[] = [];
class SqliteD1 implements Database {
  readonly file: string;
  constructor() {
    const dir = mkdtempSync(path.join(tmpdir(), "roomshift-server-test-"));
    directories.push(dir);
    this.file = path.join(dir, "db.sqlite");
    this.execute([], schema);
  }
  execute(
    queries: { sql: string; args: unknown[] }[],
    initialSchema?: string,
  ): {
    results: Record<string, unknown>[];
    meta: { changes: number };
    success: boolean;
  }[] {
    return JSON.parse(
      execFileSync("python3", ["-c", python], {
        input: JSON.stringify({
          file: this.file,
          queries,
          schema: initialSchema,
        }),
        encoding: "utf8",
      }),
    );
  }
  prepare(sql: string): Statement {
    return new SqliteStatement(this, sql);
  }
  async batch<T = unknown>(statements: Statement[]): Promise<T[]> {
    return this.execute(
      statements.map((s) => ({
        sql: (s as SqliteStatement).sql,
        args: (s as SqliteStatement).args,
      })),
    ) as T[];
  }
}
class SqliteStatement implements Statement {
  args: unknown[] = [];
  constructor(
    readonly db: SqliteD1,
    readonly sql: string,
  ) {}
  bind(...values: unknown[]) {
    this.args = values;
    return this;
  }
  async first<T = Record<string, unknown>>() {
    return (this.db.execute([{ sql: this.sql, args: this.args }])[0]
      .results[0] ?? null) as T | null;
  }
  async all<T = Record<string, unknown>>() {
    return {
      results: this.db.execute([{ sql: this.sql, args: this.args }])[0]
        .results as T[],
    };
  }
  async run() {
    return this.db.execute([{ sql: this.sql, args: this.args }])[0];
  }
}
class MemoryBucket implements Bucket {
  files = new Map<string, Uint8Array>();
  async put(key: string, value: ArrayBuffer | Uint8Array | ReadableStream) {
    if (value instanceof ReadableStream) throw new Error("unused");
    this.files.set(
      key,
      new Uint8Array(value instanceof Uint8Array ? value : value.slice(0)),
    );
  }
  async get(key: string) {
    const bytes = this.files.get(key);
    return bytes
      ? {
          body: new Response(bytes.slice().buffer as ArrayBuffer).body!,
          arrayBuffer: async () => bytes.slice().buffer as ArrayBuffer,
        }
      : null;
  }
  async delete(key: string) {
    this.files.delete(key);
  }
}
type TestResponse = Omit<Response, 'json'> & { json(): Promise<any> };
const secret = 'test-worker-token-that-is-long-enough-to-be-valid';
function fixture() {
  const db = new SqliteD1(), bucket = new MemoryBucket();
  const env: StudioEnv = { DB: db, BUCKET: bucket, STUDIO_LOCAL_PIPELINE_ENABLED: 'true', ROOMSHIFT_WORKER_TOKEN: secret };
  const call = (pathname: string, body?: unknown, owner = 'alice', method = body === undefined ? 'GET' : 'POST') => handleStudioRequest(new Request(`https://roomshift.example${pathname}`, {
    method, headers: { 'oai-authenticated-user-id': owner, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body),
  }), env).then(response => response as TestResponse);
  const worker = (pathname: string, body: unknown = {}, lease?: string, auth = secret) => handleStudioRequest(new Request(`https://roomshift.example/api/pipeline/worker/${pathname}`, {
    method: 'POST', headers: { Authorization: `Bearer ${auth}`, 'oai-authenticated-user-id': 'mallory', ...(lease ? { 'X-Roomshift-Lease': lease } : {}), ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }) },
    body: body instanceof FormData ? body : JSON.stringify(body),
  }), env).then(response => response as TestResponse);
  return { db, bucket, env, call, worker };
}
function product(): ProductDraft {
  const p = createProductDraft('room-a');
  p.source = { retailer: 'flipkart', canonicalUrl: 'https://www.flipkart.com/snuzspace-fabric-manual-recliner/p/itmcbf4f034af5ba?pid=RECHK8KJZEVZWK37' };
  p.title = 'Recliner'; p.kind = 'chair';
  return p;
}
function resultForm(p: ProductDraft, operations: OperationRecord[] = [], invalid = false) {
  const form = new FormData();
  const bytes = invalid ? new Uint8Array([1, 2, 3]) : readFileSync(new URL('../public/assets/furniture.glb', import.meta.url));
  form.set('model', new File([bytes], 'product.glb', { type: 'model/gltf-binary' }));
  form.set('metadata', JSON.stringify({ product: p, warnings: ['Hidden geometry is inferred.'], operations }));
  return form;
}
async function queued(f: ReturnType<typeof fixture>, p = product(), key = 'request-1', owner = 'alice') {
  await f.worker('heartbeat', { online: true });
  const response = await f.call('/api/pipeline/jobs', { product: p, idempotencyKey: key }, owner);
  expect(response.status).toBe(202);
  return { p, job: (await response.json()).job };
}
afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('bounded outgoing local model pilot', () => {
  it('runs the outgoing worker once, passes the requested product, uploads reports and GLB, and announces offline', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'roomshift-worker-test-')); directories.push(dir);
    mkdirSync(path.join(dir, 'scripts', 'experiments'), { recursive: true });
    copyFileSync(new URL('../scripts/local-pipeline-worker.mjs', import.meta.url), path.join(dir, 'scripts', 'local-pipeline-worker.mjs'));
    copyFileSync(new URL('../public/assets/furniture.glb', import.meta.url), path.join(dir, 'fixture.glb'));
    const p = product(), job = { id: 'worker-smoke-test', productId: p.id, roomId: p.roomId, requestedRevision: p.revision, createdAt: p.createdAt };
    writeFileSync(path.join(dir, 'scripts', 'experiments', 'product-to-model.mjs'), `
      import {readFile,writeFile} from 'node:fs/promises'; import {resolve} from 'node:path';
      const out=process.argv[3], input=process.argv[process.argv.indexOf('--product-file')+1];
      const product=JSON.parse(await readFile(input,'utf8'));
      console.log('ROOMSHIFT_STAGE '+JSON.stringify({stage:'reconstructing'}));
      await writeFile(resolve(out,'product.json'),JSON.stringify(product));
      await writeFile(resolve(out,'pipeline-report.json'),JSON.stringify({generation:{elapsedSeconds:0.1},conversion:{conversionSeconds:0.05,fileBytes:100}}));
      await writeFile(resolve(out,'snuzspace-recliner-experimental.glb'),await readFile(resolve('fixture.glb')));
      console.log('ROOMSHIFT_STAGE '+JSON.stringify({stage:'ready'}));
    `);
    writeFileSync(path.join(dir, 'mock-site.mjs'), `
      import {writeFile} from 'node:fs/promises';
      const trace=[]; const product=${JSON.stringify(p)}, job=${JSON.stringify(job)};
      globalThis.fetch=async(input,init)=>{
        if(init.headers.Authorization!=='Bearer '+process.env.ROOMSHIFT_WORKER_TOKEN) throw Error('Missing worker auth');
        const path=new URL(input).pathname; trace.push(path);
        let data={ok:true};
        if(path.endsWith('/claim'))data={job,product,leaseToken:'test-lease'};
        if(path.endsWith('/complete')){
          const report=JSON.parse(init.body.get('metadata'));
          if(report.product.id!==product.id||report.operations.length!==2||init.body.get('model').size<100)throw Error('Invalid worker report');
          data={job:{...job,status:'succeeded'}};
        }
        if(path.endsWith('/heartbeat')&&!JSON.parse(init.body).online)await writeFile('trace.json',JSON.stringify(trace));
        return Response.json(data);
      };
    `);
    const output = execFileSync(process.execPath, ['--import', path.join(dir, 'mock-site.mjs'), path.join(dir, 'scripts', 'local-pipeline-worker.mjs')], {
      cwd: dir, encoding: 'utf8', timeout: 10_000,
      env: { ...process.env, ROOMSHIFT_WORKER_TOKEN: secret, ROOMSHIFT_SITE_URL: 'https://roomshift.example' },
    });
    const trace = JSON.parse(readFileSync(path.join(dir, 'trace.json'), 'utf8')) as string[];
    expect(trace.filter(p => p.endsWith('/claim'))).toHaveLength(1);
    expect(trace.filter(p => p.endsWith('/complete'))).toHaveLength(1);
    expect(output).toContain('ready for owner review'); expect(output).toContain('offline after 1 job');
    expect(output).not.toContain(secret);
    const lockPath = path.join(dir, 'artifacts', 'local-worker.lock');
    const priorLock = JSON.stringify({ pid: process.pid, nonce: 'other-process', startedAt: new Date().toISOString() });
    writeFileSync(lockPath, priorLock);
    expect(() => execFileSync(process.execPath, ['--import', path.join(dir, 'mock-site.mjs'), path.join(dir, 'scripts', 'local-pipeline-worker.mjs')], {
      cwd: dir, encoding: 'utf8', timeout: 10_000, stdio: 'pipe',
      env: { ...process.env, ROOMSHIFT_WORKER_TOKEN: secret, ROOMSHIFT_SITE_URL: 'https://roomshift.example' },
    })).toThrow();
    expect(readFileSync(lockPath, 'utf8')).toBe(priorLock);

  });

  it('keeps the session harmless while unconfigured; requires sign-in and the real worker token', async () => {
    const f = fixture();
    const disabled = await handleStudioRequest(new Request('https://roomshift.example/api/pipeline/session'), {});
    expect(await disabled.json()).toMatchObject({ enabled: false, online: false, remainingJobs: 0 });
    expect((await f.call('/api/pipeline/jobs', { product: product(), idempotencyKey: 'a' }, '')).status).toBe(401);
    expect((await f.worker('heartbeat', { online: true }, undefined, 'wrong')).status).toBe(401);
    expect((await f.call('/api/pipeline/worker/heartbeat', { online: true }, 'alice')).status).toBe(401);
    expect((await f.call('/api/pipeline/jobs', { product: product(), idempotencyKey: 'a' })).status).toBe(503);
    expect(await (await f.call('/api/pipeline/session')).json()).toMatchObject({ enabled: true, online: false, remainingJobs: 3 });
  });

  it('deduplicates requests before quotas and rejects reuse for different input', async () => {
    const f = fixture(), { p, job } = await queued(f);
    const duplicate = await f.call('/api/pipeline/jobs', { product: p, idempotencyKey: 'request-1' });
    expect(duplicate.status).toBe(200); expect((await duplicate.json()).job.id).toBe(job.id);
    const changed = { ...p, revision: p.revision + 1 };
    expect((await f.call('/api/pipeline/jobs', { product: changed, idempotencyKey: 'request-1' })).status).toBe(409);
    expect((await f.call('/api/pipeline/jobs', { product: p, idempotencyKey: 'request-2' })).status).toBe(429);
    expect((await f.db.prepare('SELECT COUNT(*) AS n FROM studio_pipeline_jobs').first<{ n: number }>())?.n).toBe(1);
  });

  it('bounds concurrent requests, counts cancelled attempts, and enforces personal and global UTC-day limits', async () => {
    const f = fixture(); await f.worker('heartbeat', { online: true });
    const p = product();
    const responses = await Promise.all(['a', 'b'].map(key => f.call('/api/pipeline/jobs', { product: p, idempotencyKey: key })));
    expect(responses.map(r => r.status).sort()).toEqual([202, 429]);
    const accepted = await responses.find(r => r.status === 202)!.json();
    await f.call(`/api/pipeline/jobs/${accepted.job.id}/cancel`, {});
    for (const key of ['c', 'd']) {
      const { job } = await queued(f, p, key);
      await f.call(`/api/pipeline/jobs/${job.id}/cancel`, {});
    }
    expect((await f.call('/api/pipeline/jobs', { product: p, idempotencyKey: 'e' })).status).toBe(429);
    for (const owner of ['bob', 'carol', 'dave']) {
      const { job } = await queued(f, p, owner, owner);
      await f.call(`/api/pipeline/jobs/${job.id}/cancel`, {}, owner);
    }
    expect((await f.call('/api/pipeline/jobs', { product: p, idempotencyKey: 'erin' }, 'erin')).status).toBe(429);
    expect(await (await f.call('/api/pipeline/session', undefined, 'erin')).json()).toMatchObject({ remainingJobs: 0 });
  });

  it('claims once, hides lease credentials from owners, and prevents cross-owner access or cancellation', async () => {
    const f = fixture(), { job } = await queued(f);
    const claims = await Promise.all([f.worker('claim'), f.worker('claim')]);
    const results = await Promise.all(claims.map(r => r.json()));
    expect(results.filter(r => r.job)).toHaveLength(1);
    const claim = results.find(r => r.job);
    expect(claim.job.id).toBe(job.id); expect(claim.leaseToken.length).toBeGreaterThan(32);
    const publicResult = await (await f.call(`/api/pipeline/jobs/${job.id}`)).json();
    expect(JSON.stringify(publicResult)).not.toContain(claim.leaseToken);
    expect(publicResult.job).not.toHaveProperty('owner_id');
    expect((await f.call(`/api/pipeline/jobs/${job.id}`, undefined, 'bob')).status).toBe(404);
    expect((await f.call(`/api/pipeline/jobs/${job.id}/cancel`, {}, 'bob')).status).toBe(404);
    expect((await f.worker(`jobs/${job.id}/progress`, { stage: 'analyzing' }, 'wrong')).status).toBe(409);
    expect((await f.worker(`jobs/${job.id}/progress`, { stage: 'analyzing' }, claim.leaseToken)).status).toBe(200);
  });

  it('rejects invalid/stale models, saves a valid result privately without overwriting the product, and rejects replay', async () => {
    const f = fixture(), { p, job } = await queued(f), claim = await (await f.worker('claim')).json();
    expect((await f.worker(`jobs/${job.id}/complete`, resultForm(p, [], true), claim.leaseToken)).status).toBe(400);
    expect((await f.worker(`jobs/${job.id}/complete`, resultForm({ ...p, id: "wrong-product" }), claim.leaseToken)).status).toBe(409);
    const operation: OperationRecord = {
      id: 'untrusted-report-id', roomId: 'wrong-room', productId: 'wrong-product', attempt: 1,
      kind: 'image-preparation', name: 'Interpret product image', engine: 'Foundry', model: 'gemini-2.5-flash', provider: 'Foundry', status: 'succeeded',
      submittedAt: p.createdAt, finishedAt: p.createdAt, timing: { elapsedMs: 125, processingMs: 125, source: 'observed' },
      usage: { inputTokens: 100, outputTokens: 20 }, cost: { basis: 'unknown', note: 'Token usage measured; account pricing is not configured.' },
    };
    const progress = await f.worker(`jobs/${job.id}/progress`, { stage: 'reconstructing', operations: [operation] }, claim.leaseToken);
    expect(progress.status).toBe(200);
    expect((await (await f.call('/api/operations')).json()).operations).toHaveLength(1);
    const response = await f.worker(`jobs/${job.id}/complete`, resultForm({ ...p, revision: p.revision + 1,dimensions:{...p.dimensions,width:{metres:null,origin:'unknown',confirmed:false}},model:{...p.model,placementDimensions:{width:.8,depth:.9,height:1.1},scaleSource:'estimated'} }, [operation]), claim.leaseToken);
    expect(response.status).toBe(200);
    const completed = (await response.json()).job;
    expect(completed.status).toBe('succeeded'); expect(completed.result.product.id).toBe(p.id);
    expect(completed.result.product.revision).toBe(p.revision + 1);
    expect(completed.result.product.model.draftRevision).toBe(p.revision + 1);
    expect(completed.requestedRevision).toBe(p.revision);expect(completed.result.product.model.placementDimensions).toEqual({width:.8,depth:.9,height:1.1});expect(completed.result.product.model.scaleSource).toBe('estimated');expect(completed.result.product.dimensions.width.metres).toBeNull();
    expect(completed.result.product.dimensions.width.confirmed).toBe(false);
    expect(completed.operations[0]).toMatchObject({ id: `${job.id}-0`, roomId: p.roomId, productId: p.id, usage: { inputTokens: 100 } });
    expect(f.bucket.files.size).toBe(1);
    expect((await f.call(completed.result.url)).status).toBe(200);
    expect((await f.call(completed.result.url, undefined, 'bob')).status).toBe(404);
    expect((await f.call(completed.result.url, undefined, 'mallory')).status).toBe(404);
    expect((await f.call('/api/products')).status).toBe(200);
    expect((await (await f.call('/api/products')).json()).products).toEqual([]);
    expect((await (await f.call('/api/operations')).json()).operations).toHaveLength(1);
    expect((await f.worker(`jobs/${job.id}/complete`, resultForm(p), claim.leaseToken)).status).toBe(409);
    expect(f.bucket.files.size).toBe(1);
  });

  it('makes cancellation win against a completion already uploading and cleans its R2 object', async () => {
    const f = fixture(), { p, job } = await queued(f), claim = await (await f.worker('claim')).json();
    const originalPut = f.bucket.put.bind(f.bucket);
    f.bucket.put = async (key, bytes) => {
      await originalPut(key, bytes);
      await f.call(`/api/pipeline/jobs/${job.id}/cancel`, {});
    };
    expect((await f.worker(`jobs/${job.id}/complete`, resultForm(p), claim.leaseToken)).status).toBe(409);
    expect(f.bucket.files.size).toBe(0);
    expect((await f.db.prepare('SELECT COUNT(*) AS n FROM studio_assets').first<{ n: number }>())?.n).toBe(0);
    expect((await (await f.call(`/api/pipeline/jobs/${job.id}`)).json()).job.status).toBe('cancelled');
  });

  it('retains completed billable usage after cancellation without accepting stale models or exposing the reporting capability', async () => {
    const f = fixture(), { p, job } = await queued(f), claim = await (await f.worker('claim')).json();
    const operation: OperationRecord = {
      id: 'foundry-usage', roomId: p.roomId, attempt: 1, kind: 'image-preparation', name: 'Foundry vision', engine: 'Foundry',
      status: 'succeeded', submittedAt: p.createdAt, timing: { elapsedMs: 220, source: 'observed' },
      usage: { inputTokens: 1679, outputTokens: 227 }, cost: { basis: 'unknown' },
    };
    await f.worker(`jobs/${job.id}/progress`, { stage: 'reconstructing', operations: [operation] }, claim.leaseToken);
    await f.call(`/api/pipeline/jobs/${job.id}/cancel`, {});
    expect((await (await f.call('/api/operations')).json()).operations[0].usage.inputTokens).toBe(1679);
    expect((await f.worker(`jobs/${job.id}/usage`, { operations: [operation] }, 'wrong')).status).toBe(409);
    expect((await f.worker(`jobs/${job.id}/usage`, { operations: [operation] }, claim.leaseToken)).status).toBe(200);
    expect((await f.worker(`jobs/${job.id}/complete`, resultForm(p), claim.leaseToken)).status).toBe(409);
    const state = (await (await f.call(`/api/pipeline/jobs/${job.id}`)).json()).job;
    expect(state.status).toBe('cancelled'); expect(state.result).toBeUndefined();
    expect(JSON.stringify(state)).not.toContain(claim.leaseToken);
    expect((await (await f.call('/api/operations')).json()).operations).toHaveLength(1);
  });

  it('expires leases and offline heartbeats without automatically regenerating or accepting late results', async () => {
    const f = fixture(), { p, job } = await queued(f), claim = await (await f.worker('claim')).json();
    await f.db.prepare("UPDATE studio_pipeline_jobs SET lease_expires_at='2000-01-01T00:00:00.000Z' WHERE id=?").bind(job.id).run();
    await f.db.prepare("UPDATE studio_pipeline_workers SET updated_at='2000-01-01T00:00:00.000Z'").run();
    expect(await (await f.call('/api/pipeline/session')).json()).toMatchObject({ online: false });
    expect((await (await f.call(`/api/pipeline/jobs/${job.id}`)).json()).job.status).toBe('failed');
    expect((await f.worker(`jobs/${job.id}/complete`, resultForm(p), claim.leaseToken)).status).toBe(409);
    expect(await (await f.worker('claim')).json()).toEqual({ job: null });
    expect(f.bucket.files.size).toBe(0);
  });

  it('stores real usage from failed attempts with fixed public failure text and immutable owner scope', async () => {
    const f = fixture(), { p, job } = await queued(f), claim = await (await f.worker('claim')).json();
    const operation: OperationRecord = {
      id: 'provider-report', roomId: 'wrong', attempt: 1, kind: 'image-preparation', name: 'Foundry image analysis', engine: 'Foundry',
      status: 'succeeded', submittedAt: p.createdAt, timing: { elapsedMs: 31, source: 'observed' }, usage: { inputTokens: 155, outputTokens: 8 }, cost: { basis: 'unknown' },
    };
    const response = await f.worker(`jobs/${job.id}/fail`, { error: '/private/local/.env provider secret', operations: [operation] }, claim.leaseToken);
    expect(response.status).toBe(200);
    const result = (await response.json()).job;
    expect(result.status).toBe('failed'); expect(result.error).not.toContain('.env');
    expect(result.operations[0].usage.inputTokens).toBe(155);
    expect((await (await f.call('/api/operations')).json()).operations[0].roomId).toBe(p.roomId);
    expect((await (await f.call('/api/operations', undefined, 'mallory')).json()).operations).toHaveLength(0);
  });
});
