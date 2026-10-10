CREATE TABLE `linked_task_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`linked_task_id` text NOT NULL,
	`task_id` text NOT NULL,
	`body` text NOT NULL,
	`released_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`linked_task_id`) REFERENCES `linked_tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `linked_task_notes_linked_task_idx` ON `linked_task_notes` (`linked_task_id`);--> statement-breakpoint
CREATE TABLE `linked_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`release_notes` integer DEFAULT false NOT NULL,
	`name_private_repos` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `tasks` ADD `linked_task_id` text REFERENCES `linked_tasks`(`id`) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `tasks` ADD `pr_note` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `notes_seen` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX `tasks_linked_task_idx` ON `tasks` (`linked_task_id`);