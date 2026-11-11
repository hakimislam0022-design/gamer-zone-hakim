import { pgTable, serial, text, integer, bigint, boolean, timestamp, jsonb, varchar } from "drizzle-orm/pg-core";

/** Single-slot player progress (no accounts: one game owner / one stream). */
export const playerProgress = pgTable("player_progress", {
  slot: varchar("slot", { length: 64 }).primaryKey(),
  currentStage: integer("current_stage").notNull().default(1),
  highestStage: integer("highest_stage").notNull().default(1),
  totalCompleted: integer("total_completed").notNull().default(0),
  totalFalls: integer("total_falls").notNull().default(0),
  totalPlayMs: bigint("total_play_ms", { mode: "number" }).notNull().default(0),
  checkpoint: jsonb("checkpoint"),
  settings: jsonb("settings"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/** Per-stage persisted record (seed, validation result, completion stats). */
export const stageRecords = pgTable("stage_records", {
  stageId: integer("stage_id").primaryKey(),
  seed: bigint("seed", { mode: "number" }).notNull(),
  fingerprint: varchar("fingerprint", { length: 32 }).notNull(),
  name: text("name").notNull(),
  validated: boolean("validated").notNull().default(false),
  validationIssues: jsonb("validation_issues"),
  platformCount: integer("platform_count").notNull().default(0),
  completions: integer("completions").notNull().default(0),
  attempts: integer("attempts").notNull().default(0),
  falls: integer("falls").notNull().default(0),
  bestTimeMs: integer("best_time_ms"),
  botBestTimeMs: integer("bot_best_time_ms"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/** OAuth tokens for YouTube. Server only: never sent to the browser. */
export const youtubeAuth = pgTable("youtube_auth", {
  id: varchar("id", { length: 16 }).primaryKey(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  expiresAt: bigint("expires_at", { mode: "number" }),
  scope: text("scope"),
  channelTitle: text("channel_title"),
  liveChatId: text("live_chat_id"),
  videoId: text("video_id"),
  broadcastTitle: text("broadcast_title"),
  nextPageToken: text("next_page_token"),
  lastError: text("last_error"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/** Live chat messages seen (for dedupe across restarts). */
export const chatMessages = pgTable("chat_messages", {
  id: varchar("id", { length: 256 }).primaryKey(),
  author: text("author").notNull(),
  channelId: text("channel_id"),
  message: text("message").notNull(),
  verdict: varchar("verdict", { length: 32 }).notNull().default("accepted"),
  reply: text("reply"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const errorLogs = pgTable("error_logs", {
  id: serial("id").primaryKey(),
  source: varchar("source", { length: 64 }).notNull(),
  level: varchar("level", { length: 16 }).notNull().default("error"),
  message: text("message").notNull(),
  detail: text("detail"),
  stage: integer("stage"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
