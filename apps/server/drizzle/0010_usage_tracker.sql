ALTER TABLE `usage_samples` ADD `model` text;--> statement-breakpoint
ALTER TABLE `usage_samples` ADD `session_id` text;--> statement-breakpoint
ALTER TABLE `usage_samples` ADD `dedupe_key` text;--> statement-breakpoint
CREATE INDEX `usage_samples_ts_idx` ON `usage_samples` (`ts`);--> statement-breakpoint
CREATE INDEX `usage_samples_session_idx` ON `usage_samples` (`session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `usage_samples_dedupe_key_unique` ON `usage_samples` (`dedupe_key`);