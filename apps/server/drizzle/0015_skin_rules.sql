CREATE TABLE `skin_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`match` text NOT NULL,
	`skin_id` text NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "skin_rules_skin_id_check" CHECK("skin_id" IN ('standard', 'lab_coat', 'black_ops', 'chef', 'number_two'))
);
