CREATE TABLE `chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`display_name` text NOT NULL,
	`floor_id` text DEFAULT '' NOT NULL,
	`text` text NOT NULL,
	`ts` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `chat_messages_ts_idx` ON `chat_messages` (`ts`);