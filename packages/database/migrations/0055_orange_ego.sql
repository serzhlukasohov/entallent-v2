CREATE TABLE IF NOT EXISTS "survey_report_legacy_cycle_openings" (
	"tenant_id" uuid NOT NULL,
	"survey_definition_id" uuid NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	CONSTRAINT "survey_report_legacy_cycle_openings_tenant_id_survey_definition_id_period_start_period_end_pk" PRIMARY KEY("tenant_id","survey_definition_id","period_start","period_end")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_report_legacy_cycle_openings" ADD CONSTRAINT "survey_report_legacy_cycle_openings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION pulse_report_binding_guard() RETURNS trigger AS $$
DECLARE w survey_windows%ROWTYPE; p survey_report_participants%ROWTYPE; c survey_cycle_scoring_policies%ROWTYPE;
BEGIN
 IF TG_OP = 'DELETE' AND (NOT EXISTS (SELECT 1 FROM survey_windows WHERE id = OLD.survey_window_id) OR NOT EXISTS (SELECT 1 FROM users u JOIN survey_report_participants erased_participant ON erased_participant.user_id = u.id AND erased_participant.tenant_id = u.tenant_id WHERE erased_participant.id = OLD.participant_id)) THEN RETURN OLD; END IF;
 IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'pulse_report_binding_immutable'; END IF;
 SELECT * INTO w FROM survey_windows WHERE id = NEW.survey_window_id;
 SELECT * INTO p FROM survey_report_participants WHERE id = NEW.participant_id AND tenant_id = NEW.tenant_id AND cycle_scoring_policy_id = NEW.cycle_scoring_policy_id;
 SELECT * INTO c FROM survey_cycle_scoring_policies WHERE id = NEW.cycle_scoring_policy_id AND tenant_id = NEW.tenant_id;
 IF w.id IS NULL OR p.id IS NULL OR c.id IS NULL OR w.tenant_id <> NEW.tenant_id OR w.user_id <> p.user_id OR w.survey_definition_id <> c.survey_definition_id OR w.period_start <> c.period_start OR w.period_end <> c.period_end
 OR w.reporting_cohort_id IS NOT NULL OR w.reporting_team_id IS NOT NULL OR cardinality(w.reporting_roster_user_ids) <> 0
 OR NOT EXISTS (SELECT 1 FROM survey_window_scoring_policies b WHERE b.survey_window_id = w.id AND b.tenant_id = NEW.tenant_id AND b.scoring_policy_id = c.scoring_policy_id) THEN RAISE EXCEPTION 'pulse_report_window_binding_mismatch'; END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION pulse_report_opening_guard() RETURNS trigger AS $$
DECLARE cycle survey_cycle_scoring_policies%ROWTYPE;
BEGIN
 IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) THEN RETURN OLD; END IF;
 IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'pulse_report_opening_immutable'; END IF;
 SELECT * INTO cycle FROM survey_cycle_scoring_policies WHERE id = NEW.cycle_scoring_policy_id AND tenant_id = NEW.tenant_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'pulse_report_cycle_scope_mismatch'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(cycle.tenant_id::text || ':' || cycle.survey_definition_id::text || ':' || cycle.period_start::text || ':' || cycle.period_end::text, 0));
 IF EXISTS (SELECT 1 FROM survey_report_legacy_cycle_openings WHERE tenant_id = cycle.tenant_id AND survey_definition_id = cycle.survey_definition_id AND period_start = cycle.period_start AND period_end = cycle.period_end) OR EXISTS (SELECT 1 FROM survey_reporting_cohorts WHERE tenant_id = cycle.tenant_id AND survey_definition_id = cycle.survey_definition_id AND period_start = cycle.period_start AND period_end = cycle.period_end)
 OR EXISTS (SELECT 1 FROM survey_windows WHERE tenant_id = cycle.tenant_id AND survey_definition_id = cycle.survey_definition_id AND period_start = cycle.period_start AND period_end = cycle.period_end) THEN RAISE EXCEPTION 'pulse_report_scope_mode_conflict'; END IF;
 NEW.opened_at := clock_timestamp();
 IF NEW.opened_at < cycle.period_start OR NEW.opened_at >= cycle.period_end THEN RAISE EXCEPTION 'pulse_report_opening_outside_cycle'; END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION pulse_report_negative_state_guard() RETURNS trigger AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN
   IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) OR NOT EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id AND tenant_id = OLD.tenant_id) THEN RETURN OLD; END IF;
   RAISE EXCEPTION 'pulse_report_suppression_retained';
 END IF;
 IF TG_TABLE_NAME = 'survey_reporting_permissions' THEN
   IF NEW.tenant_id <> OLD.tenant_id OR NEW.user_id <> OLD.user_id OR NEW.revision <= OLD.revision OR (OLD.full_reporting_denied AND (NOT NEW.full_reporting_denied OR NEW.denied_at IS DISTINCT FROM OLD.denied_at)) THEN RAISE EXCEPTION 'pulse_report_permission_not_monotonic'; END IF;
   RETURN NEW;
 END IF;
 RAISE EXCEPTION 'pulse_report_rights_record_immutable';
END; $$ LANGUAGE plpgsql;

--> statement-breakpoint
CREATE TRIGGER report_legacy_opening_guard BEFORE INSERT ON survey_report_legacy_cycle_openings FOR EACH ROW EXECUTE FUNCTION pulse_report_legacy_mode_guard();
