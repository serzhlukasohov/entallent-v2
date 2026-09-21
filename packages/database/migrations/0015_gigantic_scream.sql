CREATE TABLE IF NOT EXISTS "survey_reporting_cohorts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"survey_definition_id" uuid NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"roster_user_ids" uuid[] NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	CONSTRAINT "survey_reporting_cohorts_scope_unique" UNIQUE("tenant_id","team_id","survey_definition_id","period_start","period_end")
);
--> statement-breakpoint
ALTER TABLE "survey_windows" ADD COLUMN "reporting_cohort_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_reporting_cohorts" ADD CONSTRAINT "survey_reporting_cohorts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_reporting_cohorts" ADD CONSTRAINT "survey_reporting_cohorts_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_reporting_cohorts" ADD CONSTRAINT "survey_reporting_cohorts_survey_definition_id_survey_definitions_id_fk" FOREIGN KEY ("survey_definition_id") REFERENCES "public"."survey_definitions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_windows" ADD CONSTRAINT "survey_windows_reporting_cohort_id_survey_reporting_cohorts_id_fk" FOREIGN KEY ("reporting_cohort_id") REFERENCES "public"."survey_reporting_cohorts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
