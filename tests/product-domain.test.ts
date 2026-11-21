import { describe, expect, it } from 'vitest';
import { applyGenerationResult, applySpecifications, canTryProduct, createProductDraft, generatedProductToFurniture, getProductReviewIssues, isSafeProductImageUrl, parseProductSpecifications, productToFurniture, updateProductDraft, validateProductDraft } from '../src/product-domain';
import { createFurnitureItem } from '../src/domain';
import type { GenerationJob, ProductDraft } from '../src/product-types';

function reviewed(): ProductDraft {
  const draft = applySpecifications({ ...createProductDraft('room-1'), title: 'Oak study desk' }, 'Study desk; Width: 150.25 cm; Depth: 600 mm; Height: 75 cm');
  for (const a of ['width', 'depth', 'height'] as const) draft.dimensions[a].confirmed = true;
  return draft;
}
describe('product specification evidence', () => {
  it('never invents missing dimensions or a category', () => {
    const draft = createProductDraft('room-1');
    expect(draft.dimensions.width.metres).toBeNull();
    expect(draft.dimensions.depth.metres).toBeNull();
    expect(draft.dimensions.height.metres).toBeNull();
    expect(draft.kind).toBeNull();
    expect(canTryProduct(draft)).toBe(false);
    expect(() => productToFurniture(draft)).toThrow(/assembled outer/);
  });
  it('parses explicitly labelled mixed units without confirming source claims', () => {
    const p = parseProductSpecifications('Study desk; Width: 150.25 cm; Depth: 600 mm; Height: 2.5 ft');
    expect(p.kind).toBe('desk');
    expect(p.dimensions.width).toMatchObject({ metres: 1.5025, origin: 'listing', confirmed: false });
    expect(p.dimensions.depth.metres).toBe(.6);
    expect(p.dimensions.height.metres).toBe(.762);
    expect(p.dimensions.width.evidence).toContain('150.25');
    expect(parseProductSpecifications('Width 60 inches; Depth 2 feet; Height 30 inch').dimensions).toMatchObject({ width: { metres: 1.524 }, depth: { metres: .6096 }, height: { metres: .762 } });
  });
  it('uses explicit tuple order including common retailer postfix labels', () => {
    for (const text of ['150 x 60 x 75 cm (W x D x H)', 'Dimensions W x D x H: 150 × 60 × 75 cm', 'Product dimensions: 60D x 150W x 75H centimetres']) {
      expect(parseProductSpecifications(text).dimensions).toMatchObject({ width: { metres: 1.5 }, depth: { metres: .6 }, height: { metres: .75 } });
    }
    expect(parseProductSpecifications('150 x 60 x 75 cm').dimensions.width.metres).toBeNull();
    expect(parseProductSpecifications('150 x 60 x 75 cm').warnings.join(' ')).toContain('order');
  });
  it('does not treat package/mattress sizes as assembled furniture, even in multiline sections', () => {
    const packed = parseProductSpecifications('Wardrobe\nPackage dimensions:\nWidth: 160 cm\nDepth: 80 cm\nHeight: 20 cm');
    expect(packed.dimensions.width.metres).toBeNull();
    const bed = parseProductSpecifications('King bed\nMattress size: 180 x 200 x 15 cm (W x D x H)');
    expect(bed.dimensions.width.metres).toBeNull();
    const assembled = parseProductSpecifications('Package dimensions: 180 x 80 x 20 cm (W x D x H)\nAssembled outer dimensions: 150 x 60 x 75 cm (W x D x H)');
    expect(assembled.dimensions.width.metres).toBe(1.5);
    expect(assembled.warnings.length).toBeGreaterThan(0);
  });
  it('rejects conflicting variants, unlabelled units and invalid ranges', () => {
    const conflict = parseProductSpecifications('Width: 150 cm; Width: 160 cm; Depth: 60 cm');
    expect(conflict.dimensions.width.metres).toBeNull();
    expect(conflict.dimensions.depth.metres).toBe(.6);
    expect(conflict.dimensions.height.metres).toBeNull();
    expect(conflict.warnings.join(' ')).toContain('Conflicting width');
    for (const text of ['Width: 150', 'Width: -150 cm', 'Width: 0 cm', 'Width: 3000 cm', '-150 x 60 x 75 cm (W x D x H)', '-150W x 60D x 75H cm', '-150 cm wide']) expect(parseProductSpecifications(text).dimensions.width.metres).toBeNull();
  });
});

