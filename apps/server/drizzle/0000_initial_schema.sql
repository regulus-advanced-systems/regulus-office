CREATE TABLE `agent_events` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`ts` integer NOT NULL,
	`kind` text NOT NULL,
	`payload_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agent_events_kind_check" CHECK("kind" IN ('status', 'action', 'message', 'tool_call', 'permission_request', 'usage', 'limit', 'exit'))
);
--> statement-breakpoint
CREATE INDEX `agent_events_agent_ts_idx` ON `agent_events` (`agent_id`,`ts`);--> statement-breakpoint
CREATE INDEX `agent_events_ts_idx` ON `agent_events` (`ts`);--> statement-breakpoint
CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`floor_id` text NOT NULL,
	`repo_id` text NOT NULL,
	`desk_seat_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`effort` text,
	`profile_id` text NOT NULL,
	`status` text DEFAULT 'starting' NOT NULL,
	`provider_session_id` text,
	`tmux_session` text,
	`workdir` text NOT NULL,
	`worktree_branch` text,
	`task_title` text NOT NULL,
	`task_summary` text,
	`issue_number` integer,
	`pr_number` integer,
	`last_activity_at` integer,
	`exited_at` integer,
	`spawn_args_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`floor_id`) REFERENCES `floors`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`repo_id`) REFERENCES `floor_repos`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agents_provider_check" CHECK("provider" IN ('claude-code', 'codex', 'gemini-cli', 'opencode', 'kimi-code', 'custom')),
	CONSTRAINT "agents_status_check" CHECK("status" IN ('starting', 'idle', 'working', 'waiting_permission', 'waiting_input', 'done', 'error', 'exited', 'offline'))
);
--> statement-breakpoint
CREATE INDEX `agents_floor_id_idx` ON `agents` (`floor_id`);--> statement-breakpoint
CREATE INDEX `agents_owner_user_id_idx` ON `agents` (`owner_user_id`);--> statement-breakpoint
CREATE INDEX `agents_status_idx` ON `agents` (`status`);--> statement-breakpoint
CREATE TABLE `credential_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`provider` text NOT NULL,
	`label` text NOT NULL,
	`auth_kind` text NOT NULL,
	`encrypted_secret` text,
	`base_url` text,
	`model_overrides_json` text,
	`verified_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "credential_profiles_provider_check" CHECK("provider" IN ('claude-code', 'codex', 'gemini-cli', 'opencode', 'kimi-code', 'custom')),
	CONSTRAINT "credential_profiles_auth_kind_check" CHECK("auth_kind" IN ('cli_login', 'api_key', 'base_url_key')),
	CONSTRAINT "credential_profiles_cli_login_check" CHECK("auth_kind" <> 'cli_login' OR ("encrypted_secret" IS NULL AND "user_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `credential_profiles_user_provider_idx` ON `credential_profiles` (`user_id`,`provider`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`floor_id` text NOT NULL,
	`repo_id` text,
	`position` integer NOT NULL,
	`kind` text NOT NULL,
	`ref_number` integer,
	`prompt` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`effort` text,
	`auto_worktree` integer DEFAULT true NOT NULL,
	`state` text DEFAULT 'queued' NOT NULL,
	`agent_id` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`floor_id`) REFERENCES `floors`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`repo_id`) REFERENCES `floor_repos`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "tasks_kind_check" CHECK("kind" IN ('issue', 'pr', 'freeform')),
	CONSTRAINT "tasks_state_check" CHECK("state" IN ('queued', 'running', 'done', 'failed', 'cancelled')),
	CONSTRAINT "tasks_provider_check" CHECK("provider" IN ('claude-code', 'codex', 'gemini-cli', 'opencode', 'kimi-code', 'custom'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_floor_position_unique` ON `tasks` (`floor_id`,`position`);--> statement-breakpoint
