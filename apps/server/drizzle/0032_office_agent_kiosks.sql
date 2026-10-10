CREATE TABLE `office_agent_kiosks` (
	`agent_id` text PRIMARY KEY NOT NULL,
	`operation_id` text NOT NULL,
	`board` text NOT NULL,
	`via_pm` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `office_agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`operation_id`) REFERENCES `operations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "office_agent_kiosks_board_check" CHECK("board" IN ('issues', 'pulls', 'queue'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `office_agent_kiosks_operation_board_unique` ON `office_agent_kiosks` (`operation_id`,`board`);--> statement-breakpoint
CREATE TABLE `office_agent_task_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`for_user_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`input_json` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`task_id` text,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `office_agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`for_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`operation_id`) REFERENCES `operations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "office_agent_task_proposals_status_check" CHECK("status" IN ('pending', 'confirmed', 'dismissed'))
);
--> statement-breakpoint
CREATE INDEX `office_agent_task_proposals_agent_user_idx` ON `office_agent_task_proposals` (`agent_id`,`for_user_id`,`status`);--> statement-breakpoint
-- Until now any agent could be given the `kiosk` job as a label (personal or shared, on any
-- engine, with any grants). From here on that job means a placed board helper. No existing
-- row has a placement, so each becomes `custom` and keeps everything else it had.
UPDATE `office_agents` SET `role` = 'custom' WHERE `role` = 'kiosk';