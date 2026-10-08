CREATE TABLE `administrators` (
	`id` integer PRIMARY KEY NOT NULL,
	`password` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `participants` (
	`id` text PRIMARY KEY NOT NULL,
	`quiz_id` text NOT NULL,
	`username` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`quiz_id`) REFERENCES `quizzes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `participant_name` ON `participants` (`quiz_id`,`username`);--> statement-breakpoint
CREATE TABLE `quizzes` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`owner` text NOT NULL,
	`description` text NOT NULL,
	`content` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`locked` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`role` text NOT NULL,
	`quiz_id` text,
	`username` text,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`quiz_id` text NOT NULL,
	`username` text NOT NULL,
	`correct` integer NOT NULL,
	`total` integer NOT NULL,
	`score` integer NOT NULL,
	`answers` text NOT NULL,
	`reward` text,
	`redeemed_at` integer,
	`submitted_at` integer NOT NULL,
	FOREIGN KEY (`quiz_id`) REFERENCES `quizzes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `one_submission` ON `submissions` (`quiz_id`,`username`);
--> statement-breakpoint
CREATE TRIGGER `lock_quiz_on_submission` AFTER INSERT ON `submissions`
BEGIN
  UPDATE `quizzes` SET `locked` = 1 WHERE `id` = NEW.`quiz_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `protect_locked_quiz` BEFORE UPDATE OF `content`, `title`, `owner`, `description` ON `quizzes`
WHEN OLD.`locked` = 1 AND (NEW.`content` != OLD.`content` OR NEW.`title` != OLD.`title` OR NEW.`owner` != OLD.`owner` OR NEW.`description` != OLD.`description`)
BEGIN
  SELECT RAISE(ABORT, 'quiz rules are locked');
END;
