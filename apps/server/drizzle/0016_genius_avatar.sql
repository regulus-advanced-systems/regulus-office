ALTER TABLE `user_profiles` ADD `avatar` text DEFAULT '{"archetype":"mastermind","outfit":"charcoal","trim":"brass","skin":"light","hair":"black","accessory":"none"}' NOT NULL;--> statement-breakpoint
ALTER TABLE `user_profiles` ADD `avatar_chosen_at` integer;--> statement-breakpoint
-- #185: humans are geniuses. Existing profiles become the default archetype (mastermind),
-- keeping their old robot colour set as the outfit colour where one matches; avatar_chosen_at
-- stays null so everyone sees the picker once at their next visit.
UPDATE `user_profiles` SET `avatar` = json_object(
	'archetype', 'mastermind',
	'outfit', CASE `avatar_color_set`
		WHEN 'teal' THEN 'teal' WHEN 'oak' THEN 'mustard' WHEN 'sky' THEN 'navy'
		WHEN 'orange' THEN 'crimson' WHEN 'lime' THEN 'olive' WHEN 'mustard' THEN 'mustard'
		WHEN 'crimson' THEN 'crimson' WHEN 'navy' THEN 'navy' WHEN 'cream' THEN 'ivory'
		ELSE 'charcoal' END,
	'trim', 'brass', 'skin', 'light', 'hair', 'black', 'accessory', 'none'
);--> statement-breakpoint
ALTER TABLE `user_profiles` DROP COLUMN `avatar_color_set`;--> statement-breakpoint
ALTER TABLE `user_profiles` DROP COLUMN `avatar_accessory`;