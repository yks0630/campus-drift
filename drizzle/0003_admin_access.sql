CREATE TABLE `race_admin_attempts` (
	`client_hash` text PRIMARY KEY NOT NULL,
	`started_at` integer NOT NULL,
	`attempts` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `race_admin_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`password_hash` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `race_admin_sessions_expiry` ON `race_admin_sessions` (`expires_at`);