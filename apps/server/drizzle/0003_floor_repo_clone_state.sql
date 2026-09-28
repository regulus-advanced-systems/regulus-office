PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_floor_repos` (
	`id` text PRIMARY KEY NOT NULL,
	`floor_id` text NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`default_branch` text DEFAULT 'main' NOT NULL,
	`workdir` text NOT NULL,
	`is_primary` integer DEFAULT false NOT NULL,
	`clone_status` text DEFAULT 'cloning' NOT NULL,
	`clone_error` text,
	`encrypted_credential` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`floor_id`) REFERENCES `floors`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "floor_repos_clone_status_check" CHECK("clone_status" IN ('cloning', 'ready', 'error'))
);
--> statement-breakpoint
INSERT INTO `__new_floor_repos`("id", "floor_id", "owner", "name", "url", "default_branch", "workdir", "is_primary", "clone_status", "clone_error", "encrypted_credential", "created_at", "updated_at") SELECT "id", "floor_id", "owner", "name", "url", "default_branch", "workdir", "is_primary", 'ready', NULL, NULL, "created_at", "updated_at" FROM `floor_repos`;--> statement-breakpoint
DROP TABLE `floor_repos`;--> statement-breakpoint
ALTER TABLE `__new_floor_repos` RENAME TO `floor_repos`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `floor_repos_floor_owner_name_unique` ON `floor_repos` (`floor_id`,`owner`,`name`);