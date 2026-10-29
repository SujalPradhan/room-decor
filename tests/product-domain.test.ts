import { describe, expect, it } from 'vitest';
import { applyGenerationResult, applySpecifications, canTryProduct, createProductDraft, getProductReviewIssues, isSafeProductImageUrl, parseProductSpecifications, productToFurniture, updateProductDraft, validateProductDraft } from '../src/product-domain';
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
  it('invalidates a previous generated model after size, image or variant changes and refuses stale completions', () => {
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
