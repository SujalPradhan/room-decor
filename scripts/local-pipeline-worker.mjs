#!/usr/bin/env node
/** Outgoing-only, bounded laptop pilot. Launch with Node's --env-file option. */
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, open, unlink } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
function option(name, fallback) {
  const index = args.indexOf(name); return index < 0 ? fallback : args[index + 1];
}
const maxJobs = Number(option('--max-jobs', '1'));
const idleSeconds = Number(option('--idle-seconds', '300'));
if (!Number.isInteger(maxJobs) || maxJobs < 1 || maxJobs > 6 || !Number.isInteger(idleSeconds) || idleSeconds < 1 || idleSeconds > 3600)
  throw Error('Use --max-jobs 1..6 and --idle-seconds 1..3600.');
let base;
try { base = new URL(process.env.ROOMSHIFT_SITE_URL ?? 'https://invalid.local'); }
catch { console.error('Configure ROOMSHIFT_SITE_URL with a valid site origin.'); process.exit(1); }
const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
if ((base.protocol !== 'https:' && !(base.protocol === 'http:' && loopback)) || base.username || base.password || base.pathname !== '/' || base.search || base.hash || base.hostname === 'invalid.local')
  throw Error('Set ROOMSHIFT_SITE_URL to an HTTPS site origin (HTTP is allowed only on literal loopback hosts).');
