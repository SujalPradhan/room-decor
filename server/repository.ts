import type {
  ProductDraft,
  OperationRecord,
  GenerationJob,
} from "../src/product-types";
import { StudioError, type Database } from "./types";
export interface AssetRow {
  id: string;
  owner_id: string;
  room_id: string;
  product_id: string | null;
  object_key: string;
  mime: string;
  size: number;
  name: string;
  generation_allowed: number;
  created_at: string;
}
export interface JobRow {
  id: string;
  owner_id: string;
  product_id: string;
  room_id: string;
  draft_revision: number;
  provider_task_id: string | null;
  operation_id: string;
  idempotency_key: string;
  request_hash: string;
  status: string;
  job_json: string;
  quoted_credits: number;
  reservation_state: string;
  created_at: string;
  updated_at: string;
}
export class StudioRepository {
  constructor(
    readonly db: Database,
    readonly owner: string,
  ) {}
  async products(roomId?: string) {
    const sql =
      "SELECT draft_json FROM studio_products WHERE owner_id = ?" +
      (roomId ? " AND room_id = ?" : "") +
      " ORDER BY updated_at DESC LIMIT 100";
    const args = roomId ? [this.owner, roomId] : [this.owner];
    return (
      await this.db
        .prepare(sql)
        .bind(...args)
        .all<{ draft_json: string }>()
    ).results.map((r) => JSON.parse(r.draft_json) as ProductDraft);
  }
  async product(id: string) {
    const r = await this.db
      .prepare(
        "SELECT draft_json FROM studio_products WHERE id = ? AND owner_id = ?",
      )
      .bind(id, this.owner)
      .first<{ draft_json: string }>();
    return r ? (JSON.parse(r.draft_json) as ProductDraft) : null;
  }
  async saveProduct(p: ProductDraft) {
    const result = await this.db
      .prepare(
        "INSERT INTO studio_products (id,owner_id,room_id,draft_json,created_at,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET draft_json = excluded.draft_json,updated_at = excluded.updated_at WHERE studio_products.owner_id = excluded.owner_id",
      )
      .bind(
        p.id,
        this.owner,
        p.roomId,
        JSON.stringify(p),
        p.createdAt,
        p.updatedAt,
      )
      .run();
    if (result.meta?.changes === 0)
      throw new StudioError(
        409,
        "PRODUCT_ID_UNAVAILABLE",
        "This product identifier is unavailable. Create a new product draft.",
      );
  }
  async operations(roomId?: string) {
    const sql =
      "SELECT record_json FROM studio_operations WHERE owner_id = ?" +
      (roomId ? " AND room_id = ?" : "") +
      " ORDER BY submitted_at DESC LIMIT 500";
    return (
      await this.db
        .prepare(sql)
        .bind(...(roomId ? [this.owner, roomId] : [this.owner]))
        .all<{ record_json: string }>()
    ).results.map((r) => JSON.parse(r.record_json) as OperationRecord);
  }
  async operation(id: string) {
    const r = await this.db
      .prepare(
        "SELECT record_json FROM studio_operations WHERE id = ? AND owner_id = ?",
      )
      .bind(id, this.owner)
      .first<{ record_json: string }>();
    return r ? (JSON.parse(r.record_json) as OperationRecord) : null;
  }
  async saveOperation(o: OperationRecord) {
    await this.db
      .prepare(
        "INSERT INTO studio_operations (id,owner_id,room_id,product_id,record_json,submitted_at) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET record_json = excluded.record_json WHERE studio_operations.owner_id = excluded.owner_id",
      )
      .bind(
        o.id,
        this.owner,
        o.roomId,
        o.productId ?? null,
        JSON.stringify(o),
        o.submittedAt,
      )
      .run();
  }
  async asset(id: string) {
    return this.db
      .prepare("SELECT * FROM studio_assets WHERE id = ? AND owner_id = ?")
      .bind(id, this.owner)
      .first<AssetRow>();
  }
  async saveAsset(a: AssetRow) {
    await this.db
      .prepare(
        "INSERT INTO studio_assets (id,owner_id,room_id,product_id,object_key,mime,size,name,generation_allowed,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      )
      .bind(
        a.id,
        this.owner,
        a.room_id,
        a.product_id,
        a.object_key,
        a.mime,
        a.size,
        a.name,
        a.generation_allowed,
        a.created_at,
      )
      .run();
  }
  async account() {
    return this.db
      .prepare(
        "SELECT allowance_credits,reserved_credits,consumed_credits FROM studio_accounts WHERE owner_id = ?",
      )
      .bind(this.owner)
      .first<{
        allowance_credits: number;
        reserved_credits: number;
        consumed_credits: number;
      }>();
  }
  async job(id: string) {
    return this.db
      .prepare("SELECT * FROM studio_jobs WHERE id = ? AND owner_id = ?")
      .bind(id, this.owner)
      .first<JobRow>();
  }
  async idempotentJob(key: string) {
    return this.db
      .prepare(
        "SELECT * FROM studio_jobs WHERE owner_id = ? AND idempotency_key = ?",
      )
      .bind(this.owner, key)
      .first<JobRow>();
  }
  async updateJob(
    row: JobRow,
    job: GenerationJob,
    patch: Partial<Pick<JobRow, "provider_task_id" | "reservation_state">> = {},
  ) {
    await this.db
      .prepare(
        "UPDATE studio_jobs SET status = ?,job_json = ?,provider_task_id = ?,reservation_state = ?,updated_at = ? WHERE id = ? AND owner_id = ?",
      )
      .bind(
        job.status,
        JSON.stringify(job),
        patch.provider_task_id ?? row.provider_task_id,
        patch.reservation_state ?? row.reservation_state,
        new Date().toISOString(),
        job.id,
        this.owner,
      )
      .run();
  }
}
