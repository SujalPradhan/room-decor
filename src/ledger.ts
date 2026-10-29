import type { OperationKind, OperationRecord } from './product-types';

export interface OperationFilter { roomId?: string; productId?: string; componentId?: string; kind?: OperationKind; provider?: string; model?: string; status?: OperationRecord['status']; from?: string; to?: string }
export interface OperationSummary {
  operationCount: number; unknownCostCount: number; localCount: number; unknownTimingCount: number;
  money: { currency: string; amountMicros: number; estimatedMicros: number; reportedMicros: number }[];
  credits: { unit: string; used: number; reserved: number; refunded: number; net: number; estimated: number }[];
  workMs: number; elapsedMs: number;
}
function safeMoneySum(a: number, b: number): number { const value = a + b; if (!Number.isSafeInteger(value)) throw new Error('This monetary total exceeds the supported precision. Export smaller reporting periods.'); return value; }
function quantitySum(a: number, b: number): number { return Number((a + b).toFixed(8)); }
const terminal = (s: OperationRecord['status']) => ['succeeded', 'failed'].includes(s);
const costRank = { unknown: 0, local: 1, estimated: 2, reported: 3, reconciled: 4 };

/** Each operation ID is one attempt, not a polling update. Stale queued updates cannot undo a final result. */
export function mergeOperations(existing: OperationRecord[], incoming: OperationRecord | OperationRecord[]): OperationRecord[] {
  const map = new Map<string, OperationRecord>();
  for (const raw of [...existing, ...(Array.isArray(incoming) ? incoming : [incoming])]) {
    const next = validateOperationRecord(raw), old = map.get(next.id);
    if (!old) { map.set(next.id, next); continue; }
    if (old.roomId !== next.roomId) throw new Error('An operation cannot move between rooms.');
    const stale = terminal(old.status) && !terminal(next.status);
    const merged = { ...old, ...(stale ? {} : next), timing: { ...old.timing, ...(stale ? {} : next.timing) }, usage: { ...old.usage, ...(stale ? {} : next.usage) }, cost: costRank[next.cost.basis] >= costRank[old.cost.basis] && !stale ? { ...old.cost, ...next.cost } : old.cost };
    map.set(next.id, merged);
  }
  return [...map.values()].sort((a, b) => Date.parse(b.submittedAt) - Date.parse(a.submittedAt));
}
export function filterOperations(records: OperationRecord[], filter: OperationFilter = {}): OperationRecord[] {
  const from = filter.from ? Date.parse(filter.from) : -Infinity, to = filter.to ? Date.parse(filter.to) : Infinity;
  return mergeOperations([], records).filter(r => {
    for (const field of ['roomId', 'productId', 'componentId', 'kind', 'provider', 'model', 'status'] as const) if (filter[field] && r[field] !== filter[field]) return false;
    const time = Date.parse(r.submittedAt);
    return time >= from && time <= to;
  });
}
/** Union of intervals: parallel work increases work time, but overlapping wall-clock intervals count once. */
export function elapsedIntervalMs(intervals: [number, number][]): number {
  const ordered = intervals.filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b >= a).sort((a, b) => a[0] - b[0]);
  let total = 0, start: number | undefined, end = 0;
  for (const [a, b] of ordered) {
    if (start === undefined) { start = a; end = b; }
    else if (a <= end) end = Math.max(end, b);
    else { total += end - start; start = a; end = b; }
  }
  return total + (start === undefined ? 0 : end - start);
}
export function summarizeOperations(records: OperationRecord[], filter: OperationFilter = {}): OperationSummary {
  const rows = filterOperations(records, filter), money = new Map<string, OperationSummary['money'][number]>(), credits = new Map<string, OperationSummary['credits'][number]>();
  const result: OperationSummary = { operationCount: rows.length, unknownCostCount: 0, localCount: 0, unknownTimingCount: 0, money: [], credits: [], workMs: 0, elapsedMs: 0 };
  const intervals: [number, number][] = [];
  for (const row of rows) {
    if (row.cost.basis === 'local') result.localCount++;
    if (row.cost.basis === 'unknown' || (row.cost.basis !== 'local' && row.cost.amountMicros == null)) result.unknownCostCount++;
    if (!row.reusedFrom && row.cost.basis !== 'unknown' && row.cost.amountMicros != null && row.cost.currency) {
      const currency = row.cost.currency.toUpperCase(), m = money.get(currency) ?? { currency, amountMicros: 0, estimatedMicros: 0, reportedMicros: 0 };
      m.amountMicros = safeMoneySum(m.amountMicros, row.cost.amountMicros);
      if (row.cost.basis === 'estimated') m.estimatedMicros = safeMoneySum(m.estimatedMicros, row.cost.amountMicros); else m.reportedMicros = safeMoneySum(m.reportedMicros, row.cost.amountMicros);
      money.set(currency, m);
    }
    if (!row.reusedFrom && (row.usage.creditUnit || row.estimate?.creditUnit)) {
      // Usage units are provider-reported net usage. Refunds are informational, never deducted twice.
      const unit = row.usage.creditUnit ?? row.estimate!.creditUnit, key = `${row.provider ?? row.engine}:${unit}`, c = credits.get(key) ?? { unit: key, used: 0, reserved: 0, refunded: 0, net: 0, estimated: 0 };
      c.used = quantitySum(c.used, row.usage.credits ?? 0); c.net = c.used;
      c.reserved = quantitySum(c.reserved, row.cost.reservedCredits ?? 0); c.refunded = quantitySum(c.refunded, row.cost.refundedCredits ?? 0);
      c.estimated = quantitySum(c.estimated, row.estimate?.creditUnit === unit ? row.estimate.credits : 0);
      credits.set(key, c);
    }
    if (!row.reusedFrom) {
      const processing = row.timing.processingMs;
      if (processing !== undefined) result.workMs += processing;
      else result.unknownTimingCount++;
      const start = Date.parse(row.submittedAt), finish = row.finishedAt ? Date.parse(row.finishedAt) : row.timing.elapsedMs !== undefined ? start + row.timing.elapsedMs : NaN;
      if (Number.isFinite(finish)) intervals.push([start, finish]);
    }
  }
  result.money = [...money.values()].sort((a, b) => a.currency.localeCompare(b.currency));
  result.credits = [...credits.values()].sort((a, b) => a.unit.localeCompare(b.unit));
  result.elapsedMs = elapsedIntervalMs(intervals);
  return result;
}

