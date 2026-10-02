CREATE TABLE `meeting_members` (
	`id` text PRIMARY KEY NOT NULL,
	`meeting_id` text NOT NULL,
	`position` integer NOT NULL,
	`role` text NOT NULL,
	`name` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`effort` text,
	`permission_mode` text,
	`profile_id` text,
	`agent_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`meeting_id`) REFERENCES `meetings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `meeting_members_position_unique` ON `meeting_members` (`meeting_id`,`position`);--> statement-breakpoint
CREATE INDEX `meeting_members_agent_idx` ON `meeting_members` (`agent_id`);--> statement-breakpoint
CREATE TABLE `meeting_turns` (
	`id` text PRIMARY KEY NOT NULL,
	`meeting_id` text NOT NULL,
	`step` integer NOT NULL,
	`round` integer NOT NULL,
	`position` integer NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`text` text DEFAULT '' NOT NULL,
	`tokens` integer DEFAULT 0 NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`meeting_id`) REFERENCES `meetings`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "meeting_turns_status_check" CHECK("status" IN ('running', 'done', 'failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `meeting_turns_step_position_unique` ON `meeting_turns` (`meeting_id`,`step`,`position`);--> statement-breakpoint
CREATE TABLE `meetings` (
	`id` text PRIMARY KEY NOT NULL,
	`operation_id` text NOT NULL,
	`repo_id` text NOT NULL,
	`started_by` text NOT NULL,
	`pattern` text NOT NULL,
	`topic` text NOT NULL,
	`status` text DEFAULT 'starting' NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`rounds` integer NOT NULL,
	`token_budget` integer NOT NULL,
	`tokens_used` integer DEFAULT 0 NOT NULL,
	`turn_timeout_ms` integer NOT NULL,
	`output` text NOT NULL,
	`pr_number` integer,
	`workdir` text,
	`branch` text,
	`output_url` text,
	`finished_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`operation_id`) REFERENCES `operations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`repo_id`) REFERENCES `operation_repos`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`started_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "meetings_pattern_check" CHECK("pattern" IN ('debate', 'lead_team', 'map_reduce', 'red_blue', 'review_panel')),
	CONSTRAINT "meetings_status_check" CHECK("status" IN ('starting', 'running', 'paused', 'done', 'stopped', 'failed')),
	CONSTRAINT "meetings_output_check" CHECK("output" IN ('pull_request', 'pr_review', 'notes'))
);
--> statement-breakpoint
CREATE INDEX `meetings_operation_idx` ON `meetings` (`operation_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `meetings_status_idx` ON `meetings` (`status`);