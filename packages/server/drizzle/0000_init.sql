CREATE TABLE `apps` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `identities` (
	`id` text PRIMARY KEY NOT NULL,
	`app_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `identities_app_created_idx` ON `identities` (`app_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `passkeys` (
	`id` text PRIMARY KEY NOT NULL,
	`identity_id` text NOT NULL,
	`public_key` blob NOT NULL,
	`counter` integer NOT NULL,
	`transports` text,
	`backed_up` integer NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer NOT NULL,
	FOREIGN KEY (`identity_id`) REFERENCES `identities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `passkeys_identity_idx` ON `passkeys` (`identity_id`);--> statement-breakpoint
CREATE TABLE `device_keys` (
	`public_key` text PRIMARY KEY NOT NULL,
	`identity_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer NOT NULL,
	FOREIGN KEY (`identity_id`) REFERENCES `identities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `device_keys_identity_idx` ON `device_keys` (`identity_id`);--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`app_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`visibility` text NOT NULL,
	`lifecycle` text NOT NULL,
	`epoch` integer NOT NULL,
	`snapshot` blob NOT NULL,
	`snapshot_seq` integer NOT NULL,
	`size_bytes` integer NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`) REFERENCES `identities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `documents_owner_idx` ON `documents` (`owner_id`);--> statement-breakpoint
CREATE INDEX `documents_app_idx` ON `documents` (`app_id`);--> statement-breakpoint
CREATE INDEX `documents_lifecycle_used_idx` ON `documents` (`lifecycle`,`last_used_at`);--> statement-breakpoint
CREATE TABLE `operations` (
	`document_id` text NOT NULL,
	`seq` integer NOT NULL,
	`payload` blob NOT NULL,
	`device_key` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`document_id`, `seq`),
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `epoch_archives` (
	`document_id` text NOT NULL,
	`epoch` integer NOT NULL,
	`final_snapshot` blob NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`document_id`, `epoch`),
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `epoch_archives_created_idx` ON `epoch_archives` (`created_at`);