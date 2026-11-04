CREATE TABLE `race_players` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`room` text NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`state` text NOT NULL,
	`distance` real DEFAULT 0 NOT NULL,
	`speed` real DEFAULT 0 NOT NULL,
	`round` integer DEFAULT 1 NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`room`) REFERENCES `race_rooms`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `race_players_token_hash_unique` ON `race_players` (`token_hash`);--> statement-breakpoint
CREATE INDEX `race_players_room` ON `race_players` (`room`);--> statement-breakpoint
CREATE INDEX `race_players_rank` ON `race_players` (`room`,`round`,`distance`);--> statement-breakpoint
CREATE TABLE `race_rooms` (
	`code` text PRIMARY KEY NOT NULL,
	`host_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`start_at` integer,
	`round` integer DEFAULT 1 NOT NULL,
	`seed` integer NOT NULL
);
