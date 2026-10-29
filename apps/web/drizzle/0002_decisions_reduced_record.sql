DROP INDEX "conversations_one_active_per_employee";--> statement-breakpoint
DROP INDEX "decisions_message_id";--> statement-breakpoint
DROP INDEX "messages_conversation_created";--> statement-breakpoint
ALTER TABLE `decisions` ALTER COLUMN "understanding" TO "understanding" text;--> statement-breakpoint
CREATE UNIQUE INDEX `conversations_one_active_per_employee` ON `conversations` (`employee_id`) WHERE "conversations"."state" <> 'closed';--> statement-breakpoint
CREATE UNIQUE INDEX `decisions_message_id` ON `decisions` (`message_id`);--> statement-breakpoint
CREATE INDEX `messages_conversation_created` ON `messages` (`conversation_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `decisions` ALTER COLUMN "action" TO "action" text;