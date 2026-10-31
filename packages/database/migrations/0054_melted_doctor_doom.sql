CREATE TABLE IF NOT EXISTS "survey_report_cycle_openings" (
	"cycle_scoring_policy_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"scope_contract_version" text DEFAULT 'org-native-v1' NOT NULL,
	CONSTRAINT "report_opening_tenant_cycle" UNIQUE("tenant_id","cycle_scoring_policy_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "survey_report_insight_revisions" (
	"insight_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"lineage_id" uuid NOT NULL,
	"permission_revision" integer DEFAULT 0 NOT NULL,
	"accepted_source_receipts" jsonb,
	"confirmation_message_id" uuid,
	"confirmation_received_at" timestamp with time zone,
	"proof_status" text DEFAULT 'unverified_historical' NOT NULL,
	CONSTRAINT "report_revision_proof" CHECK ("survey_report_insight_revisions"."proof_status" IN ('receipt_backed', 'unverified_historical', 'legacy'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "survey_report_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"cycle_scoring_policy_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"opening_role" text NOT NULL,
	"origin_unit_id" uuid NOT NULL,
	"origin_team_id" uuid NOT NULL,
	"collection_stopped_at" timestamp with time zone,
	"collection_stop_cause" text,
	"collection_stop_mutation_id" uuid,
	CONSTRAINT "report_participant_tenant_cycle_id" UNIQUE("tenant_id","cycle_scoring_policy_id","id"),
	CONSTRAINT "report_participant_person_cycle" UNIQUE("tenant_id","cycle_scoring_policy_id","person_id"),
	CONSTRAINT "report_participant_user_cycle" UNIQUE("tenant_id","cycle_scoring_policy_id","user_id"),
	CONSTRAINT "report_participant_role" CHECK ("survey_report_participants"."opening_role" IN ('employee', 'team_lead') AND "survey_report_participants"."person_id" = "survey_report_participants"."user_id"),
	CONSTRAINT "report_participant_stop" CHECK (("survey_report_participants"."collection_stopped_at" IS NULL AND "survey_report_participants"."collection_stop_cause" IS NULL AND "survey_report_participants"."collection_stop_mutation_id" IS NULL) OR ("survey_report_participants"."collection_stopped_at" IS NOT NULL AND "survey_report_participants"."collection_stop_cause" IN ('moved', 'promoted', 'deactivated', 'team_changed', 'unit_changed') AND "survey_report_participants"."collection_stop_mutation_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "survey_report_question_lineages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"cycle_scoring_policy_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"question_stable_key" text NOT NULL,
	"survey_question_id" uuid NOT NULL,
	"question_version" text NOT NULL,
	"scoring_policy_id" uuid NOT NULL,
	CONSTRAINT "report_lineage_natural" UNIQUE("tenant_id","cycle_scoring_policy_id","user_id","question_stable_key"),
	CONSTRAINT "report_lineage_subject_id" UNIQUE("tenant_id","user_id","id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "survey_report_scope_memberships" (
	"tenant_id" uuid NOT NULL,
	"cycle_scoring_policy_id" uuid NOT NULL,
	"scope_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	CONSTRAINT "survey_report_scope_memberships_scope_id_participant_id_pk" PRIMARY KEY("scope_id","participant_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "survey_report_scopes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"cycle_scoring_policy_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"org_unit_id" uuid NOT NULL,
	"org_team_id" uuid,
	"parent_scope_id" uuid,
	"label" text NOT NULL,
	"opening_owner_person_id" uuid,
	"history_key" text NOT NULL,
	"boundary_fingerprint" text NOT NULL,
	CONSTRAINT "report_scope_tenant_cycle_id" UNIQUE("tenant_id","cycle_scoring_policy_id","id"),
	CONSTRAINT "report_scope_natural" UNIQUE("tenant_id","cycle_scoring_policy_id","history_key"),
	CONSTRAINT "report_scope_kind_check" CHECK (("survey_report_scopes"."kind" = 'team' AND "survey_report_scopes"."org_team_id" IS NOT NULL AND "survey_report_scopes"."parent_scope_id" IS NOT NULL) OR ("survey_report_scopes"."kind" = 'manager_overall' AND "survey_report_scopes"."org_team_id" IS NULL AND "survey_report_scopes"."parent_scope_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "survey_report_window_bindings" (
	"survey_window_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"cycle_scoring_policy_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	CONSTRAINT "report_participant_one_window" UNIQUE("tenant_id","cycle_scoring_policy_id","participant_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "survey_reporting_lineage_exclusions" (
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"lineage_id" uuid PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"excluded_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "survey_reporting_permissions" (
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"full_reporting_denied" boolean DEFAULT false NOT NULL,
	"denied_at" timestamp with time zone,
	CONSTRAINT "survey_reporting_permissions_tenant_id_user_id_pk" PRIMARY KEY("tenant_id","user_id"),
	CONSTRAINT "report_permission_denial" CHECK ("survey_reporting_permissions"."revision" >= 0 AND ("survey_reporting_permissions"."full_reporting_denied" = ("survey_reporting_permissions"."denied_at" IS NOT NULL)))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "survey_reporting_withdrawal_requests" (
	"tenant_id" uuid NOT NULL,
	"request_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"target_kind" text NOT NULL,
	"lineage_ids" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
	"provenance_kind" text NOT NULL,
	"verification_id" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"permission_revision" integer NOT NULL,
	CONSTRAINT "survey_reporting_withdrawal_requests_tenant_id_request_id_pk" PRIMARY KEY("tenant_id","request_id"),
	CONSTRAINT "report_withdrawal_target" CHECK (("survey_reporting_withdrawal_requests"."target_kind" = 'full_reporting' AND cardinality("survey_reporting_withdrawal_requests"."lineage_ids") = 0) OR ("survey_reporting_withdrawal_requests"."target_kind" = 'partial_reporting' AND cardinality("survey_reporting_withdrawal_requests"."lineage_ids") > 0)),
	CONSTRAINT "report_withdrawal_proof" CHECK ("survey_reporting_withdrawal_requests"."provenance_kind" IN ('verified_subject', 'authorized_internal_rights_request') AND btrim("survey_reporting_withdrawal_requests"."verification_id") <> '' AND "survey_reporting_withdrawal_requests"."person_id" = "survey_reporting_withdrawal_requests"."user_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_report_cycle_openings" ADD CONSTRAINT "survey_report_cycle_openings_cycle_scoring_policy_id_survey_cycle_scoring_policies_id_fk" FOREIGN KEY ("cycle_scoring_policy_id") REFERENCES "public"."survey_cycle_scoring_policies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_report_cycle_openings" ADD CONSTRAINT "survey_report_cycle_openings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_report_insight_revisions" ADD CONSTRAINT "survey_report_insight_revisions_insight_id_survey_question_insights_id_fk" FOREIGN KEY ("insight_id") REFERENCES "public"."survey_question_insights"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_report_insight_revisions" ADD CONSTRAINT "survey_report_insight_revisions_tenant_id_user_id_lineage_id_survey_report_question_lineages_tenant_id_user_id_id_fk" FOREIGN KEY ("tenant_id","user_id","lineage_id") REFERENCES "public"."survey_report_question_lineages"("tenant_id","user_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_report_participants" ADD CONSTRAINT "survey_report_participants_tenant_id_cycle_scoring_policy_id_survey_report_cycle_openings_tenant_id_cycle_scoring_policy_id_fk" FOREIGN KEY ("tenant_id","cycle_scoring_policy_id") REFERENCES "public"."survey_report_cycle_openings"("tenant_id","cycle_scoring_policy_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_report_participants" ADD CONSTRAINT "survey_report_participants_user_id_tenant_id_users_id_tenant_id_fk" FOREIGN KEY ("user_id","tenant_id") REFERENCES "public"."users"("id","tenant_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_report_question_lineages" ADD CONSTRAINT "survey_report_question_lineages_cycle_scoring_policy_id_survey_cycle_scoring_policies_id_fk" FOREIGN KEY ("cycle_scoring_policy_id") REFERENCES "public"."survey_cycle_scoring_policies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_report_question_lineages" ADD CONSTRAINT "survey_report_question_lineages_user_id_tenant_id_users_id_tenant_id_fk" FOREIGN KEY ("user_id","tenant_id") REFERENCES "public"."users"("id","tenant_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_report_scope_memberships" ADD CONSTRAINT "survey_report_scope_memberships_tenant_id_cycle_scoring_policy_id_scope_id_survey_report_scopes_tenant_id_cycle_scoring_policy_id_id_fk" FOREIGN KEY ("tenant_id","cycle_scoring_policy_id","scope_id") REFERENCES "public"."survey_report_scopes"("tenant_id","cycle_scoring_policy_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_report_scope_memberships" ADD CONSTRAINT "survey_report_scope_memberships_tenant_id_cycle_scoring_policy_id_participant_id_survey_report_participants_tenant_id_cycle_scoring_policy_id_id_fk" FOREIGN KEY ("tenant_id","cycle_scoring_policy_id","participant_id") REFERENCES "public"."survey_report_participants"("tenant_id","cycle_scoring_policy_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_report_scopes" ADD CONSTRAINT "survey_report_scopes_tenant_id_cycle_scoring_policy_id_survey_report_cycle_openings_tenant_id_cycle_scoring_policy_id_fk" FOREIGN KEY ("tenant_id","cycle_scoring_policy_id") REFERENCES "public"."survey_report_cycle_openings"("tenant_id","cycle_scoring_policy_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_report_window_bindings" ADD CONSTRAINT "survey_report_window_bindings_survey_window_id_survey_windows_id_fk" FOREIGN KEY ("survey_window_id") REFERENCES "public"."survey_windows"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_report_window_bindings" ADD CONSTRAINT "survey_report_window_bindings_tenant_id_cycle_scoring_policy_id_participant_id_survey_report_participants_tenant_id_cycle_scoring_policy_id_id_fk" FOREIGN KEY ("tenant_id","cycle_scoring_policy_id","participant_id") REFERENCES "public"."survey_report_participants"("tenant_id","cycle_scoring_policy_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_reporting_lineage_exclusions" ADD CONSTRAINT "survey_reporting_lineage_exclusions_tenant_id_user_id_lineage_id_survey_report_question_lineages_tenant_id_user_id_id_fk" FOREIGN KEY ("tenant_id","user_id","lineage_id") REFERENCES "public"."survey_report_question_lineages"("tenant_id","user_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_reporting_lineage_exclusions" ADD CONSTRAINT "survey_reporting_lineage_exclusions_tenant_id_request_id_survey_reporting_withdrawal_requests_tenant_id_request_id_fk" FOREIGN KEY ("tenant_id","request_id") REFERENCES "public"."survey_reporting_withdrawal_requests"("tenant_id","request_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_reporting_permissions" ADD CONSTRAINT "survey_reporting_permissions_user_id_tenant_id_users_id_tenant_id_fk" FOREIGN KEY ("user_id","tenant_id") REFERENCES "public"."users"("id","tenant_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_reporting_withdrawal_requests" ADD CONSTRAINT "survey_reporting_withdrawal_requests_user_id_tenant_id_users_id_tenant_id_fk" FOREIGN KEY ("user_id","tenant_id") REFERENCES "public"."users"("id","tenant_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
-- Frozen affiliation is append-only in the opening transaction. User/tenant erasure remains legal.
CREATE FUNCTION pulse_report_frozen_guard() RETURNS trigger AS $$
DECLARE opening_xid text;
BEGIN
 IF TG_OP = 'DELETE' THEN
   IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) THEN RETURN OLD; END IF;
   IF TG_TABLE_NAME = 'survey_report_participants' AND NOT EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id AND tenant_id = OLD.tenant_id) THEN RETURN OLD; END IF;
   IF TG_TABLE_NAME = 'survey_report_scope_memberships' AND NOT EXISTS (SELECT 1 FROM survey_report_participants WHERE id = OLD.participant_id) THEN RETURN OLD; END IF;
   RAISE EXCEPTION 'pulse_report_frozen_delete';
 END IF;
 IF TG_OP = 'UPDATE' THEN
   IF TG_TABLE_NAME = 'survey_report_participants' THEN
     IF (to_jsonb(NEW) - ARRAY['collection_stopped_at','collection_stop_cause','collection_stop_mutation_id']) = (to_jsonb(OLD) - ARRAY['collection_stopped_at','collection_stop_cause','collection_stop_mutation_id'])
       AND (OLD.collection_stopped_at IS NULL OR (NEW.collection_stopped_at IS NOT NULL AND NEW.collection_stopped_at <= OLD.collection_stopped_at)) THEN RETURN NEW; END IF;
   END IF;
   RAISE EXCEPTION 'pulse_report_frozen_update';
 END IF;
 SELECT xmin::text INTO opening_xid FROM survey_report_cycle_openings WHERE tenant_id = NEW.tenant_id AND cycle_scoring_policy_id = NEW.cycle_scoring_policy_id;
 IF opening_xid IS DISTINCT FROM pg_current_xact_id()::text THEN RAISE EXCEPTION 'pulse_report_snapshot_sealed'; END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER report_scope_frozen BEFORE INSERT OR UPDATE OR DELETE ON survey_report_scopes FOR EACH ROW EXECUTE FUNCTION pulse_report_frozen_guard();
CREATE TRIGGER report_participant_frozen BEFORE INSERT OR UPDATE OR DELETE ON survey_report_participants FOR EACH ROW EXECUTE FUNCTION pulse_report_frozen_guard();
CREATE TRIGGER report_membership_frozen BEFORE INSERT OR UPDATE OR DELETE ON survey_report_scope_memberships FOR EACH ROW EXECUTE FUNCTION pulse_report_frozen_guard();
--> statement-breakpoint
CREATE FUNCTION pulse_report_opening_guard() RETURNS trigger AS $$
DECLARE cycle survey_cycle_scoring_policies%ROWTYPE;
BEGIN
 IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) THEN RETURN OLD; END IF;
 IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'pulse_report_opening_immutable'; END IF;
 SELECT * INTO cycle FROM survey_cycle_scoring_policies WHERE id = NEW.cycle_scoring_policy_id AND tenant_id = NEW.tenant_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'pulse_report_cycle_scope_mismatch'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(cycle.tenant_id::text || ':' || cycle.survey_definition_id::text || ':' || cycle.period_start::text || ':' || cycle.period_end::text, 0));
 IF EXISTS (SELECT 1 FROM survey_reporting_cohorts WHERE tenant_id = cycle.tenant_id AND survey_definition_id = cycle.survey_definition_id AND period_start = cycle.period_start AND period_end = cycle.period_end)
 OR EXISTS (SELECT 1 FROM survey_windows WHERE tenant_id = cycle.tenant_id AND survey_definition_id = cycle.survey_definition_id AND period_start = cycle.period_start AND period_end = cycle.period_end) THEN RAISE EXCEPTION 'pulse_report_scope_mode_conflict'; END IF;
 NEW.opened_at := clock_timestamp();
 IF NEW.opened_at < cycle.period_start OR NEW.opened_at >= cycle.period_end THEN RAISE EXCEPTION 'pulse_report_opening_outside_cycle'; END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER report_opening_guard BEFORE INSERT OR UPDATE OR DELETE ON survey_report_cycle_openings FOR EACH ROW EXECUTE FUNCTION pulse_report_opening_guard();
--> statement-breakpoint
CREATE FUNCTION pulse_report_legacy_mode_guard() RETURNS trigger AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text || ':' || NEW.survey_definition_id::text || ':' || NEW.period_start::text || ':' || NEW.period_end::text, 0));
 IF EXISTS (SELECT 1 FROM survey_report_cycle_openings o JOIN survey_cycle_scoring_policies c ON c.id = o.cycle_scoring_policy_id AND c.tenant_id = o.tenant_id WHERE c.tenant_id = NEW.tenant_id AND c.survey_definition_id = NEW.survey_definition_id AND c.period_start = NEW.period_start AND c.period_end = NEW.period_end) THEN RAISE EXCEPTION 'pulse_report_scope_mode_conflict'; END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER report_legacy_mode_guard BEFORE INSERT ON survey_reporting_cohorts FOR EACH ROW EXECUTE FUNCTION pulse_report_legacy_mode_guard();
--> statement-breakpoint
CREATE FUNCTION pulse_report_lineage(window_id uuid, question_id uuid) RETURNS uuid AS $$
DECLARE lineage uuid; w survey_windows%ROWTYPE; q survey_questions%ROWTYPE; c survey_cycle_scoring_policies%ROWTYPE;
BEGIN
 SELECT * INTO w FROM survey_windows WHERE id = window_id;
 SELECT * INTO q FROM survey_questions WHERE id = question_id AND survey_definition_id = w.survey_definition_id AND response_type = 'open_ended';
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT cycle.* INTO c FROM survey_cycle_scoring_policies cycle JOIN survey_window_scoring_policies b ON b.survey_window_id = w.id AND b.tenant_id = w.tenant_id AND b.scoring_policy_id = cycle.scoring_policy_id
 JOIN survey_scoring_policies policy ON policy.id = cycle.scoring_policy_id AND policy.tenant_id = cycle.tenant_id
 WHERE cycle.tenant_id = w.tenant_id AND cycle.survey_definition_id = w.survey_definition_id AND cycle.period_start = w.period_start AND cycle.period_end = w.period_end AND jsonb_typeof(policy.rubrics -> q.stable_key) = 'object';
 IF NOT FOUND THEN RETURN NULL; END IF;
 INSERT INTO survey_report_question_lineages(tenant_id, cycle_scoring_policy_id, user_id, question_stable_key, survey_question_id, question_version, scoring_policy_id)
 VALUES(w.tenant_id, c.id, w.user_id, q.stable_key, q.id, q.version, c.scoring_policy_id)
 ON CONFLICT (tenant_id, cycle_scoring_policy_id, user_id, question_stable_key) DO NOTHING;
 SELECT id INTO lineage FROM survey_report_question_lineages WHERE tenant_id = w.tenant_id AND cycle_scoring_policy_id = c.id AND user_id = w.user_id AND question_stable_key = q.stable_key AND survey_question_id = q.id AND question_version = q.version AND scoring_policy_id = c.scoring_policy_id;
 RETURN lineage;
END; $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE FUNCTION pulse_report_binding_guard() RETURNS trigger AS $$
DECLARE w survey_windows%ROWTYPE; p survey_report_participants%ROWTYPE; c survey_cycle_scoring_policies%ROWTYPE;
BEGIN
 IF TG_OP = 'DELETE' AND (NOT EXISTS (SELECT 1 FROM survey_windows WHERE id = OLD.survey_window_id) OR NOT EXISTS (SELECT 1 FROM users u JOIN survey_report_participants p ON p.user_id = u.id AND p.tenant_id = u.tenant_id WHERE p.id = OLD.participant_id)) THEN RETURN OLD; END IF;
 IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'pulse_report_binding_immutable'; END IF;
 SELECT * INTO w FROM survey_windows WHERE id = NEW.survey_window_id;
 SELECT * INTO p FROM survey_report_participants WHERE id = NEW.participant_id AND tenant_id = NEW.tenant_id AND cycle_scoring_policy_id = NEW.cycle_scoring_policy_id;
 SELECT * INTO c FROM survey_cycle_scoring_policies WHERE id = NEW.cycle_scoring_policy_id AND tenant_id = NEW.tenant_id;
 IF w.id IS NULL OR p.id IS NULL OR c.id IS NULL OR w.tenant_id <> NEW.tenant_id OR w.user_id <> p.user_id OR w.survey_definition_id <> c.survey_definition_id OR w.period_start <> c.period_start OR w.period_end <> c.period_end
 OR w.reporting_cohort_id IS NOT NULL OR w.reporting_team_id IS NOT NULL OR cardinality(w.reporting_roster_user_ids) <> 0
 OR NOT EXISTS (SELECT 1 FROM survey_window_scoring_policies b WHERE b.survey_window_id = w.id AND b.tenant_id = NEW.tenant_id AND b.scoring_policy_id = c.scoring_policy_id) THEN RAISE EXCEPTION 'pulse_report_window_binding_mismatch'; END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER report_binding_guard BEFORE INSERT OR UPDATE OR DELETE ON survey_report_window_bindings FOR EACH ROW EXECUTE FUNCTION pulse_report_binding_guard();
--> statement-breakpoint
CREATE FUNCTION pulse_report_admission(t uuid, u uuid, window_id uuid, question_id uuid DEFAULT NULL, receipt_id uuid DEFAULT NULL) RETURNS text AS $$
DECLARE w survey_windows%ROWTYPE; p survey_report_participants%ROWTYPE; opening survey_report_cycle_openings%ROWTYPE; lineage uuid; admitted_at timestamptz;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('pulse-report-subject:' || t::text || ':' || u::text, 0));
 SELECT * INTO w FROM survey_windows WHERE id = window_id AND tenant_id = t AND user_id = u;
 IF NOT FOUND THEN RETURN 'nonparticipant'; END IF;
 IF EXISTS (SELECT 1 FROM survey_reporting_permissions WHERE tenant_id = t AND user_id = u AND full_reporting_denied) THEN RETURN 'full_withdrawal'; END IF;
 IF question_id IS NOT NULL THEN
   lineage := pulse_report_lineage(window_id, question_id);
   IF EXISTS (SELECT 1 FROM survey_reporting_lineage_exclusions WHERE tenant_id = t AND user_id = u AND lineage_id = lineage) THEN RETURN 'lineage_excluded'; END IF;
 END IF;
 SELECT o.* INTO opening FROM survey_report_cycle_openings o JOIN survey_cycle_scoring_policies c ON c.id = o.cycle_scoring_policy_id AND c.tenant_id = o.tenant_id
 WHERE c.tenant_id = t AND c.survey_definition_id = w.survey_definition_id AND c.period_start = w.period_start AND c.period_end = w.period_end;
 IF NOT FOUND THEN RETURN 'allowed'; END IF;
 SELECT participant.* INTO p FROM survey_report_window_bindings b JOIN survey_report_participants participant ON participant.id = b.participant_id AND participant.tenant_id = b.tenant_id AND participant.cycle_scoring_policy_id = b.cycle_scoring_policy_id
 WHERE b.survey_window_id = window_id AND b.tenant_id = t AND b.cycle_scoring_policy_id = opening.cycle_scoring_policy_id AND participant.user_id = u;
 IF NOT FOUND THEN RETURN 'nonparticipant'; END IF;
 IF receipt_id IS NULL THEN admitted_at := clock_timestamp(); ELSE
   SELECT received_at INTO admitted_at FROM messages WHERE id = receipt_id AND tenant_id = t AND user_id = u AND direction = 'inbound' AND deleted_at IS NULL;
   IF admitted_at IS NULL THEN RETURN 'missing_proof'; END IF;
 END IF;
 IF admitted_at < greatest(w.period_start, opening.opened_at) OR admitted_at >= least(w.period_end, coalesce(p.collection_stopped_at, w.period_end)) THEN RETURN 'stopped'; END IF;
 RETURN 'allowed';
END; $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE FUNCTION pulse_report_stop_changed(t uuid, mutation_id uuid) RETURNS void AS $$
DECLARE p survey_report_participants%ROWTYPE; cause text; stopped_at timestamptz;
BEGIN
 FOR p IN SELECT participant.* FROM survey_report_participants participant WHERE participant.tenant_id = t AND participant.collection_stopped_at IS NULL AND (
   NOT EXISTS(SELECT 1 FROM people person JOIN users runtime ON runtime.id = person.id AND runtime.tenant_id = person.tenant_id WHERE person.id = participant.person_id AND person.tenant_id = t AND person.lifecycle_status = 'active' AND runtime.status = 'active' AND runtime.deleted_at IS NULL AND person.primary_role = participant.opening_role AND person.pulse_participant)
   OR NOT EXISTS(SELECT 1 FROM org_teams team JOIN org_units unit ON unit.id = team.unit_id AND unit.tenant_id = team.tenant_id WHERE team.id = participant.origin_team_id AND team.tenant_id = t AND team.unit_id = participant.origin_unit_id AND team.lifecycle_status = 'active' AND unit.lifecycle_status = 'active' AND (
     (participant.opening_role = 'team_lead' AND team.team_lead_person_id = participant.person_id)
     OR (participant.opening_role = 'employee' AND EXISTS(SELECT 1 FROM org_employee_placements placement WHERE placement.tenant_id = t AND placement.employee_person_id = participant.person_id AND placement.team_id = participant.origin_team_id AND placement.unit_id = participant.origin_unit_id AND placement.lifecycle_status = 'active')))))
 ORDER BY participant.user_id, participant.id LOOP
   PERFORM pg_advisory_xact_lock(hashtextextended('pulse-report-subject:' || t::text || ':' || p.user_id::text, 0));
   stopped_at := clock_timestamp();
   cause := CASE WHEN NOT EXISTS(SELECT 1 FROM people WHERE id = p.person_id AND tenant_id = t AND lifecycle_status = 'active') THEN 'deactivated'
     WHEN NOT EXISTS(SELECT 1 FROM people WHERE id = p.person_id AND tenant_id = t AND primary_role = p.opening_role) THEN 'promoted'
     WHEN NOT EXISTS(SELECT 1 FROM org_units WHERE id = p.origin_unit_id AND tenant_id = t AND lifecycle_status = 'active') THEN 'unit_changed'
     WHEN NOT EXISTS(SELECT 1 FROM org_teams WHERE id = p.origin_team_id AND tenant_id = t AND lifecycle_status = 'active' AND unit_id = p.origin_unit_id) THEN 'team_changed' ELSE 'moved' END;
   UPDATE survey_report_participants SET collection_stopped_at = stopped_at, collection_stop_cause = cause, collection_stop_mutation_id = mutation_id WHERE id = p.id AND (collection_stopped_at IS NULL OR collection_stopped_at > stopped_at);
 END LOOP;
END; $$ LANGUAGE plpgsql;
--> statement-breakpoint
-- Historical metadata-only backfill: all revisions, including superseded and withdrawn.
INSERT INTO survey_report_question_lineages(tenant_id, cycle_scoring_policy_id, user_id, question_stable_key, survey_question_id, question_version, scoring_policy_id)
SELECT DISTINCT i.tenant_id, c.id, i.user_id, q.stable_key, q.id, q.version, c.scoring_policy_id
FROM survey_question_insights i JOIN survey_windows w ON w.id = i.survey_window_id AND w.tenant_id = i.tenant_id AND w.user_id = i.user_id AND w.survey_definition_id = i.survey_definition_id
JOIN survey_questions q ON q.id = i.survey_question_id AND q.survey_definition_id = i.survey_definition_id AND q.version = i.question_version AND q.response_type = 'open_ended'
JOIN survey_window_scoring_policies b ON b.survey_window_id = w.id AND b.tenant_id = i.tenant_id
JOIN survey_cycle_scoring_policies c ON c.tenant_id = i.tenant_id AND c.survey_definition_id = w.survey_definition_id AND c.period_start = w.period_start AND c.period_end = w.period_end AND c.scoring_policy_id = b.scoring_policy_id
JOIN survey_scoring_policies policy ON policy.id = c.scoring_policy_id AND policy.tenant_id = i.tenant_id AND policy.version = i.scoring_policy_version AND jsonb_typeof(policy.rubrics -> q.stable_key) = 'object'
ON CONFLICT DO NOTHING;
INSERT INTO survey_report_insight_revisions(insight_id, tenant_id, user_id, lineage_id, proof_status)
SELECT i.id, i.tenant_id, i.user_id, l.id, 'unverified_historical' FROM survey_question_insights i
JOIN survey_windows w ON w.id = i.survey_window_id AND w.tenant_id = i.tenant_id AND w.user_id = i.user_id AND w.survey_definition_id = i.survey_definition_id
JOIN survey_questions q ON q.id = i.survey_question_id AND q.survey_definition_id = i.survey_definition_id AND q.version = i.question_version
JOIN survey_cycle_scoring_policies c ON c.tenant_id = i.tenant_id AND c.survey_definition_id = w.survey_definition_id AND c.period_start = w.period_start AND c.period_end = w.period_end
JOIN survey_window_scoring_policies b ON b.survey_window_id = w.id AND b.tenant_id = i.tenant_id AND b.scoring_policy_id = c.scoring_policy_id
JOIN survey_scoring_policies policy ON policy.id = c.scoring_policy_id AND policy.tenant_id = i.tenant_id AND policy.version = i.scoring_policy_version
JOIN survey_report_question_lineages l ON l.tenant_id = i.tenant_id AND l.cycle_scoring_policy_id = c.id AND l.user_id = i.user_id AND l.survey_question_id = i.survey_question_id AND l.question_version = i.question_version
ON CONFLICT DO NOTHING;
--> statement-breakpoint
CREATE FUNCTION pulse_report_revision_guard() RETURNS trigger AS $$
DECLARE lineage uuid; working survey_question_working_insights%ROWTYPE; source_id uuid; decision text; org_native boolean; sources jsonb; confirmation_time timestamptz; permission_revision integer;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('pulse-report-subject:' || NEW.tenant_id::text || ':' || NEW.user_id::text, 0));
 lineage := pulse_report_lineage(NEW.survey_window_id, NEW.survey_question_id);
 IF EXISTS (SELECT 1 FROM survey_reporting_permissions WHERE tenant_id = NEW.tenant_id AND user_id = NEW.user_id AND full_reporting_denied)
 OR EXISTS (SELECT 1 FROM survey_reporting_lineage_exclusions WHERE tenant_id = NEW.tenant_id AND user_id = NEW.user_id AND lineage_id = lineage) THEN RAISE EXCEPTION 'pulse_report_finalization_excluded'; END IF;
 SELECT EXISTS(SELECT 1 FROM survey_report_window_bindings WHERE survey_window_id = NEW.survey_window_id AND tenant_id = NEW.tenant_id) INTO org_native;
 IF org_native AND lineage IS NULL THEN RAISE EXCEPTION 'pulse_report_lineage_unresolved'; END IF;
 IF org_native THEN
   SELECT * INTO working FROM survey_question_working_insights WHERE id = NEW.working_insight_id AND tenant_id = NEW.tenant_id AND user_id = NEW.user_id AND survey_window_id = NEW.survey_window_id AND survey_question_id = NEW.survey_question_id AND question_version = NEW.question_version;
   IF NOT FOUND OR working.confirmation_message_id IS NULL OR cardinality(working.source_message_ids) = 0 THEN RAISE EXCEPTION 'pulse_report_receipt_missing'; END IF;
   FOREACH source_id IN ARRAY working.source_message_ids || ARRAY[working.confirmation_message_id] LOOP
     decision := pulse_report_admission(NEW.tenant_id, NEW.user_id, NEW.survey_window_id, NEW.survey_question_id, source_id);
     IF decision <> 'allowed' THEN RAISE EXCEPTION 'pulse_report_receipt_ineligible: %', decision; END IF;
   END LOOP;
 END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER report_revision_guard BEFORE INSERT ON survey_question_insights FOR EACH ROW EXECUTE FUNCTION pulse_report_revision_guard();
--> statement-breakpoint
CREATE FUNCTION pulse_report_revision_metadata() RETURNS trigger AS $$
DECLARE lineage uuid; sources jsonb; confirmation_id uuid; confirmation_time timestamptz; org_native boolean;
BEGIN
 lineage := pulse_report_lineage(NEW.survey_window_id, NEW.survey_question_id);
 IF lineage IS NULL THEN RETURN NEW; END IF;
 SELECT EXISTS(SELECT 1 FROM survey_report_window_bindings WHERE survey_window_id = NEW.survey_window_id AND tenant_id = NEW.tenant_id) INTO org_native;
 IF org_native THEN
   SELECT jsonb_agg(jsonb_build_object('messageId', m.id, 'receivedAt', m.received_at) ORDER BY m.id) INTO sources FROM survey_question_working_insights w JOIN messages m ON m.id = ANY(w.source_message_ids) AND m.tenant_id = w.tenant_id AND m.user_id = w.user_id WHERE w.id = NEW.working_insight_id;
   SELECT m.id, m.received_at INTO confirmation_id, confirmation_time FROM survey_question_working_insights w JOIN messages m ON m.id = w.confirmation_message_id AND m.tenant_id = w.tenant_id AND m.user_id = w.user_id WHERE w.id = NEW.working_insight_id;
 END IF;
 INSERT INTO survey_report_insight_revisions(insight_id, tenant_id, user_id, lineage_id, permission_revision, accepted_source_receipts, confirmation_message_id, confirmation_received_at, proof_status)
 VALUES(NEW.id, NEW.tenant_id, NEW.user_id, lineage, coalesce((SELECT revision FROM survey_reporting_permissions WHERE tenant_id = NEW.tenant_id AND user_id = NEW.user_id), 0), sources, confirmation_id, confirmation_time, CASE WHEN org_native THEN 'receipt_backed' ELSE 'legacy' END);
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER report_revision_metadata AFTER INSERT ON survey_question_insights FOR EACH ROW EXECUTE FUNCTION pulse_report_revision_metadata();
--> statement-breakpoint
CREATE FUNCTION pulse_report_negative_state_guard() RETURNS trigger AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN
   IF NOT EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id AND tenant_id = OLD.tenant_id) THEN RETURN OLD; END IF;
   RAISE EXCEPTION 'pulse_report_suppression_retained';
 END IF;
 IF TG_TABLE_NAME = 'survey_reporting_permissions' THEN
   IF NEW.tenant_id <> OLD.tenant_id OR NEW.user_id <> OLD.user_id OR NEW.revision <= OLD.revision OR (OLD.full_reporting_denied AND (NOT NEW.full_reporting_denied OR NEW.denied_at IS DISTINCT FROM OLD.denied_at)) THEN RAISE EXCEPTION 'pulse_report_permission_not_monotonic'; END IF;
   RETURN NEW;
 END IF;
 RAISE EXCEPTION 'pulse_report_rights_record_immutable';
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER report_permission_monotonic BEFORE UPDATE OR DELETE ON survey_reporting_permissions FOR EACH ROW EXECUTE FUNCTION pulse_report_negative_state_guard();
CREATE TRIGGER report_withdrawal_immutable BEFORE UPDATE OR DELETE ON survey_reporting_withdrawal_requests FOR EACH ROW EXECUTE FUNCTION pulse_report_negative_state_guard();
CREATE TRIGGER report_exclusion_immutable BEFORE UPDATE OR DELETE ON survey_reporting_lineage_exclusions FOR EACH ROW EXECUTE FUNCTION pulse_report_negative_state_guard();
CREATE TRIGGER report_lineage_immutable BEFORE UPDATE OR DELETE ON survey_report_question_lineages FOR EACH ROW EXECUTE FUNCTION pulse_report_negative_state_guard();
--> statement-breakpoint
CREATE FUNCTION pulse_report_scope_relation_guard() RETURNS trigger AS $$
DECLARE scope survey_report_scopes%ROWTYPE; participant survey_report_participants%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME = 'survey_report_scopes' THEN
   IF NEW.kind = 'team' AND NOT EXISTS(SELECT 1 FROM survey_report_scopes parent WHERE parent.id = NEW.parent_scope_id AND parent.tenant_id = NEW.tenant_id AND parent.cycle_scoring_policy_id = NEW.cycle_scoring_policy_id AND parent.kind = 'manager_overall' AND parent.org_unit_id = NEW.org_unit_id) THEN RAISE EXCEPTION 'pulse_report_scope_parent_mismatch'; END IF;
 ELSE
   SELECT * INTO scope FROM survey_report_scopes WHERE id = NEW.scope_id AND tenant_id = NEW.tenant_id AND cycle_scoring_policy_id = NEW.cycle_scoring_policy_id;
   SELECT * INTO participant FROM survey_report_participants WHERE id = NEW.participant_id AND tenant_id = NEW.tenant_id AND cycle_scoring_policy_id = NEW.cycle_scoring_policy_id;
   IF scope.id IS NULL OR participant.id IS NULL OR scope.org_unit_id <> participant.origin_unit_id OR (scope.kind = 'team' AND (scope.org_team_id <> participant.origin_team_id OR participant.opening_role <> 'employee')) THEN RAISE EXCEPTION 'pulse_report_membership_mismatch'; END IF;
 END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER report_scope_relation BEFORE INSERT ON survey_report_scopes FOR EACH ROW EXECUTE FUNCTION pulse_report_scope_relation_guard();
CREATE TRIGGER report_membership_relation BEFORE INSERT ON survey_report_scope_memberships FOR EACH ROW EXECUTE FUNCTION pulse_report_scope_relation_guard();