describe('review and model identity', () => {
  it('requires all three confirmed values and maps a whole candidate without moving the original', () => {
    const draft = reviewed(), original = { ...createFurnitureItem('bed'), position: { x: 1.2, z: -1 }, rotation: Math.PI / 2 };
    expect(getProductReviewIssues(draft)).toEqual([]);
    const candidate = productToFurniture(draft, original);
    expect(candidate).toMatchObject({ id: original.id, kind: 'desk', name: 'Oak study desk', dimensions: { width: 1.5025, depth: .6, height: .75 }, position: original.position, rotation: original.rotation, dimensionSource: 'product', productId: draft.id });
    expect(original.kind).toBe('bed');
    draft.dimensions.height.confirmed = false;
    expect(() => productToFurniture(draft)).toThrow(/Confirm.*height/);
  });
  it('preserves ready imported geometry when only review metadata changes', () => {
    const draft = reviewed();
    draft.model = { state: 'ready', appearance: 'seller-model', localAssetId: 'local:11111111-1111-4111-8111-111111111111', draftRevision: draft.revision };
    const updated = updateProductDraft(draft, { title: 'My oak desk', dimensions: { ...draft.dimensions, width: { ...draft.dimensions.width, evidence: 'Checked by tape', origin: 'user', confirmed: true } } });
    expect(updated.revision).toBe(draft.revision);
    expect(productToFurniture(updated).assetId).toBe(draft.model.localAssetId);
    const resized = updateProductDraft(updated, { dimensions: { ...updated.dimensions, width: { ...updated.dimensions.width, metres: 1.6 } } });
    expect(resized.revision).toBe(updated.revision + 1);
    expect(productToFurniture(resized).assetId).toBe(draft.model.localAssetId);
    const otherVariant = updateProductDraft(resized, { variant: 'Different timber and size' });
    expect(otherVariant.model.localAssetId).toBeUndefined();
  });
  it('invalidates a previous generated model after variant changes and refuses stale completions', () => {
    const draft = reviewed();
    draft.model = { state: 'ready', appearance: 'ai-generated', draftRevision: draft.revision, localAssetId: 'local:old' };
    const updated = updateProductDraft(draft, { variant: '180 cm wide' });
    expect(updated.revision).toBe(draft.revision + 1);
    expect(updated.model).toMatchObject({ state: 'proxy', appearance: 'size-preview' });
    expect(updated.model.localAssetId).toBeUndefined();
    const job: GenerationJob = { id: 'job', productId: draft.id, draftRevision: draft.revision, roomId: draft.roomId, status: 'succeeded', provider: 'example', model: 'pinned', createdAt: draft.createdAt, outputAssetId: 'asset', operationId: 'op' };
    expect(() => applyGenerationResult(updated, job)).toThrow(/changed/);
    expect(applyGenerationResult(draft, job, 'local:result').model).toMatchObject({ state: 'ready', remoteAssetId: 'asset', localAssetId: 'local:result' });
    expect(productToFurniture({ ...draft, model: { ...draft.model, draftRevision: draft.revision - 1 } }).assetId).toBeUndefined();
  });
  it('validates stored drafts and rejects hostile source URLs, forged confirmations and nonfinite values', () => {
    const draft = reviewed();
    expect(validateProductDraft(draft)).toEqual(draft);
    expect(() => validateProductDraft({ ...draft, dimensions: { ...draft.dimensions, width: { metres: null, confirmed: true, origin: 'user' } } })).toThrow(/unknown dimension/);
    expect(() => validateProductDraft({ ...draft, dimensions: { ...draft.dimensions, width: { metres: NaN, confirmed: true, origin: 'user' } } })).toThrow(/width/);
    expect(() => validateProductDraft({ ...draft, source: { retailer: 'manual', submittedUrl: 'javascript:alert(1)' } })).toThrow(/source URL/);
    expect(isSafeProductImageUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeProductImageUrl('//evil.test/image.jpg')).toBe(false);
    expect(isSafeProductImageUrl('/api/assets/asset_1')).toBe(true);
    expect(isSafeProductImageUrl('https://images.example/photo.jpg')).toBe(true);
  });
});

