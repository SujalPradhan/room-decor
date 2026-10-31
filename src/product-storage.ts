import type { OperationRecord, ProductDraft } from './product-types';
import { validateProductDraft } from './product-domain';
import { mergeOperations, validateOperationRecord } from './ledger';

const STORES = ['products', 'operations', 'images'] as const;
type Store = typeof STORES[number];
type Stored<T> = { id: string; data: T; savedAt: number };
interface ImageData { blob?: Blob; dataUrl?: string; name: string; productId?: string }
type Fallback = Record<Store, Stored<unknown>[]>;
export interface ProductStorageStatus { mode: 'indexeddb' | 'localstorage' | 'memory'; persistent: boolean; message?: string }
export interface ProductWorkspace { products: ProductDraft[]; operations: OperationRecord[]; status: ProductStorageStatus }
interface Scope { name: string; database: string; fallbackKey: string; memory: Fallback; urls: Map<string, string>; status: ProductStorageStatus }
function newScope(name: string): Scope {
  const suffix = encodeURIComponent(name);
  return { name, database: `roomshift-product-studio-${suffix}`, fallbackKey: `roomshift-product-studio-v1-${suffix}`, memory: { products: [], operations: [], images: [] }, urls: new Map(), status: { mode: 'memory', persistent: false, message: 'Storage has not been checked yet.' } };
}
let active = newScope('device');
export const MAX_PRODUCT_IMAGE_BYTES = 8_000_000;
const MAX_FALLBACK_IMAGE_BYTES = 1_500_000;
const statusOf = (scope: Scope): ProductStorageStatus => ({ ...scope.status });
export const getProductStorageStatus = (): ProductStorageStatus => statusOf(active);
/** Every async operation captures this namespace before its first await. Account changes never redirect pending writes. */
export function setProductStorageScope(name: string): void {
  if (typeof name !== 'string' || !name.trim() || name.length > 200 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error('Choose a valid product storage account.');
  try { encodeURIComponent(name); } catch { throw new Error('Choose a valid product storage account.'); }
  if (name === active.name) return;
  for (const url of active.urls.values()) URL.revokeObjectURL(url);
  active.urls.clear();
  active = newScope(name);
}
function localFallback(scope: Scope): Fallback {
  if (typeof localStorage === 'undefined') throw new Error('Persistent browser storage is unavailable.');
  const raw = localStorage.getItem(scope.fallbackKey);
  if (!raw) return { products: [], operations: [], images: [] };
  const value = JSON.parse(raw);
  if (!value || STORES.some(s => !Array.isArray(value[s]))) throw new Error('Saved product data could not be read.');
  return value;
}
function keepMemory(scope: Scope, store: Store, record: Stored<unknown>): void { scope.memory[store] = [...scope.memory[store].filter(r => r.id !== record.id), record]; }
function unique<T>(rows: Stored<T>[]): Stored<T>[] {
  const map = new Map<string, Stored<T>>();
  for (const row of rows) if (row && typeof row.id === 'string' && typeof row.savedAt === 'number' && (!map.has(row.id) || map.get(row.id)!.savedAt <= row.savedAt)) map.set(row.id, row);
  return [...map.values()];
}
async function database(scope: Scope): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') throw new Error('IndexedDB is unavailable.');
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(scope.database, 1);
    request.onupgradeneeded = () => { for (const store of STORES) if (!request.result.objectStoreNames.contains(store)) request.result.createObjectStore(store, { keyPath: 'id' }); };
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
    request.onerror = () => reject(new Error('The product database could not be opened.'));
    request.onblocked = () => reject(new Error('Close other Roomshift tabs and try again.'));
  });
}
async function readDatabase<T>(scope: Scope, store: Store): Promise<Stored<T>[]> {
  const db = await database(scope);
  try { return await new Promise((resolve, reject) => { const tx = db.transaction(store, 'readonly'), request = tx.objectStore(store).getAll(); let rows: Stored<T>[] = []; request.onsuccess = () => { rows = request.result; }; tx.oncomplete = () => resolve(rows); tx.onabort = tx.onerror = () => reject(new Error('Saved products could not be read.')); }); } finally { db.close(); }
}
async function putDatabase(scope: Scope, store: Store, record: Stored<unknown>): Promise<void> {
  const db = await database(scope);
  try { await new Promise<void>((resolve, reject) => { const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).put(record); tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(new Error('Your browser could not save this product.')); }); } finally { db.close(); }
}
async function save(scope: Scope, store: Store, record: Stored<unknown>): Promise<ProductStorageStatus> {
  keepMemory(scope, store, record);
  try { await putDatabase(scope, store, record); scope.status = { mode: 'indexeddb', persistent: true }; }
  catch {
    try { const fallback = localFallback(scope); fallback[store] = unique([...fallback[store], record]); localStorage.setItem(scope.fallbackKey, JSON.stringify(fallback)); scope.status = { mode: 'localstorage', persistent: true, message: 'Using limited browser storage. Keep a copy of imported files.' }; }
    catch { scope.status = { mode: 'memory', persistent: false, message: 'This browser could not save product data. Changes are available only in this tab; keep a copy of your files.' }; }
  }
  return statusOf(scope);
}
async function read<T>(scope: Scope, store: Store): Promise<Stored<T>[]> {
  let fallback: Stored<T>[] = [];
  try { fallback = localFallback(scope)[store] as Stored<T>[]; } catch { /* IndexedDB may still be available. */ }
  try { const records = await readDatabase<T>(scope, store); scope.status = { mode: 'indexeddb', persistent: true }; return unique([...fallback, ...records, ...scope.memory[store] as Stored<T>[]]); }
  catch {
    try { localFallback(scope); scope.status = { mode: 'localstorage', persistent: true, message: 'Using limited browser storage. Keep a copy of imported files.' }; }
    catch { scope.status = { mode: 'memory', persistent: false, message: 'Saved product storage is unavailable. Changes are available only in this tab.' }; }
    return unique([...fallback, ...scope.memory[store] as Stored<T>[]]);
  }
}
export async function loadProductWorkspace(): Promise<ProductWorkspace> {
  const scope = active;
  const [products, operations] = await Promise.all([read<ProductDraft>(scope, 'products'), read<OperationRecord>(scope, 'operations')]);
  let invalid = false;
  const validProducts: ProductDraft[] = [], validOperations: OperationRecord[] = [];
  for (const row of products) { try { validProducts.push(validateProductDraft(row.data)); } catch { invalid = true; } }
  for (const row of operations) { try { validOperations.push(validateOperationRecord(row.data)); } catch { invalid = true; } }
  const status = statusOf(scope);
  if (invalid) status.message = 'Some saved product or cost records could not be read. Valid records were kept.';
  return { products: validProducts.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)), operations: mergeOperations([], validOperations), status };
}
export async function saveProduct(product: ProductDraft): Promise<ProductStorageStatus> { const scope = active, safe = validateProductDraft(product); return save(scope, 'products', { id: safe.id, data: safe, savedAt: Date.now() }); }
export async function saveOperation(operation: OperationRecord): Promise<ProductStorageStatus> {
  const scope = active, safe = validateOperationRecord(operation), old = (await read<OperationRecord>(scope, 'operations')).find(r => r.id === safe.id);
  const merged = old ? mergeOperations([old.data], safe)[0] : safe;
  return save(scope, 'operations', { id: merged.id, data: merged, savedAt: Date.now() });
}
async function dataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer()); let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return `data:${blob.type};base64,${btoa(binary)}`;
}
function blobFromDataUrl(value: string): Blob | null {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([a-z\d+/]+={0,2})$/i.exec(value);
  if (!match) return null;
  const binary = atob(match[2]), bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: match[1] });
}
/** Binary assets outlive room undo and product collection changes. */
export async function saveProductImage(file: File, productId?: string): Promise<{ id: string; url: string; name: string; status: ProductStorageStatus }> {
  const scope = active;
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Choose a PNG, JPEG or WebP product photo.');
  if (!file.size || file.size > MAX_PRODUCT_IMAGE_BYTES) throw new Error('Choose a product photo smaller than 8 MB.');
  const imageId = globalThis.crypto.randomUUID(), record: Stored<ImageData> = { id: imageId, savedAt: Date.now(), data: { blob: file, name: file.name.slice(0, 200), ...(productId ? { productId } : {}) } };
  keepMemory(scope, 'images', record);
  try { await putDatabase(scope, 'images', record); scope.status = { mode: 'indexeddb', persistent: true }; }
  catch {
    if (file.size > MAX_FALLBACK_IMAGE_BYTES) { scope.memory.images = scope.memory.images.filter(r => r.id !== imageId); throw new Error('Photo storage is limited in this browser. Choose a photo smaller than 1.5 MB or enable browser storage.'); }
    const encoded = await dataUrl(file);
    await save(scope, 'images', { ...record, data: { ...record.data, blob: undefined, dataUrl: encoded } });
  }
  if (active !== scope) throw new Error('The signed-in account changed. Choose the photo again in this account.');
  const url = URL.createObjectURL(file); scope.urls.set(imageId, url);
  return { id: imageId, url, name: record.data.name, status: statusOf(scope) };
}
async function imageFor(scope: Scope, imageId: string): Promise<Blob | null> {
  const record = (await read<ImageData>(scope, 'images')).find(r => r.id === imageId);
  if (!record) return null;
  if (record.data.blob instanceof Blob) return record.data.blob;
  try { return record.data.dataUrl ? blobFromDataUrl(record.data.dataUrl) : null; } catch { return null; }
}
export async function getProductImage(imageId: string): Promise<Blob | null> { return imageFor(active, imageId); }
export async function hydrateProductImages(products: ProductDraft[]): Promise<ProductDraft[]> {
  const scope = active;
  const rows = await Promise.all(products.map(async product => ({ ...structuredClone(product), images: await Promise.all(product.images.map(async image => {
    if (image.source !== 'upload') return image;
    const cached = scope.urls.get(image.id); if (cached) return { ...image, url: cached };
    const blob = await imageFor(scope, image.assetId ?? image.id);
    if (!blob) return /^\/api\/assets\//.test(image.url) || /^https:\/\//.test(image.url) ? image : { ...image, url: '', generationAllowed: false };
    if (active !== scope) return { ...image, url: '', generationAllowed: false };
    const url = URL.createObjectURL(blob); scope.urls.set(image.id, url); return { ...image, url };
  })) })));
  return rows.map(p => ({ ...p, images: p.images.filter(i => i.url), ...(p.selectedImageId && !p.images.some(i => i.id === p.selectedImageId && i.url) ? { selectedImageId: undefined } : {}) }));
}
export async function deleteProduct(productId: string): Promise<ProductStorageStatus> {
  const scope = active; scope.memory.products = scope.memory.products.filter(r => r.id !== productId); let failed = false;
  try { const db = await database(scope); try { await new Promise<void>((resolve, reject) => { const tx = db.transaction('products', 'readwrite'); tx.objectStore('products').delete(productId); tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(new Error('Could not remove the saved product.')); }); } finally { db.close(); } } catch { failed = true; }
  try { const fallback = localFallback(scope); fallback.products = fallback.products.filter(r => r.id !== productId); localStorage.setItem(scope.fallbackKey, JSON.stringify(fallback)); } catch { if (failed) scope.status = { mode: 'memory', persistent: false, message: 'This removal could not be saved. The product may return after reload.' }; }
  return statusOf(scope);
}
export function releaseProductImageUrls(): void { for (const url of active.urls.values()) URL.revokeObjectURL(url); active.urls.clear(); }
