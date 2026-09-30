CREATE TABLE `floor_queue_settings` (
	`floor_id` text PRIMARY KEY NOT NULL,
	`max_running` integer NOT NULL,
	`max_per_owner` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`floor_id`) REFERENCES `floors`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `tasks` ADD `title` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `permission_mode` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `profile_id` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `pr_number` integer;--> statement-breakpoint
ALTER TABLE `tasks` ADD `reason` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `started_at` integer;--> statement-breakpoint
ALTER TABLE `tasks` ADD `finished_at` integer;