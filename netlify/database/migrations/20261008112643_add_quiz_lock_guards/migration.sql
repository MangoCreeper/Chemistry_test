-- Custom SQL migration file, put your code below! --
CREATE FUNCTION lock_quiz_on_submission() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE quizzes SET locked = 1 WHERE id = NEW.quiz_id;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER lock_quiz_on_submission AFTER INSERT ON submissions
FOR EACH ROW EXECUTE FUNCTION lock_quiz_on_submission();
--> statement-breakpoint
CREATE FUNCTION protect_locked_quiz() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.locked = 1 AND (
    NEW.content IS DISTINCT FROM OLD.content OR
    NEW.title IS DISTINCT FROM OLD.title OR
    NEW.owner IS DISTINCT FROM OLD.owner OR
    NEW.description IS DISTINCT FROM OLD.description OR
    NEW.locked IS DISTINCT FROM OLD.locked
  ) THEN
    RAISE EXCEPTION 'quiz rules are locked';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER protect_locked_quiz BEFORE UPDATE ON quizzes
FOR EACH ROW EXECUTE FUNCTION protect_locked_quiz();
