CREATE TABLE `office_agent_room_reads` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`user_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `office_agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `office_agent_room_reads_unique` ON `office_agent_room_reads` (`agent_id`,`user_id`,`operation_id`);--> statement-breakpoint
ALTER TABLE `office_agent_memories` ADD `sealed` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `office_agent_memories` ADD `room_scope` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `office_agent_memories` ADD `for_user_id` text REFERENCES `users`(`id`) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `office_agent_requests` ADD `room_scope` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `office_agent_settings` ADD `mind_scrub_pending` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `office_agent_soul_versions` ADD `sealed` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `office_agent_tokens` ADD `for_user_id` text REFERENCES `users`(`id`) ON DELETE cascade;--> statement-breakpoint
ALTER TABLE `office_agent_tokens` ADD `minted_by` text REFERENCES `users`(`id`) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `office_agents` ADD `stopped_by_person` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `office_agents` ADD `instructions_sealed` integer DEFAULT false NOT NULL;--> statement-breakpoint
-- A shared agent's memories and notes from before this migration carry no room
-- (#301), and nothing recorded tells reliably which rooms they are about (its
-- grants may have been wider then). Their rooms are unknown: they are kept,
-- and shown to nobody. A shared agent starts with none of its earlier
-- memories. Personal agents' entries are read by their owner only and are not
-- touched.
UPDATE `office_agent_memories` SET `room_scope` = 'unknown'
WHERE `agent_id` IN (SELECT `id` FROM `office_agents` WHERE `owner_user_id` IS NULL);
--> statement-breakpoint
-- A shared agent's engine sessions from before this migration may hold what it
-- read under its grants alone, for whoever asked. They are dropped once: its
-- next answer to each person starts a new session. The conversations people
-- see are kept by the office and are not touched.
UPDATE `office_agents` SET `engine_state` = '{}' WHERE `owner_user_id` IS NULL;
-- Souls, memories and notes are encrypted by the office when it starts with
-- OFFICE_MASTER_KEY set (pm/mind/seal-existing.ts): SQL cannot hold the key.
