ALTER TABLE "survey_group_states" ADD COLUMN "confirmation_prompt_message_id" uuid;--> statement-breakpoint
UPDATE "survey_group_states"
SET "status" = 'pending_confirmation', "updated_at" = date_trunc('milliseconds', now())
WHERE "status" = 'awaiting_confirmation';--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_group_states" ADD CONSTRAINT "survey_group_states_confirmation_prompt_message_id_messages_id_fk" FOREIGN KEY ("confirmation_prompt_message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "survey_group_states_one_active_confirmation_per_user_idx" ON "survey_group_states" USING btree ("tenant_id","user_id") WHERE "survey_group_states"."confirmation_prompt_message_id" is not null AND "survey_group_states"."status" IN ('pending_confirmation', 'awaiting_confirmation');--> statement-breakpoint
ALTER TABLE "survey_group_states" ADD CONSTRAINT "survey_group_states_confirmation_prompt_message_id_unique" UNIQUE("confirmation_prompt_message_id");--> statement-breakpoint
ALTER TABLE "survey_group_states" ADD CONSTRAINT "survey_group_states_confirmed_displayed_summary_proof_check" CHECK ("survey_group_states"."status" <> 'confirmed' OR ("survey_group_states"."confirmation_prompt_message_id" IS NOT NULL AND "survey_group_states"."ai_summary" IS NOT NULL AND btrim("survey_group_states"."ai_summary") <> '')) NOT VALID;
