CREATE TABLE `office_agent_reads` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`user_id` text NOT NULL,
	`seen_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `office_agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `office_agent_reads_agent_user_unique` ON `office_agent_reads` (`agent_id`,`user_id`);--> statement-breakpoint
ALTER TABLE `office_agents` ADD `dismissed` integer DEFAULT false NOT NULL;--> statement-breakpoint
-- Conversations from before this migration count as read, so old replies do not all show as "answer ready".
INSERT INTO `office_agent_reads` (`id`, `agent_id`, `user_id`, `seen_at`, `created_at`, `updated_at`)
SELECT lower(hex(randomblob(16))), `agent_id`, `user_id`, max(`ts`), max(`ts`), max(`ts`)
FROM `office_agent_messages` GROUP BY `agent_id`, `user_id`;