const token = process.env.ROOMSHIFT_WORKER_TOKEN;
if (!token || token.length < 32) throw Error('Configure a shared ROOMSHIFT_WORKER_TOKEN of at least 32 characters locally and on the site.');
let stopping = false, child = null, active = null, leaseLost = false;
const sleep = milliseconds => new Promise(done => setTimeout(done, milliseconds));
function stopChild() {
  if (!child?.pid) return;
  const pid = child.pid;
  try { process.kill(-pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch {} }
  const timer = setTimeout(() => { try { process.kill(-pid, 'SIGKILL'); } catch {} }, 3000);
  timer.unref();
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopping = true; stopChild(); });
async function api(path, body, leaseToken) {
  const headers = { Authorization: `Bearer ${token}`, ...(leaseToken ? { 'X-Roomshift-Lease': leaseToken } : {}) };
  if (!(body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const response = await fetch(new URL(`/api/pipeline/worker/${path}`, base), {
    method: 'POST', headers, body: body instanceof FormData ? body : JSON.stringify(body ?? {}), signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) {
    const error = Error(`Worker endpoint returned HTTP ${response.status}.`); error.status = response.status; throw error;
  }
  return response.json();
}
async function heartbeat(online = true) { return api('heartbeat', { online }); }
async function progress() {
  if (!active || leaseLost) return;
  try {
    const foundry = await optionalJson(resolve(active.directory, 'foundry-analysis.json'));
    await api(`jobs/${active.job.id}/progress`, { stage: active.stage, operations: foundry?.operation ? [foundry.operation] : [] }, active.leaseToken);
  }
  catch (error) {
    if (error.status === 409) { leaseLost = true; stopChild(); console.log('Job cancelled or lease expired; stopping local processing.'); }
    else console.log('Job heartbeat could not be delivered; retrying while the lease remains valid.');
  }
}
async function optionalJson(file) { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return null; } }
function localOperation(job, name, kind, engine, start, seconds, extra = {}) {
  const duration = Math.max(0, seconds * 1000);
  return {
    id: crypto.randomUUID(), roomId: job.roomId, productId: job.productId, attempt: 1, name, kind, engine, status: 'succeeded',
    submittedAt: start, startedAt: start, finishedAt: new Date(Date.parse(start) + duration).toISOString(),
    timing: { processingMs: duration, elapsedMs: duration, source: 'local' }, usage: {},
    cost: { basis: 'local', note: 'Local computation; device, electricity, storage and downloads are unmetered. No external 3D-generation API call.' }, ...extra,
  };
}
async function reports(directory, job, times, startedAt, final = false) {
  const report = await optionalJson(resolve(directory, 'pipeline-report.json'));
  const foundry = await optionalJson(resolve(directory, 'foundry-analysis.json'));
  const generation = report?.generation ?? await optionalJson(resolve(directory, 'generation-report.json'));
  const conversion = report?.conversion ?? await optionalJson(resolve(directory, 'conversion-report.json'));
  const operations = [];
  if (foundry?.operation) {
    const op={...foundry.operation,roomId:job.roomId,productId:job.productId};
    if(final&&['queued','running'].includes(op.status)){op.status='unknown';op.finishedAt=new Date().toISOString();op.timing={elapsedMs:Math.max(0,Date.now()-Date.parse(op.submittedAt)),source:'observed'};}
    operations.push(op);
  }
  if (generation && Number.isFinite(generation.elapsedSeconds))
    operations.push(localOperation(job, 'Reconstruct product geometry', 'model-generation', 'Local TripoSR', times.reconstructing ?? startedAt, generation.elapsedSeconds, {
      model: generation.model ?? 'stabilityai/TripoSR', usage: { imageCount: 1 },
      timing: { processingMs: generation.elapsedSeconds * 1000, elapsedMs: generation.elapsedSeconds * 1000, queueMs: Math.max(0, Date.parse(startedAt) - Date.parse(job.createdAt)), source: 'local' },
    }));
  if (conversion && Number.isFinite(conversion.conversionSeconds))
    operations.push(localOperation(job, 'Scale and package product model', 'model-import', 'Local Blender', times.converting ?? startedAt, conversion.conversionSeconds, { usage: { ...(Number.isFinite(conversion.fileBytes) ? { bytes: conversion.fileBytes } : {}) } }));
  return { report, foundry, conversion, operations };
}
async function runJob(claim) {
  const { job, product, leaseToken } = claim;
  if (!/^[\w.-]{1,128}$/.test(job.id)) throw Error('The queue supplied an invalid job ID.');
  const directory = resolve(root, 'artifacts', 'pipeline-jobs', job.id, 'output');
  await mkdir(directory, { recursive: true });
  const input = resolve(directory, 'requested-product.json');
  await writeFile(input, JSON.stringify(product, null, 2), { mode: 0o600 });
  const url = product.source.canonicalUrl ?? product.source.submittedUrl;
  if (typeof url !== 'string' || !url.startsWith('https://')) throw Error('The queue supplied an invalid product link.');
  const startedAt = new Date().toISOString(), times = { reading: startedAt };
  leaseLost = false; active = { job, leaseToken, stage: 'reading', directory };
  console.log(`Processing job ${job.id}.`);
  async function cancelledUsage() {
    const { operations } = await reports(directory, job, times, startedAt, true);
    const interrupted = localOperation(job, 'Interrupted model pipeline', 'validation', 'Local pipeline worker', startedAt, 0, {
      status: 'failed', finishedAt: new Date().toISOString(), timing: { elapsedMs: Date.now() - Date.parse(startedAt), source: 'observed' },
      cost: { basis: 'unknown', note: 'Processing was interrupted. Completed usage is retained; an in-flight provider request that never returned may have additional unreported usage.' }, errorCode: 'PIPELINE_INTERRUPTED',
    });
    try { await api(`jobs/${job.id}/usage`, { operations: [...operations, interrupted] }, leaseToken); }
    catch { console.log('Interrupted usage report could not be delivered; local reports are retained.'); }
  }
  // Keep this Mac awake only during an actual job; idle polling never prevents sleep.
  let awake = null;
  if (process.platform === 'darwin') {
    awake = spawn('/usr/bin/caffeinate', ['-i', '-w', String(process.pid)], { stdio: 'ignore' });
    awake.once('error', () => {});
  }
  let line = '';
  const jobTimeout = setTimeout(() => { stopChild(); }, 15 * 60_000);
  jobTimeout.unref();
  try {
    const code = await new Promise((done, reject) => {
      child = spawn(process.execPath, ['scripts/experiments/product-to-model.mjs', url, directory, '--product-file', input], {
        cwd: root, detached: true, env: process.env, stdio: ['ignore', 'pipe', 'pipe'],
      });
      // Only emit our bounded progress markers; raw provider output never reaches public reports.
      child.stdout.on('data', bytes => {
        line += bytes.toString();
        if (line.length > 100_000) line = line.slice(-10_000);
        let next;
        while ((next = line.indexOf('\n')) >= 0) {
          const current = line.slice(0, next).trim(); line = line.slice(next + 1);
          if (!current.startsWith('ROOMSHIFT_STAGE ')) continue;
          try {
            const event = JSON.parse(current.slice(16));
            if (['reading', 'analyzing', 'preparing', 'reconstructing', 'converting', 'ready'].includes(event.stage)) {
              active.stage = event.stage; times[event.stage] ??= new Date().toISOString();
              console.log(`Job stage: ${event.stage}.`);
            }
          } catch {}
        }
      });
      child.stderr.on('data', () => {});
      child.once('error', reject); child.once('close', done);
    });
    child = null;
    if (leaseLost) { await cancelledUsage(); return; }
    if (code !== 0 || stopping) throw Error('The local pipeline did not finish.');
    await progress(); if (leaseLost) { await cancelledUsage(); return; }
    const { report, foundry, conversion, operations } = await reports(directory, job, times, startedAt);
    const result = JSON.parse(await readFile(resolve(directory, 'product.json'), 'utf8'));
    const bytes = await readFile(resolve(directory, 'snuzspace-recliner-experimental.glb'));
    if (bytes.byteLength > 30_000_000) throw Error('The generated GLB exceeds 30 MB.');
    const warnings = [...new Set([
      'AI-inferred geometry. Hidden surfaces, orientation and appearance require visual review.',
      'Retailer dimensions are not independently measured; verify fit before buying.',
      ...(result.specificationWarnings ?? []), ...(report?.limitations ?? []),
      ...(conversion?.geometryWarnings ?? []), ...(foundry?.analysis?.warnings ?? []),
    ].filter(value => typeof value === 'string').map(value => value.slice(0, 1000)))].slice(0, 30);
    const form = new FormData();
    form.append('metadata', JSON.stringify({ product: result, warnings, operations }));
    form.append('model', new Blob([bytes], { type: 'model/gltf-binary' }), 'product.glb');
    active.stage='uploading';await progress();if(leaseLost){await cancelledUsage();return;}
    await api(`jobs/${job.id}/complete`, form, leaseToken);
    console.log(`Job ${job.id} is ready for owner review.`);
  } catch (error) {
    if (error.status === 409) { leaseLost = true; console.log('A stale completion was discarded.'); }
    if (leaseLost) await cancelledUsage();
    if (!leaseLost) {
      const { operations } = await reports(directory, job, times, startedAt, true);
      const failed = localOperation(job, 'Product model pipeline', 'validation', 'Local pipeline worker', startedAt, (Date.now() - Date.parse(startedAt)) / 1000, { status: 'failed', errorCode: stopping ? 'WORKER_STOPPED' : 'LOCAL_PIPELINE_FAILED', timing: { elapsedMs: Date.now() - Date.parse(startedAt), source: 'observed' } });
      try { await api(`jobs/${job.id}/fail`, { operations: [...operations, failed] }, leaseToken); }
      catch { console.log('Failure report could not be delivered; the lease will expire safely.'); }
      console.log(`Job ${job.id} did not complete. No model was applied.`);
    }
  } finally { clearTimeout(jobTimeout); awake?.kill('SIGTERM'); active = null; child = null; }
}
const lockPath = resolve(root, 'artifacts', 'local-worker.lock');
const lock = { pid: process.pid, nonce: crypto.randomUUID(), startedAt: new Date().toISOString() };
async function processExists(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return true;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}
async function acquireLock() {
  await mkdir(dirname(lockPath), { recursive: true });
  async function create() {
    const file = await open(lockPath, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(lock)); } finally { await file.close(); }
  }
  try { await create(); return; } catch (error) { if (error.code !== 'EEXIST') throw error; }
  // Serialize stale-lock recovery too: two starters must not delete each other's fresh lock.
  let recovery;
  try { recovery = await open(lockPath + '.recovery', 'wx', 0o600); }
  catch { throw Error('Another laptop worker is starting. Wait briefly and retry.'); }
  try {
    const existing = await optionalJson(lockPath);
    if (!existing || await processExists(existing.pid))
      throw Error('A laptop worker is already running (or its lock cannot be verified). Close that worker before starting another.');
    await unlink(lockPath); await create();
  } finally { await recovery.close(); await unlink(lockPath + '.recovery').catch(() => {}); }
}
async function releaseLock() {
  const current = await optionalJson(lockPath);
  if (current?.nonce === lock.nonce && current.pid === process.pid) await unlink(lockPath).catch(() => {});
}
try { await acquireLock(); }
catch (error) { console.error(error.message); process.exit(1); }
let tickPending = null;
const tick = setInterval(() => {
  if (tickPending) return;
  tickPending = (async () => {
    try { await heartbeat(!stopping); await progress(); } catch { console.log('Worker heartbeat unavailable; retrying.'); }
    finally { tickPending = null; }
  })();
}, 10_000);
let processed = 0, idleSince = Date.now();
try {
  await heartbeat();
  console.log(`Laptop worker online; will process at most ${maxJobs} job(s), then stop.`);
  while (!stopping && processed < maxJobs && Date.now() - idleSince < idleSeconds * 1000) {
    let claim;
    try { claim = await api('claim'); }
    catch (error) {
      if ([401,403].includes(error.status)) throw error;
      console.log('The queue connection was interrupted. Waiting before checking again.');
      await sleep(3000); continue;
    }
    if (!claim.job) { await sleep(3000); continue; }
    processed++; await runJob(claim); idleSince = Date.now();
  }
} catch { console.error('Worker stopped because the site connection or configuration was unavailable. No credentials were logged.'); process.exitCode = 1; }
finally {
  stopping = true; clearInterval(tick); stopChild();
  if (tickPending) await tickPending;
  try { await heartbeat(false); } catch {}
  await releaseLock();
  console.log(`Laptop worker offline after ${processed} job(s).`);
}
