ALTER TABLE `conversations` ADD `needs_analyst_since` integer;--> statement-breakpoint
ALTER TABLE `conversations` ADD `version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Written by hand: the conversations transferred before this column need an analyst since the message of hers that the
-- transferring reply answered.
UPDATE `conversations` SET `needs_analyst_since` = (SELECT max(`created_at`) FROM `messages` WHERE `messages`.`conversation_id` = `conversations`.`id` AND `messages`.`author` = 'employee' AND `messages`.`created_at` <= `conversations`.`transferred_at`) WHERE `transferred_at` IS NOT NULL;
