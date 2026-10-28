CREATE TABLE `analysts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`level` text NOT NULL,
	`available` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `analysts_email_unique` ON `analysts` (`email`);--> statement-breakpoint
CREATE TABLE `employees` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`department` text NOT NULL,
	`password_changed_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `employees_email_unique` ON `employees` (`email`);--> statement-breakpoint
CREATE TABLE `idempotency_keys` (
	`key` text PRIMARY KEY NOT NULL,
	`response` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `kb_articles` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`category` text NOT NULL,
	`keywords` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `service_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`unavailable_until` integer
);
--> statement-breakpoint
CREATE TABLE `ticket_updates` (
	`id` text PRIMARY KEY NOT NULL,
	`ticket_id` text NOT NULL,
	`author` text NOT NULL,
	`text` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`ticket_id`) REFERENCES `tickets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `tickets` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`category` text NOT NULL,
	`subcategory` text,
	`priority` text NOT NULL,
	`affected` text NOT NULL,
	`status` text NOT NULL,
	`opened_by` text NOT NULL,
	`assigned_to` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_it_response_at` integer,
	`due_at` integer NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`opened_by`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assigned_to`) REFERENCES `analysts`(`id`) ON UPDATE no action ON DELETE no action
);
