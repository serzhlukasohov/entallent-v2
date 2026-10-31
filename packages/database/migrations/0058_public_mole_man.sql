ALTER TABLE "survey_report_scope_memberships" DROP CONSTRAINT IF EXISTS "survey_report_scope_memberships_tenant_id_cycle_scoring_policy_id_scope_id_survey_report_scopes_tenant_id_cycle_scoring_policy_id_id_fk";
--> statement-breakpoint
ALTER TABLE "survey_report_scope_memberships" DROP CONSTRAINT IF EXISTS "survey_report_scope_memberships_tenant_id_cycle_scoring_policy_id_participant_id_survey_report_participants_tenant_id_cycle_scoring_policy_id_id_fk";
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_report_scope_memberships" ADD CONSTRAINT "report_membership_scope_fk" FOREIGN KEY ("tenant_id","cycle_scoring_policy_id","scope_id") REFERENCES "public"."survey_report_scopes"("tenant_id","cycle_scoring_policy_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_report_scope_memberships" ADD CONSTRAINT "report_membership_participant_fk" FOREIGN KEY ("tenant_id","cycle_scoring_policy_id","participant_id") REFERENCES "public"."survey_report_participants"("tenant_id","cycle_scoring_policy_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
