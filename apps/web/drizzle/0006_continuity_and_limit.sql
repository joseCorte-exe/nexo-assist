ALTER TABLE `conversations` ADD `limit_reached_at` integer;--> statement-breakpoint
CREATE INDEX `conversations_employee_created` ON `conversations` (`employee_id`,`created_at`);