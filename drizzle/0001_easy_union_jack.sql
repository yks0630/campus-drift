ALTER TABLE `race_players` ADD `ready` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `race_players` ADD `participating` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `race_players` ADD `membership` text DEFAULT 'active' NOT NULL;--> statement-breakpoint
UPDATE race_players SET participating=1 WHERE EXISTS (
  SELECT 1 FROM race_rooms WHERE race_rooms.code=race_players.room
  AND race_rooms.round=race_players.round AND race_rooms.start_at IS NOT NULL
);
