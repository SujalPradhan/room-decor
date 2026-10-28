import { isSupportedAssetId } from "./catalog";

export const MAX_LOCAL_MODEL_BYTES = 30_000_000;
const DB_NAME = "roomshift-local-models";
const STORE_NAME = "models";

type JsonObject = Record<string, unknown>;
function record(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object.`);
  return value as JsonObject;
}
function list(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
}
function uint(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error(`${label} must be a nonnegative integer.`);
  return value;
}
function index(value: unknown, length: number, label: string): number {
  const n = uint(value, label);
  if (n >= length) throw new Error(`${label} points outside the model.`);
  return n;
}

/** Local structural validation. This is not a claim of full Khronos conformance. */
export function validateGLB(data: ArrayBuffer): {
  nodeCount: number;
  meshCount: number;
} {
  if (data.byteLength > MAX_LOCAL_MODEL_BYTES)
    throw new Error("Choose a GLB smaller than 30 MB.");
  if (data.byteLength < 20)
    throw new Error("The file is too short to be a GLB model.");
  const view = new DataView(data);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2)
    throw new Error("Choose a binary glTF 2.0 (.glb) model.");
  if (view.getUint32(8, true) !== data.byteLength)
    throw new Error(
      "The GLB file length is inconsistent or the file is truncated.",
    );
  const jsonLength = view.getUint32(12, true);
  if (
    view.getUint32(16, true) !== 0x4e4f534a ||
    jsonLength % 4 !== 0 ||
    jsonLength < 4 ||
    20 + jsonLength > data.byteLength
  )
    throw new Error("The GLB JSON chunk is missing or truncated.");
  let raw: unknown;
  try {
    raw = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        new Uint8Array(data, 20, jsonLength),
      ),
    );
  } catch {
    throw new Error("The GLB contains invalid JSON.");
  }
  const json = record(raw, "GLB JSON"),
    asset = record(json.asset, "GLB asset");
  if (
    asset.version !== "2.0" ||
    (asset.minVersion !== undefined && asset.minVersion !== "2.0")
  )
    throw new Error("This model requires an unsupported glTF version.");
  let binLength = 0,
    binChunks = 0,
    offset = 20 + jsonLength;
  while (offset < data.byteLength) {
    if (offset + 8 > data.byteLength)
      throw new Error("The GLB contains a truncated chunk.");
    const length = view.getUint32(offset, true),
      type = view.getUint32(offset + 4, true);
    if (length % 4 !== 0 || offset + 8 + length > data.byteLength)
      throw new Error("The GLB chunk length is invalid.");
    if (type === 0x4e4f534a)
      throw new Error("The GLB contains more than one JSON chunk.");
    if (type === 0x004e4942) {
      binChunks++;
      binLength = length;
    }
    offset += 8 + length;
  }
  if (binChunks > 1)
    throw new Error("The GLB contains more than one binary chunk.");
  const required =
    json.extensionsRequired === undefined
      ? []
      : list(json.extensionsRequired, "Required extensions");
  const decoderExtensions = [
    "KHR_draco_mesh_compression",
    "EXT_meshopt_compression",
    "KHR_texture_basisu",
  ];
  if (
    required.some(
      (extension) =>
        typeof extension !== "string" || decoderExtensions.includes(extension),
    )
  )
    throw new Error(
      "Export an uncompressed GLB with embedded PNG or JPEG textures; this model needs an additional decoder.",
    );
  // Never let a user-imported model cause network or local-file resource reads.
  const stack: unknown[] = [json];
  while (stack.length) {
    const value = stack.pop();
    if (Array.isArray(value)) {
      for (const child of value) stack.push(child);
      continue;
    }
    if (value && typeof value === "object")
      for (const [key, child] of Object.entries(value)) {
        if (
          key === "uri" &&
          (typeof child !== "string" ||
            !/^data:(?:application\/(?:octet-stream|gltf-buffer)|image\/(?:png|jpeg|webp|avif|ktx2));base64,[a-z\d+/]*={0,2}$/i.test(
              child,
            ))
        )
          throw new Error(
            "The model references an external file. Export one self-contained GLB with embedded textures.",
          );
        if (child && typeof child === "object") stack.push(child);
      }
  }
  const buffers =
    json.buffers === undefined ? [] : list(json.buffers, "Buffers");
  const bufferLengths = buffers.map((value, i) => {
    const buffer = record(value, "Buffer"),
      length = uint(buffer.byteLength, "Buffer byte length");
    if (
      buffer.uri === undefined &&
      (i !== 0 || !binChunks || length > binLength || binLength - length > 3)
    )
      throw new Error("The model is missing its embedded binary buffer.");
    return length;
  });
  const views =
    json.bufferViews === undefined
      ? []
      : list(json.bufferViews, "Buffer views");
  views.forEach((value) => {
    const v = record(value, "Buffer view"),
      buffer = index(v.buffer, buffers.length, "Buffer reference"),
      start = uint(v.byteOffset ?? 0, "Buffer offset"),
      length = uint(v.byteLength, "Buffer view length");
    if (start + length > bufferLengths[buffer])
      throw new Error("A buffer view extends beyond the embedded model data.");
  });
  const images = json.images === undefined ? [] : list(json.images, "Images");
  images.forEach((value) => {
    const image = record(value, "Image");
    if (image.uri === undefined)
      index(image.bufferView, views.length, "Image buffer view");
  });
  const nodes = list(json.nodes, "Nodes"),
    meshes = list(json.meshes, "Meshes");
  if (!nodes.length || !meshes.length)
    throw new Error("The GLB does not contain furniture geometry.");
  const graph = nodes.map((value) => {
    const node = record(value, "Node");
    if (node.mesh !== undefined) index(node.mesh, meshes.length, "Node mesh");
    for (const [field, length] of [
      ["translation", 3],
      ["rotation", 4],
      ["scale", 3],
      ["matrix", 16],
    ] as const) {
      if (node[field] === undefined) continue;
      const values = list(node[field], `Node ${field}`);
      if (
        values.length !== length ||
        values.some(
          (value) => typeof value !== "number" || !Number.isFinite(value),
        )
      )
        throw new Error("The model contains invalid node transforms.");
    }
    return node.children === undefined
      ? []
      : list(node.children, "Node children").map((child) =>
          index(child, nodes.length, "Child node"),
        );
  });
  // Reject cycles before GLTFLoader can recursively expand the node graph.
  const visited = new Uint8Array(nodes.length);
  for (let node = 0; node < nodes.length; node++) {
    const pending: { node: number; exit: boolean }[] = [{ node, exit: false }];
    while (pending.length) {
      const current = pending.pop()!;
      if (current.exit) {
        visited[current.node] = 2;
        continue;
      }
      if (visited[current.node] === 1)
        throw new Error("The model contains a cyclic node hierarchy.");
      if (visited[current.node] === 2) continue;
      visited[current.node] = 1;
      pending.push({ node: current.node, exit: true });
      for (const child of graph[current.node])
        pending.push({ node: child, exit: false });
    }
  }
  const scenes = list(json.scenes, "Scenes");
  if (!scenes.length) throw new Error("The GLB does not contain a scene.");
  if (json.scene !== undefined)
    index(json.scene, scenes.length, "Default scene");
  scenes.forEach((value) => {
    const scene = record(value, "Scene");
    if (scene.nodes !== undefined)
      list(scene.nodes, "Scene nodes").forEach((node) =>
        index(node, nodes.length, "Scene node"),
      );
  });
  return { nodeCount: nodes.length, meshCount: meshes.length };
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined")
    return Promise.reject(
      new Error("Local model storage is unavailable in this browser."),
    );
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME))
        request.result.createObjectStore(STORE_NAME, { keyPath: "assetId" });
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () =>
      reject(new Error("Local model storage could not be opened."));
    request.onblocked = () =>
      reject(
        new Error(
          "Close other Roomshift tabs and try importing the model again.",
        ),
      );
  });
}

export async function storeLocalModel(
  file: File,
): Promise<{ assetId: string; name: string }> {
  if (!/\.glb$/i.test(file.name))
    throw new Error("Choose a binary glTF (.glb) file.");
  if (file.size > MAX_LOCAL_MODEL_BYTES)
    throw new Error("Choose a GLB smaller than 30 MB.");
  const bytes = await file.arrayBuffer();
  validateGLB(bytes);
  const assetId = `local:${crypto.randomUUID()}`,
    name = file.name.slice(0, 160),
    db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put({
        assetId,
        name,
        bytes,
        createdAt: Date.now(),
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () =>
        reject(
          new Error(
            "The model could not be stored. Your browser may be out of space.",
          ),
        );
      tx.onabort = () => reject(new Error("The model import was interrupted."));
    });
    return { assetId, name };
  } finally {
    db.close();
  }
}

export async function getLocalModel(
  assetId: string,
): Promise<ArrayBuffer | null> {
  if (!isSupportedAssetId(assetId) || !assetId.startsWith("local:"))
    return null;
  const db = await openDatabase();
  try {
    return await new Promise<ArrayBuffer | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly"),
        request = tx.objectStore(STORE_NAME).get(assetId);
      let bytes: ArrayBuffer | null = null;
      request.onsuccess = () => {
        const value = request.result;
        if (value?.bytes instanceof ArrayBuffer) bytes = value.bytes;
      };
      tx.oncomplete = () => resolve(bytes);
      tx.onerror = () =>
        reject(new Error("This local model could not be read."));
      tx.onabort = () =>
        reject(new Error("Reading the local model was interrupted."));
    });
  } finally {
    db.close();
  }
}

export async function removeLocalModel(assetId: string): Promise<void> {
  if (!isSupportedAssetId(assetId) || !assetId.startsWith("local:")) return;
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(assetId);
      tx.oncomplete = () => resolve();
      tx.onerror = () =>
        reject(new Error("The local model could not be removed."));
      tx.onabort = () =>
        reject(new Error("Removing the local model was interrupted."));
    });
  } finally {
    db.close();
  }
}
