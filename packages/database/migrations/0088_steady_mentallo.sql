CREATE TABLE IF NOT EXISTS "survey_report_scope_observations" (
	"tenant_id" uuid NOT NULL,
	"cycle_id" uuid NOT NULL,
	"scope_id" uuid PRIMARY KEY NOT NULL,
	"observed_generation" bigint,
	"next_observation_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"scan_cursor_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_report_scope_observations" ADD CONSTRAINT "survey_report_scope_observations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_report_scope_observations" ADD CONSTRAINT "survey_report_scope_observations_tenant_id_cycle_id_scope_id_survey_report_scopes_tenant_id_cycle_scoring_policy_id_id_fk" FOREIGN KEY ("tenant_id","cycle_id","scope_id") REFERENCES "public"."survey_report_scopes"("tenant_id","cycle_scoring_policy_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION pulse_publication_wakeup() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM tenants WHERE id=NEW.tenant_id) THEN RETURN NEW; END IF;
 INSERT INTO survey_report_observations(tenant_id,cycle_id,generation) VALUES(NEW.tenant_id,NEW.cycle_id,NEW.generation)
 ON CONFLICT(tenant_id,cycle_id) DO UPDATE SET generation=EXCLUDED.generation,next_observation_at=least(survey_report_observations.next_observation_at,clock_timestamp());
 UPDATE survey_report_scope_observations SET next_observation_at=least(next_observation_at,clock_timestamp()) WHERE tenant_id=NEW.tenant_id AND cycle_id=NEW.cycle_id;
 RETURN NEW;
END $$;
