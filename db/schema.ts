import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const studioProducts = sqliteTable(
  "studio_products",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    roomId: text("room_id").notNull(),
    draftJson: text("draft_json").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("studio_products_owner_room").on(t.ownerId, t.roomId)],
);
export const studioOperations = sqliteTable(
  "studio_operations",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    roomId: text("room_id").notNull(),
    productId: text("product_id"),
    recordJson: text("record_json").notNull(),
    submittedAt: text("submitted_at").notNull(),
  },
  (t) => [index("studio_operations_owner_room").on(t.ownerId, t.roomId)],
);
export const studioAssets = sqliteTable(
  "studio_assets",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    roomId: text("room_id").notNull(),
    productId: text("product_id"),
    objectKey: text("object_key").notNull().unique(),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
    name: text("name").notNull(),
    generationAllowed: integer("generation_allowed").notNull().default(0),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("studio_assets_owner").on(t.ownerId)],
);
export const studioJobs = sqliteTable(
  "studio_jobs",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    productId: text("product_id").notNull(),
    roomId: text("room_id").notNull(),
    draftRevision: integer("draft_revision").notNull(),
    providerTaskId: text("provider_task_id"),
    operationId: text("operation_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    status: text("status").notNull(),
    jobJson: text("job_json").notNull(),
    quotedCredits: integer("quoted_credits").notNull(),
    reservationState: text("reservation_state").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("studio_jobs_owner_idempotency").on(
      t.ownerId,
      t.idempotencyKey,
    ),
    index("studio_jobs_owner").on(t.ownerId),
  ],
);
export const studioAccounts = sqliteTable("studio_accounts", {
  ownerId: text("owner_id").primaryKey(),
  allowanceCredits: integer("allowance_credits").notNull().default(0),
  reservedCredits: integer("reserved_credits").notNull().default(0),
  consumedCredits: integer("consumed_credits").notNull().default(0),
});


/** Separate from paid-provider jobs: one manually operated laptop pilot. */
export const studioPipelineJobs = sqliteTable(
  "studio_pipeline_jobs",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    productId: text("product_id").notNull(),
    roomId: text("room_id").notNull(),
    requestedRevision: integer("requested_revision").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    productJson: text("product_json").notNull(),
    status: text("status").notNull(),
    stage: text("stage").notNull(),
    leaseToken: text("lease_token"),
    leaseExpiresAt: text("lease_expires_at"),
    resultJson: text("result_json"),
    operationsJson: text("operations_json"),
    error: text("error"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("studio_pipeline_owner_idempotency").on(t.ownerId, t.idempotencyKey),
    index("studio_pipeline_owner_created").on(t.ownerId, t.createdAt),
    index("studio_pipeline_status_created").on(t.status, t.createdAt),
  ],
);
export const studioPipelineWorkers = sqliteTable("studio_pipeline_workers", {
  id: text("id").primaryKey(),
  online: integer("online").notNull(),
  updatedAt: text("updated_at").notNull(),
});
