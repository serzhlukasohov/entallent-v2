ALTER TABLE "survey_question_insights" DROP CONSTRAINT "survey_question_insights_score_range";--> statement-breakpoint
ALTER TABLE "survey_question_insights" ADD CONSTRAINT "survey_question_insights_score_range" CHECK ((
      "survey_question_insights"."outcome" = 'scored' AND "survey_question_insights"."score" IS NOT NULL AND "survey_question_insights"."score" >= 0 AND "survey_question_insights"."score" <= 100
      AND ("survey_question_insights"."working_insight_id" IS NULL OR mod("survey_question_insights"."score", 1) = 0)
    ) OR ("survey_question_insights"."outcome" = 'insufficient_evidence' AND "survey_question_insights"."working_insight_id" IS NOT NULL AND "survey_question_insights"."score" IS NULL));