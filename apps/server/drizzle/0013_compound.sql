CREATE TABLE `compound` (
	`id` text PRIMARY KEY NOT NULL,
	`width` integer NOT NULL,
	`depth` integer NOT NULL,
	`lobby_grid_x` integer NOT NULL,
	`lobby_grid_y` integer NOT NULL,
	`lobby_width` integer NOT NULL,
	`lobby_depth` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "compound_single_row_check" CHECK("id" = 'main')
);
--> statement-breakpoint
ALTER TABLE `floors` ADD `grid_x` integer;--> statement-breakpoint
ALTER TABLE `floors` ADD `grid_y` integer;--> statement-breakpoint
ALTER TABLE `floors` ADD `width` integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE `floors` ADD `depth` integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE `floors` ADD `door_side` text DEFAULT 'south' NOT NULL;--> statement-breakpoint
ALTER TABLE `floors` ADD `build_state` text DEFAULT 'ready' NOT NULL;--> statement-breakpoint
ALTER TABLE `floors` ADD `build_started_at` integer;