ALTER TABLE "survey_question_working_insights" ADD COLUMN "meaning_sufficient" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "survey_question_working_insights" ADD COLUMN "driver_resolved" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- GC round 3 CAP-2: rows already ready keep their readiness; both parts count as resolved.
UPDATE "survey_question_working_insights" SET "meaning_sufficient" = true, "driver_resolved" = true WHERE "ready_for_confirmation" = true;
