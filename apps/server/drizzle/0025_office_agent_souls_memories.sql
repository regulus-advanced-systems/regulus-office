CREATE TABLE `office_agent_memories` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`title_key` text DEFAULT '' NOT NULL,
	`text` text NOT NULL,
	`source` text DEFAULT '' NOT NULL,
	`written_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `office_agents`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "office_agent_memories_kind_check" CHECK("kind" IN ('memory', 'note')),
	CONSTRAINT "office_agent_memories_written_by_check" CHECK("written_by" IN ('agent', 'person'))
);
--> statement-breakpoint
CREATE INDEX `office_agent_memories_agent_kind_idx` ON `office_agent_memories` (`agent_id`,`kind`,`updated_at`);--> statement-breakpoint
CREATE TABLE `office_agent_soul_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`version` integer NOT NULL,
	`content` text NOT NULL,
	`kind` text NOT NULL,
	`revert_of` integer,
	`edited_by` text,
	`lines_added` integer DEFAULT 0 NOT NULL,
	`lines_removed` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `office_agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`edited_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "office_agent_soul_versions_kind_check" CHECK("kind" IN ('created', 'edit', 'revert', 'imported'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `office_agent_soul_versions_agent_version_unique` ON `office_agent_soul_versions` (`agent_id`,`version`);--> statement-breakpoint
-- The instructions agents already have become version 1 of their soul (#136).
INSERT INTO `office_agent_soul_versions` (`id`, `agent_id`, `version`, `content`, `kind`, `edited_by`, `lines_added`, `lines_removed`, `created_at`, `updated_at`)
SELECT lower(hex(randomblob(16))), `id`, 1, `instructions`, 'imported', NULL,
	length(`instructions`) - length(replace(`instructions`, char(10), '')) + 1, 0, `updated_at`, `updated_at`
FROM `office_agents` WHERE `instructions` <> '';
