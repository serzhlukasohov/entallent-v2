ALTER TABLE "survey_question_working_insights" ADD COLUMN "clarification_prompt_message_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_question_working_insights" ADD CONSTRAINT "survey_question_working_insights_clarification_prompt_message_id_messages_id_fk" FOREIGN KEY ("clarification_prompt_message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
