CREATE TABLE `race_results` (
	`room` text NOT NULL,
	`round` integer NOT NULL,
	`seed` integer NOT NULL,
	`start_at` integer NOT NULL,
	`finished_at` integer NOT NULL,
	`participant_count` integer NOT NULL,
	`players` text NOT NULL,
	PRIMARY KEY(`room`, `round`),
	FOREIGN KEY (`room`) REFERENCES `race_rooms`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `race_players` ADD `ready_version` integer DEFAULT 0 NOT NULL;