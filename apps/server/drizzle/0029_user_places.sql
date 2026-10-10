CREATE TABLE `user_places` (
	`user_id` text PRIMARY KEY NOT NULL,
	`level_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`x` real NOT NULL,
	`z` real NOT NULL,
	`heading` real NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
