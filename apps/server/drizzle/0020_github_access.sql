CREATE TABLE `github_org_memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`org_login` text NOT NULL,
	`org_id` integer,
	`role` text DEFAULT 'member' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `github_org_memberships_user_org_unique` ON `github_org_memberships` (`user_id`,`org_login`);--> statement-breakpoint
CREATE TABLE `github_repo_permissions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`repo_id` text NOT NULL,
	`permission` text NOT NULL,
	`checked_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`repo_id`) REFERENCES `operation_repos`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "github_repo_permissions_permission_check" CHECK("permission" IN ('none', 'read', 'triage', 'write', 'maintain', 'admin'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `github_repo_permissions_user_repo_unique` ON `github_repo_permissions` (`user_id`,`repo_id`);--> statement-breakpoint
CREATE INDEX `github_repo_permissions_repo_idx` ON `github_repo_permissions` (`repo_id`);--> statement-breakpoint
CREATE TABLE `github_user_links` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`github_user_id` integer NOT NULL,
	`login` text NOT NULL,
	`status` text DEFAULT 'linked' NOT NULL,
	`encrypted_token` text,
	`encrypted_refresh_token` text,
	`token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`linked_at` integer NOT NULL,
	`last_checked_at` integer,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "github_user_links_status_check" CHECK("status" IN ('linked', 'revoked'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `github_user_links_user_unique` ON `github_user_links` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `github_user_links_github_user_unique` ON `github_user_links` (`github_user_id`);--> statement-breakpoint
-- GitHub sign-in tokens Better Auth stored in clear before #267. The office never reads them
-- (sign-in does not need them; a person's GitHub access comes from github_user_links), and
-- new ones are stored encrypted (account.encryptOAuthTokens).
UPDATE `accounts` SET `access_token` = NULL, `refresh_token` = NULL, `id_token` = NULL WHERE `provider_id` = 'github';
