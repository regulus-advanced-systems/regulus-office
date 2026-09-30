CREATE TABLE `workflow_events` (
	`id` text PRIMARY KEY NOT NULL,
	`delivery_id` text NOT NULL,
	`name` text NOT NULL,
	`action` text,
	`repo` text,
	`floor_ids_json` text DEFAULT '[]' NOT NULL,
	`summary` text NOT NULL,
	`sender` text,
	`event_json` text NOT NULL,
	`received_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_events_delivery_unique` ON `workflow_events` (`delivery_id`);--> statement-breakpoint
CREATE INDEX `workflow_events_received_idx` ON `workflow_events` (`received_at`);--> statement-breakpoint
CREATE TABLE `workflow_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`workflow_id` text NOT NULL,
	`floor_id` text NOT NULL,
	`delivery_id` text NOT NULL,
	`trigger` text NOT NULL,
	`target_key` text,
	`target_json` text,
	`context_json` text NOT NULL,
	`status` text NOT NULL,
	`reason` text,
	`provider` text NOT NULL,
	`model` text,
	`day` text NOT NULL,
	`queued_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cache_read_tokens` integer DEFAULT 0 NOT NULL,
	`cache_write_tokens` integer DEFAULT 0 NOT NULL,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`links_json` text DEFAULT '[]' NOT NULL,
	`log_json` text DEFAULT '[]' NOT NULL,
	`summary` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workflow_id`) REFERENCES `workflows`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`floor_id`) REFERENCES `floors`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "workflow_runs_status_check" CHECK("status" IN ('queued', 'running', 'succeeded', 'failed', 'refused', 'skipped', 'cancelled')),
	CONSTRAINT "workflow_runs_provider_check" CHECK("provider" IN ('claude-code', 'codex'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_runs_delivery_unique` ON `workflow_runs` (`workflow_id`,`delivery_id`);--> statement-breakpoint
CREATE INDEX `workflow_runs_floor_queued_idx` ON `workflow_runs` (`floor_id`,`queued_at`);--> statement-breakpoint
CREATE INDEX `workflow_runs_workflow_day_idx` ON `workflow_runs` (`workflow_id`,`day`);--> statement-breakpoint
CREATE INDEX `workflow_runs_status_idx` ON `workflow_runs` (`status`);--> statement-breakpoint
CREATE INDEX `workflow_runs_target_idx` ON `workflow_runs` (`workflow_id`,`target_key`);--> statement-breakpoint
CREATE TABLE `workflows` (
	`id` text PRIMARY KEY NOT NULL,
	`floor_id` text NOT NULL,
	`name` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`spec_json` text NOT NULL,
	`last_scheduled_at` integer,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`floor_id`) REFERENCES `floors`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `workflows_floor_idx` ON `workflows` (`floor_id`);