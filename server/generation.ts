import type {
  GenerationJob,
  OperationRecord,
  ProductDraft,
} from "../src/product-types";
import { validateGLB } from "../src/local-assets";
import type { Bucket } from "./types";
import { StudioError } from "./types";
import { StudioRepository, type AssetRow, type JobRow } from "./repository";
import { MESHY_MODEL, MESHY_RATE, type ModelProvider } from "./provider";

/** Disabled in this release even if a deployment accidentally supplies credentials. */
export const PAID_GENERATION_RELEASED = false;
export function quotedGeneration() {
  return {
    provider: "Meshy",
    model: MESHY_MODEL,
    credits: MESHY_RATE.credits,
    creditUnit: MESHY_RATE.unit,
    rateId: MESHY_RATE.id,
    rateSource: MESHY_RATE.source,
    rateCheckedAt: MESHY_RATE.checkedAt,
    basis: "estimated" as const,
  };
}
const stamp = () => new Date().toISOString();
function validKey(key: string) {
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(key))
    throw new StudioError(
      400,
      "INVALID_IDEMPOTENCY_KEY",
      "Retry with a valid request identifier.",
    );
  return key;
}
async function hash(value: string) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  ]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
function dataUri(bytes: ArrayBuffer, mime: string) {
  const value = new Uint8Array(bytes);
  let encoded = "";
  for (let i = 0; i < value.length; i += 8192)
    encoded += String.fromCharCode(...value.subarray(i, i + 8192));
  return `data:${mime};base64,${btoa(encoded)}`;
}
/** Internal engine is provider-injected for deterministic tests. HTTP release policy lives in studio.ts. */
export async function startGeneration(
  repo: StudioRepository,
  bucket: Bucket,
  product: ProductDraft,
  imageId: string,
  idempotencyKey: string,
  provider: ModelProvider,
): Promise<GenerationJob> {
  validKey(idempotencyKey);
  if (
    !Object.values(product.dimensions).every(
      (d) => d.confirmed && d.metres !== null,
    )
  )
    throw new StudioError(
      400,
      "DIMENSIONS_REQUIRED",
      "Review all three outer dimensions first.",
    );
  const image = product.images.find((i) => i.id === imageId);
  const asset = image?.assetId ? await repo.asset(image.assetId) : null;
  if (
    !image ||
    image.source !== "upload" ||
    !asset ||
    !asset.generation_allowed ||
    !/^image\/(png|jpeg|webp)$/.test(asset.mime)
  )
    throw new StudioError(
      400,
      "PERMITTED_IMAGE_REQUIRED",
      "Choose your own permitted product photo before generating.",
    );
  const requestHash = await hash(
    JSON.stringify({
      product: product.id,
      revision: product.revision,
      image: asset.id,
      model: MESHY_MODEL,
      rate: MESHY_RATE.id,
    }),
  );
  const old = await repo.idempotentJob(idempotencyKey);
  if (old) {
    if (old.request_hash !== requestHash)
      throw new StudioError(
        409,
        "IDEMPOTENCY_CONFLICT",
        "This request identifier was already used for another product revision.",
      );
    return JSON.parse(old.job_json) as GenerationJob;
  }
  const now = stamp(),
    id = crypto.randomUUID(),
    operationId = crypto.randomUUID(),
    quote = MESHY_RATE.credits;
  const job: GenerationJob = {
    id,
    productId: product.id,
    draftRevision: product.revision,
    roomId: product.roomId,
    status: "queued",
    provider: "Meshy",
    model: MESHY_MODEL,
    createdAt: now,
    operationId,
  };
  const operation: OperationRecord = {
    id: operationId,
    roomId: product.roomId,
    productId: product.id,
    attempt: 1,
    kind: "model-generation",
    name: `Create model: ${product.title}`,
    status: "queued",
    engine: "external inference",
    provider: "Meshy",
    model: MESHY_MODEL,
    submittedAt: now,
    timing: { source: "observed" },
    usage: { imageCount: 1 },
    estimate: {
      credits: quote,
      creditUnit: MESHY_RATE.unit,
      rateId: MESHY_RATE.id,
      rateSource: MESHY_RATE.source,
      rateCheckedAt: MESHY_RATE.checkedAt,
    },
    cost: {
      basis: "estimated",
      amountMicros: null,
      reservedCredits: quote,
      rateId: MESHY_RATE.id,
      note: "Configuration quote; final credits require provider reconciliation.",
    },
    inputImageIds: [image.id],
  };
  // D1 batch is transactional: insertion is conditional on allowance, and retries reserve nothing twice.
  await repo.db.batch([
    repo.db
      .prepare(
        "INSERT INTO studio_jobs (id,owner_id,product_id,room_id,draft_revision,provider_task_id,operation_id,idempotency_key,request_hash,status,job_json,quoted_credits,reservation_state,created_at,updated_at) SELECT ?,?,?,?,?,NULL,?,?,?,?,?,?,'pending',?,? FROM studio_accounts WHERE owner_id = ? AND allowance_credits - reserved_credits - consumed_credits >= ? ON CONFLICT(owner_id,idempotency_key) DO NOTHING",
      )
      .bind(
        id,
        repo.owner,
        product.id,
        product.roomId,
        product.revision,
        operationId,
        idempotencyKey,
        requestHash,
        "queued",
        JSON.stringify(job),
        quote,
        now,
        now,
        repo.owner,
        quote,
      ),
    repo.db
      .prepare(
        "INSERT INTO studio_operations (id,owner_id,room_id,product_id,record_json,submitted_at) SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM studio_jobs WHERE id = ? AND owner_id = ? AND reservation_state = 'pending')",
      )
      .bind(
        operationId,
        repo.owner,
        product.roomId,
        product.id,
        JSON.stringify(operation),
        now,
        id,
        repo.owner,
      ),
    repo.db
      .prepare(
        "UPDATE studio_accounts SET reserved_credits = reserved_credits + ? WHERE owner_id = ? AND allowance_credits - reserved_credits - consumed_credits >= ? AND EXISTS (SELECT 1 FROM studio_jobs WHERE id = ? AND reservation_state = 'pending')",
      )
      .bind(quote, repo.owner, quote, id),
    repo.db
      .prepare(
        "UPDATE studio_jobs SET reservation_state = 'reserved' WHERE id = ? AND owner_id = ? AND reservation_state = 'pending'",
      )
      .bind(id, repo.owner),
  ]);
  const row = await repo.idempotentJob(idempotencyKey);
  if (!row)
    throw new StudioError(
      409,
      "ALLOWANCE_REQUIRED",
      "There is no generation allowance available. Your size preview is still available.",
    );
  if (row.id !== id) {
    if (row.request_hash !== requestHash)
      throw new StudioError(
        409,
        "IDEMPOTENCY_CONFLICT",
        "This request identifier was already used.",
      );
    return JSON.parse(row.job_json);
  }
  try {
    const source = await bucket.get(asset.object_key);
    if (!source)
      throw new StudioError(
        404,
        "IMAGE_MISSING",
        "The product image is unavailable.",
      );
    const bytes = await source.arrayBuffer();
    if (bytes.byteLength > 8_000_000)
      throw new StudioError(
        413,
        "IMAGE_TOO_LARGE",
        "Choose a product image smaller than 8 MB.",
      );
    const task = await provider.create(dataUri(bytes, asset.mime), operationId);
    job.status = task.status === "running" ? "running" : "queued";
    operation.status = job.status;
    operation.timing.transferMs = Date.now() - Date.parse(now);
    if (job.status === "running") {
      job.startedAt = stamp();
      operation.startedAt = job.startedAt;
      operation.timing.queueMs = Date.parse(job.startedAt) - Date.parse(now);
    }
    await repo.updateJob(row, job, { provider_task_id: task.id });
    await repo.saveOperation(operation);
  } catch {
    // A timeout may follow task creation; hold the reservation until authoritative reconciliation.
    job.status = "unknown";
    job.error =
      "The model request could not be confirmed. No automatic retry was made.";
    operation.status = "unknown";
    operation.errorCode = "PROVIDER_REQUEST_UNCONFIRMED";
    operation.cost.note =
      "Billing outcome unknown; reservation held for reconciliation.";
    await repo.updateJob(row, job);
    await repo.saveOperation(operation);
  }
  return job;
}
async function settleReservation(
  repo: StudioRepository,
  row: JobRow,
  job: GenerationJob,
  credits: number | null,
) {
  if (credits === null) {
    await repo.updateJob(row, job);
    return;
  }
  const charged = Math.max(0, credits),
    state = charged ? "consumed" : "released";
  await repo.db.batch([
    repo.db
      .prepare(
        "UPDATE studio_accounts SET reserved_credits = MAX(0,reserved_credits - ?),consumed_credits = consumed_credits + ? WHERE owner_id = ? AND EXISTS (SELECT 1 FROM studio_jobs WHERE id = ? AND owner_id = ? AND reservation_state = 'reserved')",
      )
      .bind(row.quoted_credits, charged, repo.owner, row.id, repo.owner),
    repo.db
      .prepare(
        "UPDATE studio_jobs SET status = ?,job_json = ?,reservation_state = ?,updated_at = ? WHERE id = ? AND owner_id = ?",
      )
      .bind(
        job.status,
        JSON.stringify(job),
        state,
        stamp(),
        job.id,
        repo.owner,
      ),
  ]);
}
export async function pollGeneration(
  repo: StudioRepository,
  bucket: Bucket,
  id: string,
  provider: ModelProvider,
): Promise<GenerationJob> {
  const row = await repo.job(id);
  if (!row)
    throw new StudioError(
      404,
      "JOB_NOT_FOUND",
      "This model job is unavailable.",
    );
  const job = JSON.parse(row.job_json) as GenerationJob;
  if (
    ["succeeded", "failed", "preparing"].includes(job.status) ||
    !row.provider_task_id
  )
    return job;
  const task = await provider.get(row.provider_task_id);
  const op = await repo.operation(row.operation_id);
  if (!op)
    throw new StudioError(
      503,
      "ACCOUNTING_UNAVAILABLE",
      "This job cannot proceed until its activity record is available.",
    );
  if (
    task.status === "queued" ||
    task.status === "running" ||
    task.status === "unknown"
  ) {
    if (task.status === "running" && !job.startedAt) {
      job.status = "running";
      job.startedAt = stamp();
      op.status = "running";
      op.startedAt = job.startedAt;
      op.timing.queueMs = Date.parse(job.startedAt) - Date.parse(job.createdAt);
      await repo.updateJob(row, job);
      await repo.saveOperation(op);
    }
    return job;
  }
  job.finishedAt = stamp();
  op.finishedAt = job.finishedAt;
  op.timing.elapsedMs = Date.parse(job.finishedAt) - Date.parse(job.createdAt);
  op.timing.processingMs = job.startedAt
    ? Date.parse(job.finishedAt) - Date.parse(job.startedAt)
    : undefined;
  if (task.status === "failed") {
    job.status = "failed";
    job.error =
      "The model service could not finish. Your size preview is still available.";
    op.status = "failed";
    op.errorCode = "PROVIDER_TASK_FAILED";
    op.usage.credits = task.credits;
    op.cost.basis = task.credits === undefined ? "unknown" : "reported";
    op.cost.note =
      task.credits === undefined
        ? "Final charge unknown; awaiting provider reconciliation."
        : "Provider-reported credits; currency charge is not reconciled.";
    if (task.credits !== undefined) op.cost.reservedCredits = 0;
    await settleReservation(repo, row, job, task.credits ?? null);
    await repo.saveOperation(op);
    return job;
  }
  const lock = await repo.db
    .prepare(
      "UPDATE studio_jobs SET status = 'preparing',job_json = ? WHERE id = ? AND owner_id = ? AND status IN ('queued','running','unknown')",
    )
    .bind(
      JSON.stringify({ ...job, status: "preparing", finishedAt: undefined }),
      id,
      repo.owner,
    )
    .run();
  if (lock.meta?.changes === 0)
    return JSON.parse((await repo.job(id))!.job_json);
  try {
    if (!task.modelUrl) throw new Error("No asset");
    const started = Date.now(),
      bytes = await provider.download(task.modelUrl);
    validateGLB(bytes);
    const assetId = crypto.randomUUID(),
      key = `studio/${repo.owner}/${assetId}.glb`;
    await bucket.put(key, bytes, {
      httpMetadata: { contentType: "model/gltf-binary" },
    });
    const asset: AssetRow = {
      id: assetId,
      owner_id: repo.owner,
      room_id: row.room_id,
      product_id: row.product_id,
      object_key: key,
      mime: "model/gltf-binary",
      size: bytes.byteLength,
      name: "Product model.glb",
      generation_allowed: 0,
      created_at: stamp(),
    };
    try {
      await repo.saveAsset(asset);
    } catch (e) {
      await bucket.delete(key);
      throw e;
    }
    job.status = "succeeded";
    job.outputAssetId = assetId;
    op.status = "succeeded";
    op.outputAssetIds = [assetId];
    op.usage.bytes = bytes.byteLength;
    op.timing.transferMs = Date.now() - started;
  } catch {
    job.status = "failed";
    job.error =
      "The generated model could not be prepared. Your size preview is still available.";
    op.status = "failed";
    op.errorCode = "MODEL_PREPARATION_FAILED";
  }
  job.finishedAt = stamp();
  op.finishedAt = job.finishedAt;
  op.timing.elapsedMs = Date.parse(job.finishedAt) - Date.parse(job.createdAt);
  op.cost.reservedCredits = 0;
  op.usage.credits = task.credits;
  op.usage.creditUnit = MESHY_RATE.unit;
  op.cost.basis = task.credits === undefined ? "estimated" : "reported";
  op.cost.note =
    task.credits === undefined
      ? "Provider task succeeded; quoted credits remain an estimate until reconciliation."
      : "Provider-reported credits; currency charge is not reconciled.";
  await settleReservation(repo, row, job, task.credits ?? row.quoted_credits);
  await repo.saveOperation(op);
  // Completion returns an asset, never mutates a product draft, layout, or protected Original.
  return job;
}
