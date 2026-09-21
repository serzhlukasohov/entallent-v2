ALTER TABLE "survey_group_states" ADD COLUMN "withdrawn_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "survey_group_states" ADD COLUMN "withdrawal_message_id" uuid;--> statement-breakpoint
ALTER TABLE "survey_group_states" ADD CONSTRAINT "survey_group_states_withdrawal_message_id_messages_id_fk" FOREIGN KEY ("withdrawal_message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;
