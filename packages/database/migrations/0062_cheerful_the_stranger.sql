ALTER TABLE "survey_engagement_answer_revisions" DROP CONSTRAINT "survey_engagement_answer_revisions_tenant_id_user_id_inbound_receipt_id_survey_engagement_capture_events_tenant_id_user_id_inbound_receipt_id_fk";
--> statement-breakpoint
ALTER TABLE "survey_engagement_answer_revisions" DROP CONSTRAINT "survey_engagement_answer_revisions_tenant_id_user_id_lineage_id_survey_report_question_lineages_tenant_id_user_id_id_fk";
--> statement-breakpoint
ALTER TABLE "survey_engagement_capture_events" DROP CONSTRAINT "survey_engagement_capture_events_user_id_tenant_id_users_id_tenant_id_fk";
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_engagement_answer_revisions" ADD CONSTRAINT "engagement_answer_event_fk" FOREIGN KEY ("tenant_id","user_id","inbound_receipt_id") REFERENCES "public"."survey_engagement_capture_events"("tenant_id","user_id","inbound_receipt_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_engagement_answer_revisions" ADD CONSTRAINT "engagement_answer_lineage_fk" FOREIGN KEY ("tenant_id","user_id","lineage_id") REFERENCES "public"."survey_report_question_lineages"("tenant_id","user_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_engagement_capture_events" ADD CONSTRAINT "engagement_event_subject_fk" FOREIGN KEY ("user_id","tenant_id") REFERENCES "public"."users"("id","tenant_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
