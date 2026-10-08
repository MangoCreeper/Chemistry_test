import { pgTable, text, integer, bigint, uniqueIndex } from "drizzle-orm/pg-core";

export const administrators = pgTable("administrators", {
  id: integer("id").primaryKey(), password: text("password").notNull(),
});
export const quizzes = pgTable("quizzes", {
  id: text("id").primaryKey(), title: text("title").notNull(), owner: text("owner").notNull(),
  description: text("description").notNull(), content: text("content").notNull(),
  status: text("status").notNull().default("draft"), locked: integer("locked").notNull().default(0),
  version: integer("version").notNull().default(1), createdAt: bigint("created_at", { mode: "number" }).notNull(), updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});
export const participants = pgTable("participants", {
  id: text("id").primaryKey(), quizId: text("quiz_id").notNull().references(() => quizzes.id),
  username: text("username").notNull(), enabled: integer("enabled").notNull().default(1),
}, (table) => [uniqueIndex("participant_name").on(table.quizId, table.username)]);
export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(), role: text("role").notNull(), quizId: text("quiz_id"),
  username: text("username"), expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
});
export const submissions = pgTable("submissions", {
  id: text("id").primaryKey(), quizId: text("quiz_id").notNull().references(() => quizzes.id),
  username: text("username").notNull(), correct: integer("correct").notNull(), total: integer("total").notNull(),
  score: integer("score").notNull(), answers: text("answers").notNull(), reward: text("reward"),
  redeemedAt: bigint("redeemed_at", { mode: "number" }), submittedAt: bigint("submitted_at", { mode: "number" }).notNull(),
}, (table) => [uniqueIndex("one_submission").on(table.quizId, table.username)]);

export const loginAttempts = pgTable("login_attempts", {
  id: text("id").primaryKey(), count: integer("count").notNull(),
  since: bigint("since", { mode: "number" }).notNull(),
});
