CREATE TABLE `operator_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`subject` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `operator_sessions_expires_idx` ON `operator_sessions` (`expires_at`);--> statement-breakpoint
ALTER TABLE `apps` ADD `policy` text;--> statement-breakpoint
ALTER TABLE `apps` ADD `registered_at` integer;--> statement-breakpoint
ALTER TABLE `apps` ADD `updated_at` integer;