CREATE INDEX `tasks_floor_state_idx` ON `tasks` (`floor_id`,`state`);--> statement-breakpoint
CREATE TABLE `desks` (
	`id` text PRIMARY KEY NOT NULL,
	`floor_id` text NOT NULL,
	`seat_id` text NOT NULL,
	`agent_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`floor_id`) REFERENCES `floors`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `desks_floor_seat_unique` ON `desks` (`floor_id`,`seat_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `desks_agent_id_unique` ON `desks` (`agent_id`);--> statement-breakpoint
CREATE TABLE `floor_members` (
	`id` text PRIMARY KEY NOT NULL,
	`floor_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access` text DEFAULT 'view' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`floor_id`) REFERENCES `floors`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "floor_members_access_check" CHECK("access" IN ('manage', 'spawn', 'view'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `floor_members_floor_user_unique` ON `floor_members` (`floor_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `floor_members_user_id_idx` ON `floor_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `floor_repos` (
	`id` text PRIMARY KEY NOT NULL,
	`floor_id` text NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`default_branch` text DEFAULT 'main' NOT NULL,
	`workdir` text NOT NULL,
	`is_primary` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`floor_id`) REFERENCES `floors`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `floor_repos_floor_owner_name_unique` ON `floor_repos` (`floor_id`,`owner`,`name`);--> statement-breakpoint
CREATE TABLE `floors` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`index` integer NOT NULL,
	`palette_id` text NOT NULL,
	`layout_template_id` text NOT NULL,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `floors_slug_unique` ON `floors` (`slug`);--> statement-breakpoint
CREATE INDEX `floors_index_idx` ON `floors` (`index`);--> statement-breakpoint
CREATE TABLE `github_issues` (
	`id` text PRIMARY KEY NOT NULL,
	`repo_id` text NOT NULL,
	`number` integer NOT NULL,
	`title` text NOT NULL,
	`state` text NOT NULL,
	`labels_json` text DEFAULT '[]' NOT NULL,
	`assignees_json` text DEFAULT '[]' NOT NULL,
	`gh_updated_at` integer NOT NULL,
	`body_md` text,
	`raw` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`repo_id`) REFERENCES `floor_repos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `github_issues_repo_number_unique` ON `github_issues` (`repo_id`,`number`);--> statement-breakpoint
CREATE INDEX `github_issues_repo_state_idx` ON `github_issues` (`repo_id`,`state`);--> statement-breakpoint
CREATE TABLE `github_pulls` (
	`id` text PRIMARY KEY NOT NULL,
	`repo_id` text NOT NULL,
	`number` integer NOT NULL,
	`title` text NOT NULL,
	`state` text NOT NULL,
	`labels_json` text DEFAULT '[]' NOT NULL,
	`assignees_json` text DEFAULT '[]' NOT NULL,
	`gh_updated_at` integer NOT NULL,
	`body_md` text,
	`raw` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`checks_state` text DEFAULT 'none' NOT NULL,
	`review_state` text DEFAULT 'none' NOT NULL,
	`head_ref` text,
	`base_ref` text,
	`is_draft` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`repo_id`) REFERENCES `floor_repos`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "github_pulls_checks_state_check" CHECK("checks_state" IN ('none', 'pending', 'success', 'failure')),
	CONSTRAINT "github_pulls_review_state_check" CHECK("review_state" IN ('none', 'review_required', 'approved', 'changes_requested'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `github_pulls_repo_number_unique` ON `github_pulls` (`repo_id`,`number`);--> statement-breakpoint
CREATE INDEX `github_pulls_repo_state_idx` ON `github_pulls` (`repo_id`,`state`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`action` text NOT NULL,
	`target_kind` text NOT NULL,
	`target_id` text,
	`meta_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `audit_log_user_created_idx` ON `audit_log` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_log_target_idx` ON `audit_log` (`target_kind`,`target_id`);--> statement-breakpoint
CREATE TABLE `pm_briefs` (
	`id` text PRIMARY KEY NOT NULL,
	`ts` integer NOT NULL,
	`for_user_id` text,
	`markdown` text NOT NULL,
	`delivered_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`for_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pm_briefs_user_ts_idx` ON `pm_briefs` (`for_user_id`,`ts`);--> statement-breakpoint
CREATE TABLE `services` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`pid` integer NOT NULL,
	`port` integer NOT NULL,
	`url` text NOT NULL,
	`title` text,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `services_agent_port_unique` ON `services` (`agent_id`,`port`);--> statement-breakpoint
CREATE TABLE `usage_limits` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`window_kind` text NOT NULL,
	`used_pct` real NOT NULL,
	`resets_at` integer,
	`observed_at` integer NOT NULL,
	`source` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "usage_limits_provider_check" CHECK("provider" IN ('claude-code', 'codex', 'gemini-cli', 'opencode', 'kimi-code', 'custom')),
	CONSTRAINT "usage_limits_window_kind_check" CHECK("window_kind" IN ('five_hour', 'seven_day', 'monthly', 'credits')),
	CONSTRAINT "usage_limits_source_check" CHECK("source" IN ('inband', 'transcript', 'statusline'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `usage_limits_user_provider_window_unique` ON `usage_limits` (`user_id`,`provider`,`window_kind`);--> statement-breakpoint
CREATE TABLE `usage_samples` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`agent_id` text,
	`provider` text NOT NULL,
	`ts` integer NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cache_read_tokens` integer DEFAULT 0 NOT NULL,
	`cache_write_tokens` integer DEFAULT 0 NOT NULL,
	`cost_usd_estimate` real DEFAULT 0 NOT NULL,
	`source` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "usage_samples_provider_check" CHECK("provider" IN ('claude-code', 'codex', 'gemini-cli', 'opencode', 'kimi-code', 'custom')),
	CONSTRAINT "usage_samples_source_check" CHECK("source" IN ('inband', 'transcript', 'statusline'))
);
--> statement-breakpoint
CREATE INDEX `usage_samples_user_ts_idx` ON `usage_samples` (`user_id`,`ts`);--> statement-breakpoint
CREATE INDEX `usage_samples_agent_ts_idx` ON `usage_samples` (`agent_id`,`ts`);--> statement-breakpoint
CREATE INDEX `usage_samples_provider_ts_idx` ON `usage_samples` (`provider`,`ts`);--> statement-breakpoint
CREATE TABLE `invites` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`expires_at` integer NOT NULL,
	`created_by` text,
	`used_by` text,
	`used_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`used_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "invites_role_check" CHECK("role" IN ('owner', 'admin', 'member', 'viewer'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invites_token_unique` ON `invites` (`token`);--> statement-breakpoint
CREATE INDEX `invites_expires_at_idx` ON `invites` (`expires_at`);--> statement-breakpoint
CREATE TABLE `user_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`display_name` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`avatar_color_set` text DEFAULT 'default' NOT NULL,
	`avatar_accessory` text DEFAULT 'none' NOT NULL,
	`runner_id` text,
	`linux_uid` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "user_profiles_role_check" CHECK("role" IN ('owner', 'admin', 'member', 'viewer'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_profiles_user_id_unique` ON `user_profiles` (`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `decor` (
	`id` text PRIMARY KEY NOT NULL,
	`floor_id` text,
	`kind` text NOT NULL,
	`wall_id` text NOT NULL,
	`x` real NOT NULL,
	`y` real NOT NULL,
	`w` real NOT NULL,
	`h` real NOT NULL,
	`blob_path` text,
	`placed_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`floor_id`) REFERENCES `floors`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`placed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "decor_kind_check" CHECK("kind" IN ('picture', 'poster', 'plant'))
);
--> statement-breakpoint
CREATE INDEX `decor_floor_id_idx` ON `decor` (`floor_id`);--> statement-breakpoint
CREATE TABLE `jukebox_state` (
	`id` text PRIMARY KEY NOT NULL,
	`track_id` text,
	`started_at_server_ms` integer,
	`paused_at_ms` integer,
	`volume` real DEFAULT 0.5 NOT NULL,
	`queue_json` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`track_id`) REFERENCES `jukebox_tracks`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `jukebox_tracks` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`artist` text,
	`source` text NOT NULL,
	`ref` text NOT NULL,
	`duration_ms` integer,
	`added_by` text,
	`license` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`added_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "jukebox_tracks_source_check" CHECK("source" IN ('file', 'youtube', 'url'))
);
--> statement-breakpoint
CREATE TABLE `whiteboards` (
	`id` text PRIMARY KEY NOT NULL,
	`floor_id` text,
	`ydoc_blob` blob,
	`snapshot_png` text,
	`version` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`floor_id`) REFERENCES `floors`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `whiteboards_floor_id_unique` ON `whiteboards` (`floor_id`);