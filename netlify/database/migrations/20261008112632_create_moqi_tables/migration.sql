CREATE TABLE "administrators" (
	"id" integer PRIMARY KEY,
	"password" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"id" text PRIMARY KEY,
	"count" integer NOT NULL,
	"since" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "participants" (
	"id" text PRIMARY KEY,
	"quiz_id" text NOT NULL,
	"username" text NOT NULL,
	"enabled" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quizzes" (
	"id" text PRIMARY KEY,
	"title" text NOT NULL,
	"owner" text NOT NULL,
	"description" text NOT NULL,
	"content" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"locked" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY,
	"role" text NOT NULL,
	"quiz_id" text,
	"username" text,
	"expires_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" text PRIMARY KEY,
	"quiz_id" text NOT NULL,
	"username" text NOT NULL,
	"correct" integer NOT NULL,
	"total" integer NOT NULL,
	"score" integer NOT NULL,
	"answers" text NOT NULL,
	"reward" text,
	"redeemed_at" bigint,
	"submitted_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "participant_name" ON "participants" ("quiz_id","username");--> statement-breakpoint
CREATE UNIQUE INDEX "one_submission" ON "submissions" ("quiz_id","username");--> statement-breakpoint
ALTER TABLE "participants" ADD CONSTRAINT "participants_quiz_id_quizzes_id_fkey" FOREIGN KEY ("quiz_id") REFERENCES "quizzes"("id");--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_quiz_id_quizzes_id_fkey" FOREIGN KEY ("quiz_id") REFERENCES "quizzes"("id");