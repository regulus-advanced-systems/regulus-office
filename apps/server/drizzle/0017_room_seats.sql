-- Pre-compound floors switch to generated rooms (#186): seat ids renamed through
-- LEGACY_SEAT_IDS (@regulus/floor-layout), so robots keep their seats. Generated from
-- apps/server/src/db/legacy-seats.ts; legacy-seats.test.ts keeps the two in step.
UPDATE `desks` SET `seat_id` = CASE `seat_id`
	WHEN 'table-a-n1' THEN 'd1s1'
	WHEN 'table-a-n2' THEN 'd1s2'
	WHEN 'table-a-s1' THEN 'd1s3'
	WHEN 'table-a-s2' THEN 'd1s4'
	WHEN 'desk-1-seat' THEN 'd2s1'
	WHEN 'ceo-seat' THEN 'd2s2'
	ELSE `seat_id`
END
WHERE `floor_id` IN (SELECT `id` FROM `floors` WHERE `layout_template_id` = 'office-small');--> statement-breakpoint
UPDATE `agents` SET `desk_seat_id` = CASE `desk_seat_id`
	WHEN 'table-a-n1' THEN 'd1s1'
	WHEN 'table-a-n2' THEN 'd1s2'
	WHEN 'table-a-s1' THEN 'd1s3'
	WHEN 'table-a-s2' THEN 'd1s4'
	WHEN 'desk-1-seat' THEN 'd2s1'
	WHEN 'ceo-seat' THEN 'd2s2'
	ELSE `desk_seat_id`
END
WHERE `floor_id` IN (SELECT `id` FROM `floors` WHERE `layout_template_id` = 'office-small');--> statement-breakpoint
INSERT INTO `desks` (`id`, `floor_id`, `seat_id`, `created_at`, `updated_at`)
SELECT lower(hex(randomblob(16))), `f`.`id`, 'd2s3', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM `floors` `f` WHERE `f`.`layout_template_id` = 'office-small'
AND NOT EXISTS (SELECT 1 FROM `desks` `d` WHERE `d`.`floor_id` = `f`.`id` AND `d`.`seat_id` = 'd2s3');--> statement-breakpoint
INSERT INTO `desks` (`id`, `floor_id`, `seat_id`, `created_at`, `updated_at`)
SELECT lower(hex(randomblob(16))), `f`.`id`, 'd2s4', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM `floors` `f` WHERE `f`.`layout_template_id` = 'office-small'
AND NOT EXISTS (SELECT 1 FROM `desks` `d` WHERE `d`.`floor_id` = `f`.`id` AND `d`.`seat_id` = 'd2s4');--> statement-breakpoint
UPDATE `desks` SET `seat_id` = CASE `seat_id`
	WHEN 'table-a-n1' THEN 'd1s1'
	WHEN 'table-a-n2' THEN 'd1s2'
	WHEN 'table-a-s1' THEN 'd1s3'
	WHEN 'table-a-s2' THEN 'd1s4'
	WHEN 'table-b-n1' THEN 'd2s1'
	WHEN 'table-b-n2' THEN 'd2s2'
	WHEN 'table-b-s1' THEN 'd2s3'
	WHEN 'table-b-s2' THEN 'd2s4'
	WHEN 'desk-1-seat' THEN 'd3s1'
	WHEN 'desk-2-seat' THEN 'd3s2'
	WHEN 'desk-3-seat' THEN 'd3s3'
	WHEN 'ceo-seat' THEN 'd3s4'
	ELSE `seat_id`
END
WHERE `floor_id` IN (SELECT `id` FROM `floors` WHERE `layout_template_id` = 'office-l2');--> statement-breakpoint
UPDATE `agents` SET `desk_seat_id` = CASE `desk_seat_id`
	WHEN 'table-a-n1' THEN 'd1s1'
	WHEN 'table-a-n2' THEN 'd1s2'
	WHEN 'table-a-s1' THEN 'd1s3'
	WHEN 'table-a-s2' THEN 'd1s4'
	WHEN 'table-b-n1' THEN 'd2s1'
	WHEN 'table-b-n2' THEN 'd2s2'
	WHEN 'table-b-s1' THEN 'd2s3'
	WHEN 'table-b-s2' THEN 'd2s4'
	WHEN 'desk-1-seat' THEN 'd3s1'
	WHEN 'desk-2-seat' THEN 'd3s2'
	WHEN 'desk-3-seat' THEN 'd3s3'
	WHEN 'ceo-seat' THEN 'd3s4'
	ELSE `desk_seat_id`
END
WHERE `floor_id` IN (SELECT `id` FROM `floors` WHERE `layout_template_id` = 'office-l2');--> statement-breakpoint
UPDATE `desks` SET `seat_id` = CASE `seat_id`
	WHEN 'a-table-1-n1' THEN 'd1s1'
	WHEN 'a-table-1-n2' THEN 'd1s2'
	WHEN 'a-table-1-s1' THEN 'd1s3'
	WHEN 'a-table-1-s2' THEN 'd1s4'
	WHEN 'a-table-2-n1' THEN 'd2s1'
	WHEN 'a-table-2-n2' THEN 'd2s2'
	WHEN 'a-table-2-s1' THEN 'd2s3'
	WHEN 'a-table-2-s2' THEN 'd2s4'
	WHEN 'a-desk-1-seat' THEN 'd3s1'
	WHEN 'a-desk-2-seat' THEN 'd3s2'
	WHEN 'b-table-1-n1' THEN 'd3s3'
	WHEN 'b-table-1-n2' THEN 'd3s4'
	WHEN 'b-table-1-s1' THEN 'd4s1'
	WHEN 'b-table-1-s2' THEN 'd4s2'
	WHEN 'b-table-2-n1' THEN 'd4s3'
	WHEN 'b-table-2-n2' THEN 'd4s4'
	WHEN 'b-table-2-s1' THEN 'd5s1'
	WHEN 'b-table-2-s2' THEN 'd5s2'
	WHEN 'b-desk-1-seat' THEN 'd5s3'
	WHEN 'ceo-seat' THEN 'd5s4'
	ELSE `seat_id`
END
WHERE `floor_id` IN (SELECT `id` FROM `floors` WHERE `layout_template_id` = 'office-large');--> statement-breakpoint
UPDATE `agents` SET `desk_seat_id` = CASE `desk_seat_id`
	WHEN 'a-table-1-n1' THEN 'd1s1'
	WHEN 'a-table-1-n2' THEN 'd1s2'
	WHEN 'a-table-1-s1' THEN 'd1s3'
	WHEN 'a-table-1-s2' THEN 'd1s4'
	WHEN 'a-table-2-n1' THEN 'd2s1'
	WHEN 'a-table-2-n2' THEN 'd2s2'
	WHEN 'a-table-2-s1' THEN 'd2s3'
	WHEN 'a-table-2-s2' THEN 'd2s4'
	WHEN 'a-desk-1-seat' THEN 'd3s1'
	WHEN 'a-desk-2-seat' THEN 'd3s2'
	WHEN 'b-table-1-n1' THEN 'd3s3'
	WHEN 'b-table-1-n2' THEN 'd3s4'
	WHEN 'b-table-1-s1' THEN 'd4s1'
	WHEN 'b-table-1-s2' THEN 'd4s2'
	WHEN 'b-table-2-n1' THEN 'd4s3'
	WHEN 'b-table-2-n2' THEN 'd4s4'
	WHEN 'b-table-2-s1' THEN 'd5s1'
	WHEN 'b-table-2-s2' THEN 'd5s2'
	WHEN 'b-desk-1-seat' THEN 'd5s3'
	WHEN 'ceo-seat' THEN 'd5s4'
	ELSE `desk_seat_id`
END
WHERE `floor_id` IN (SELECT `id` FROM `floors` WHERE `layout_template_id` = 'office-large');--> statement-breakpoint
UPDATE `floors` SET `layout_template_id` = 'room' WHERE `layout_template_id` IN ('office-small', 'office-l2', 'office-large');
