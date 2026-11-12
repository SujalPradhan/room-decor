CREATE TABLE `studio_pipeline_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`product_id` text NOT NULL,
	`room_id` text NOT NULL,
	`requested_revision` integer NOT NULL,
	`idempotency_key` text NOT NULL,
	`request_hash` text NOT NULL,
	`product_json` text NOT NULL,
	`status` text NOT NULL,
	`stage` text NOT NULL,
	`lease_token` text,
	`lease_expires_at` text,
	`result_json` text,
	`operations_json` text,
	`error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `studio_pipeline_owner_idempotency` ON `studio_pipeline_jobs` (`owner_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `studio_pipeline_owner_created` ON `studio_pipeline_jobs` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `studio_pipeline_status_created` ON `studio_pipeline_jobs` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `studio_pipeline_workers` (
	`id` text PRIMARY KEY NOT NULL,
	`online` integer NOT NULL,
	`updated_at` text NOT NULL
);
