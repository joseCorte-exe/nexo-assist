CREATE TABLE `console_reads` (
	`analyst_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`read_at` integer NOT NULL,
	PRIMARY KEY(`analyst_id`, `conversation_id`),
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `conversations` ADD `transfer_confidence` real;--> statement-breakpoint
ALTER TABLE `conversations` ADD `transferred_at` integer;--> statement-breakpoint
ALTER TABLE `conversations` ADD `assumed_at` integer;--> statement-breakpoint
ALTER TABLE `conversations` ADD `last_activity_at` integer;--> statement-breakpoint
ALTER TABLE `conversations` ADD `employee_seen_at` integer;--> statement-breakpoint
ALTER TABLE `conversations` ADD `employee_typing_until` integer;--> statement-breakpoint
CREATE INDEX `conversations_last_activity` ON `conversations` (`last_activity_at`);--> statement-breakpoint
CREATE INDEX `conversations_state_level` ON `conversations` (`state`,`target_level`);--> statement-breakpoint
ALTER TABLE `messages` ADD `author_id` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `event` text;--> statement-breakpoint
-- Written by hand: drizzle-kit does not generate triggers. Every message moves the activity of its conversation forward,
-- so the console orders the list on an index, and no code path can forget to.
UPDATE `conversations` SET `last_activity_at` = coalesce((SELECT max(`created_at`) FROM `messages` WHERE `messages`.`conversation_id` = `conversations`.`id`), `created_at`);--> statement-breakpoint
CREATE TRIGGER `messages_move_activity` AFTER INSERT ON `messages`
BEGIN
	UPDATE `conversations` SET `last_activity_at` = NEW.`created_at`
	WHERE `id` = NEW.`conversation_id` AND (`last_activity_at` IS NULL OR `last_activity_at` < NEW.`created_at`);
END;
