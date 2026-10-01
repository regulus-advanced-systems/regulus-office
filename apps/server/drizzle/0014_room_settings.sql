ALTER TABLE `floors` ADD `desk_count` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `floors` ADD `decor_style` text DEFAULT 'ops_room' NOT NULL;--> statement-breakpoint
-- Floors migrated from a fixed template keep every desk seat (#182): ceil(seats / 4) desks,
-- matching LEGACY_SEAT_IDS in @regulus/floor-layout (6, 12 and 20 desk seats).
UPDATE `floors` SET `desk_count` = CASE `layout_template_id`
	WHEN 'office-small' THEN 2
	WHEN 'office-l2' THEN 3
	WHEN 'office-large' THEN 5
	ELSE `desk_count`
END;
