ALTER TABLE "survey_group_states" ADD COLUMN "reporting_disclosure_version" text;--> statement-breakpoint
ALTER TABLE "survey_group_states" ADD COLUMN "reporting_disclosure_shown_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "survey_group_states" ADD COLUMN "confirmation_message_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_group_states" ADD CONSTRAINT "survey_group_states_confirmation_message_id_messages_id_fk" FOREIGN KEY ("confirmation_message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "survey_group_states" ADD CONSTRAINT "survey_group_states_confirmed_disclosure_proof_check" CHECK ("survey_group_states"."status" <> 'confirmed' OR ("survey_group_states"."confirmed_at" IS NOT NULL AND "survey_group_states"."reporting_disclosure_version" IS NOT NULL AND btrim("survey_group_states"."reporting_disclosure_version") <> '' AND "survey_group_states"."reporting_disclosure_shown_at" IS NOT NULL AND "survey_group_states"."confirmation_message_id" IS NOT NULL AND "survey_group_states"."reporting_disclosure_shown_at" < "survey_group_states"."confirmed_at")) NOT VALID;
