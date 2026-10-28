CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_id` text NOT NULL,
	`state` text NOT NULL,
	`outcome` text,
	`target_level` text,
	`transfer_reason` text,
	`transfer_summary` text,
	`analyst_id` text,
	`ticket_id` text,
	`message_count` integer DEFAULT 0 NOT NULL,
	`wait_until` integer,
	`created_at` integer NOT NULL,
	`first_response_at` integer,
	`closed_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `conversations_one_active_per_employee` ON `conversations` (`employee_id`) WHERE "conversations"."state" <> 'closed';--> statement-breakpoint
CREATE TABLE `decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`understanding` text NOT NULL,
	`action` text NOT NULL,
	`tools_used` text NOT NULL,
	`confidence` real,
	`reason` text,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`operation` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`type` text NOT NULL,
	`category` text NOT NULL,
	`subcategory` text,
	`impact` text NOT NULL,
	`urgency` text NOT NULL,
	`priority` text NOT NULL,
	`affected` text NOT NULL,
	`ticket_id` text,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`author` text NOT NULL,
	`text` text NOT NULL,
	`parts` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `messages_conversation_created` ON `messages` (`conversation_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `usage_counters` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer DEFAULT 0 NOT NULL
);
