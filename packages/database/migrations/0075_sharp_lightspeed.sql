CREATE TABLE IF NOT EXISTS "survey_report_candidate_sources" (
	"candidate_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"lineage_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	CONSTRAINT "survey_report_candidate_sources_candidate_id_lineage_id_revision_id_pk" PRIMARY KEY("candidate_id","lineage_id","revision_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "survey_report_component_verdicts" (
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"inbound_receipt_id" uuid NOT NULL,
	"prompt_message_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"outcome" text NOT NULL,
	CONSTRAINT "survey_report_component_verdicts_inbound_receipt_id_prompt_message_id_ordinal_pk" PRIMARY KEY("inbound_receipt_id","prompt_message_id","ordinal")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "survey_report_final_completions" (
	"candidate_id" uuid PRIMARY KEY NOT NULL,
	"completed_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "survey_report_inbound_work" (
	"inbound_receipt_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"received_at" timestamp with time zone,
	"trust" text NOT NULL,
	"capture" text DEFAULT 'pending' NOT NULL,
	"native_verdict" text DEFAULT 'pending' NOT NULL,
	"evidence" text DEFAULT 'pending' NOT NULL,
	"finalization" text DEFAULT 'pending' NOT NULL,
	"attempt_token" uuid,
	"lease_until" timestamp with time zone,
	"failure_code" text,
	"recovery_cursor_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "report_work_subject_identity" UNIQUE("tenant_id","user_id","inbound_receipt_id"),
	CONSTRAINT "report_work_trust" CHECK ("survey_report_inbound_work"."trust" in ('db-receipt-v1','unverified_explicit_receipt','legacy_unverified','legacy_missing_clock')),
	CONSTRAINT "report_work_stages" CHECK ("survey_report_inbound_work"."capture" in ('pending','applied','not_applicable','invalid','excluded','expired','deleted','blocked') and "survey_report_inbound_work"."native_verdict" in ('pending','claimed','applied','not_applicable','excluded','expired','deleted','blocked') and "survey_report_inbound_work"."evidence" in ('pending','applied','not_applicable','excluded','expired','deleted','delegated','blocked') and "survey_report_inbound_work"."finalization" in ('pending','applied','not_applicable','excluded','expired','deleted','blocked'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "survey_report_input_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"cycle_id" uuid NOT NULL,
	"scope_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"frontier" timestamp with time zone NOT NULL,
	"generation" bigint NOT NULL,
	"calculation_contract" text NOT NULL,
	"context" jsonb NOT NULL,
	"metrics" jsonb NOT NULL,
	"invalidated_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "report_input_candidate_identity" UNIQUE("tenant_id","cycle_id","scope_id","purpose","frontier","generation","calculation_contract"),
	CONSTRAINT "report_candidate_purpose" CHECK ("survey_report_input_candidates"."purpose" in ('intermediate','final'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "survey_report_input_generations" (
	"tenant_id" uuid NOT NULL,
	"cycle_id" uuid NOT NULL,
	"generation" bigint DEFAULT 0 NOT NULL,
	"certified_generation" bigint,
	"cutoff" timestamp with time zone,
	CONSTRAINT "survey_report_input_generations_tenant_id_cycle_id_pk" PRIMARY KEY("tenant_id","cycle_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "survey_report_shown_components" (
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"bundle_id" uuid NOT NULL,
	"prompt_message_id" uuid NOT NULL,
	"survey_window_id" uuid NOT NULL,
	"survey_question_id" uuid NOT NULL,
	"question_version" text NOT NULL,
	"ordinal" integer NOT NULL,
	"working_insight_id" uuid NOT NULL,
	"working_revision_hash" text NOT NULL,
	"component_hash" text NOT NULL,
	"form_hash" text NOT NULL,
	"sent_at" timestamp with time zone,
	"acknowledged_at" timestamp with time zone,
	CONSTRAINT "survey_report_shown_components_prompt_message_id_ordinal_pk" PRIMARY KEY("prompt_message_id","ordinal")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "survey_report_topic_watermarks" (
	"insight_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"lineage_id" uuid NOT NULL,
	"confirmation_message_id" uuid NOT NULL,
	"confirmation_received_at" timestamp with time zone NOT NULL,
	"accepted_source_receipts" jsonb NOT NULL,
	"state" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "report_watermark_state" CHECK ("survey_report_topic_watermarks"."state" in ('retained','withdrawn','expired','deleted'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "survey_report_work_dependencies" (
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"inbound_receipt_id" uuid NOT NULL,
	"depends_on_receipt_id" uuid NOT NULL,
	"stage" text DEFAULT 'evidence' NOT NULL,
	CONSTRAINT "survey_report_work_dependencies_inbound_receipt_id_depends_on_receipt_id_stage_pk" PRIMARY KEY("inbound_receipt_id","depends_on_receipt_id","stage"),
	CONSTRAINT "report_dependency_stage" CHECK ("survey_report_work_dependencies"."stage"='evidence' and "survey_report_work_dependencies"."inbound_receipt_id"<>"survey_report_work_dependencies"."depends_on_receipt_id")
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "receipt_trust" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_report_candidate_sources" ADD CONSTRAINT "survey_report_candidate_sources_candidate_id_survey_report_input_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."survey_report_input_candidates"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_report_candidate_sources" ADD CONSTRAINT "survey_report_candidate_sources_user_id_tenant_id_users_id_tenant_id_fk" FOREIGN KEY ("user_id","tenant_id") REFERENCES "public"."users"("id","tenant_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_report_component_verdicts" ADD CONSTRAINT "survey_report_component_verdicts_tenant_id_user_id_inbound_receipt_id_survey_report_inbound_work_tenant_id_user_id_inbound_receipt_id_fk" FOREIGN KEY ("tenant_id","user_id","inbound_receipt_id") REFERENCES "public"."survey_report_inbound_work"("tenant_id","user_id","inbound_receipt_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_report_component_verdicts" ADD CONSTRAINT "survey_report_component_verdicts_prompt_message_id_ordinal_survey_report_shown_components_prompt_message_id_ordinal_fk" FOREIGN KEY ("prompt_message_id","ordinal") REFERENCES "public"."survey_report_shown_components"("prompt_message_id","ordinal") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_report_final_completions" ADD CONSTRAINT "survey_report_final_completions_candidate_id_survey_report_input_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."survey_report_input_candidates"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_report_inbound_work" ADD CONSTRAINT "survey_report_inbound_work_user_id_tenant_id_users_id_tenant_id_fk" FOREIGN KEY ("user_id","tenant_id") REFERENCES "public"."users"("id","tenant_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_report_input_candidates" ADD CONSTRAINT "survey_report_input_candidates_tenant_id_cycle_id_scope_id_survey_report_scopes_tenant_id_cycle_scoring_policy_id_id_fk" FOREIGN KEY ("tenant_id","cycle_id","scope_id") REFERENCES "public"."survey_report_scopes"("tenant_id","cycle_scoring_policy_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_report_input_generations" ADD CONSTRAINT "survey_report_input_generations_tenant_id_cycle_id_survey_report_cycle_openings_tenant_id_cycle_scoring_policy_id_fk" FOREIGN KEY ("tenant_id","cycle_id") REFERENCES "public"."survey_report_cycle_openings"("tenant_id","cycle_scoring_policy_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_report_shown_components" ADD CONSTRAINT "survey_report_shown_components_user_id_tenant_id_users_id_tenant_id_fk" FOREIGN KEY ("user_id","tenant_id") REFERENCES "public"."users"("id","tenant_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_report_topic_watermarks" ADD CONSTRAINT "survey_report_topic_watermarks_tenant_id_user_id_lineage_id_survey_report_question_lineages_tenant_id_user_id_id_fk" FOREIGN KEY ("tenant_id","user_id","lineage_id") REFERENCES "public"."survey_report_question_lineages"("tenant_id","user_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_report_work_dependencies" ADD CONSTRAINT "survey_report_work_dependencies_tenant_id_user_id_inbound_receipt_id_survey_report_inbound_work_tenant_id_user_id_inbound_receipt_id_fk" FOREIGN KEY ("tenant_id","user_id","inbound_receipt_id") REFERENCES "public"."survey_report_inbound_work"("tenant_id","user_id","inbound_receipt_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_report_work_dependencies" ADD CONSTRAINT "survey_report_work_dependencies_tenant_id_user_id_depends_on_receipt_id_survey_report_inbound_work_tenant_id_user_id_inbound_receipt_id_fk" FOREIGN KEY ("tenant_id","user_id","depends_on_receipt_id") REFERENCES "public"."survey_report_inbound_work"("tenant_id","user_id","inbound_receipt_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX report_work_receipt_order ON survey_report_inbound_work(tenant_id,user_id,received_at,inbound_receipt_id);
CREATE INDEX report_work_recovery_cursor ON survey_report_inbound_work(recovery_cursor_at,inbound_receipt_id);
--> statement-breakpoint
CREATE FUNCTION pulse_input_bump(t uuid,u uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO survey_report_input_generations(tenant_id,cycle_id,generation)
 SELECT tenant_id,cycle_scoring_policy_id,1 FROM survey_report_participants WHERE tenant_id=t AND user_id=u
 ON CONFLICT(tenant_id,cycle_id) DO UPDATE SET generation=survey_report_input_generations.generation+1,certified_generation=NULL;
 UPDATE survey_report_input_candidates c SET invalidated_at=clock_timestamp()
 WHERE c.tenant_id=t AND c.invalidated_at IS NULL AND EXISTS(SELECT 1 FROM survey_report_participants p WHERE p.tenant_id=t AND p.user_id=u AND p.cycle_scoring_policy_id=c.cycle_id);
END $$;
--> statement-breakpoint
CREATE FUNCTION pulse_input_ingress_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF OLD.direction='inbound' AND ROW(NEW.id,NEW.tenant_id,NEW.user_id,NEW.conversation_id,NEW.received_at,NEW.receipt_trust,NEW.direction) IS DISTINCT FROM ROW(OLD.id,OLD.tenant_id,OLD.user_id,OLD.conversation_id,OLD.received_at,OLD.receipt_trust,OLD.direction) THEN RAISE EXCEPTION 'pulse_receipt_identity_immutable'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.direction<>'inbound' THEN NEW.receipt_trust:=NULL; RETURN NEW; END IF;
 -- All writers, including admissionless dev and generic saves, obey the formation fence.
 PERFORM 1 FROM tenants WHERE id=NEW.tenant_id FOR SHARE;
 PERFORM pg_advisory_xact_lock(hashtextextended('pulse-report-subject:'||NEW.tenant_id::text||':'||NEW.user_id::text,0));
 IF NOT EXISTS(SELECT 1 FROM conversations WHERE id=NEW.conversation_id AND tenant_id=NEW.tenant_id AND user_id=NEW.user_id) THEN RAISE EXCEPTION 'pulse_receipt_owner_mismatch'; END IF;
 IF NEW.received_at IS NULL THEN
  NEW.received_at:=clock_timestamp(); NEW.receipt_trust:='db-receipt-v1';
 ELSE
  NEW.receipt_trust:='unverified_explicit_receipt';
  IF EXISTS(SELECT 1 FROM survey_report_participants p JOIN survey_cycle_scoring_policies c ON c.id=p.cycle_scoring_policy_id JOIN survey_report_cycle_openings o ON o.cycle_scoring_policy_id=c.id JOIN survey_report_final_timings f ON f.tenant_id=p.tenant_id AND f.cycle_scoring_policy_id=c.id WHERE p.tenant_id=NEW.tenant_id AND p.user_id=NEW.user_id AND f.status='started' AND NEW.received_at>=greatest(c.period_start,o.opened_at) AND NEW.received_at<least(c.period_end,coalesce(p.collection_stopped_at,c.period_end),f.report_data_cutoff)) THEN RAISE EXCEPTION 'pulse_receipt_backdate_after_formation'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aaa_pulse_input_ingress BEFORE INSERT OR UPDATE ON messages FOR EACH ROW EXECUTE FUNCTION pulse_input_ingress_guard();
--> statement-breakpoint
INSERT INTO survey_report_inbound_work(inbound_receipt_id,tenant_id,user_id,conversation_id,received_at,trust)
SELECT id,tenant_id,user_id,conversation_id,received_at,CASE WHEN received_at IS NULL THEN 'legacy_missing_clock' ELSE 'legacy_unverified' END FROM messages WHERE direction='inbound';
--> statement-breakpoint
CREATE FUNCTION pulse_input_ingress_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.direction='inbound' THEN
  INSERT INTO survey_report_inbound_work(inbound_receipt_id,tenant_id,user_id,conversation_id,received_at,trust) VALUES(NEW.id,NEW.tenant_id,NEW.user_id,NEW.conversation_id,NEW.received_at,NEW.receipt_trust);
  PERFORM pulse_input_bump(NEW.tenant_id,NEW.user_id);
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER pulse_input_ingress_record AFTER INSERT ON messages FOR EACH ROW EXECUTE FUNCTION pulse_input_ingress_record();
--> statement-breakpoint
CREATE FUNCTION pulse_input_dependency_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('pulse-report-subject:'||NEW.tenant_id::text||':'||NEW.user_id::text,0));
 IF EXISTS(WITH RECURSIVE chain(id) AS (SELECT NEW.depends_on_receipt_id UNION SELECT d.depends_on_receipt_id FROM survey_report_work_dependencies d JOIN chain c ON d.inbound_receipt_id=c.id) SELECT 1 FROM chain WHERE id=NEW.inbound_receipt_id) THEN RAISE EXCEPTION 'pulse_input_dependency_cycle'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER pulse_input_dependency_guard BEFORE INSERT ON survey_report_work_dependencies FOR EACH ROW EXECUTE FUNCTION pulse_input_dependency_guard();
--> statement-breakpoint
CREATE FUNCTION pulse_input_progress_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.capture,NEW.native_verdict,NEW.evidence,NEW.finalization,NEW.failure_code) IS DISTINCT FROM ROW(OLD.capture,OLD.native_verdict,OLD.evidence,OLD.finalization,OLD.failure_code) THEN PERFORM pulse_input_bump(NEW.tenant_id,NEW.user_id); END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER pulse_input_progress_changed AFTER UPDATE ON survey_report_inbound_work FOR EACH ROW EXECUTE FUNCTION pulse_input_progress_changed();
--> statement-breakpoint
CREATE FUNCTION pulse_input_claim(t uuid,u uuid,r uuid) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE w survey_report_inbound_work%ROWTYPE; token uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('pulse-report-subject:'||t::text||':'||u::text,0));
 SELECT * INTO w FROM survey_report_inbound_work WHERE tenant_id=t AND user_id=u AND inbound_receipt_id=r;
 IF w.inbound_receipt_id IS NULL THEN RAISE EXCEPTION 'pulse_input_missing_receipt'; END IF;
 IF NOT EXISTS(SELECT 1 FROM survey_report_participants p JOIN survey_cycle_scoring_policies c ON c.id=p.cycle_scoring_policy_id JOIN survey_report_cycle_openings o ON o.cycle_scoring_policy_id=c.id WHERE p.tenant_id=t AND p.user_id=u AND w.received_at>=greatest(c.period_start,o.opened_at) AND w.received_at<least(c.period_end,coalesce(p.collection_stopped_at,c.period_end))) THEN RETURN NULL; END IF;
 IF w.native_verdict NOT IN ('pending','claimed','blocked') THEN RETURN NULL; END IF;
 IF w.trust<>'db-receipt-v1' THEN RAISE EXCEPTION 'pulse_input_unverified_receipt'; END IF;
 IF EXISTS(SELECT 1 FROM survey_report_inbound_work earlier WHERE earlier.tenant_id=t AND earlier.user_id=u AND (earlier.received_at,earlier.inbound_receipt_id)<(w.received_at,r) AND earlier.native_verdict IN ('pending','claimed','blocked') AND EXISTS(SELECT 1 FROM survey_report_participants p JOIN survey_cycle_scoring_policies c ON c.id=p.cycle_scoring_policy_id JOIN survey_report_cycle_openings o ON o.cycle_scoring_policy_id=c.id WHERE p.tenant_id=t AND p.user_id=u AND earlier.received_at>=greatest(c.period_start,o.opened_at) AND earlier.received_at<least(c.period_end,coalesce(p.collection_stopped_at,c.period_end)))) THEN RAISE EXCEPTION 'pulse_input_earlier_native_stage'; END IF;
 IF w.native_verdict='claimed' AND w.lease_until>clock_timestamp() THEN RAISE EXCEPTION 'pulse_input_native_lease_busy'; END IF;
 token:=gen_random_uuid();
 UPDATE survey_report_inbound_work SET native_verdict='claimed',attempt_token=token,lease_until=clock_timestamp()+interval '10 minutes',failure_code=NULL WHERE inbound_receipt_id=r;
 RETURN token;
END $$;
--> statement-breakpoint
CREATE FUNCTION pulse_input_verify_claim(t uuid,u uuid,r uuid,token uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('pulse-report-subject:'||t::text||':'||u::text,0));
 IF token IS NOT NULL AND NOT EXISTS(SELECT 1 FROM survey_report_inbound_work WHERE tenant_id=t AND user_id=u AND inbound_receipt_id=r AND attempt_token=token AND native_verdict IN ('claimed','applied') AND lease_until>clock_timestamp()) THEN RAISE EXCEPTION 'pulse_input_stale_native_claim'; END IF;
END $$;
--> statement-breakpoint
CREATE FUNCTION pulse_input_shown_bundle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.components IS NOT NULL AND NEW.prompt_message_id IS NOT NULL AND EXISTS(SELECT 1 FROM survey_report_window_bindings WHERE survey_window_id=NEW.survey_window_id) THEN
  INSERT INTO survey_report_shown_components(tenant_id,user_id,conversation_id,bundle_id,prompt_message_id,survey_window_id,survey_question_id,question_version,ordinal,working_insight_id,working_revision_hash,component_hash,form_hash,sent_at,acknowledged_at)
  SELECT NEW.tenant_id,NEW.user_id,m.conversation_id,NEW.id,m.id,NEW.survey_window_id,w.survey_question_id,w.question_version,c.ordinality::integer,w.id,encode(sha256(convert_to(coalesce(w.working_summary,'')||':'||w.updated_at::text,'UTF8')),'hex'),encode(sha256(convert_to(c.value->>'statement','UTF8')),'hex'),encode(sha256(convert_to(NEW.displayed_text,'UTF8')),'hex'),m.sent_at,m.delivery_recorded_at
  FROM jsonb_array_elements(NEW.components) WITH ORDINALITY c(value,ordinality) JOIN survey_question_working_insights w ON w.tenant_id=NEW.tenant_id AND w.user_id=NEW.user_id AND w.survey_window_id=NEW.survey_window_id AND w.survey_question_id=(c.value->>'surveyQuestionId')::uuid AND w.question_version=c.value->>'questionVersion' JOIN messages m ON m.id=NEW.prompt_message_id AND m.tenant_id=NEW.tenant_id AND m.user_id=NEW.user_id
  ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER pulse_input_shown_bundle AFTER INSERT ON survey_question_confirmation_bundles FOR EACH ROW EXECUTE FUNCTION pulse_input_shown_bundle();
--> statement-breakpoint
CREATE FUNCTION pulse_input_shown_delivery() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.direction='outbound' AND NEW.sent_at IS NOT NULL AND NEW.delivery_recorded_at IS NOT NULL THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('pulse-report-subject:'||NEW.tenant_id::text||':'||NEW.user_id::text,0));
  UPDATE survey_report_shown_components SET sent_at=NEW.sent_at,acknowledged_at=NEW.delivery_recorded_at WHERE prompt_message_id=NEW.id AND tenant_id=NEW.tenant_id AND user_id=NEW.user_id AND sent_at IS NULL;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER pulse_input_shown_delivery AFTER UPDATE OF sent_at,delivery_recorded_at ON messages FOR EACH ROW EXECUTE FUNCTION pulse_input_shown_delivery();
--> statement-breakpoint
CREATE FUNCTION pulse_input_verdict_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM survey_report_inbound_work WHERE inbound_receipt_id=NEW.inbound_message_id) THEN
  INSERT INTO survey_report_component_verdicts(tenant_id,user_id,inbound_receipt_id,prompt_message_id,ordinal,outcome)
  SELECT NEW.tenant_id,NEW.user_id,NEW.inbound_message_id,s.prompt_message_id,s.ordinal,
   CASE WHEN w.status='confirmed' AND w.confirmation_message_id=NEW.inbound_message_id THEN 'accepted' ELSE w.status END
  FROM survey_report_shown_components s JOIN survey_question_working_insights w ON w.id=s.working_insight_id JOIN survey_report_inbound_work r ON r.inbound_receipt_id=NEW.inbound_message_id
  WHERE s.tenant_id=NEW.tenant_id AND s.user_id=NEW.user_id AND (s.bundle_id=NEW.bundle_id OR s.working_insight_id=NEW.working_insight_id) AND s.sent_at<r.received_at AND s.acknowledged_at<r.received_at ON CONFLICT DO NOTHING;
  UPDATE survey_report_inbound_work SET native_verdict='applied',finalization=CASE WHEN EXISTS(SELECT 1 FROM survey_question_working_insights WHERE tenant_id=NEW.tenant_id AND user_id=NEW.user_id AND confirmation_message_id=NEW.inbound_message_id AND finalized_at IS NULL) THEN 'pending' ELSE 'not_applicable' END WHERE inbound_receipt_id=NEW.inbound_message_id;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER pulse_input_verdict_record AFTER INSERT ON survey_question_verdict_receipts FOR EACH ROW EXECUTE FUNCTION pulse_input_verdict_record();
--> statement-breakpoint
CREATE FUNCTION pulse_input_engagement_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE survey_report_inbound_work SET capture=CASE WHEN NEW.status='accepted' THEN 'applied' WHEN NEW.status IN ('invalid','expired') THEN NEW.status WHEN NEW.status='source_deleted' THEN 'deleted' ELSE 'excluded' END WHERE inbound_receipt_id=NEW.inbound_receipt_id AND tenant_id=NEW.tenant_id AND user_id=NEW.user_id;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER pulse_input_engagement_record AFTER INSERT OR UPDATE ON survey_engagement_capture_events FOR EACH ROW EXECUTE FUNCTION pulse_input_engagement_record();
--> statement-breakpoint
CREATE FUNCTION pulse_input_permanent_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO survey_report_topic_watermarks(insight_id,tenant_id,user_id,lineage_id,confirmation_message_id,confirmation_received_at,accepted_source_receipts,state,expires_at)
 SELECT NEW.insight_id,NEW.tenant_id,NEW.user_id,NEW.lineage_id,NEW.confirmation_message_id,NEW.confirmation_received_at,NEW.accepted_source_receipts,'retained',i.processed_at+engagement_retention_days(t.retention_policy)*interval '1 day'
 FROM survey_question_insights i JOIN tenants t ON t.id=i.tenant_id WHERE i.id=NEW.insight_id AND NEW.proof_status='receipt_backed';
 PERFORM pulse_input_bump(NEW.tenant_id,NEW.user_id);
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER pulse_input_permanent_record AFTER INSERT ON survey_report_insight_revisions FOR EACH ROW EXECUTE FUNCTION pulse_input_permanent_record();
--> statement-breakpoint
-- Inventory retained, previously verified permanent proof without upgrading any inbound trust.
INSERT INTO survey_report_topic_watermarks(insight_id,tenant_id,user_id,lineage_id,confirmation_message_id,confirmation_received_at,accepted_source_receipts,state,expires_at)
SELECT r.insight_id,r.tenant_id,r.user_id,r.lineage_id,r.confirmation_message_id,r.confirmation_received_at,r.accepted_source_receipts,CASE WHEN i.withdrawn_at IS NULL THEN 'retained' ELSE 'withdrawn' END,i.processed_at+engagement_retention_days(t.retention_policy)*interval '1 day'
FROM survey_report_insight_revisions r JOIN survey_question_insights i ON i.id=r.insight_id JOIN tenants t ON t.id=r.tenant_id WHERE r.proof_status='receipt_backed';
--> statement-breakpoint
CREATE FUNCTION pulse_input_insight_negative() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('pulse-report-subject:'||OLD.tenant_id::text||':'||OLD.user_id::text,0));
 IF TG_OP='DELETE' OR NEW.withdrawn_at IS NOT NULL THEN
  UPDATE survey_report_topic_watermarks SET state=CASE WHEN TG_OP='UPDATE' THEN 'withdrawn' WHEN expires_at<=clock_timestamp() THEN 'expired' ELSE 'deleted' END WHERE insight_id=OLD.id;
  PERFORM pulse_input_bump(OLD.tenant_id,OLD.user_id);
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aaa_pulse_input_insight_negative BEFORE DELETE OR UPDATE OF withdrawn_at ON survey_question_insights FOR EACH ROW EXECUTE FUNCTION pulse_input_insight_negative();
--> statement-breakpoint
CREATE FUNCTION pulse_input_working_finalized() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.finalized_at IS NOT NULL AND OLD.finalized_at IS NULL AND OLD.confirmation_message_id IS NOT NULL THEN
  UPDATE survey_report_inbound_work SET finalization='applied' WHERE inbound_receipt_id=OLD.confirmation_message_id AND NOT EXISTS(SELECT 1 FROM survey_question_working_insights w WHERE w.id<>NEW.id AND w.tenant_id=NEW.tenant_id AND w.user_id=NEW.user_id AND w.confirmation_message_id=OLD.confirmation_message_id AND w.status='confirmed' AND w.finalized_at IS NULL);
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER pulse_input_working_finalized AFTER UPDATE ON survey_question_working_insights FOR EACH ROW EXECUTE FUNCTION pulse_input_working_finalized();
--> statement-breakpoint
CREATE FUNCTION pulse_input_negative_subject(t uuid,u uuid,kind text,lineage uuid DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('pulse-report-subject:'||t::text||':'||u::text,0));
 UPDATE survey_report_topic_watermarks SET state=CASE WHEN kind='deleted' THEN 'deleted' ELSE 'withdrawn' END WHERE tenant_id=t AND user_id=u AND (lineage IS NULL OR lineage_id=lineage);
 IF lineage IS NULL THEN UPDATE survey_report_inbound_work SET capture=kind,native_verdict=kind,evidence=kind,finalization=kind,attempt_token=NULL,lease_until=NULL WHERE tenant_id=t AND user_id=u; END IF;
 PERFORM pulse_input_bump(t,u);
END $$;
--> statement-breakpoint
CREATE FUNCTION pulse_input_rights_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='survey_reporting_permissions' THEN
  IF NEW.full_reporting_denied THEN PERFORM pulse_input_negative_subject(NEW.tenant_id,NEW.user_id,'excluded'); END IF;
 ELSE PERFORM pulse_input_negative_subject(NEW.tenant_id,NEW.user_id,'excluded',NEW.lineage_id);
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER pulse_input_rights_changed AFTER INSERT OR UPDATE ON survey_reporting_permissions FOR EACH ROW EXECUTE FUNCTION pulse_input_rights_changed();
CREATE TRIGGER pulse_input_exclusions_changed AFTER INSERT ON survey_reporting_lineage_exclusions FOR EACH ROW EXECUTE FUNCTION pulse_input_rights_changed();
--> statement-breakpoint
CREATE FUNCTION pulse_input_subject_erasure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL) OR (OLD.status<>'deleted' AND NEW.status='deleted') THEN PERFORM pulse_input_negative_subject(OLD.tenant_id,OLD.id,'deleted'); END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aaa_pulse_input_subject_erasure BEFORE DELETE OR UPDATE ON users FOR EACH ROW EXECUTE FUNCTION pulse_input_subject_erasure();
--> statement-breakpoint
CREATE FUNCTION pulse_input_completion_closed() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'pulse_final_completion_requires_rpt07_snapshot_fk'; END $$;
CREATE TRIGGER pulse_input_completion_closed BEFORE INSERT OR UPDATE ON survey_report_final_completions FOR EACH ROW EXECUTE FUNCTION pulse_input_completion_closed();
--> statement-breakpoint
CREATE FUNCTION pulse_input_evidence_terminal(r uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 WITH RECURSIVE chain(id,state) AS (
  SELECT inbound_receipt_id,evidence FROM survey_report_inbound_work WHERE inbound_receipt_id=r
  UNION
  SELECT w.inbound_receipt_id,w.evidence FROM chain c JOIN survey_report_work_dependencies d ON d.inbound_receipt_id=c.id JOIN survey_report_inbound_work w ON w.inbound_receipt_id=d.depends_on_receipt_id WHERE c.state='delegated'
 ) SELECT EXISTS(SELECT 1 FROM chain) AND NOT EXISTS(SELECT 1 FROM chain c WHERE c.state IN ('pending','blocked') OR c.state='delegated' AND NOT EXISTS(SELECT 1 FROM survey_report_work_dependencies d WHERE d.inbound_receipt_id=c.id));
$$;
--> statement-breakpoint
CREATE FUNCTION pulse_input_private_form_copy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.components IS NOT NULL AND NEW.prompt_message_id IS NOT NULL AND EXISTS(SELECT 1 FROM survey_report_window_bindings WHERE survey_window_id=NEW.survey_window_id) THEN
  UPDATE messages SET metadata=jsonb_set(metadata,'{nativeShownComponents}',NEW.components) WHERE id=NEW.prompt_message_id AND tenant_id=NEW.tenant_id AND user_id=NEW.user_id;
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER pulse_input_private_form_copy AFTER INSERT ON survey_question_confirmation_bundles FOR EACH ROW EXECUTE FUNCTION pulse_input_private_form_copy();
--> statement-breakpoint
CREATE FUNCTION pulse_input_private_erasure() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE row_data messages%ROWTYPE;
BEGIN
 row_data:=OLD;
 IF OLD.direction='inbound' AND (TG_OP='DELETE' OR OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL) THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('pulse-report-subject:'||OLD.tenant_id::text||':'||OLD.user_id::text,0));
  UPDATE survey_report_inbound_work SET capture=CASE WHEN capture IN ('pending','blocked') THEN 'deleted' ELSE capture END,native_verdict=CASE WHEN native_verdict IN ('pending','claimed','blocked') THEN 'deleted' ELSE native_verdict END,evidence=CASE WHEN evidence IN ('pending','blocked','delegated') THEN 'deleted' ELSE evidence END,finalization=CASE WHEN finalization IN ('pending','blocked') THEN 'deleted' ELSE finalization END,attempt_token=NULL,lease_until=NULL,failure_code=NULL WHERE inbound_receipt_id=OLD.id;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER pulse_input_private_erasure BEFORE DELETE OR UPDATE OF deleted_at ON messages FOR EACH ROW EXECUTE FUNCTION pulse_input_private_erasure();
--> statement-breakpoint
CREATE FUNCTION pulse_input_shown_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.tenant_id,NEW.user_id,NEW.conversation_id,NEW.bundle_id,NEW.prompt_message_id,NEW.survey_window_id,NEW.survey_question_id,NEW.question_version,NEW.ordinal,NEW.working_insight_id,NEW.working_revision_hash,NEW.component_hash,NEW.form_hash) IS DISTINCT FROM ROW(OLD.tenant_id,OLD.user_id,OLD.conversation_id,OLD.bundle_id,OLD.prompt_message_id,OLD.survey_window_id,OLD.survey_question_id,OLD.question_version,OLD.ordinal,OLD.working_insight_id,OLD.working_revision_hash,OLD.component_hash,OLD.form_hash) OR OLD.sent_at IS NOT NULL AND ROW(OLD.sent_at,OLD.acknowledged_at) IS DISTINCT FROM ROW(NEW.sent_at,NEW.acknowledged_at) THEN RAISE EXCEPTION 'pulse_shown_identity_immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER pulse_input_shown_immutable BEFORE UPDATE ON survey_report_shown_components FOR EACH ROW EXECUTE FUNCTION pulse_input_shown_immutable();
