ALTER TABLE "survey_question_insights" DROP CONSTRAINT "survey_question_insights_scope_key";--> statement-breakpoint
ALTER TABLE "survey_question_insights" DROP CONSTRAINT "survey_question_insights_score_range";--> statement-breakpoint
ALTER TABLE "survey_question_insights" ALTER COLUMN "score" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "survey_question_insights" ADD COLUMN "outcome" text DEFAULT 'scored' NOT NULL;--> statement-breakpoint
ALTER TABLE "survey_question_insights" ADD COLUMN "is_current" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "survey_question_insights" ADD COLUMN "working_insight_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_question_insights" ADD CONSTRAINT "survey_question_insights_working_insight_id_survey_question_working_insights_id_fk" FOREIGN KEY ("working_insight_id") REFERENCES "public"."survey_question_working_insights"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "survey_question_insights_current_scope_key" ON "survey_question_insights" USING btree ("tenant_id","user_id","survey_window_id","survey_definition_id","survey_question_id","question_version") WHERE "survey_question_insights"."is_current" = true;--> statement-breakpoint
ALTER TABLE "survey_question_insights" ADD CONSTRAINT "survey_question_insights_working_revision_unique" UNIQUE("working_insight_id","confirmed_at");--> statement-breakpoint
ALTER TABLE "survey_question_insights" ADD CONSTRAINT "survey_question_insights_score_range" CHECK ("survey_question_insights"."working_insight_id" IS NULL OR ((
      "survey_question_insights"."outcome" = 'scored' AND "survey_question_insights"."score" IS NOT NULL AND "survey_question_insights"."score" >= 0 AND "survey_question_insights"."score" <= 100 AND mod("survey_question_insights"."score", 1) = 0
    ) OR ("survey_question_insights"."outcome" = 'insufficient_evidence' AND "survey_question_insights"."score" IS NULL)));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION survey_insight_v2_validate_canonical_question_map() RETURNS trigger AS $$
DECLARE definition_version text;
BEGIN
  SELECT version INTO definition_version FROM survey_definitions WHERE id = NEW.survey_definition_id;
  IF definition_version = 'v2-policy-1.0.0' THEN
    IF (SELECT count(*) FROM survey_questions
        WHERE survey_definition_id = NEW.survey_definition_id AND response_type = 'open_ended') <> 12
      OR EXISTS (
        SELECT 1 FROM (VALUES
          ('autonomy_control_work', 'autonomy'),
          ('autonomy_voice_influence', 'autonomy'),
          ('autonomy_expectation_clarity', 'autonomy'),
          ('growth_skill_development', 'growth'),
          ('growth_useful_feedback', 'growth'),
          ('growth_future_opportunities', 'growth'),
          ('purpose_personal_meaning', 'purpose'),
          ('purpose_contribution_visibility', 'purpose'),
          ('purpose_recognition', 'purpose'),
          ('belonging_team', 'belonging'),
          ('belonging_psychological_safety', 'belonging'),
          ('belonging_manager_support', 'belonging')
        ) AS expected(stable_key, question_group)
        WHERE NOT EXISTS (
          SELECT 1 FROM survey_questions question
          WHERE question.survey_definition_id = NEW.survey_definition_id
            AND question.response_type = 'open_ended'
            AND question.stable_key = expected.stable_key
            AND question.question_group = expected.question_group
        )
      ) THEN
      RAISE EXCEPTION 'survey_insight_v2_cycle_question_map_invalid';
    END IF;
  ELSE
    IF (SELECT count(*) FROM survey_questions
        WHERE survey_definition_id = NEW.survey_definition_id AND response_type = 'open_ended') <> 12
      OR EXISTS (
        SELECT 1 FROM (VALUES
          ('q12_expectations', 'autonomy'), ('q12_strengths_opportunity', 'autonomy'),
          ('q12_opinions_count', 'autonomy'), ('wellbeing_at_work', 'belonging'),
          ('q12_supervisor_cares', 'belonging'), ('belonging_psychological_safety', 'belonging'),
          ('role_clarity', 'growth'), ('professional_growth', 'growth'),
          ('q12_progress_discussion', 'growth'), ('q12_recognition', 'purpose'),
          ('purpose_meaning', 'purpose'), ('purpose_contribution', 'purpose')
        ) AS expected(stable_key, question_group)
        WHERE NOT EXISTS (
          SELECT 1 FROM survey_questions question
          WHERE question.survey_definition_id = NEW.survey_definition_id
            AND question.response_type = 'open_ended'
            AND question.stable_key = expected.stable_key
            AND question.question_group = expected.question_group
        )
      ) THEN
      RAISE EXCEPTION 'survey_insight_v2_cycle_question_map_invalid';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
