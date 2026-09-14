ALTER TABLE "survey_windows" ADD COLUMN "reporting_team_id" uuid;--> statement-breakpoint
ALTER TABLE "survey_windows" ADD COLUMN "reporting_roster_user_ids" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_windows" ADD CONSTRAINT "survey_windows_reporting_team_id_teams_id_fk" FOREIGN KEY ("reporting_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
