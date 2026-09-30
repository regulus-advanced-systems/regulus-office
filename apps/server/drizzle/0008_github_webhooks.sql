CREATE TABLE `github_webhook_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`event` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `github_webhook_deliveries_created_idx` ON `github_webhook_deliveries` (`created_at`);--> statement-breakpoint
ALTER TABLE `github_pulls` ADD `head_sha` text;--> statement-breakpoint
ALTER TABLE `github_pulls` ADD `checks_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `github_pulls` ADD `reviews_json` text DEFAULT '{}' NOT NULL;