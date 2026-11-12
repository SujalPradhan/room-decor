CREATE TABLE `studio_accounts` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`allowance_credits` integer DEFAULT 0 NOT NULL,
	`reserved_credits` integer DEFAULT 0 NOT NULL,
	`consumed_credits` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `studio_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`room_id` text NOT NULL,
	`product_id` text,
	`object_key` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`name` text NOT NULL,
	`generation_allowed` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `studio_assets_object_key_unique` ON `studio_assets` (`object_key`);--> statement-breakpoint
CREATE INDEX `studio_assets_owner` ON `studio_assets` (`owner_id`);--> statement-breakpoint
CREATE TABLE `studio_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`product_id` text NOT NULL,
	`room_id` text NOT NULL,
	`draft_revision` integer NOT NULL,
	`provider_task_id` text,
	`operation_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`request_hash` text NOT NULL,
	`status` text NOT NULL,
	`job_json` text NOT NULL,
	`quoted_credits` integer NOT NULL,
	`reservation_state` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `studio_jobs_owner_idempotency` ON `studio_jobs` (`owner_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `studio_jobs_owner` ON `studio_jobs` (`owner_id`);--> statement-breakpoint
CREATE TABLE `studio_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`room_id` text NOT NULL,
	`product_id` text,
	`record_json` text NOT NULL,
	`submitted_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `studio_operations_owner_room` ON `studio_operations` (`owner_id`,`room_id`);--> statement-breakpoint
CREATE TABLE `studio_products` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`room_id` text NOT NULL,
	`draft_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `studio_products_owner_room` ON `studio_products` (`owner_id`,`room_id`);