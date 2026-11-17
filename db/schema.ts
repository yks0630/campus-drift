import { sqliteTable, text, integer, real, index, primaryKey } from 'drizzle-orm/sqlite-core';
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
  ready: integer('ready').notNull().default(0),
  readyVersion: integer('ready_version').notNull().default(0),
  participating: integer('participating').notNull().default(0),
  membership: text('membership').notNull().default('active'),
}, (t) => [index('race_players_room').on(t.room), index('race_players_rank').on(t.room,t.round,t.distance)]);

export const results = sqliteTable('race_results', {
  room: text('room').notNull().references(() => rooms.code),
  round: integer('round').notNull(), seed: integer('seed').notNull(),
  startAt: integer('start_at').notNull(), finishedAt: integer('finished_at').notNull(),
  participantCount: integer('participant_count').notNull(), players: text('players').notNull(),
}, (t) => [primaryKey({columns:[t.room,t.round]})]);

// Legacy login tables are retained for migration compatibility; the passwordless backend does not use them.
export const adminSessions = sqliteTable('race_admin_sessions', {
  tokenHash: text('token_hash').primaryKey(), passwordHash: text('password_hash').notNull(),
  expiresAt: integer('expires_at').notNull(),
}, (t) => [index('race_admin_sessions_expiry').on(t.expiresAt)]);
export const adminAttempts = sqliteTable('race_admin_attempts', {
  clientHash: text('client_hash').primaryKey(), startedAt: integer('started_at').notNull(),
  attempts: integer('attempts').notNull(),
});
