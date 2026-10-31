CREATE TABLE IF NOT EXISTS "survey_report_assembly_inputs" (
	"obligation_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"context" jsonb NOT NULL,
	"sections" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "survey_report_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"part_id" uuid NOT NULL,
	"token" bigint NOT NULL,
	"state" text DEFAULT 'attempt_started' NOT NULL,
	"artifact_hash" text NOT NULL,
	"body_hash" text NOT NULL,
	"route_hash" text NOT NULL,
	"authorization_receipt" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"resolved_at" timestamp with time zone,
	"reason" text,
	"retryable" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	CONSTRAINT "report_attempt_part_token" UNIQUE("part_id","token"),
	CONSTRAINT "report_attempt_tenant_identity" UNIQUE("tenant_id","snapshot_id","id"),
	CONSTRAINT "report_attempt_state" CHECK ("survey_report_attempts"."token">0 and "survey_report_attempts"."state" in ('attempt_started','dispatching','delivered','unknown','definitely_not_sent'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "survey_report_completion_supports" (
	"snapshot_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"cycle_id" uuid NOT NULL,
	"history_key" text NOT NULL,
	"metric_key" text NOT NULL,
	"context_hash" text NOT NULL,
	CONSTRAINT "survey_report_completion_supports_snapshot_id_candidate_id_metric_key_pk" PRIMARY KEY("snapshot_id","candidate_id","metric_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "survey_report_native_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"obligation_id" uuid NOT NULL,
	"cycle_id" uuid NOT NULL,
	"scope_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"artifact_hash" text NOT NULL,
	"part_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"purged_at" timestamp with time zone,
	CONSTRAINT "survey_report_native_snapshots_obligation_id_unique" UNIQUE("obligation_id"),
	CONSTRAINT "report_snapshot_tenant_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "report_snapshot_shape" CHECK ("survey_report_native_snapshots"."part_count">0 and "survey_report_native_snapshots"."part_count"<=1024 and "survey_report_native_snapshots"."artifact_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "survey_report_obligations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"cycle_id" uuid NOT NULL,
	"scope_id" uuid NOT NULL,
	"audience" text NOT NULL,
	"purpose" text NOT NULL,
	"index_key" text DEFAULT 'final' NOT NULL,
	"status" text DEFAULT 'observing' NOT NULL,
	"assembly_token" bigint DEFAULT 0 NOT NULL,
	"lease_until" timestamp with time zone,
	"initiated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"frontier" timestamp with time zone NOT NULL,
	"config_revision" integer NOT NULL,
	"next_action_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"repair_cursor_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"disposition" text,
	"completed_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	CONSTRAINT "report_obligation_native_identity" UNIQUE("tenant_id","cycle_id","scope_id","audience","purpose","index_key"),
	CONSTRAINT "report_obligation_tenant_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "report_obligation_shape" CHECK (("survey_report_obligations"."purpose"='intermediate' and "survey_report_obligations"."index_key" in ('autonomy','growth','purpose','belonging')) or ("survey_report_obligations"."purpose"='final' and "survey_report_obligations"."index_key"='final')),
	CONSTRAINT "report_obligation_audience" CHECK ("survey_report_obligations"."audience" in ('team_lead','manager')),
	CONSTRAINT "report_obligation_status" CHECK ("survey_report_obligations"."status" in ('observing','assembling','snapshot_ready','delivering','delivered','pending','blocked','canceled','reconciliation_required'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "survey_report_observations" (
	"tenant_id" uuid NOT NULL,
	"cycle_id" uuid NOT NULL,
	"generation" bigint DEFAULT 0 NOT NULL,
	"observed_generation" bigint,
	"next_observation_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"scan_cursor_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "survey_report_observations_tenant_id_cycle_id_pk" PRIMARY KEY("tenant_id","cycle_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "survey_report_part_payloads" (
	"part_id" uuid PRIMARY KEY NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "survey_report_parts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"body_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt_token" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "report_part_snapshot_ordinal" UNIQUE("snapshot_id","ordinal"),
	CONSTRAINT "report_part_tenant_identity" UNIQUE("tenant_id","snapshot_id","id"),
	CONSTRAINT "report_part_shape" CHECK ("survey_report_parts"."ordinal">0 and "survey_report_parts"."body_hash" ~ '^[a-f0-9]{64}$' and "survey_report_parts"."status" in ('pending','attempt_started','dispatching','delivered','unknown','canceled'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "survey_report_receipts" (
	"attempt_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"provider_timestamp" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"evidence_ref" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "survey_report_recipient_proofs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"scope_id" uuid NOT NULL,
	"binding" jsonb NOT NULL,
	"verified_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "survey_report_reconciliations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"attempt_id" uuid NOT NULL,
	"token" bigint NOT NULL,
	"decision" text NOT NULL,
	"actor_id" text NOT NULL,
	"authorization_ref" text NOT NULL,
	"reason" text NOT NULL,
	"evidence_ref" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "survey_report_snapshot_payloads" (
	"snapshot_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"presentation" jsonb NOT NULL,
	"provenance" jsonb NOT NULL,
	"manifest" jsonb NOT NULL,
	"route" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace_connections" ADD COLUMN "binding_revision" bigint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "channel_accounts" ADD COLUMN "binding_revision" bigint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "survey_report_final_completions" ADD COLUMN "canonical_snapshot_id" uuid;
--> statement-breakpoint
DO $$ BEGIN IF EXISTS(SELECT 1 FROM survey_report_final_completions) THEN RAISE EXCEPTION 'unexpected_pre_native_final_completion_inventory'; END IF; END $$;
--> statement-breakpoint
ALTER TABLE "survey_report_final_completions" ALTER COLUMN "canonical_snapshot_id" SET NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_report_assembly_inputs" ADD CONSTRAINT "survey_report_assembly_inputs_obligation_id_survey_report_obligations_id_fk" FOREIGN KEY ("obligation_id") REFERENCES "public"."survey_report_obligations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_report_assembly_inputs" ADD CONSTRAINT "survey_report_assembly_inputs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_report_attempts" ADD CONSTRAINT "survey_report_attempts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_report_attempts" ADD CONSTRAINT "survey_report_attempts_tenant_id_snapshot_id_part_id_survey_report_parts_tenant_id_snapshot_id_id_fk" FOREIGN KEY ("tenant_id","snapshot_id","part_id") REFERENCES "public"."survey_report_parts"("tenant_id","snapshot_id","id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_report_completion_supports" ADD CONSTRAINT "survey_report_completion_supports_snapshot_id_survey_report_native_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."survey_report_native_snapshots"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_report_completion_supports" ADD CONSTRAINT "survey_report_completion_supports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_report_native_snapshots" ADD CONSTRAINT "survey_report_native_snapshots_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_report_native_snapshots" ADD CONSTRAINT "survey_report_native_snapshots_tenant_id_obligation_id_survey_report_obligations_tenant_id_id_fk" FOREIGN KEY ("tenant_id","obligation_id") REFERENCES "public"."survey_report_obligations"("tenant_id","id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_report_obligations" ADD CONSTRAINT "survey_report_obligations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_report_obligations" ADD CONSTRAINT "survey_report_obligations_tenant_id_cycle_id_scope_id_survey_report_scopes_tenant_id_cycle_scoring_policy_id_id_fk" FOREIGN KEY ("tenant_id","cycle_id","scope_id") REFERENCES "public"."survey_report_scopes"("tenant_id","cycle_scoring_policy_id","id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_report_observations" ADD CONSTRAINT "survey_report_observations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_report_part_payloads" ADD CONSTRAINT "survey_report_part_payloads_part_id_survey_report_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."survey_report_parts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_report_parts" ADD CONSTRAINT "survey_report_parts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_report_parts" ADD CONSTRAINT "survey_report_parts_tenant_id_snapshot_id_survey_report_native_snapshots_tenant_id_id_fk" FOREIGN KEY ("tenant_id","snapshot_id") REFERENCES "public"."survey_report_native_snapshots"("tenant_id","id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_report_receipts" ADD CONSTRAINT "survey_report_receipts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_report_receipts" ADD CONSTRAINT "survey_report_receipts_tenant_id_snapshot_id_attempt_id_survey_report_attempts_tenant_id_snapshot_id_id_fk" FOREIGN KEY ("tenant_id","snapshot_id","attempt_id") REFERENCES "public"."survey_report_attempts"("tenant_id","snapshot_id","id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_report_recipient_proofs" ADD CONSTRAINT "survey_report_recipient_proofs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_report_reconciliations" ADD CONSTRAINT "survey_report_reconciliations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_report_reconciliations" ADD CONSTRAINT "survey_report_reconciliations_tenant_id_snapshot_id_attempt_id_survey_report_attempts_tenant_id_snapshot_id_id_fk" FOREIGN KEY ("tenant_id","snapshot_id","attempt_id") REFERENCES "public"."survey_report_attempts"("tenant_id","snapshot_id","id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_report_snapshot_payloads" ADD CONSTRAINT "survey_report_snapshot_payloads_snapshot_id_survey_report_native_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."survey_report_native_snapshots"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_report_snapshot_payloads" ADD CONSTRAINT "survey_report_snapshot_payloads_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_report_final_completions" ADD CONSTRAINT "survey_report_final_completions_canonical_snapshot_id_survey_report_native_snapshots_id_fk" FOREIGN KEY ("canonical_snapshot_id") REFERENCES "public"."survey_report_native_snapshots"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

--> statement-breakpoint
-- Identity revisions are authored by the DB even for installation/raw SQL writers.
CREATE FUNCTION pulse_binding_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE changed boolean;
BEGIN
 IF TG_OP='INSERT' THEN NEW.binding_revision:=1; RETURN NEW; END IF;
 IF TG_TABLE_NAME='channel_accounts' THEN
 changed:=ROW(NEW.id,NEW.tenant_id,NEW.user_id,NEW.channel_type,NEW.external_workspace_id,NEW.external_user_id,NEW.link_status) IS DISTINCT FROM ROW(OLD.id,OLD.tenant_id,OLD.user_id,OLD.channel_type,OLD.external_workspace_id,OLD.external_user_id,OLD.link_status);
 ELSE
 changed:=ROW(NEW.id,NEW.tenant_id,NEW.channel_type,NEW.external_workspace_id,NEW.encrypted_credentials,NEW.status,NEW.scopes) IS DISTINCT FROM ROW(OLD.id,OLD.tenant_id,OLD.channel_type,OLD.external_workspace_id,OLD.encrypted_credentials,OLD.status,OLD.scopes);
 END IF;
 NEW.binding_revision:=OLD.binding_revision+CASE WHEN changed THEN 1 ELSE 0 END;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER pulse_account_binding_revision BEFORE INSERT OR UPDATE ON channel_accounts FOR EACH ROW EXECUTE FUNCTION pulse_binding_revision();
CREATE TRIGGER pulse_workspace_binding_revision BEFORE INSERT OR UPDATE ON workspace_connections FOR EACH ROW EXECUTE FUNCTION pulse_binding_revision();
--> statement-breakpoint
CREATE FUNCTION pulse_publication_wakeup() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 INSERT INTO survey_report_observations(tenant_id,cycle_id,generation) VALUES(NEW.tenant_id,NEW.cycle_id,NEW.generation)
 ON CONFLICT(tenant_id,cycle_id) DO UPDATE SET generation=EXCLUDED.generation,next_observation_at=least(survey_report_observations.next_observation_at,clock_timestamp());
 RETURN NEW;
END $$;
CREATE TRIGGER pulse_publication_generation AFTER INSERT OR UPDATE ON survey_report_input_generations FOR EACH ROW EXECUTE FUNCTION pulse_publication_wakeup();
--> statement-breakpoint
CREATE FUNCTION pulse_publication_obligation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s survey_report_scopes%ROWTYPE;
BEGIN
 IF TG_OP='UPDATE' AND ROW(NEW.id,NEW.tenant_id,NEW.cycle_id,NEW.scope_id,NEW.audience,NEW.purpose,NEW.index_key,NEW.initiated_at,NEW.frontier,NEW.config_revision) IS DISTINCT FROM ROW(OLD.id,OLD.tenant_id,OLD.cycle_id,OLD.scope_id,OLD.audience,OLD.purpose,OLD.index_key,OLD.initiated_at,OLD.frontier,OLD.config_revision) THEN RAISE EXCEPTION 'pulse_obligation_identity_immutable'; END IF;
 SELECT * INTO s FROM survey_report_scopes WHERE tenant_id=NEW.tenant_id AND cycle_scoring_policy_id=NEW.cycle_id AND id=NEW.scope_id;
 IF s.id IS NULL OR (s.kind='team' AND NEW.audience<>'team_lead') OR (s.kind='manager_overall' AND NEW.audience<>'manager') THEN RAISE EXCEPTION 'pulse_obligation_scope_audience'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER pulse_obligation_guard BEFORE INSERT OR UPDATE ON survey_report_obligations FOR EACH ROW EXECUTE FUNCTION pulse_publication_obligation_guard();
--> statement-breakpoint
CREATE FUNCTION pulse_publication_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'pulse_publication_immutable'; END $$;
CREATE TRIGGER pulse_snapshot_payload_immutable BEFORE UPDATE ON survey_report_snapshot_payloads FOR EACH ROW EXECUTE FUNCTION pulse_publication_immutable();
CREATE TRIGGER pulse_part_payload_immutable BEFORE UPDATE ON survey_report_part_payloads FOR EACH ROW EXECUTE FUNCTION pulse_publication_immutable();
CREATE TRIGGER pulse_proof_immutable BEFORE UPDATE ON survey_report_recipient_proofs FOR EACH ROW EXECUTE FUNCTION pulse_publication_immutable();
CREATE TRIGGER pulse_support_immutable BEFORE UPDATE ON survey_report_completion_supports FOR EACH ROW EXECUTE FUNCTION pulse_publication_immutable();
CREATE TRIGGER pulse_receipt_immutable BEFORE UPDATE ON survey_report_receipts FOR EACH ROW EXECUTE FUNCTION pulse_publication_immutable();
CREATE TRIGGER pulse_reconciliation_immutable BEFORE UPDATE ON survey_report_reconciliations FOR EACH ROW EXECUTE FUNCTION pulse_publication_immutable();
--> statement-breakpoint
CREATE FUNCTION pulse_snapshot_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o survey_report_obligations%ROWTYPE;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-'purged_at') IS DISTINCT FROM (to_jsonb(OLD)-'purged_at') OR OLD.purged_at IS NOT NULL OR NEW.purged_at IS NULL THEN RAISE EXCEPTION 'pulse_snapshot_immutable'; END IF;
 ELSE
  SELECT * INTO o FROM survey_report_obligations WHERE id=NEW.obligation_id AND tenant_id=NEW.tenant_id;
  IF o.id IS NULL OR ROW(o.cycle_id,o.scope_id,o.purpose) IS DISTINCT FROM ROW(NEW.cycle_id,NEW.scope_id,NEW.purpose) OR o.status<>'assembling' THEN RAISE EXCEPTION 'pulse_snapshot_obligation_mismatch'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER pulse_snapshot_identity_guard BEFORE INSERT OR UPDATE ON survey_report_native_snapshots FOR EACH ROW EXECUTE FUNCTION pulse_snapshot_identity_guard();
--> statement-breakpoint
CREATE FUNCTION pulse_part_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='UPDATE' AND (to_jsonb(NEW)-'status'-'attempt_token') IS DISTINCT FROM (to_jsonb(OLD)-'status'-'attempt_token') THEN RAISE EXCEPTION 'pulse_part_immutable'; END IF;
 IF NOT EXISTS(SELECT 1 FROM survey_report_native_snapshots WHERE id=NEW.snapshot_id AND tenant_id=NEW.tenant_id AND NEW.ordinal<=part_count) THEN RAISE EXCEPTION 'pulse_part_ordinal'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER pulse_part_identity_guard BEFORE INSERT OR UPDATE ON survey_report_parts FOR EACH ROW EXECUTE FUNCTION pulse_part_identity_guard();
--> statement-breakpoint
CREATE UNIQUE INDEX pulse_one_unresolved_transport_owner ON survey_report_attempts(snapshot_id) WHERE state IN ('attempt_started','dispatching','unknown');
CREATE FUNCTION pulse_attempt_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='UPDATE' AND (to_jsonb(NEW)-'state'-'resolved_at'-'reason'-'retryable'-'next_attempt_at') IS DISTINCT FROM (to_jsonb(OLD)-'state'-'resolved_at'-'reason'-'retryable'-'next_attempt_at') THEN RAISE EXCEPTION 'pulse_attempt_immutable'; END IF;
 IF TG_OP='INSERT' AND EXISTS(SELECT 1 FROM survey_report_parts p JOIN survey_report_parts current ON current.id=NEW.part_id WHERE p.snapshot_id=NEW.snapshot_id AND p.ordinal<current.ordinal AND p.status<>'delivered') THEN RAISE EXCEPTION 'pulse_part_order'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER pulse_attempt_identity_guard BEFORE INSERT OR UPDATE ON survey_report_attempts FOR EACH ROW EXECUTE FUNCTION pulse_attempt_identity_guard();
--> statement-breakpoint
CREATE FUNCTION pulse_final_support_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c survey_report_input_candidates%ROWTYPE; p survey_report_snapshot_payloads%ROWTYPE; s survey_report_native_snapshots%ROWTYPE; section jsonb; metric jsonb;
BEGIN
 SELECT * INTO c FROM survey_report_input_candidates WHERE id=NEW.candidate_id;
 SELECT * INTO s FROM survey_report_native_snapshots WHERE id=NEW.snapshot_id;
 SELECT * INTO p FROM survey_report_snapshot_payloads WHERE snapshot_id=s.id;
 IF c.id IS NULL OR s.id IS NULL OR s.purpose<>'final' OR c.purpose<>'final' OR c.invalidated_at IS NOT NULL OR c.expires_at<=clock_timestamp() OR ROW(c.tenant_id,c.cycle_id,c.context->>'historyKey') IS DISTINCT FROM ROW(NEW.tenant_id,NEW.cycle_id,NEW.history_key) OR ROW(s.tenant_id,s.cycle_id) IS DISTINCT FROM ROW(c.tenant_id,c.cycle_id) OR p.presentation->'sections'->0->>'status'<>'eligible' THEN RAISE EXCEPTION 'pulse_final_support_context'; END IF;
 SELECT value INTO section FROM jsonb_array_elements(p.provenance->'sections') WHERE value->>'candidateId'=c.id::text;
 SELECT value INTO metric FROM jsonb_array_elements(c.metrics) WHERE value->>'metricKey'=NEW.metric_key;
 IF section IS NULL OR section->'context'<>c.context OR section->'metrics'<>c.metrics OR (section->'context'->>'frontier')::timestamptz<>c.frontier OR (section->'context'->>'generation')::bigint<>c.generation OR metric IS NULL OR metric->>'status'<>'eligible' OR (metric->>'completeCount')::integer<5 OR metric->>'rawMean' IS NULL OR NOT EXISTS(SELECT 1 FROM survey_report_final_timings f WHERE f.tenant_id=c.tenant_id AND f.cycle_scoring_policy_id=c.cycle_id AND f.status='started' AND f.report_data_cutoff=c.frontier) THEN RAISE EXCEPTION 'pulse_final_support_metric_or_provenance'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('pulse-publication-history:'||c.tenant_id||':'||NEW.history_key,0));
 IF EXISTS(SELECT 1 FROM survey_report_completion_supports prior WHERE prior.tenant_id=NEW.tenant_id AND prior.cycle_id=NEW.cycle_id AND prior.history_key=NEW.history_key AND prior.metric_key=NEW.metric_key AND prior.candidate_id<>NEW.candidate_id) THEN RAISE EXCEPTION 'pulse_conflicting_official_final'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER pulse_final_support_guard BEFORE INSERT ON survey_report_completion_supports FOR EACH ROW EXECUTE FUNCTION pulse_final_support_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION pulse_input_completion_closed() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'pulse_final_completion_immutable'; END IF;
 IF NOT EXISTS(SELECT 1 FROM survey_report_completion_supports support JOIN survey_report_native_snapshots s ON s.id=support.snapshot_id JOIN survey_report_input_candidates c ON c.id=support.candidate_id WHERE support.snapshot_id=NEW.canonical_snapshot_id AND support.candidate_id=NEW.candidate_id AND s.tenant_id=c.tenant_id AND s.cycle_id=c.cycle_id AND s.purpose='final' AND c.purpose='final') THEN RAISE EXCEPTION 'pulse_final_completion_requires_real_native_support'; END IF;
 NEW.completed_at:=clock_timestamp(); RETURN NEW;
END $$;
--> statement-breakpoint
-- Negative source invalidation reaches both current and historical dependencies before lifecycle rows.
CREATE FUNCTION pulse_publication_candidate_invalidated() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.invalidated_at IS NULL AND NEW.invalidated_at IS NOT NULL THEN
  UPDATE survey_report_obligations o SET status=CASE WHEN EXISTS(SELECT 1 FROM survey_report_attempts a WHERE a.snapshot_id=s.id AND a.state IN ('attempt_started','dispatching','unknown')) THEN 'reconciliation_required' ELSE 'canceled' END,disposition='source_invalidated'
  FROM survey_report_native_snapshots s JOIN survey_report_snapshot_payloads p ON p.snapshot_id=s.id
  WHERE o.id=s.obligation_id AND o.status<>'delivered' AND (p.provenance->'sections')::text LIKE '%'||NEW.id::text||'%';
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER pulse_publication_candidate_invalidated AFTER UPDATE OF invalidated_at ON survey_report_input_candidates FOR EACH ROW EXECUTE FUNCTION pulse_publication_candidate_invalidated();
--> statement-breakpoint
CREATE FUNCTION pulse_publication_payload_purge(t uuid,cutoff timestamptz) RETURNS void LANGUAGE plpgsql AS $$
DECLARE item record;
BEGIN
 -- Source invalidation precedes lifecycle/payload rows, sharing the sender's direction.
 UPDATE survey_report_input_candidates SET invalidated_at=coalesce(invalidated_at,clock_timestamp()) WHERE tenant_id=t AND (expires_at<=clock_timestamp() OR (context->>'periodStart')::timestamptz<cutoff);
 FOR item IN SELECT id,obligation_id FROM survey_report_native_snapshots WHERE tenant_id=t AND purged_at IS NULL AND (expires_at<=clock_timestamp() OR created_at<cutoff) ORDER BY id LOOP
  UPDATE survey_report_obligations SET status=CASE WHEN EXISTS(SELECT 1 FROM survey_report_attempts WHERE snapshot_id=item.id AND state IN ('attempt_started','dispatching','unknown')) THEN 'reconciliation_required' WHEN status='delivered' THEN 'delivered' ELSE 'canceled' END,disposition='retention_purged' WHERE id=item.obligation_id;
  DELETE FROM survey_report_part_payloads WHERE part_id IN(SELECT id FROM survey_report_parts WHERE snapshot_id=item.id);
  DELETE FROM survey_report_snapshot_payloads WHERE snapshot_id=item.id;
  UPDATE survey_report_native_snapshots SET purged_at=clock_timestamp() WHERE id=item.id;
 END LOOP;
 DELETE FROM survey_report_assembly_inputs WHERE tenant_id=t AND expires_at<=clock_timestamp();
 DELETE FROM survey_report_recipient_proofs WHERE tenant_id=t AND expires_at<=clock_timestamp();
END $$;
--> statement-breakpoint
-- Valid assembly history must survive expiry/source erasure as invalid content-free continuity.
CREATE FUNCTION pulse_completed_candidate_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM tenants WHERE id=OLD.tenant_id) AND EXISTS(SELECT 1 FROM survey_report_final_completions WHERE candidate_id=OLD.id) THEN
  UPDATE survey_report_input_candidates SET invalidated_at=coalesce(invalidated_at,clock_timestamp()),metrics='[]'::jsonb WHERE id=OLD.id;
  DELETE FROM survey_report_candidate_sources WHERE candidate_id=OLD.id;
  RETURN NULL;
 END IF;
 RETURN OLD;
END $$;
CREATE TRIGGER aaa_pulse_completed_candidate_delete BEFORE DELETE ON survey_report_input_candidates FOR EACH ROW EXECUTE FUNCTION pulse_completed_candidate_delete();
--> statement-breakpoint
CREATE FUNCTION pulse_receipt_context_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM survey_report_attempts a JOIN survey_report_snapshot_payloads p ON p.snapshot_id=a.snapshot_id WHERE a.id=NEW.attempt_id AND a.tenant_id=NEW.tenant_id AND a.snapshot_id=NEW.snapshot_id AND p.route->>'channelId'=NEW.channel AND NEW.provider_timestamp ~ '^[0-9]{10,}\.[0-9]{6}$' AND a.state IN ('dispatching','unknown','attempt_started')) THEN RAISE EXCEPTION 'pulse_receipt_context'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER pulse_receipt_context_guard BEFORE INSERT ON survey_report_receipts FOR EACH ROW EXECUTE FUNCTION pulse_receipt_context_guard();
