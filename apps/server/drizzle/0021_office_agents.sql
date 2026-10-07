CREATE TABLE `office_agent_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`access` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `office_agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`operation_id`) REFERENCES `operations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "office_agent_grants_access_check" CHECK("access" IN ('manage', 'spawn', 'view'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `office_agent_grants_agent_operation_unique` ON `office_agent_grants` (`agent_id`,`operation_id`);--> statement-breakpoint
CREATE TABLE `office_agent_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`user_id` text NOT NULL,
	`author` text NOT NULL,
	`text` text NOT NULL,
	`ts` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `office_agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `office_agent_messages_conversation_idx` ON `office_agent_messages` (`agent_id`,`user_id`,`ts`);--> statement-breakpoint
CREATE TABLE `office_agent_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`for_user_id` text NOT NULL,
	`question` text NOT NULL,
	`options_json` text DEFAULT '[]' NOT NULL,
	`operation_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`answer` text,
	`answered_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `office_agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`for_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`operation_id`) REFERENCES `operations`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "office_agent_requests_status_check" CHECK("status" IN ('pending', 'answered', 'cancelled'))
);
--> statement-breakpoint
CREATE INDEX `office_agent_requests_user_status_idx` ON `office_agent_requests` (`for_user_id`,`status`);--> statement-breakpoint
CREATE INDEX `office_agent_requests_agent_idx` ON `office_agent_requests` (`agent_id`);--> statement-breakpoint
CREATE TABLE `office_agent_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`personal_agent_cap` integer NOT NULL,
	`manager_daily_spawn_cap` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `office_agent_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`kind` text NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`last_used_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `office_agents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `office_agent_tokens_hash_unique` ON `office_agent_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `office_agent_tokens_agent_idx` ON `office_agent_tokens` (`agent_id`);--> statement-breakpoint
CREATE TABLE `office_agents` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`owner_user_id` text,
	`engine` text NOT NULL,
	`role` text NOT NULL,
	`preset` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`effort` text,
	`profile_id` text,
	`instructions` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'stopped' NOT NULL,
	`status_reason` text,
	`engine_state` text DEFAULT '{}' NOT NULL,
	`last_activity_at` integer,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "office_agents_preset_check" CHECK("preset" IN ('observer', 'coordinator', 'manager')),
	CONSTRAINT "office_agents_status_check" CHECK("status" IN ('stopped', 'starting', 'ready', 'busy', 'error'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `office_agents_name_key_unique` ON `office_agents` (`name_key`);--> statement-breakpoint
CREATE INDEX `office_agents_owner_idx` ON `office_agents` (`owner_user_id`);