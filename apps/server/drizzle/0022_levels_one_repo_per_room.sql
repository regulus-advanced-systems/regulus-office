-- #268 (D7 as changed 2026-10-07, D26): levels and one repo per room.
--
-- This file only adds the structure and the two fixed levels. The data step
-- runs right after the SQL migrations, in the same `runMigrations` call
-- (src/db/one-repo-per-room.ts): it splits every operation with several repos
-- into one operation per repo, moves each operation to the level of its repo's
-- owner, and only then creates the unique index
-- `operation_repos_operation_unique` (one repo per operation), which could not
-- be created here while multi-repo operations still exist.
--
-- `level_id` defaults to the holding level so that existing rows are valid at
-- once; runMigrations has foreign keys off while migrating, which SQLite needs
-- to add a referencing column with a non-null default.
CREATE TABLE `levels` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`github_id` integer,
	`login` text,
	`name` text NOT NULL,
	`position` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "levels_kind_check" CHECK("kind" IN ('lobby', 'org', 'account', 'holding'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `levels_login_unique` ON `levels` (`login`);--> statement-breakpoint
INSERT INTO `levels` (`id`, `kind`, `github_id`, `login`, `name`, `position`, `created_at`, `updated_at`) VALUES
	('lobby', 'lobby', NULL, NULL, 'Lobby', 0, CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER)),
	('holding', 'holding', NULL, NULL, 'Unassigned', 65535, CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER));--> statement-breakpoint
ALTER TABLE `operations` ADD `level_id` text DEFAULT 'holding' NOT NULL REFERENCES levels(id);--> statement-breakpoint
ALTER TABLE `operations` ADD `dir_slug` text;--> statement-breakpoint
CREATE INDEX `operations_level_id_idx` ON `operations` (`level_id`);
