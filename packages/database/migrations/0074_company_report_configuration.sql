CREATE TABLE IF NOT EXISTS "survey_report_final_timings" (
	"tenant_id" uuid NOT NULL,
	"cycle_scoring_policy_id" uuid NOT NULL,
	"config_revision" integer NOT NULL,
	"algorithm_version" text NOT NULL,
	"status" text NOT NULL,
	"blocked_reason" text,
	"timezone" text,
	"local_date" text,
	"local_work_end" text,
	"final_due_at" timestamp with time zone,
	"formation_started_at" timestamp with time zone,
	"report_data_cutoff" timestamp with time zone,
	CONSTRAINT "survey_report_final_timings_tenant_id_cycle_scoring_policy_id_pk" PRIMARY KEY("tenant_id","cycle_scoring_policy_id"),
	CONSTRAINT "report_final_timing_shape" CHECK (("survey_report_final_timings"."status" = 'blocked' AND "survey_report_final_timings"."blocked_reason" IS NOT NULL AND "survey_report_final_timings"."blocked_reason" IN ('missing_calendar','invalid_calendar','invalid_locale','source_out_of_sync','invalid_cycle','no_working_close_in_cycle','nonexistent_work_end','ambiguous_work_end') AND "survey_report_final_timings"."final_due_at" IS NULL AND "survey_report_final_timings"."formation_started_at" IS NULL AND "survey_report_final_timings"."report_data_cutoff" IS NULL) OR ("survey_report_final_timings"."status" IN ('scheduled','started') AND "survey_report_final_timings"."blocked_reason" IS NULL AND "survey_report_final_timings"."timezone" IS NOT NULL AND "survey_report_final_timings"."local_date" IS NOT NULL AND "survey_report_final_timings"."local_work_end" IS NOT NULL AND "survey_report_final_timings"."final_due_at" IS NOT NULL AND (("survey_report_final_timings"."status" = 'scheduled' AND "survey_report_final_timings"."formation_started_at" IS NULL AND "survey_report_final_timings"."report_data_cutoff" IS NULL) OR ("survey_report_final_timings"."status" = 'started' AND "survey_report_final_timings"."formation_started_at" IS NOT NULL AND "survey_report_final_timings"."report_data_cutoff" IS NOT NULL AND "survey_report_final_timings"."report_data_cutoff" = "survey_report_final_timings"."formation_started_at" AND "survey_report_final_timings"."formation_started_at" >= "survey_report_final_timings"."final_due_at"))))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tenant_report_config_revisions" (
	"tenant_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"locale" text,
	"calendar" jsonb,
	"unavailable_reason" text,
	"source_fingerprint" text NOT NULL,
	"captured_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	CONSTRAINT "tenant_report_config_revisions_tenant_id_revision_pk" PRIMARY KEY("tenant_id","revision"),
	CONSTRAINT "report_config_readiness" CHECK ("tenant_report_config_revisions"."revision" > 0 AND ("tenant_report_config_revisions"."unavailable_reason" IS NULL AND "tenant_report_config_revisions"."locale" IS NOT NULL AND "tenant_report_config_revisions"."calendar" IS NOT NULL OR "tenant_report_config_revisions"."unavailable_reason" IS NOT NULL AND "tenant_report_config_revisions"."unavailable_reason" IN ('missing_calendar','invalid_calendar','invalid_locale')))
);
--> statement-breakpoint
ALTER TABLE "tenant_work_calendars" ADD COLUMN "holidays" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_work_calendars" ADD COLUMN "date_overrides" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_report_final_timings" ADD CONSTRAINT "survey_report_final_timings_tenant_id_cycle_scoring_policy_id_survey_report_cycle_openings_tenant_id_cycle_scoring_policy_id_fk" FOREIGN KEY ("tenant_id","cycle_scoring_policy_id") REFERENCES "public"."survey_report_cycle_openings"("tenant_id","cycle_scoring_policy_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_report_final_timings" ADD CONSTRAINT "survey_report_final_timings_tenant_id_config_revision_tenant_report_config_revisions_tenant_id_revision_fk" FOREIGN KEY ("tenant_id","config_revision") REFERENCES "public"."tenant_report_config_revisions"("tenant_id","revision") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tenant_report_config_revisions" ADD CONSTRAINT "tenant_report_config_revisions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE FUNCTION report_calendar_tenant_lock() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM tenants WHERE id=COALESCE(NEW.tenant_id, OLD.tenant_id) FOR NO KEY UPDATE;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF TG_OP='UPDATE' AND NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN RAISE EXCEPTION 'calendar tenant immutable' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER report_calendar_lock BEFORE INSERT OR UPDATE OR DELETE ON tenant_work_calendars FOR EACH ROW EXECUTE FUNCTION report_calendar_tenant_lock();
--> statement-breakpoint
CREATE FUNCTION report_config_revision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM tenants WHERE id=OLD.tenant_id) THEN RETURN OLD; END IF;
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'report config revisions immutable' USING ERRCODE='23514'; END IF;
 PERFORM 1 FROM tenants WHERE id=NEW.tenant_id FOR NO KEY UPDATE;
 IF NEW.revision<>(SELECT COALESCE(max(revision),0)+1 FROM tenant_report_config_revisions WHERE tenant_id=NEW.tenant_id) THEN RAISE EXCEPTION 'report config revision sequence' USING ERRCODE='23514'; END IF;
 NEW.captured_at:=clock_timestamp();
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER report_config_revision_immutable BEFORE INSERT OR UPDATE OR DELETE ON tenant_report_config_revisions FOR EACH ROW EXECUTE FUNCTION report_config_revision_guard();
--> statement-breakpoint
CREATE FUNCTION report_final_timing_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c survey_cycle_scoring_policies%ROWTYPE; first_clock timestamptz;
BEGIN
 IF TG_OP='DELETE' THEN
   IF EXISTS(SELECT 1 FROM tenants WHERE id=OLD.tenant_id) THEN RAISE EXCEPTION 'report timing deletion forbidden' USING ERRCODE='23514'; END IF;
   RETURN OLD;
 END IF;
 PERFORM 1 FROM tenants WHERE id=NEW.tenant_id FOR NO KEY UPDATE;
 SELECT * INTO STRICT c FROM survey_cycle_scoring_policies WHERE tenant_id=NEW.tenant_id AND id=NEW.cycle_scoring_policy_id;
 PERFORM pg_advisory_xact_lock(hashtextextended(c.tenant_id::text||':'||c.survey_definition_id::text||':'||c.period_start::text||':'||c.period_end::text,0));
 IF TG_OP='UPDATE' AND OLD.status='started' THEN
   IF NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'started report timing immutable' USING ERRCODE='23514'; END IF;
   RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' AND (NEW.tenant_id,NEW.cycle_scoring_policy_id) IS DISTINCT FROM (OLD.tenant_id,OLD.cycle_scoring_policy_id) THEN RAISE EXCEPTION 'report timing identity immutable' USING ERRCODE='23514'; END IF;
 IF NEW.algorithm_version<>'company-working-close-v1' THEN RAISE EXCEPTION 'report timing algorithm invalid' USING ERRCODE='23514'; END IF;
 IF NEW.final_due_at IS NOT NULL AND NOT (c.period_start<NEW.final_due_at AND NEW.final_due_at<=c.period_end) THEN RAISE EXCEPTION 'report due outside cycle' USING ERRCODE='23514'; END IF;
 IF NEW.status='started' THEN
   IF TG_OP='INSERT' OR OLD.status<>'scheduled' THEN RAISE EXCEPTION 'report must start from scheduled plan' USING ERRCODE='23514'; END IF;
   IF NEW.formation_started_at IS NOT NULL OR NEW.report_data_cutoff IS NOT NULL THEN RAISE EXCEPTION 'caller report clock forbidden' USING ERRCODE='23514'; END IF;
   IF (NEW.config_revision,NEW.algorithm_version,NEW.blocked_reason,NEW.timezone,NEW.local_date,NEW.local_work_end,NEW.final_due_at) IS DISTINCT FROM (OLD.config_revision,OLD.algorithm_version,OLD.blocked_reason,OLD.timezone,OLD.local_date,OLD.local_work_end,OLD.final_due_at) THEN RAISE EXCEPTION 'report start context changed' USING ERRCODE='23514'; END IF;
   first_clock:=clock_timestamp();
   IF first_clock<NEW.final_due_at THEN RAISE EXCEPTION 'report not due' USING ERRCODE='23514'; END IF;
   NEW.formation_started_at:=first_clock; NEW.report_data_cutoff:=first_clock;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER report_final_timing_enforced BEFORE INSERT OR UPDATE OR DELETE ON survey_report_final_timings FOR EACH ROW EXECUTE FUNCTION report_final_timing_guard();