describe('automatic generated-model placement', () => {
  const localAssetId = 'local:11111111-1111-4111-8111-111111111111';
  function generated(): ProductDraft {
    const draft = reviewed();
    draft.model = { state: 'ready', appearance: 'ai-generated', localAssetId, draftRevision: draft.revision, placementDimensions: { width: 1.5025, depth: .6, height: .75 }, scaleSource: 'listing' };
    return draft;
  }
  it('places the actual generated geometry with unconfirmed or conflicting evidence, without changing facts', () => {
    const draft = generated();
    draft.dimensions.width.confirmed = false;
    draft.specificationWarnings = ['Width diagram conflicts with the table.'];
    const before = structuredClone(draft), original = createFurnitureItem('bed');
    const item = generatedProductToFurniture(draft, original);
    expect(item).toMatchObject({ id: original.id, assetId: localAssetId, productId: draft.id, dimensionSource: 'estimated', dimensions: { width: 1.5025, depth: .6, height: .75 } });
    expect(draft).toEqual(before);
    expect(original.kind).toBe('bed');
    expect(canTryProduct(draft)).toBe(false);
  });
  it('uses separately recorded model bounds for missing sizes and metadata without inventing product evidence', () => {
    const draft = createProductDraft('room-1');
    draft.model = { state: 'ready', appearance: 'ai-generated', localAssetId, draftRevision: draft.revision, placementDimensions: { width: .7, depth: .8, height: 1 }, scaleSource: 'estimated' };
    const item = generatedProductToFurniture(draft);
    expect(item).toMatchObject({ name: 'Product', assetId: localAssetId, dimensions: { width: .7, depth: .8, height: 1 }, dimensionSource: 'estimated' });
    for (const axis of ['width', 'depth', 'height'] as const) expect(draft.dimensions[axis]).toEqual({ metres: null, origin: 'unknown', confirmed: false });
    expect(draft.kind).toBeNull();
    expect(draft.title).toBe('');
  });
  it('refuses proxy, stale, missing and malformed local models instead of silently choosing a stock asset', () => {
    const draft = generated();
    for (const model of [
      { ...draft.model, state: 'proxy' as const },
      { ...draft.model, draftRevision: draft.revision + 1 },
      { ...draft.model, localAssetId: undefined, remoteAssetId: 'private-model' },
      { ...draft.model, localAssetId: 'local:bad' },
      { ...draft.model, appearance: 'size-preview' as const },
    ]) expect(() => generatedProductToFurniture({ ...draft, model })).toThrow(/not ready/);
    draft.dimensions.depth.metres = null;
    draft.dimensions.depth.confirmed = false;
    delete draft.model.placementDimensions;
    expect(() => generatedProductToFurniture(draft)).toThrow(/no usable placement size/);
  });
  it('preserves ready geometry when category or size changes and keeps uncertainty explicit', () => {
    const draft = generated();
    const category = updateProductDraft(draft, { kind: 'wardrobe' });
    expect(category.revision).toBe(draft.revision + 1);
    expect(category.model).toMatchObject({ state: 'ready', localAssetId, draftRevision: category.revision });
    const resized = updateProductDraft(category, { dimensions: { ...category.dimensions, width: { metres: 1.7, origin: 'user', confirmed: false } } });
    expect(resized.model).toMatchObject({ state: 'ready', localAssetId, draftRevision: resized.revision, scaleSource: 'estimated' });
    expect(generatedProductToFurniture(resized)).toMatchObject({ kind: 'wardrobe', dimensions: { width: 1.7 }, dimensionSource: 'estimated' });
  });
  it('invalidates ready geometry after source, variant or reference changes', () => {
    const draft = generated();
    draft.source = { retailer: 'flipkart', canonicalUrl: 'https://www.flipkart.com/first/p/itmfirst', submittedUrl: 'https://www.flipkart.com/first/p/itmfirst' };
    for (const patch of [
      { source: { ...draft.source, submittedUrl: 'https://www.flipkart.com/other/p/itmother' } },
      { source: { ...draft.source, canonicalUrl: 'https://www.flipkart.com/other/p/itmother' } },
      { variant: 'Other fabric' },
      { images: [{ id: 'another-photo', source: 'listing' as const, url: 'https://example.com/product.jpg', generationAllowed: false }], selectedImageId: 'another-photo' },
    ]) expect(updateProductDraft(draft, patch).model).toMatchObject({ state: 'proxy', appearance: 'size-preview' });
  });
  it('round-trips model scale metadata and rejects malformed bounds or scale provenance', () => {
    const draft = generated();
    expect(validateProductDraft(draft)).toEqual(draft);
    expect(generatedProductToFurniture(draft).dimensionSource).toBe('product');
    for (const placementDimensions of [{ width: NaN, depth: .6, height: .75 }, { width: 21, depth: .6, height: .75 }, { width: .7, depth: .6 }])
      expect(() => validateProductDraft({ ...draft, model: { ...draft.model, placementDimensions } })).toThrow(/placement/);
    expect(() => validateProductDraft({ ...draft, model: { ...draft.model, scaleSource: 'verified' } })).toThrow(/scale source/);
  });
});
