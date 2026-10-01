-- #226: floors are called operations and robots henchmen, all the way down.
-- Tables, columns and indexes are renamed in place (ALTER TABLE ... RENAME keeps
-- every row, and SQLite rewrites the foreign keys that point at a renamed table).
-- operation_repos and operation_members are rebuilt so their CHECK constraints
-- carry the new names; runMigrations turns foreign keys off while migrating, so
-- dropping the old copy cascades nowhere.
ALTER TABLE `floors` RENAME TO `operations`;--> statement-breakpoint
DROP INDEX `floors_slug_unique`;--> statement-breakpoint
DROP INDEX `floors_index_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `operations_slug_unique` ON `operations` (`slug`);--> statement-breakpoint
CREATE INDEX `operations_index_idx` ON `operations` (`index`);--> statement-breakpoint
ALTER TABLE `floor_repos` RENAME TO `operation_repos`;--> statement-breakpoint
CREATE TABLE `__new_operation_repos` (
	`id` text PRIMARY KEY NOT NULL,
	`operation_id` text NOT NULL,
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
	FOREIGN KEY (`operation_id`) REFERENCES `operations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "operation_repos_clone_status_check" CHECK("clone_status" IN ('cloning', 'ready', 'error'))
);
--> statement-breakpoint
INSERT INTO `__new_operation_repos`("id", "operation_id", "owner", "name", "url", "default_branch", "workdir", "is_primary", "clone_status", "clone_error", "encrypted_credential", "created_at", "updated_at") SELECT "id", "floor_id", "owner", "name", "url", "default_branch", "workdir", "is_primary", "clone_status", "clone_error", "encrypted_credential", "created_at", "updated_at" FROM `operation_repos`;--> statement-breakpoint
DROP TABLE `operation_repos`;--> statement-breakpoint
ALTER TABLE `__new_operation_repos` RENAME TO `operation_repos`;--> statement-breakpoint
CREATE UNIQUE INDEX `operation_repos_operation_owner_name_unique` ON `operation_repos` (`operation_id`,`owner`,`name`);--> statement-breakpoint
CREATE TABLE `operation_members` (
	`id` text PRIMARY KEY NOT NULL,
	`operation_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access` text DEFAULT 'view' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`operation_id`) REFERENCES `operations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "operation_members_access_check" CHECK("access" IN ('manage', 'spawn', 'view'))
);
--> statement-breakpoint
INSERT INTO `operation_members`("id", "operation_id", "user_id", "access", "created_at", "updated_at") SELECT "id", "floor_id", "user_id", "access", "created_at", "updated_at" FROM `floor_members`;--> statement-breakpoint
DROP TABLE `floor_members`;--> statement-breakpoint
CREATE UNIQUE INDEX `operation_members_operation_user_unique` ON `operation_members` (`operation_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `operation_members_user_id_idx` ON `operation_members` (`user_id`);--> statement-breakpoint
ALTER TABLE `floor_queue_settings` RENAME TO `operation_queue_settings`;--> statement-breakpoint
ALTER TABLE `operation_queue_settings` RENAME COLUMN `floor_id` TO `operation_id`;--> statement-breakpoint
ALTER TABLE `agents` RENAME COLUMN `floor_id` TO `operation_id`;--> statement-breakpoint
DROP INDEX `agents_floor_id_idx`;--> statement-breakpoint
CREATE INDEX `agents_operation_id_idx` ON `agents` (`operation_id`);--> statement-breakpoint
ALTER TABLE `tasks` RENAME COLUMN `floor_id` TO `operation_id`;--> statement-breakpoint
DROP INDEX `tasks_floor_position_unique`;--> statement-breakpoint
DROP INDEX `tasks_floor_state_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_operation_position_unique` ON `tasks` (`operation_id`,`position`);--> statement-breakpoint
CREATE INDEX `tasks_operation_state_idx` ON `tasks` (`operation_id`,`state`);--> statement-breakpoint
ALTER TABLE `chat_messages` RENAME COLUMN `floor_id` TO `operation_id`;--> statement-breakpoint
ALTER TABLE `desks` RENAME COLUMN `floor_id` TO `operation_id`;--> statement-breakpoint
DROP INDEX `desks_floor_seat_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `desks_operation_seat_unique` ON `desks` (`operation_id`,`seat_id`);--> statement-breakpoint
ALTER TABLE `workflows` RENAME COLUMN `floor_id` TO `operation_id`;--> statement-breakpoint
DROP INDEX `workflows_floor_idx`;--> statement-breakpoint
CREATE INDEX `workflows_operation_idx` ON `workflows` (`operation_id`);--> statement-breakpoint
ALTER TABLE `workflow_runs` RENAME COLUMN `floor_id` TO `operation_id`;--> statement-breakpoint
DROP INDEX `workflow_runs_floor_queued_idx`;--> statement-breakpoint
CREATE INDEX `workflow_runs_operation_queued_idx` ON `workflow_runs` (`operation_id`,`queued_at`);--> statement-breakpoint
ALTER TABLE `workflow_events` RENAME COLUMN `floor_ids_json` TO `operation_ids_json`;--> statement-breakpoint
ALTER TABLE `notification_channels` RENAME COLUMN `floor_ids_json` TO `operation_ids_json`;--> statement-breakpoint
ALTER TABLE `decor` RENAME COLUMN `floor_id` TO `operation_id`;--> statement-breakpoint
DROP INDEX `decor_floor_id_idx`;--> statement-breakpoint
CREATE INDEX `decor_operation_id_idx` ON `decor` (`operation_id`);--> statement-breakpoint
ALTER TABLE `whiteboards` RENAME COLUMN `floor_id` TO `operation_id`;--> statement-breakpoint
DROP INDEX `whiteboards_floor_id_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `whiteboards_operation_id_unique` ON `whiteboards` (`operation_id`);--> statement-breakpoint
-- Stored values the server writes: audit actions and target kinds (floor.create,
-- floor_repo.clone, ...), audit meta keys, and a workflow's `robot` spec section.
UPDATE `audit_log` SET `action` = 'operation' || substr(`action`, 6) WHERE substr(`action`, 1, 6) IN ('floor.', 'floor_');--> statement-breakpoint
UPDATE `audit_log` SET `target_kind` = 'operation' || substr(`target_kind`, 6) WHERE `target_kind` IN ('floor', 'floor_repo');--> statement-breakpoint
UPDATE `audit_log` SET `meta_json` = json_set(json_remove(`meta_json`, '$.floorId'), '$.operationId', json(`meta_json` -> '$.floorId')) WHERE json_valid(`meta_json`) AND json_type(`meta_json`, '$.floorId') IS NOT NULL;--> statement-breakpoint
UPDATE `audit_log` SET `meta_json` = json_set(json_remove(`meta_json`, '$.floorEvacuation'), '$.operationEvacuation', json(`meta_json` -> '$.floorEvacuation')) WHERE json_valid(`meta_json`) AND json_type(`meta_json`, '$.floorEvacuation') IS NOT NULL;--> statement-breakpoint
UPDATE `workflows` SET `spec_json` = json_set(json_remove(`spec_json`, '$.robot'), '$.henchman', json(`spec_json` -> '$.robot')) WHERE json_valid(`spec_json`) AND json_type(`spec_json`, '$.robot') IS NOT NULL;
