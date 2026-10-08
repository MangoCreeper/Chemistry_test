import { sqliteTable, text, integer, uniqueIndex } from "drizzle-orm/sqlite-core";

export const administrators = sqliteTable("administrators", {
  id: integer("id").primaryKey(), password: text("password").notNull(),
});
export const quizzes = sqliteTable("quizzes", {
  id: text("id").primaryKey(), title: text("title").notNull(), owner: text("owner").notNull(),
  description: text("description").notNull(), content: text("content").notNull(),
  status: text("status").notNull().default("draft"), locked: integer("locked").notNull().default(0),
  version: integer("version").notNull().default(1), createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull(),
});
export const participants = sqliteTable("participants", {
  id: text("id").primaryKey(), quizId: text("quiz_id").notNull().references(() => quizzes.id),
  username: text("username").notNull(), enabled: integer("enabled").notNull().default(1),
}, (table) => [uniqueIndex("participant_name").on(table.quizId, table.username)]);
export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(), role: text("role").notNull(), quizId: text("quiz_id"),
  username: text("username"), expiresAt: integer("expires_at").notNull(),
});
export const submissions = sqliteTable("submissions", {
  id: text("id").primaryKey(), quizId: text("quiz_id").notNull().references(() => quizzes.id),
  username: text("username").notNull(), correct: integer("correct").notNull(), total: integer("total").notNull(),
  score: integer("score").notNull(), answers: text("answers").notNull(), reward: text("reward"),
  redeemedAt: integer("redeemed_at"), submittedAt: integer("submitted_at").notNull(),
}, (table) => [uniqueIndex("one_submission").on(table.quizId, table.username)]);
