CREATE TABLE `watchdog_apps` (
	`id` text PRIMARY KEY NOT NULL,
	`host_id` text NOT NULL,
	`name` text NOT NULL,
	`operation_id` text,
	`watched` integer DEFAULT true NOT NULL,
	`last_restarts` integer,
	`last_status` text,
	`last_log_mark` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`host_id`) REFERENCES `watchdog_hosts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`operation_id`) REFERENCES `operations`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `watchdog_apps_host_name_unique` ON `watchdog_apps` (`host_id`,`name`);--> statement-breakpoint
CREATE TABLE `watchdog_finding_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`finding_id` text NOT NULL,
	`kind` text NOT NULL,
	`key` text NOT NULL,
	`label` text NOT NULL,
	`url` text,
	`project` text,
	`ref` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`finding_id`) REFERENCES `watchdog_findings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `watchdog_finding_sources_key_unique` ON `watchdog_finding_sources` (`key`);--> statement-breakpoint
CREATE INDEX `watchdog_finding_sources_finding_idx` ON `watchdog_finding_sources` (`finding_id`);--> statement-breakpoint
CREATE TABLE `watchdog_findings` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`evidence` text NOT NULL,
	`disposition` text NOT NULL,
	`reason` text NOT NULL,
	`scope` text NOT NULL,
	`operation_id` text,
	`round_id` text,
	`judged_at` integer NOT NULL,
	`announced_at` integer,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`seen_count` integer DEFAULT 0 NOT NULL,
	`regressions` integer DEFAULT 0 NOT NULL,
	`noise_by` text,
	`noise_at` integer,
	`fix_state` text DEFAULT 'none' NOT NULL,
	`fix_summary` text DEFAULT '' NOT NULL,
	`fix_task_id` text,
	`fix_decided_by` text,
	`fix_auto` integer DEFAULT false NOT NULL,
	`fix_queued_at` integer,
	`fix_pr_number` integer,
	`fix_pr_url` text,
	`fix_error` text,
	`sentry_comment` text DEFAULT 'none' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`operation_id`) REFERENCES `operations`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`round_id`) REFERENCES `watchdog_rounds`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`noise_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`fix_decided_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "watchdog_findings_disposition_check" CHECK("disposition" IN ('dismiss', 'notify', 'propose_fix')),
	CONSTRAINT "watchdog_findings_fix_state_check" CHECK("fix_state" IN ('none', 'unavailable', 'awaiting_approval', 'declined', 'queued', 'pr_open', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `watchdog_findings_last_seen_idx` ON `watchdog_findings` (`last_seen_at`);--> statement-breakpoint
CREATE INDEX `watchdog_findings_fix_state_idx` ON `watchdog_findings` (`fix_state`);--> statement-breakpoint
CREATE TABLE `watchdog_hosts` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`host` text NOT NULL,
	`port` integer DEFAULT 22 NOT NULL,
	`username` text NOT NULL,
	`host_key` text DEFAULT '' NOT NULL,
	`host_key_source` text DEFAULT 'none' NOT NULL,
	`offered_host_key` text DEFAULT '' NOT NULL,
	`offered_at` integer,
	`encrypted_key` text NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `watchdog_round_parts` (
	`id` text PRIMARY KEY NOT NULL,
	`round_id` text NOT NULL,
	`position` integer NOT NULL,
	`scope` text NOT NULL,
	`operation_id` text,
	`state` text NOT NULL,
	`started_at` integer,
	`checked_at` integer,
	`finished_at` integer,
	`summary` text DEFAULT '' NOT NULL,
	`error` text,
	`marks_json` text DEFAULT '{}' NOT NULL,
	`signals_json` text DEFAULT '{}' NOT NULL,
	`truncated_json` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`round_id`) REFERENCES `watchdog_rounds`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`operation_id`) REFERENCES `operations`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "watchdog_round_parts_state_check" CHECK("state" IN ('pending', 'running', 'done', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `watchdog_round_parts_round_idx` ON `watchdog_round_parts` (`round_id`);--> statement-breakpoint
CREATE TABLE `watchdog_rounds` (
	`id` text PRIMARY KEY NOT NULL,
	`trigger` text NOT NULL,
	`requested_by` text,
	`state` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`requested_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "watchdog_rounds_state_check" CHECK("state" IN ('pending', 'running', 'done', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `watchdog_rounds_started_idx` ON `watchdog_rounds` (`started_at`);--> statement-breakpoint
CREATE TABLE `watchdog_sentry_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`operation_id` text,
	`watched` integer DEFAULT true NOT NULL,
	`unread_since` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`operation_id`) REFERENCES `operations`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `watchdog_sentry_projects_slug_unique` ON `watchdog_sentry_projects` (`slug`);--> statement-breakpoint
CREATE TABLE `watchdog_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`agent_id` text,
	`interval_minutes` integer DEFAULT 60 NOT NULL,
	`fix_mode` text DEFAULT 'ask' NOT NULL,
	`fix_provider` text DEFAULT 'claude-code' NOT NULL,
	`fix_model` text DEFAULT 'opus' NOT NULL,
	`auto_fix_user_id` text,
	`auto_fix_per_round` integer DEFAULT 1 NOT NULL,
	`auto_fix_per_day` integer DEFAULT 3 NOT NULL,
	`sentry_host` text DEFAULT 'sentry.io' NOT NULL,
	`sentry_organization` text DEFAULT '' NOT NULL,
	`encrypted_sentry_token` text,
	`last_round_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `office_agents`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`auto_fix_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "watchdog_settings_fix_mode_check" CHECK("fix_mode" IN ('ask', 'auto'))
);
--> statement-breakpoint
CREATE TABLE `watchdog_told` (
	`user_id` text PRIMARY KEY NOT NULL,
	`told_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `office_agent_tokens` ADD `office_turn` text;