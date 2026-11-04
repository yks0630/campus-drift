import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';
export const rooms = sqliteTable('race_rooms', {
  code: text('code').primaryKey(), hostHash: text('host_hash').notNull(),
  createdAt: integer('created_at').notNull(), startAt: integer('start_at'),
  round: integer('round').notNull().default(1), seed: integer('seed').notNull(),
});
export const players = sqliteTable('race_players', {
  id: text('id').primaryKey(), tokenHash: text('token_hash').notNull().unique(),
  room: text('room').notNull().references(() => rooms.code), name: text('name').notNull(),
  color: text('color').notNull(), state: text('state').notNull(),
  distance: real('distance').notNull().default(0), speed: real('speed').notNull().default(0),
  round: integer('round').notNull().default(1), version: integer('version').notNull().default(0),
  updatedAt: integer('updated_at').notNull(),
}, (t) => [index('race_players_room').on(t.room), index('race_players_rank').on(t.room,t.round,t.distance)]);
