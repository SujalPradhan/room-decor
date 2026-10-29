import type { FurnitureItem, ItemKind } from './types';
import type { GenerationJob, ProductAxis, ProductDraft, ProductImage, ProductMeasurement } from './product-types';
import { createFurnitureItem } from './domain';
import { createReplacementDraft } from './replacement';
import { DIMENSION_LIMITS } from './measurements';

export const PRODUCT_AXES = ['width', 'depth', 'height'] as const;
export const PRODUCT_KINDS: ItemKind[] = ['bed', 'wardrobe', 'desk', 'chair', 'floor-bed', 'pedestal-fan', 'stool', 'plant', 'shelf'];
const unknownMeasurement = (): ProductMeasurement => ({ metres: null, origin: 'unknown', confirmed: false });
const emptyDimensions = (): ProductDraft['dimensions'] => ({ width: unknownMeasurement(), depth: unknownMeasurement(), height: unknownMeasurement() });
const now = () => new Date().toISOString();
const id = () => globalThis.crypto?.randomUUID?.() ?? `product-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function createProductDraft(roomId: string, source: Partial<ProductDraft['source']> = {}): ProductDraft {
  return { id: id(), roomId, revision: 1, createdAt: now(), updatedAt: now(), source: { retailer: 'manual', ...source }, title: '', kind: null, variant: '', images: [], dimensions: emptyDimensions(), model: { state: 'proxy', appearance: 'size-preview', draftRevision: 1 } };
}

const unitPattern = '(?:millimet(?:re|er)s?|mm|centimet(?:re|er)s?|cm|met(?:re|er)s?|m|inches|inch|in|feet|foot|ft|["\u2033\u2032\'])';
const numberPattern = '\\d+(?:[.,]\\d+)?';
function metres(raw: string, unit: string): number {
  const value = Number(raw.replace(',', '.'));
  const u = unit.toLowerCase();
  const factor = /^(mm|millimet)/.test(u) ? .001 : /^(cm|centimet)/.test(u) ? .01 : /^(in|["\u2033])/.test(u) ? .0254 : /^(ft|feet|foot|['\u2032])/.test(u) ? .3048 : 1;
  return Math.round(value * factor * 1e6) / 1e6;
}
function axis(label: string): ProductAxis | null {
  const s = label.toLowerCase();
  if (/^(w|width)$/.test(s)) return 'width';
  if (/^(d|depth|l|length)$/.test(s)) return 'depth';
  if (/^(h|height)$/.test(s)) return 'height';
  return null;
}
function inferKind(text: string): ItemKind | null {
  if (/\b(?:floor mattress|floor bed)\b/i.test(text)) return 'floor-bed';
  if (/\bwardrobe|cupboard|almirah\b/i.test(text)) return 'wardrobe';
  if (/\b(?:desk|study table|work table)\b/i.test(text)) return 'desk';
  if (/\bchair\b/i.test(text)) return 'chair';
  if (/\b(?:pedestal|standing) fan\b/i.test(text)) return 'pedestal-fan';
  if (/\bstool\b/i.test(text)) return 'stool';
  if (/\b(?:bookshelf|shelf|shelving)\b/i.test(text)) return 'shelf';
  if (/\bplant\b/i.test(text)) return 'plant';
  if (/\bbed\b/i.test(text)) return 'bed';
  return null;
}

export interface ParsedProductSpecifications { dimensions: ProductDraft['dimensions']; kind: ItemKind | null; warnings: string[] }
/** Deterministic evidence extraction only. Unlabelled tuples and packaging sizes never become furniture measurements. */
export function parseProductSpecifications(text: string): ParsedProductSpecifications {
  const dimensions = emptyDimensions(), warnings: string[] = [], kind = inferKind(text);
  const values: Record<ProductAxis, { value: number; evidence: string }[]> = { width: [], depth: [], height: [] };
  const source = text.slice(0, 30000).replace(/[×✕]/g, 'x').replace(/\u00a0/g, ' ');
  const add = (a: ProductAxis | null, raw: string, unit: string, evidence: string) => {
    if (!a) return;
    const value = metres(raw, unit), limits = DIMENSION_LIMITS[a];
    if (!Number.isFinite(value) || value < limits.min || value > limits.max) { warnings.push(`${a} is outside the supported furniture range. Check the source and units.`); return; }
    values[a].push({ value, evidence: evidence.trim().slice(0, 500) });
  };
  const lines = source.split(/[\n;]+/);
  let excludedSection = false;
  for (const line of lines) {
    const excluded = /\b(?:shipping|package|packaging|packed|carton|box dimensions|sleeping (?:area|surface))\b/i.test(line) || (kind !== 'floor-bed' && /\bmattress\b/i.test(line));
    if (excluded) excludedSection = true;
    else if (/\b(?:assembled|overall|external|outer|product dimensions|furniture dimensions)\b/i.test(line)) excludedSection = false;
    if (excludedSection) {
      if (/\d/.test(line)) warnings.push('Package, shipping or mattress measurements were ignored. Enter the assembled outer furniture dimensions.');
      continue;
    }
    // Retailer form: 60D x 150W x 75H cm. Labels are evidence, not a guessed tuple order.
    const postfixTuple = new RegExp(`(${numberPattern})\\s*([wdhl])\\s*x\\s*(${numberPattern})\\s*([wdhl])\\s*x\\s*(${numberPattern})\\s*([wdhl])\\s*(${unitPattern})(?![a-z])`, 'gi');
    for (const match of line.matchAll(postfixTuple)) {
      const axes = [axis(match[2]), axis(match[4]), axis(match[6])];
      if (new Set(axes).size !== 3 || /-\s*$/.test(line.slice(0, match.index))) { warnings.push('The dimension labels or values are ambiguous.'); continue; }
      axes.forEach((a, index) => add(a, match[1 + index * 2], match[7], match[0]));
    }
    // Explicit axes after a labelled tuple: 150 x 60 x 75 cm (W x D x H).
    const tuple = new RegExp(`(${numberPattern})\\s*(${unitPattern})?\\s*x\\s*(${numberPattern})\\s*(${unitPattern})?\\s*x\\s*(${numberPattern})\\s*(${unitPattern})?`, 'gi');
    for (const match of line.matchAll(tuple)) {
      if (/-\s*$/.test(line.slice(0, match.index))) { warnings.push('Negative furniture dimensions were ignored.'); continue; }
      const around = line.slice(Math.max(0, match.index! - 50), match.index! + match[0].length + 55);
      const orderMatch = /\b(width|depth|height|length|[wdhl])\s*[x/]\s*(width|depth|height|length|[wdhl])\s*[x/]\s*(width|depth|height|length|[wdhl])\b/i.exec(around);
      if (!orderMatch) { warnings.push('The dimension order is missing. Label width, depth and height before using these sizes.'); continue; }
      const axes = [axis(orderMatch[1]), axis(orderMatch[2]), axis(orderMatch[3])];
      if (new Set(axes).size !== 3 || axes.includes(null)) { warnings.push('The dimension labels are ambiguous. Enter width, depth and height separately.'); continue; }
      const shared = match[6] || match[4] || match[2];
      if (!shared) { warnings.push('The dimension unit is missing.'); continue; }
      axes.forEach((a, index) => add(a, match[1 + index * 2], match[2 + index * 2] || shared, match[0] + ' (' + orderMatch[0] + ')'));
    }
    // Explicit individual measurements, e.g. Width: 150 cm or 150 cm wide.
    const labelled = new RegExp(`\\b(width|depth|height|length|[wdhl])\\b\\s*(?:[:=]|is)?\\s*(${numberPattern})\\s*(${unitPattern})(?![a-z])`, 'gi');
    for (const match of line.matchAll(labelled)) add(axis(match[1]), match[2], match[3], match[0]);
    const postfix = new RegExp(`(${numberPattern})\\s*(${unitPattern})\\s*(width|wide|depth|deep|height|high|length|long)\\b`, 'gi');
    for (const match of line.matchAll(postfix)) {
      if (/-\s*$/.test(line.slice(0, match.index))) continue;
      const label = { wide: 'width', deep: 'depth', high: 'height', long: 'length' }[match[3].toLowerCase()] ?? match[3];
      add(axis(label), match[1], match[2], match[0]);
    }
  }
  for (const a of PRODUCT_AXES) {
    const found = values[a], distinct = [...new Set(found.map(v => v.value))];
    if (distinct.length > 1) { warnings.push(`Conflicting ${a} measurements were found. Confirm the selected variant and enter its assembled outer ${a}.`); continue; }
    if (found.length) dimensions[a] = { metres: found[0].value, origin: 'listing', evidence: found[0].evidence, confirmed: false };
  }
  return { dimensions, kind, warnings: [...new Set(warnings)] };
}

export function applySpecifications(draft: ProductDraft, text: string): ProductDraft {
  const parsed = parseProductSpecifications(text);
  return updateProductDraft(draft, { dimensions: parsed.dimensions, kind: draft.kind ?? parsed.kind, specificationWarnings: parsed.warnings });
}
function materialSignature(draft: ProductDraft): string {
  return JSON.stringify([draft.kind, draft.variant, draft.source.productId, draft.source.canonicalUrl, PRODUCT_AXES.map(a => draft.dimensions[a].metres), draft.selectedImageId, draft.images.map(i => [i.id, i.assetId, i.source, i.source === 'listing' ? i.url : ''])]);
}
/** Material review changes invalidate old generation/import associations; binary assets remain stored for history. */
export function updateProductDraft(draft: ProductDraft, patch: Partial<ProductDraft>): ProductDraft {
  const next = { ...structuredClone(draft), ...structuredClone(patch), id: draft.id, roomId: draft.roomId, createdAt: draft.createdAt, revision: draft.revision, updatedAt: now() };
  if (materialSignature(next) !== materialSignature(draft)) {
    next.revision = draft.revision + 1;
    const sameProduct = JSON.stringify([draft.kind, draft.variant, draft.source.productId, draft.source.canonicalUrl]) === JSON.stringify([next.kind, next.variant, next.source.productId, next.source.canonicalUrl]);
    next.model = sameProduct && draft.model.state === 'ready' && draft.model.appearance === 'seller-model'
      ? { ...draft.model, draftRevision: next.revision }
      : { state: 'proxy', appearance: 'size-preview', draftRevision: next.revision };
  }
  return next;
}
export function getProductReviewIssues(draft: ProductDraft): string[] {
  const issues: string[] = [];
  if (!draft.title.trim()) issues.push('Name the product.');
  if (!draft.kind || !PRODUCT_KINDS.includes(draft.kind)) issues.push('Choose a furniture type.');
  for (const a of PRODUCT_AXES) {
    const m = draft.dimensions[a], limits = DIMENSION_LIMITS[a];
    if (m.metres === null || !Number.isFinite(m.metres) || m.metres < limits.min || m.metres > limits.max) issues.push(`Enter the assembled outer ${a}.`);
    else if (!m.confirmed) issues.push(`Confirm the assembled outer ${a}.`);
  }
  return issues;
}
export const canTryProduct = (draft: ProductDraft) => getProductReviewIssues(draft).length === 0;
export function productToFurniture(draft: ProductDraft, original?: FurnitureItem | null): FurnitureItem {
  const issues = getProductReviewIssues(draft);
  if (issues.length) throw new Error(issues.join(' '));
  const item: FurnitureItem & { productId?: string } = { ...createFurnitureItem(draft.kind!), name: draft.title.trim().slice(0, 80), dimensions: { width: draft.dimensions.width.metres!, depth: draft.dimensions.depth.metres!, height: draft.dimensions.height.metres! }, dimensionSource: 'product', productId: draft.id };
  if (draft.model.state === 'ready' && draft.model.draftRevision === draft.revision && draft.model.localAssetId?.startsWith('local:')) item.assetId = draft.model.localAssetId;
  return original ? createReplacementDraft(original, item) : item;
}
export function applyGenerationResult(draft: ProductDraft, job: GenerationJob, localAssetId?: string): ProductDraft {
  if (job.productId !== draft.id || job.roomId !== draft.roomId || job.draftRevision !== draft.revision) throw new Error('The product changed while this model was prepared. Review or create a model for the current variant.');
  if (job.status !== 'succeeded' || (!job.outputAssetId && !localAssetId)) throw new Error('This model is not ready to review.');
  return { ...structuredClone(draft), updatedAt: now(), model: { state: 'ready', appearance: 'ai-generated', jobId: job.id, draftRevision: draft.revision, ...(job.outputAssetId ? { remoteAssetId: job.outputAssetId } : {}), ...(localAssetId ? { localAssetId } : {}) } };
}

export function isSafeProductImageUrl(url: string): boolean {
  if (/^\/api\/assets\/[a-z\d_-]+(?:\?[^#]*)?$/i.test(url)) return true;
  if (/^blob:https?:\/\//i.test(url)) return true;
  if (/^data:image\/(?:png|jpeg|webp);base64,[a-z\d+/]+={0,2}$/i.test(url)) return true;
  try { const u = new URL(url); return u.protocol === 'https:' && !u.username && !u.password; } catch { return false; }
}
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}
function str(value: unknown, label: string, max = 500, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim())) throw new Error(`${label} is invalid.`);
  return value;
}
function optionalStr(value: unknown, label: string, max = 500): string | undefined { return value === undefined ? undefined : str(value, label, max); }
function date(value: unknown, label: string): string { const s = str(value, label, 40); if (!Number.isFinite(Date.parse(s))) throw new Error(`${label} is invalid.`); return s; }
function sourceUrl(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const s = str(value, 'Product source URL', 4096);
  try { const u = new URL(s); if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) throw new Error(); } catch { throw new Error('Product source URL is invalid.'); }
  return s;
}
export function validateProductDraft(value: unknown): ProductDraft {
  const p = object(value, 'Product'), s = object(p.source, 'Product source'), dims = object(p.dimensions, 'Product dimensions'), model = object(p.model, 'Product model');
  if (!Number.isSafeInteger(p.revision) || (p.revision as number) < 1) throw new Error('Product revision is invalid.');
  if (!['amazon', 'flipkart', 'manual'].includes(s.retailer as string)) throw new Error('Product retailer is invalid.');
  if (p.kind !== null && !PRODUCT_KINDS.includes(p.kind as ItemKind)) throw new Error('Product type is invalid.');
  const dimensions = emptyDimensions();
  for (const a of PRODUCT_AXES) {
    const m = object(dims[a], `Product ${a}`), v = m.metres, limits = DIMENSION_LIMITS[a];
    if (v !== null && (typeof v !== 'number' || !Number.isFinite(v) || v < limits.min || v > limits.max)) throw new Error(`Product ${a} is invalid.`);
    if (!['listing', 'user', 'unknown'].includes(m.origin as string) || typeof m.confirmed !== 'boolean') throw new Error(`Product ${a} evidence is invalid.`);
    if (v === null && m.confirmed) throw new Error('An unknown dimension cannot be confirmed.');
    dimensions[a] = { metres: v as number | null, origin: m.origin as ProductMeasurement['origin'], confirmed: m.confirmed, ...(m.evidence === undefined ? {} : { evidence: str(m.evidence, 'Dimension evidence', 1000) }) };
  }
  if (!Array.isArray(p.images) || p.images.length > 20) throw new Error('Product images are invalid.');
  const images: ProductImage[] = p.images.map(raw => { const i = object(raw, 'Product image'); if (!['listing', 'upload'].includes(i.source as string) || typeof i.generationAllowed !== 'boolean') throw new Error('Product image source is invalid.'); const url = str(i.url, 'Product image URL', 8_000_000); if (!isSafeProductImageUrl(url)) throw new Error('Product image URL is invalid.'); return { id: str(i.id, 'Product image ID', 160), url, source: i.source as ProductImage['source'], generationAllowed: i.generationAllowed, ...(i.assetId === undefined ? {} : { assetId: str(i.assetId, 'Image asset ID', 160) }), ...(i.name === undefined ? {} : { name: str(i.name, 'Image name', 200) }) }; });
  if (new Set(images.map(i => i.id)).size !== images.length) throw new Error('Product image IDs must be unique.');
  const selectedImageId = optionalStr(p.selectedImageId, 'Selected image ID', 160);
  if (selectedImageId && !images.some(i => i.id === selectedImageId)) throw new Error('The selected product image is missing.');
  if (!['proxy', 'queued', 'running', 'ready', 'failed'].includes(model.state as string) || !['size-preview', 'ai-generated', 'seller-model'].includes(model.appearance as string)) throw new Error('Product model status is invalid.');
  if (model.draftRevision !== undefined && (!Number.isSafeInteger(model.draftRevision) || (model.draftRevision as number) < 1)) throw new Error('Product model revision is invalid.');
  const safeModel: ProductDraft['model'] = { state: model.state as ProductDraft['model']['state'], appearance: model.appearance as ProductDraft['model']['appearance'] };
  for (const field of ['jobId', 'localAssetId', 'remoteAssetId', 'error'] as const) if (model[field] !== undefined) safeModel[field] = str(model[field], `Product model ${field}`, field === 'error' ? 1000 : 160);
  if (model.draftRevision !== undefined) safeModel.draftRevision = model.draftRevision as number;
  const warnings = p.specificationWarnings;
  if (warnings !== undefined && (!Array.isArray(warnings) || warnings.length > 30 || warnings.some(w => typeof w !== 'string' || w.length > 1000))) throw new Error('Product specification warnings are invalid.');
  return { id: str(p.id, 'Product ID', 160), roomId: str(p.roomId, 'Product room ID', 160), revision: p.revision as number, createdAt: date(p.createdAt, 'Product created time'), updatedAt: date(p.updatedAt, 'Product updated time'), source: { retailer: s.retailer as ProductDraft['source']['retailer'], ...(sourceUrl(s.submittedUrl) ? { submittedUrl: sourceUrl(s.submittedUrl) } : {}), ...(sourceUrl(s.canonicalUrl) ? { canonicalUrl: sourceUrl(s.canonicalUrl) } : {}), ...(s.productId === undefined ? {} : { productId: str(s.productId, 'Retailer product ID', 160) }) }, title: str(p.title, 'Product name', 200, true), kind: p.kind as ItemKind | null, variant: str(p.variant, 'Product variant', 300, true), dimensions, images, ...(selectedImageId ? { selectedImageId } : {}), model: safeModel, ...(warnings ? { specificationWarnings: warnings as string[] } : {}) };
}