export function formatDuration(ms?: number): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return 'Not recorded';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)} s`;
  const minutes = Math.floor(seconds / 60), rest = Math.round(seconds % 60);
  return rest === 60 ? `${minutes + 1} min` : `${minutes} min${rest ? ` ${rest} s` : ''}`;
}
export function formatMoneyMicros(amountMicros: number | null | undefined, currency?: string): string {
  if (amountMicros == null || !Number.isFinite(amountMicros) || !currency) return 'Not recorded';
  try { return new Intl.NumberFormat('en', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(amountMicros / 1_000_000); } catch { return `${currency} ${(amountMicros / 1_000_000).toFixed(4)}`; }
}
function csvCell(value: unknown): string {
  let s = value === undefined || value === null ? '' : String(value);
  // Spreadsheet parsers can execute formulas even inside quoted CSV cells.
  if (/^[\s\u0000-\u001f]*[=+\-@]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}
export function operationsToCsv(records: OperationRecord[]): string {
  const columns = ['Operation ID', 'Room', 'Product', 'Component', 'Operation', 'Status', 'Engine', 'Provider', 'Model', 'Attempt', 'Submitted UTC', 'Finished UTC', 'Queue ms', 'Processing ms', 'Transfer ms', 'Elapsed ms', 'Timing source', 'Cost basis', 'Net amount', 'Currency', 'Credit unit', 'Net credits', 'Reserved credits', 'Refunded credits', 'Input tokens', 'Output tokens', 'Images', 'Bytes', 'Reused from', 'Note', 'Estimated credits', 'Estimated credit unit', 'Rate ID', 'Rate source', 'Rate checked UTC'];
  const rows = mergeOperations([], records).map(r => [r.id, r.roomName ?? r.roomId, r.productId, r.componentId, r.name, r.status, r.engine, r.provider, r.model, r.attempt, r.submittedAt, r.finishedAt, r.timing.queueMs, r.timing.processingMs, r.timing.transferMs, r.timing.elapsedMs, r.timing.source, r.cost.basis, r.cost.amountMicros == null ? '' : r.cost.amountMicros / 1_000_000, r.cost.currency, r.usage.creditUnit, r.usage.credits, r.cost.reservedCredits, r.cost.refundedCredits, r.usage.inputTokens, r.usage.outputTokens, r.usage.imageCount, r.usage.bytes, r.reusedFrom, r.cost.note, r.estimate?.credits, r.estimate?.creditUnit, r.estimate?.rateId ?? r.cost.rateId, r.estimate?.rateSource, r.estimate?.rateCheckedAt]);
  return '\ufeff' + [columns, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
}
export function createLocalOperation(input: { roomId: string; roomName?: string; productId?: string; componentId?: string; kind: OperationKind; name: string; engine: string; startedAt?: string; elapsedMs?: number; imageCount?: number; bytes?: number }): OperationRecord {
  const submittedAt = input.startedAt ?? new Date().toISOString(), elapsed = input.elapsedMs;
  return { id: globalThis.crypto?.randomUUID?.() ?? `operation-${Date.now()}-${Math.random().toString(36).slice(2)}`, roomId: input.roomId, ...(input.roomName ? { roomName: input.roomName } : {}), ...(input.productId ? { productId: input.productId } : {}), ...(input.componentId ? { componentId: input.componentId } : {}), kind: input.kind, name: input.name, engine: input.engine, attempt: 1, status: 'succeeded', submittedAt, startedAt: submittedAt, ...(elapsed === undefined ? {} : { finishedAt: new Date(Date.parse(submittedAt) + elapsed).toISOString() }), timing: { source: 'local', ...(elapsed === undefined ? {} : { processingMs: elapsed, elapsedMs: elapsed }) }, usage: { ...(input.imageCount === undefined ? {} : { imageCount: input.imageCount }), ...(input.bytes === undefined ? {} : { bytes: input.bytes }) }, cost: { basis: 'local', note: 'Local processing. No external model API charge; device and electricity costs are not measured.' } };
}

export function validateOperationRecord(value: unknown): OperationRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Operation must be an object.');
  const r = value as OperationRecord;
  for (const field of ['id', 'roomId', 'name', 'engine', 'submittedAt'] as const) if (typeof r[field] !== 'string' || !r[field].trim() || r[field].length > 500) throw new Error(`Operation ${field} is invalid.`);
  for (const field of ['roomName', 'productId', 'componentId', 'parentId', 'provider', 'model', 'errorCode', 'reusedFrom'] as const) if (r[field] !== undefined && (typeof r[field] !== 'string' || r[field]!.length > 500)) throw new Error(`Operation ${field} is invalid.`);
  if (!['product-lookup', 'room-analysis', 'image-preparation', 'model-generation', 'model-import', 'asset-download', 'render', 'validation'].includes(r.kind)) throw new Error('Operation kind is invalid.');
  if (!['queued', 'running', 'succeeded', 'failed', 'unknown'].includes(r.status) || !Number.isSafeInteger(r.attempt) || r.attempt < 1) throw new Error('Operation status or attempt is invalid.');
  for (const field of ['submittedAt', 'startedAt', 'finishedAt'] as const) if (r[field] !== undefined && !Number.isFinite(Date.parse(r[field]!))) throw new Error('Operation time is invalid.');
  if (r.finishedAt && Date.parse(r.finishedAt) < Date.parse(r.submittedAt)) throw new Error('Operation end precedes its start.');
  if (!r.timing || !['local', 'provider', 'observed', 'unknown'].includes(r.timing.source) || !r.usage || !r.cost || !['local', 'estimated', 'reported', 'reconciled', 'unknown'].includes(r.cost.basis)) throw new Error('Operation metering is invalid.');
  for (const group of [r.timing, r.usage, r.cost]) for (const [key, n] of Object.entries(group)) if (['queueMs', 'processingMs', 'transferMs', 'elapsedMs', 'credits', 'inputTokens', 'outputTokens', 'cachedTokens', 'imageCount', 'bytes', 'amountMicros', 'reservedCredits', 'refundedCredits'].includes(key) && n !== null && (typeof n !== 'number' || !Number.isFinite(n) || n < 0)) throw new Error('Operation quantities must be finite and nonnegative.');
  if (r.cost.amountMicros != null && !Number.isSafeInteger(r.cost.amountMicros)) throw new Error('Monetary micros must be a safe integer.');
  for (const field of ['inputImageIds', 'outputAssetIds'] as const) if (r[field] !== undefined && (!Array.isArray(r[field]) || r[field]!.length > 100 || r[field]!.some(v => typeof v !== 'string' || v.length > 200))) throw new Error('Operation asset references are invalid.');
  if (r.cost.note !== undefined && (typeof r.cost.note !== 'string' || r.cost.note.length > 2000)) throw new Error('Operation note is invalid.');
  if (r.estimate && (typeof r.estimate.credits !== 'number' || !Number.isFinite(r.estimate.credits) || r.estimate.credits < 0 || typeof r.estimate.creditUnit !== 'string' || !r.estimate.creditUnit.trim())) throw new Error('Operation estimate is invalid.');
  if (r.cost.currency !== undefined && !/^[A-Z]{3}$/.test(r.cost.currency)) throw new Error('Operation currency must be a three-letter currency code.');
  if (r.cost.amountMicros != null && !r.cost.currency) throw new Error('A monetary amount needs its currency.');
  if (r.cost.basis === 'unknown' && r.cost.amountMicros != null) throw new Error('Historical unknown cost cannot be replaced by an invented amount.');
  for (const key of ['creditUnit', 'imageCount'] as const) if (key === 'creditUnit' && r.usage[key] !== undefined && (typeof r.usage[key] !== 'string' || !r.usage[key]!.trim())) throw new Error('Credit units are invalid.');
  return structuredClone(r);
}
