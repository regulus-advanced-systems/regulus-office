CREATE TABLE `github_connection` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`app_id` integer,
	`app_client_id` text,
	`app_slug` text,
	`app_name` text,
	`app_html_url` text,
	`app_owner` text,
	`encrypted_private_key` text,
	`encrypted_webhook_secret` text,
	`encrypted_token` text,
	`token_login` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "github_connection_kind_check" CHECK("kind" IN ('app', 'pat'))
);
