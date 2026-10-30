import { handlePipelineRequest } from "./local-pipeline";
import type {
  OperationRecord,
  ProductDraft,
  ProductResolveInput,
  StudioSession,
} from "../src/product-types";
import { validateProductDraft } from "../src/product-domain";
import { validateGLB } from "../src/local-assets";
import { resolveProduct, normalizeRetailerUrl, readBounded } from "./retailers";
import { StudioRepository, type AssetRow } from "./repository";
import { MeshyProvider, MESHY_MODEL } from "./provider";
import {
  PAID_GENERATION_RELEASED,
  startGeneration,
  pollGeneration,
  quotedGeneration,
} from "./generation";
import {
  StudioError,
  PAUSED_MESSAGE,
  type StudioEnv,
  type RequestContext,
} from "./types";
export type { StudioEnv, RequestContext } from "./types";

function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      Vary: "oai-authenticated-user-id",
    },
  });
}
function safeId(value: unknown, label = "identifier"): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 128 ||
    !/^[\w.-]+$/.test(value)
  )
    throw new StudioError(400, "INVALID_INPUT", `Choose a valid ${label}.`);
  return value;
}
function ownerOf(request: Request): string | null {
  // Trust boundary: Sites dispatch strips/replaces these headers. Never expose this route on an unprotected workers.dev origin.
  const owner = request.headers.get("oai-authenticated-user-id");
  return owner && owner.length <= 256 && /^[\w:@.-]+$/.test(owner)
    ? owner
    : null;
}
function requireOwner(request: Request): string {
  const owner = ownerOf(request);
  if (!owner)
    throw new StudioError(
      401,
      "SIGN_IN_REQUIRED",
      "Sign in to save products and keep your files private.",
    );
  return owner;
}
function repository(env: StudioEnv, owner: string) {
  if (!env.DB)
    throw new StudioError(
      503,
      "STORAGE_UNAVAILABLE",
      "Saved products are temporarily unavailable. You can still try dimensions locally.",
    );
  return new StudioRepository(env.DB, owner);
}
async function readJson(
  request: Request,
  max = 120_000,
): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new StudioError(415, "INVALID_CONTENT_TYPE", "Send a JSON request.");
  const len = Number(request.headers.get("content-length"));
  if (len > max)
    throw new StudioError(
      413,
      "REQUEST_TOO_LARGE",
      "This request is too large.",
    );
  const reader = request.body?.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    try {
      for (;;) {
        const r = await reader.read();
        if (r.done) break;
        size += r.value.length;
        if (size > max) {
          await reader.cancel();
          throw new StudioError(
            413,
            "REQUEST_TOO_LARGE",
            "This request is too large.",
          );
        }
        chunks.push(r.value);
      }
    } finally {
      reader.releaseLock();
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    const data = JSON.parse(new TextDecoder().decode(bytes));
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw new Error();
    return data;
  } catch {
    throw new StudioError(
      400,
      "INVALID_JSON",
      "This request could not be read.",
    );
  }
}
function sameOrigin(request: Request) {
  if (request.method === "GET" || request.method === "HEAD") return;
  const origin = request.headers.get("origin");
  if (
    (origin && origin !== new URL(request.url).origin) ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    throw new StudioError(
      403,
      "CROSS_ORIGIN_REQUEST",
      "Open this action from Roomshift.",
    );
}
function generationEnabled(env: StudioEnv) {
  return (
    PAID_GENERATION_RELEASED &&
    env.STUDIO_PAID_GENERATION_ENABLED === "true" &&
    typeof env.MESHY_API_KEY === "string" &&
    env.MESHY_API_KEY.length >= 12
  );
}
function observedOperation(
  roomId: string,
  name: string,
  kind: OperationRecord["kind"],
  start: number,
  productId?: string,
): OperationRecord {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    roomId,
    productId,
    attempt: 1,
    kind,
    name,
    status: "succeeded",
    engine: "deterministic server processing",
    submittedAt: new Date(start).toISOString(),
    startedAt: new Date(start).toISOString(),
    finishedAt: now,
    timing: {
      processingMs: Date.now() - start,
      elapsedMs: Date.now() - start,
      source: "observed",
    },
    usage: {},
    cost: {
      basis: "local",
      note: "No model API call. Hosting, storage and server processing are unmetered.",
    },
  };
}
async function session(request: Request, env: StudioEnv): Promise<Response> {
  const owner = ownerOf(request),
    storageAvailable = !!(env.DB && env.BUCKET);
  let remaining: number | null = owner && env.DB ? 0 : null;
  if (owner && env.DB) {
    const account = await new StudioRepository(env.DB, owner).account();
    if (account)
      remaining = Math.max(
        0,
        account.allowance_credits -
          account.reserved_credits -
          account.consumed_credits,
      );
  }
  const enabled = generationEnabled(env),
    result: StudioSession = {
      user: owner
        ? {
            id: owner,
            name:
              request.headers
                .get("oai-authenticated-user-full-name")
                ?.slice(0, 100) || "Your account",
          }
        : null,
      storageAvailable,
      generation: {
        enabled,
        available:
          enabled &&
          !!owner &&
          storageAvailable &&
          remaining !== null &&
          remaining >= quotedGeneration().credits,
        provider: "Meshy",
        model: MESHY_MODEL,
        estimatedCredits: enabled ? quotedGeneration().credits : null,
        creditUnit: quotedGeneration().creditUnit,
        remainingCredits: remaining,
        reason: enabled ? undefined : PAUSED_MESSAGE,
      },
    };
  return json(result);
}
function validateResolve(data: Record<string, unknown>): ProductResolveInput {
  const roomId = safeId(data.roomId, "room");
  if (
    data.url !== undefined &&
    (typeof data.url !== "string" || data.url.length > 2048)
  )
    throw new StudioError(
      400,
      "INVALID_INPUT",
      "Paste a supported product link.",
    );
  if (
    data.specifications !== undefined &&
    (typeof data.specifications !== "string" ||
      data.specifications.length > 20_000)
  )
    throw new StudioError(
      400,
      "INVALID_INPUT",
      "Paste up to 20,000 characters of product specifications.",
    );
  if (
    !String(data.url ?? "").trim() &&
    !String(data.specifications ?? "").trim()
  )
    throw new StudioError(
      400,
      "PRODUCT_INPUT_REQUIRED",
      "Paste a product link or its specifications.",
    );
  return {
    roomId,
    url: data.url as string | undefined,
    specifications: data.specifications as string | undefined,
    roomName:
      typeof data.roomName === "string"
        ? data.roomName.slice(0, 100)
        : undefined,
    componentId:
      typeof data.componentId === "string"
        ? safeId(data.componentId)
        : undefined,
  };
}
async function resolve(request: Request, env: StudioEnv) {
  const input = validateResolve(await readJson(request, 30_000)),
    started = Date.now(),
    result = await resolveProduct(input),
    operation = observedOperation(
      input.roomId,
      result.notice
        ? "Product link needs review"
        : "Read product specifications",
      "product-lookup",
      started,
      result.product.id,
    );
  operation.roomName = input.roomName;
  operation.componentId = input.componentId;
  if (result.notice) {
    operation.status = "unknown";
    operation.errorCode = "PAGE_UNAVAILABLE";
    operation.cost.note =
      "No model API call; infrastructure is unmetered. Product-page access was incomplete; enter specifications manually.";
  }
  const owner = ownerOf(request);
  if (owner && env.DB)
    await new StudioRepository(env.DB, owner).saveOperation(operation);
  return json({ ...result, operation });
}
async function saveProduct(request: Request, repo: StudioRepository) {
  const data = await readJson(request);
  let product: ProductDraft;
  try {
    product = validateProductDraft(data.product ?? data);
  } catch {
    throw new StudioError(
      400,
      "INVALID_PRODUCT",
      "Review the product name, dimensions and source before saving.",
    );
  }
  if (product.source.retailer !== "manual") {
    const url = product.source.submittedUrl ?? product.source.canonicalUrl;
    if (!url)
      throw new StudioError(
        400,
        "INVALID_PRODUCT",
        "The retailer product link is missing.",
      );
    const safe = normalizeRetailerUrl(url);
    if (safe.retailer !== product.source.retailer)
      throw new StudioError(
        400,
        "INVALID_PRODUCT",
        "The product source does not match its link.",
      );
  }
  for (const image of product.images) {
    if (image.source === "listing") {
      image.generationAllowed = false;
      image.assetId = undefined;
      continue;
    }
    if (!image.assetId)
      throw new StudioError(
        400,
        "INVALID_ASSET",
        "Upload the product photo before saving.",
      );
    const asset = await repo.asset(image.assetId);
    if (!asset || !asset.mime.startsWith("image/"))
      throw new StudioError(
        400,
        "INVALID_ASSET",
        "This product image is unavailable.",
      );
    image.url = `/api/assets/${asset.id}`;
    image.generationAllowed = !!asset.generation_allowed;
    image.name = asset.name;
  }
  if (product.model.remoteAssetId) {
    const asset = await repo.asset(product.model.remoteAssetId);
    if (!asset || asset.mime !== "model/gltf-binary")
      throw new StudioError(
        400,
        "INVALID_ASSET",
        "This 3D model is unavailable.",
      );
  }
  product.updatedAt = new Date().toISOString();
  await repo.saveProduct(product);
  return json({ product });
}
function sniffImage(bytes: Uint8Array): string | null {
  if (
    bytes.length >= 8 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)
  )
    return "image/png";
  if (
    bytes.length >= 3 &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255
  )
    return "image/jpeg";
  if (
    bytes.length >= 12 &&
    new TextDecoder().decode(bytes.subarray(0, 4)) === "RIFF" &&
    new TextDecoder().decode(bytes.subarray(8, 12)) === "WEBP"
  )
    return "image/webp";
  return null;
}
async function uploadAsset(
  request: Request,
  env: StudioEnv,
  repo: StudioRepository,
) {
  if (!env.BUCKET)
    throw new StudioError(
      503,
      "STORAGE_UNAVAILABLE",
      "File storage is temporarily unavailable.",
    );
  if (Number(request.headers.get("content-length")) > 31_000_000)
    throw new StudioError(
      413,
      "ASSET_TOO_LARGE",
      "Choose a GLB smaller than 30 MB or an image smaller than 8 MB.",
    );
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.startsWith("multipart/form-data"))
    throw new StudioError(
      415,
      "INVALID_CONTENT_TYPE",
      "Choose a file to upload.",
    );
  const requestBytes = await readBounded(
    new Response(request.body, { headers: request.headers }),
    31_000_000,
  );
  let form: FormData;
  try {
    form = await new Response(requestBytes.buffer as ArrayBuffer, {
      headers: { "content-type": contentType },
    }).formData();
  } catch {
    throw new StudioError(
      400,
      "INVALID_MULTIPART",
      "This file upload could not be read.",
    );
  }
  const file = form.get("file"),
    roomId = safeId(form.get("roomId"), "room");
  if (!(file instanceof File) || !file.size)
    throw new StudioError(
      400,
      "FILE_REQUIRED",
      "Choose a product photo or GLB model.",
    );
  const model = /\.glb$/i.test(file.name),
    max = model ? 30_000_000 : 8_000_000;
  if (file.size > max)
    throw new StudioError(
      413,
      "ASSET_TOO_LARGE",
      model
        ? "Choose a GLB smaller than 30 MB."
        : "Choose an image smaller than 8 MB.",
    );
  const started = Date.now(),
    bytes = await file.arrayBuffer();
  let mime: string;
  if (model) {
    try {
      validateGLB(bytes);
    } catch {
      throw new StudioError(
        400,
        "INVALID_GLB",
        "Choose a self-contained GLB 2 model with embedded textures.",
      );
    }
    mime = "model/gltf-binary";
  } else {
    const image = sniffImage(new Uint8Array(bytes));
    if (!image)
      throw new StudioError(
        400,
        "INVALID_IMAGE",
        "Choose a PNG, JPEG or WebP product photo.",
      );
    mime = image;
  }
  const productId = form.get("productId")
      ? safeId(form.get("productId"), "product")
      : null,
    id = crypto.randomUUID(),
    name =
      file.name.replace(/[\\/\x00-\x1f]/g, "").slice(0, 160) || "Product asset",
    key = `studio/${repo.owner}/${id}`,
    allowed = !model && form.get("generationAllowed") === "true";
  const row: AssetRow = {
    id,
    owner_id: repo.owner,
    room_id: roomId,
    product_id: productId,
    object_key: key,
    mime,
    size: bytes.byteLength,
    name,
    generation_allowed: allowed ? 1 : 0,
    created_at: new Date().toISOString(),
  };
  await env.BUCKET.put(key, bytes, { httpMetadata: { contentType: mime } });
  try {
    await repo.saveAsset(row);
  } catch (e) {
    await env.BUCKET.delete(key);
    throw e;
  }
  const operation = observedOperation(
    roomId,
    model ? "Import 3D model" : "Add product photo",
    model ? "model-import" : "image-preparation",
    started,
    productId ?? undefined,
  );
  operation.usage.bytes = bytes.byteLength;
  operation.outputAssetIds = [id];
  if (!model) operation.usage.imageCount = 1;
  await repo.saveOperation(operation);
  return json(
    {
      id,
      assetId: id,
      url: `/api/assets/${id}`,
      name,
      mime,
      size: bytes.byteLength,
      generationAllowed: allowed,
      operation,
    },
    201,
  );
}
async function getAsset(env: StudioEnv, repo: StudioRepository, id: string) {
  const row = await repo.asset(safeId(id));
  if (!row || !env.BUCKET)
    throw new StudioError(
      404,
      "ASSET_NOT_FOUND",
      "This product asset is unavailable.",
    );
  const object = await env.BUCKET.get(row.object_key);
  if (!object)
    throw new StudioError(
      404,
      "ASSET_NOT_FOUND",
      "This product asset is unavailable.",
    );
  return new Response(object.body, {
    headers: {
      "Content-Type": row.mime,
      "Content-Length": String(row.size),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `inline; filename="${row.mime === "model/gltf-binary" ? "product-model.glb" : "product-photo"}"`,
      Vary: "oai-authenticated-user-id",
    },
  });
}
export async function handleStudioRequest(
  request: Request,
  env: StudioEnv,
  _context?: RequestContext,
): Promise<Response> {
  try {
    sameOrigin(request);
    const url = new URL(request.url),
      path = url.pathname.replace(/\/$/, "");
    if (path.startsWith("/api/pipeline/"))
      return await handlePipelineRequest(request, env, { ownerOf, readJson, json });
    if (path === "/api/studio/session" && request.method === "GET")
      return await session(request, env);
    if (path === "/api/products/resolve" && request.method === "POST")
      return await resolve(request, env);
    // The release switch is deliberately checked before body parsing, storage, network, or credentials.
    if (
      (path === "/api/generations" || path === "/api/studio/generation/jobs") &&
      request.method === "POST" &&
      !generationEnabled(env)
    )
      return json(
        { error: { code: "GENERATION_PAUSED", message: PAUSED_MESSAGE } },
        403,
      );
    const owner = requireOwner(request),
      repo = repository(env, owner),
      roomId = url.searchParams.get("roomId") ?? undefined;
    if (roomId) safeId(roomId, "room");
    if (path === "/api/products" && request.method === "GET")
      return json({ products: await repo.products(roomId) });
    if (path === "/api/products" && request.method === "POST")
      return await saveProduct(request, repo);
    if (path === "/api/operations" && request.method === "GET")
      return json({
        operations: await repo.operations(roomId),
        coverage:
          "Most recent 500 instrumented operations. Earlier processing was not recorded.",
      });
    if (path === "/api/assets" && request.method === "POST")
      return await uploadAsset(request, env, repo);
    const assetMatch = path.match(/^\/api\/assets\/([^/]+)$/);
    if (assetMatch && request.method === "GET")
      return await getAsset(env, repo, assetMatch[1]);
    if (path === "/api/generations" && request.method === "POST") {
      if (!env.BUCKET || !env.MESHY_API_KEY)
        throw new StudioError(503, "GENERATION_UNAVAILABLE", PAUSED_MESSAGE);
      const data = await readJson(request),
        product = await repo.product(safeId(data.productId, "product"));
      if (!product)
        throw new StudioError(
          404,
          "PRODUCT_NOT_FOUND",
          "Save this product before creating its model.",
        );
      if (
        data.draftRevision !== undefined &&
        data.draftRevision !== product.revision
      )
        throw new StudioError(
          409,
          "STALE_PRODUCT",
          "Review the current product revision before generating.",
        );
      const job = await startGeneration(
        repo,
        env.BUCKET,
        product,
        safeId(data.imageId ?? product.selectedImageId, "image"),
        String(
          request.headers.get("Idempotency-Key") ?? data.idempotencyKey ?? "",
        ),
        new MeshyProvider(env.MESHY_API_KEY),
      );
      return json({ job }, 202);
    }
    const jobMatch = path.match(/^\/api\/generations\/([^/]+)$/);
    if (jobMatch && request.method === "GET") {
      const row = await repo.job(safeId(jobMatch[1]));
      if (!row)
        throw new StudioError(
          404,
          "JOB_NOT_FOUND",
          "This model job is unavailable.",
        );
      if (!generationEnabled(env) || !env.BUCKET || !env.MESHY_API_KEY)
        return json({ job: JSON.parse(row.job_json), notice: PAUSED_MESSAGE });
      return json({
        job: await pollGeneration(
          repo,
          env.BUCKET,
          jobMatch[1],
          new MeshyProvider(env.MESHY_API_KEY),
        ),
      });
    }
    throw new StudioError(
      404,
      "NOT_FOUND",
      "This studio action is unavailable.",
    );
  } catch (error) {
    if (error instanceof StudioError)
      return json(
        { error: { code: error.code, message: error.message } },
        error.status,
      );
    return json(
      {
        error: {
          code: "STUDIO_UNAVAILABLE",
          message:
            "This action could not be completed. Your room has not been changed.",
        },
      },
      503,
    );
  }
}
