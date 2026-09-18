CREATE TABLE IF NOT EXISTS "survey_report_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"reporting_cohort_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"question_group" text NOT NULL,
	"snapshot_version" integer DEFAULT 1 NOT NULL,
	"status" text NOT NULL,
	"manager_payload" jsonb NOT NULL,
	"contributor_user_ids" uuid[] NOT NULL,
	"source_group_state_ids" uuid[] NOT NULL,
	"policy_version" text NOT NULL,
	"workspace_connection_id" uuid,
	"manager_slack_user_id" text,
	"slack_external_message_id" text,
	"failure_reason" text,
	"delivery_attempted_at" timestamp with time zone,
	"status_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_report_snapshots" ADD CONSTRAINT "survey_report_snapshots_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_report_snapshots" ADD CONSTRAINT "survey_report_snapshots_reporting_cohort_id_survey_reporting_cohorts_id_fk" FOREIGN KEY ("reporting_cohort_id") REFERENCES "public"."survey_reporting_cohorts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_report_snapshots" ADD CONSTRAINT "survey_report_snapshots_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_report_snapshots" ADD CONSTRAINT "survey_report_snapshots_workspace_connection_id_workspace_connections_id_fk" FOREIGN KEY ("workspace_connection_id") REFERENCES "public"."workspace_connections"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "survey_report_snapshots_first_non_cancelled_unique" ON "survey_report_snapshots" USING btree ("tenant_id","reporting_cohort_id","question_group","snapshot_version") WHERE "survey_report_snapshots"."status" <> 'cancelled';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "survey_report_snapshots_scope_idx" ON "survey_report_snapshots" USING btree ("tenant_id","reporting_cohort_id","question_group");