CREATE TABLE `office_agent_connections` (
	`agent_id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`encrypted_secret` text NOT NULL,
	`continues_session` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `office_agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `office_agent_connections_owner_idx` ON `office_agent_connections` (`owner_user_id`);