import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLocalOperation, elapsedIntervalMs, filterOperations, mergeOperations, operationsToCsv, summarizeOperations, validateOperationRecord } from '../src/ledger';
import type { OperationRecord, StudioSession } from '../src/product-types';
import { createProductDraft } from '../src/product-domain';

const base = (id = 'one', overrides: Partial<OperationRecord> = {}): OperationRecord => ({ id, roomId: 'room', name: 'Generate desk', attempt: 1, kind: 'model-generation', status: 'succeeded', engine: 'API', provider: 'provider-a', model: 'pinned', submittedAt: '2026-10-29T00:00:00Z', startedAt: '2026-10-29T00:00:01Z', finishedAt: '2026-10-29T00:00:10Z', timing: { queueMs: 1000, processingMs: 9000, elapsedMs: 10000, source: 'provider' }, usage: { credits: 30, creditUnit: 'credits' }, cost: { basis: 'reported', amountMicros: 300000, currency: 'USD' }, ...overrides });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('usage ledger', () => {
  it('deduplicates polling updates without allowing a stale queued snapshot to reverse completion', () => {
    const done = base();
    const rows = mergeOperations([done], [done, base('one', { status: 'queued', finishedAt: undefined, usage: {}, cost: { basis: 'estimated', amountMicros: 100000, currency: 'USD' } })]);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('succeeded');
    expect(summarizeOperations(rows).money[0].amountMicros).toBe(300000);
  });
  it('keeps currencies and provider-specific credits separate and differentiates unknown from local processing', () => {
    const rows = [base(), base('two', { provider: 'provider-b', cost: { basis: 'estimated', amountMicros: 25000000, currency: 'INR' } }), base('unknown', { usage: {}, cost: { basis: 'unknown', amountMicros: null } }), createLocalOperation({ roomId: 'room', name: 'Blender bake', engine: 'Blender Cycles', kind: 'render', elapsedMs: 2000 })];
    const summary = summarizeOperations(rows);
    expect(summary.money).toEqual([{ currency: 'INR', amountMicros: 25000000, estimatedMicros: 25000000, reportedMicros: 0 }, { currency: 'USD', amountMicros: 300000, estimatedMicros: 0, reportedMicros: 300000 }]);
    expect(summary.credits).toHaveLength(2);
    expect(summary.localCount).toBe(1);
    expect(summary.unknownCostCount).toBe(1);
  });
  it('does not subtract a refunded failed task twice or erase other successful usage', () => {
    const summary = summarizeOperations([base(), base('failed', { status: 'failed', usage: { credits: 0, creditUnit: 'credits' }, cost: { basis: 'reported', amountMicros: 0, currency: 'USD', refundedCredits: 30 } })]);
    expect(summary.credits[0]).toMatchObject({ used: 30, net: 30, refunded: 30 });
    expect(summary.money[0].amountMicros).toBe(300000);
  });
  it('keeps a model quote separate from reported consumption and unpriced cash', () => {
    const record = base('quote', { usage: {}, estimate: { credits: 30, creditUnit: 'credits', rateId: 'dated-price' }, cost: { basis: 'estimated', amountMicros: null } });
    const summary = summarizeOperations([record]);
    expect(summary.credits[0]).toMatchObject({ estimated: 30, used: 0, net: 0 });
    expect(summary.money).toEqual([]);
    expect(summary.unknownCostCount).toBe(1);
    expect(operationsToCsv([record])).toContain('Estimated credits');
    expect(summarizeOperations([base('a', { usage: { credits: .1, creditUnit: 'credits' } }), base('b', { usage: { credits: .2, creditUnit: 'credits' } })]).credits[0].used).toBe(.3);
  });
  it('measures overlapping elapsed intervals separately from summed processing work', () => {
    const s = summarizeOperations([base('a', { startedAt: '2026-10-29T00:00:00Z', timing: { source: 'local', processingMs: 10000 } }), base('b', { submittedAt: '2026-10-29T00:00:05Z', finishedAt: '2026-10-29T00:00:15Z', timing: { source: 'local', processingMs: 10000 } })]);
    expect(s.workMs).toBe(20000); expect(s.elapsedMs).toBe(15000);
    expect(elapsedIntervalMs([[0, 10], [5, 15], [30, 35]])).toBe(20);
  });
  it('filters by room/item/provider/date and counts retries as separate real attempts', () => {
    const retry = base('retry', { attempt: 2, productId: 'desk' });
    expect(summarizeOperations([base(), retry]).money[0].amountMicros).toBe(600000);
    expect(filterOperations([base(), retry], { productId: 'desk' })).toEqual([retry]);
    expect(filterOperations([base(), retry], { roomId: 'another' })).toEqual([]);
    expect(filterOperations([base()], { from: '2026-11-01' })).toEqual([]);
  });
  it('does not count a reused result as a second charge or new work', () => {
    const summary = summarizeOperations([base(), base('reuse', { reusedFrom: 'one' })]);
    expect(summary.operationCount).toBe(2); expect(summary.money[0].amountMicros).toBe(300000); expect(summary.workMs).toBe(9000);
  });
  it('escapes CSV delimiters, newlines and spreadsheet formulas', () => {
    const csv = operationsToCsv([base('a', { name: '=IMPORTXML("evil","x")', roomName: '+Room,\n"quoted"' })]);
    expect(csv).toContain('"\'=IMPORTXML(""evil"",""x"")"');
    expect(csv).toContain('"\'+Room,\n""quoted"""');
    expect(csv).toContain('Cost basis');
    expect(csv).toContain('"reported"');
  });
  it('rejects fabricated historical totals, nonfinite quantities, missing currencies and negative durations', () => {
    expect(() => validateOperationRecord(base('bad', { cost: { basis: 'unknown', amountMicros: 0, currency: 'USD' } }))).toThrow(/invented/);
    expect(() => validateOperationRecord(base('bad', { usage: { credits: Infinity } }))).toThrow(/finite/);
    expect(() => validateOperationRecord(base('bad', { timing: { source: 'local', processingMs: -1 } }))).toThrow(/finite/);
    expect(() => validateOperationRecord(base('bad', { cost: { basis: 'reported', amountMicros: 12 } }))).toThrow(/currency/);
  });
});
describe('local product persistence and disabled generation', () => {
  it('isolates account products, operations and image binaries, including a write pending at sign-out', async () => {
    const values = new Map<string, string>();
    vi.stubGlobal('indexedDB', undefined);
    vi.stubGlobal('localStorage', { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v) });
    vi.resetModules(); const storage = await import('../src/product-storage');
    storage.setProductStorageScope('account-a');
    const product = createProductDraft('room-a');
    await storage.saveProduct(product);
    const image = await storage.saveProductImage(new File(['image bytes'], 'photo.png', { type: 'image/png' }), product.id);
    const pending = storage.saveOperation(base('pending-a'));
    storage.setProductStorageScope('account-b');
    await pending;
    expect((await storage.loadProductWorkspace()).products).toEqual([]);
    expect((await storage.loadProductWorkspace()).operations).toEqual([]);
    expect(await storage.getProductImage(image.id)).toBeNull();
    await storage.saveProduct(createProductDraft('room-b'));
    storage.setProductStorageScope('account-a');
    const a = await storage.loadProductWorkspace();
    expect(a.products.map(p => p.id)).toEqual([product.id]);
    expect(a.operations.map(o => o.id)).toEqual(['pending-a']);
    expect(await (await storage.getProductImage(image.id))!.text()).toBe('image bytes');
    storage.setProductStorageScope('device');
    expect((await storage.loadProductWorkspace()).products).toEqual([]);
  });
  it('falls back to durable localStorage and retains products/operations across module reload', async () => {
    const values = new Map<string, string>();
    vi.stubGlobal('indexedDB', undefined);
    vi.stubGlobal('localStorage', { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v) });
    vi.resetModules();
    let storage = await import('../src/product-storage');
    const draft = createProductDraft('room');
    expect(await storage.saveProduct(draft)).toMatchObject({ mode: 'localstorage', persistent: true });
    await storage.saveOperation(base());
    vi.resetModules(); storage = await import('../src/product-storage');
    const loaded = await storage.loadProductWorkspace();
    expect(loaded.products[0].id).toBe(draft.id); expect(loaded.operations).toHaveLength(1);
  });
  it('reports an ephemeral session when both persistent stores are unavailable', async () => {
    vi.stubGlobal('indexedDB', undefined);
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
    vi.resetModules(); const storage = await import('../src/product-storage');
    expect(await storage.saveProduct(createProductDraft('room'))).toMatchObject({ mode: 'memory', persistent: false });
    expect((await storage.loadProductWorkspace()).products).toHaveLength(1);
  });
  it('never submits a model request when paid generation is paused', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const { requestGeneration } = await import('../src/product-client');
    const session: StudioSession = { user: null, storageAvailable: false, generation: { enabled: false, available: false, provider: 'none', model: 'none', estimatedCredits: null, creditUnit: 'credits', remainingCredits: 0, reason: 'Generation is paused.' } };
    await expect(requestGeneration(createProductDraft('room'), session)).rejects.toThrow('Generation is paused.');
    expect(fetch).not.toHaveBeenCalled();
  });
});
