CREATE TABLE `comments` (
	`id` text PRIMARY KEY NOT NULL,
	`photo_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `likes` (
	`photo_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`photo_id`, `profile_id`)
);
--> statement-breakpoint
CREATE TABLE `magic_links` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`email` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `parties` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`title` text NOT NULL,
	`host_profile_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `parties_code_unique` ON `parties` (`code`);--> statement-breakpoint
CREATE TABLE `party_members` (
	`party_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`role` text NOT NULL,
	`joined_at` integer NOT NULL,
	PRIMARY KEY(`party_id`, `profile_id`)
);
--> statement-breakpoint
CREATE TABLE `photos` (
	`id` text PRIMARY KEY NOT NULL,
	`party_id` text NOT NULL,
	`uploader_profile_id` text NOT NULL,
	`r2_key` text NOT NULL,
	`width` integer,
	`height` integer,
	`bytes` integer NOT NULL,
	`content_type` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text,
	`nickname` text,
	`created_at` integer NOT NULL,
	`is_anonymous` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `profiles_email_unique` ON `profiles` (`email`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`expires_at` integer NOT NULL
);
