-- Written by hand. Nothing wrote drafts before feature 4 (the seed only empties the table), so the table is recreated
-- with its final shape instead of altered: SQLite cannot add the NOT NULL number and due_at to a table, even an empty one.
DROP TABLE `drafts`;--> statement-breakpoint
CREATE TABLE `drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`number` integer NOT NULL,
	`conversation_id` text NOT NULL,
	`operation` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`type` text NOT NULL,
	`category` text NOT NULL,
	`subcategory` text,
	`impact` text,
	`urgency` text,
	`priority` text NOT NULL,
	`affected` text NOT NULL,
	`ticket_id` text,
	`status` text NOT NULL,
	`rejected_reason` text,
	`not_duplicate_reason` text,
	`due_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `drafts_number` ON `drafts` (`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `drafts_one_pending_per_conversation` ON `drafts` (`conversation_id`) WHERE "drafts"."status" = 'pending';--> statement-breakpoint
CREATE INDEX `drafts_conversation_created` ON `drafts` (`conversation_id`,`created_at`);
