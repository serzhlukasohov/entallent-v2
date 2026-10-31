CREATE TABLE IF NOT EXISTS "survey_engagement_answer_revisions" (
	"inbound_receipt_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"survey_window_id" uuid NOT NULL,
	"cycle_scoring_policy_id" uuid NOT NULL,
	"lineage_id" uuid NOT NULL,
	"survey_definition_id" uuid NOT NULL,
	"survey_question_id" uuid NOT NULL,
	"question_version" text NOT NULL,
	"stable_key" text NOT NULL,
	"contract_version" text NOT NULL,
	"value" integer NOT NULL,
	"answer_received_at" timestamp with time zone NOT NULL,
	"prompt_message_id" uuid NOT NULL,
	"prompt_sent_at" timestamp with time zone NOT NULL,
	"displayed_form_hash" text NOT NULL,
	"permission_revision" integer NOT NULL,
	"proof_kind" text DEFAULT 'direct_explicit_answer' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "engagement_answer_value" CHECK ("survey_engagement_answer_revisions"."value" BETWEEN 1 AND 10 AND "survey_engagement_answer_revisions"."proof_kind" = 'direct_explicit_answer' AND "survey_engagement_answer_revisions"."contract_version" = 'engagement-1-10-v1' AND "survey_engagement_answer_revisions"."question_version" = "survey_engagement_answer_revisions"."contract_version" AND "survey_engagement_answer_revisions"."permission_revision" >= 0 AND "survey_engagement_answer_revisions"."prompt_sent_at" < "survey_engagement_answer_revisions"."answer_received_at" AND "survey_engagement_answer_revisions"."expires_at" > "survey_engagement_answer_revisions"."answer_received_at")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "survey_engagement_capture_events" (
	"inbound_receipt_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text NOT NULL,
	"answer_received_at" timestamp with time zone NOT NULL,
	"survey_window_id" uuid,
	"lineage_id" uuid,
	"contract_version" text,
	CONSTRAINT "engagement_capture_subject_receipt" UNIQUE("tenant_id","user_id","inbound_receipt_id"),
	CONSTRAINT "engagement_capture_status" CHECK ("survey_engagement_capture_events"."status" IN ('accepted','invalid','ineligible','expired','source_deleted','withdrawn'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "survey_engagement_contract_questions" (
	"survey_question_id" uuid PRIMARY KEY NOT NULL,
	"survey_definition_id" uuid NOT NULL,
	"contract_version" text NOT NULL,
	"stable_key" text NOT NULL,
	"question_version" text NOT NULL,
	"displayed_text_hash" text NOT NULL,
	CONSTRAINT "engagement_contract_topic" UNIQUE("survey_definition_id","stable_key"),
	CONSTRAINT "engagement_contract_version" CHECK ("survey_engagement_contract_questions"."contract_version" = 'engagement-1-10-v1' AND "survey_engagement_contract_questions"."question_version" = "survey_engagement_contract_questions"."contract_version" AND "survey_engagement_contract_questions"."stable_key" IN ('engagement_nps','engagement_motivation','engagement_current'))
);
--> statement-breakpoint
ALTER TABLE "survey_report_question_lineages" ADD COLUMN "answer_kind" text DEFAULT 'open_ended' NOT NULL;--> statement-breakpoint
ALTER TABLE "survey_report_question_lineages" ADD COLUMN "answer_contract" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_engagement_answer_revisions" ADD CONSTRAINT "survey_engagement_answer_revisions_survey_window_id_survey_windows_id_fk" FOREIGN KEY ("survey_window_id") REFERENCES "public"."survey_windows"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_engagement_answer_revisions" ADD CONSTRAINT "survey_engagement_answer_revisions_survey_question_id_survey_engagement_contract_questions_survey_question_id_fk" FOREIGN KEY ("survey_question_id") REFERENCES "public"."survey_engagement_contract_questions"("survey_question_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_engagement_answer_revisions" ADD CONSTRAINT "survey_engagement_answer_revisions_tenant_id_user_id_inbound_receipt_id_survey_engagement_capture_events_tenant_id_user_id_inbound_receipt_id_fk" FOREIGN KEY ("tenant_id","user_id","inbound_receipt_id") REFERENCES "public"."survey_engagement_capture_events"("tenant_id","user_id","inbound_receipt_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_engagement_answer_revisions" ADD CONSTRAINT "survey_engagement_answer_revisions_tenant_id_user_id_lineage_id_survey_report_question_lineages_tenant_id_user_id_id_fk" FOREIGN KEY ("tenant_id","user_id","lineage_id") REFERENCES "public"."survey_report_question_lineages"("tenant_id","user_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_engagement_capture_events" ADD CONSTRAINT "survey_engagement_capture_events_survey_window_id_survey_windows_id_fk" FOREIGN KEY ("survey_window_id") REFERENCES "public"."survey_windows"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_engagement_capture_events" ADD CONSTRAINT "survey_engagement_capture_events_lineage_id_survey_report_question_lineages_id_fk" FOREIGN KEY ("lineage_id") REFERENCES "public"."survey_report_question_lineages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_engagement_capture_events" ADD CONSTRAINT "survey_engagement_capture_events_user_id_tenant_id_users_id_tenant_id_fk" FOREIGN KEY ("user_id","tenant_id") REFERENCES "public"."users"("id","tenant_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_engagement_contract_questions" ADD CONSTRAINT "survey_engagement_contract_questions_survey_question_id_survey_questions_id_fk" FOREIGN KEY ("survey_question_id") REFERENCES "public"."survey_questions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_engagement_contract_questions" ADD CONSTRAINT "survey_engagement_contract_questions_survey_definition_id_survey_definitions_id_fk" FOREIGN KEY ("survey_definition_id") REFERENCES "public"."survey_definitions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION survey_insight_v2_validate_canonical_question_map() RETURNS trigger AS $$
DECLARE definition_version text;
BEGIN
  SELECT version INTO definition_version FROM survey_definitions WHERE id = NEW.survey_definition_id;
  IF definition_version = 'v2-report-engagement-1.0.0' THEN
    IF (SELECT count(*) FROM survey_questions WHERE survey_definition_id=NEW.survey_definition_id) <> 15
      OR (SELECT count(*) FROM survey_engagement_contract_questions WHERE survey_definition_id=NEW.survey_definition_id AND contract_version='engagement-1-10-v1') <> 3
      OR NOT EXISTS(SELECT 1 FROM survey_definitions WHERE id=NEW.survey_definition_id AND configuration->>'engagementAnswerContract'='engagement-1-10-v1') THEN
      RAISE EXCEPTION 'engagement_catalog_incomplete'; END IF;
  END IF;
  IF definition_version IN ('v2-policy-1.0.0','v2-report-engagement-1.0.0') THEN
    IF (SELECT count(*) FROM survey_questions
        WHERE survey_definition_id = NEW.survey_definition_id AND response_type = 'open_ended') <> 12
      OR EXISTS (
        SELECT 1 FROM (VALUES
          ('autonomy_control_work', 'autonomy'),
          ('autonomy_voice_influence', 'autonomy'),
          ('autonomy_expectation_clarity', 'autonomy'),
          ('growth_skill_development', 'growth'),
          ('growth_useful_feedback', 'growth'),
          ('growth_future_opportunities', 'growth'),
          ('purpose_personal_meaning', 'purpose'),
          ('purpose_contribution_visibility', 'purpose'),
          ('purpose_recognition', 'purpose'),
          ('belonging_team', 'belonging'),
          ('belonging_psychological_safety', 'belonging'),
          ('belonging_manager_support', 'belonging')
        ) AS expected(stable_key, question_group)
        WHERE NOT EXISTS (
          SELECT 1 FROM survey_questions question
          WHERE question.survey_definition_id = NEW.survey_definition_id
            AND question.response_type = 'open_ended'
            AND question.stable_key = expected.stable_key
            AND question.question_group = expected.question_group
        )
      ) THEN
      RAISE EXCEPTION 'survey_insight_v2_cycle_question_map_invalid';
    END IF;
  ELSE
    IF (SELECT count(*) FROM survey_questions
        WHERE survey_definition_id = NEW.survey_definition_id AND response_type = 'open_ended') <> 12
      OR EXISTS (
        SELECT 1 FROM (VALUES
          ('q12_expectations', 'autonomy'), ('q12_strengths_opportunity', 'autonomy'),
          ('q12_opinions_count', 'autonomy'), ('wellbeing_at_work', 'belonging'),
          ('q12_supervisor_cares', 'belonging'), ('belonging_psychological_safety', 'belonging'),
          ('role_clarity', 'growth'), ('professional_growth', 'growth'),
          ('q12_progress_discussion', 'growth'), ('q12_recognition', 'purpose'),
          ('purpose_meaning', 'purpose'), ('purpose_contribution', 'purpose')
        ) AS expected(stable_key, question_group)
        WHERE NOT EXISTS (
          SELECT 1 FROM survey_questions question
          WHERE question.survey_definition_id = NEW.survey_definition_id
            AND question.response_type = 'open_ended'
            AND question.stable_key = expected.stable_key
            AND question.question_group = expected.question_group
        )
      ) THEN
      RAISE EXCEPTION 'survey_insight_v2_cycle_question_map_invalid';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION pulse_report_lineage(window_id uuid, question_id uuid) RETURNS uuid AS $$
DECLARE lineage uuid; w survey_windows%ROWTYPE; q survey_questions%ROWTYPE; c survey_cycle_scoring_policies%ROWTYPE;
BEGIN
 SELECT * INTO w FROM survey_windows WHERE id = window_id;
 SELECT * INTO q FROM survey_questions WHERE id = question_id AND survey_definition_id = w.survey_definition_id AND response_type IN ('open_ended','numeric_1_10_integer');
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT cycle.* INTO c FROM survey_cycle_scoring_policies cycle JOIN survey_window_scoring_policies b ON b.survey_window_id = w.id AND b.tenant_id = w.tenant_id AND b.scoring_policy_id = cycle.scoring_policy_id
 JOIN survey_scoring_policies policy ON policy.id = cycle.scoring_policy_id AND policy.tenant_id = cycle.tenant_id
 WHERE cycle.tenant_id = w.tenant_id AND cycle.survey_definition_id = w.survey_definition_id AND cycle.period_start = w.period_start AND cycle.period_end = w.period_end AND ((q.response_type='open_ended' AND jsonb_typeof(policy.rubrics -> q.stable_key) = 'object') OR (q.response_type='numeric_1_10_integer' AND EXISTS(SELECT 1 FROM survey_engagement_contract_questions contract WHERE contract.survey_question_id=q.id AND contract.survey_definition_id=w.survey_definition_id AND contract.question_version=q.version)));
 IF NOT FOUND THEN RETURN NULL; END IF;
 INSERT INTO survey_report_question_lineages(tenant_id, cycle_scoring_policy_id, user_id, question_stable_key, survey_question_id, question_version, scoring_policy_id, answer_kind, answer_contract)
 VALUES(w.tenant_id, c.id, w.user_id, q.stable_key, q.id, q.version, c.scoring_policy_id, q.response_type, CASE WHEN q.response_type='numeric_1_10_integer' THEN 'engagement-1-10-v1' ELSE NULL END)
 ON CONFLICT (tenant_id, cycle_scoring_policy_id, user_id, question_stable_key) DO NOTHING;
 SELECT id INTO lineage FROM survey_report_question_lineages WHERE tenant_id = w.tenant_id AND cycle_scoring_policy_id = c.id AND user_id = w.user_id AND question_stable_key = q.stable_key AND survey_question_id = q.id AND question_version = q.version AND scoring_policy_id = c.scoring_policy_id;
 RETURN lineage;
END; $$ LANGUAGE plpgsql;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION pulse_report_metadata_identity_guard() RETURNS trigger AS $$
BEGIN
 IF TG_TABLE_NAME = 'survey_report_insight_revisions' THEN
   IF TG_OP = 'DELETE' AND (NOT EXISTS(SELECT 1 FROM survey_question_insights WHERE id = OLD.insight_id) OR NOT EXISTS(SELECT 1 FROM users WHERE id = OLD.user_id AND tenant_id = OLD.tenant_id)) THEN RETURN OLD; END IF;
   IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'pulse_report_revision_metadata_immutable'; END IF;
   IF NOT EXISTS(SELECT 1 FROM survey_question_insights i JOIN survey_report_question_lineages l ON l.id = NEW.lineage_id AND l.tenant_id = i.tenant_id AND l.user_id = i.user_id AND l.survey_question_id = i.survey_question_id AND l.question_version = i.question_version JOIN survey_windows w ON w.id = i.survey_window_id AND w.tenant_id = i.tenant_id AND w.user_id = i.user_id JOIN survey_cycle_scoring_policies c ON c.id = l.cycle_scoring_policy_id AND c.tenant_id = l.tenant_id AND c.survey_definition_id = w.survey_definition_id AND c.period_start = w.period_start AND c.period_end = w.period_end WHERE i.id = NEW.insight_id AND i.tenant_id = NEW.tenant_id AND i.user_id = NEW.user_id) THEN RAISE EXCEPTION 'pulse_report_revision_metadata_scope_mismatch'; END IF;
 ELSE
   IF NOT EXISTS(SELECT 1 FROM survey_cycle_scoring_policies c JOIN survey_questions q ON q.survey_definition_id = c.survey_definition_id AND q.id = NEW.survey_question_id AND q.stable_key = NEW.question_stable_key AND q.version = NEW.question_version JOIN survey_scoring_policies policy ON policy.id = c.scoring_policy_id AND policy.tenant_id = c.tenant_id AND ((NEW.answer_kind='open_ended' AND NEW.answer_contract IS NULL AND q.response_type='open_ended' AND jsonb_typeof(policy.rubrics -> q.stable_key) = 'object') OR (NEW.answer_kind='numeric_1_10_integer' AND NEW.answer_contract='engagement-1-10-v1' AND q.response_type='numeric_1_10_integer' AND EXISTS(SELECT 1 FROM survey_engagement_contract_questions contract WHERE contract.survey_question_id=q.id AND contract.survey_definition_id=c.survey_definition_id AND contract.question_version=q.version))) WHERE c.id = NEW.cycle_scoring_policy_id AND c.tenant_id = NEW.tenant_id AND c.scoring_policy_id = NEW.scoring_policy_id) THEN RAISE EXCEPTION 'pulse_report_lineage_scope_mismatch'; END IF;
 END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE FUNCTION engagement_contract_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM survey_definitions WHERE id=OLD.survey_definition_id) THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'engagement_contract_immutable';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM survey_questions q JOIN survey_definitions d ON d.id=q.survey_definition_id
    WHERE q.id=NEW.survey_question_id AND q.survey_definition_id=NEW.survey_definition_id
      AND q.stable_key=NEW.stable_key AND q.version=NEW.question_version AND q.question_group='engagement'
      AND q.response_type='numeric_1_10_integer' AND d.version='v2-report-engagement-1.0.0'
      AND d.configuration->>'engagementAnswerContract'=NEW.contract_version
      AND encode(sha256(convert_to(q.title,'UTF8')),'hex')=NEW.displayed_text_hash) THEN RAISE EXCEPTION 'engagement_contract_identity_mismatch'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER engagement_contract_immutable BEFORE INSERT OR UPDATE OR DELETE ON survey_engagement_contract_questions FOR EACH ROW EXECUTE FUNCTION engagement_contract_guard();
--> statement-breakpoint
CREATE FUNCTION engagement_question_immutable() RETURNS trigger AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM survey_engagement_contract_questions WHERE survey_question_id=OLD.id)
    AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN RAISE EXCEPTION 'engagement_question_immutable'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER engagement_question_immutable BEFORE UPDATE ON survey_questions FOR EACH ROW EXECUTE FUNCTION engagement_question_immutable();
--> statement-breakpoint
CREATE FUNCTION engagement_answer_guard() RETURNS trigger AS $$
DECLARE source messages%ROWTYPE; prompt messages%ROWTYPE; decision text; retention_days integer;
BEGIN
  IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'engagement_answer_immutable'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('pulse-report-subject:' || NEW.tenant_id::text || ':' || NEW.user_id::text,0));
  SELECT * INTO source FROM messages WHERE id=NEW.inbound_receipt_id AND tenant_id=NEW.tenant_id AND user_id=NEW.user_id AND direction='inbound' AND deleted_at IS NULL;
  IF source.id IS NULL OR source.received_at IS DISTINCT FROM NEW.answer_received_at THEN RAISE EXCEPTION 'engagement_source_identity_mismatch'; END IF;
  SELECT * INTO prompt FROM messages WHERE tenant_id=NEW.tenant_id AND user_id=NEW.user_id AND conversation_id=source.conversation_id
    AND direction='outbound' AND sent_at < source.received_at AND deleted_at IS NULL ORDER BY sent_at DESC,id DESC LIMIT 1;
  IF prompt.id IS DISTINCT FROM NEW.prompt_message_id OR prompt.sent_at IS DISTINCT FROM NEW.prompt_sent_at
    OR prompt.metadata->'engagementProbe'->>'surveyWindowId' IS DISTINCT FROM NEW.survey_window_id::text
    OR prompt.metadata->'engagementProbe'->>'questionId' IS DISTINCT FROM NEW.survey_question_id::text
    OR prompt.metadata->'engagementProbe'->>'questionVersion' IS DISTINCT FROM NEW.question_version
    OR prompt.metadata->'engagementProbe'->>'contractVersion' IS DISTINCT FROM NEW.contract_version
    OR prompt.metadata->'engagementProbe'->>'displayedFormHash' IS DISTINCT FROM NEW.displayed_form_hash
    OR encode(sha256(convert_to(prompt.text,'UTF8')),'hex') <> NEW.displayed_form_hash THEN RAISE EXCEPTION 'engagement_prompt_identity_mismatch'; END IF;
  IF NOT EXISTS(SELECT 1 FROM survey_engagement_contract_questions q JOIN survey_windows w ON w.id=NEW.survey_window_id
      JOIN survey_report_window_bindings b ON b.survey_window_id=w.id AND b.tenant_id=w.tenant_id
      JOIN survey_report_question_lineages l ON l.id=NEW.lineage_id AND l.tenant_id=w.tenant_id AND l.user_id=w.user_id
    WHERE q.survey_question_id=NEW.survey_question_id AND q.survey_definition_id=NEW.survey_definition_id
      AND q.contract_version=NEW.contract_version AND q.question_version=NEW.question_version AND q.stable_key=NEW.stable_key
      AND w.tenant_id=NEW.tenant_id AND w.user_id=NEW.user_id AND w.survey_definition_id=q.survey_definition_id
      AND l.survey_question_id=q.survey_question_id AND l.cycle_scoring_policy_id=b.cycle_scoring_policy_id
      AND NEW.cycle_scoring_policy_id=b.cycle_scoring_policy_id AND NEW.answer_received_at>=w.period_end-interval '14 days'
      AND l.answer_kind='numeric_1_10_integer' AND l.answer_contract=NEW.contract_version)
    OR NOT EXISTS(SELECT 1 FROM survey_engagement_capture_events e WHERE e.inbound_receipt_id=NEW.inbound_receipt_id AND e.tenant_id=NEW.tenant_id AND e.user_id=NEW.user_id AND e.status='accepted' AND e.survey_window_id=NEW.survey_window_id AND e.lineage_id=NEW.lineage_id AND e.answer_received_at=NEW.answer_received_at) THEN RAISE EXCEPTION 'engagement_answer_scope_mismatch'; END IF;
  decision:=pulse_report_admission(NEW.tenant_id,NEW.user_id,NEW.survey_window_id,NEW.survey_question_id,NEW.inbound_receipt_id);
  IF decision<>'allowed' THEN RAISE EXCEPTION 'engagement_answer_admission_denied'; END IF;
  IF NEW.permission_revision<>coalesce((SELECT revision FROM survey_reporting_permissions WHERE tenant_id=NEW.tenant_id AND user_id=NEW.user_id),0) THEN RAISE EXCEPTION 'engagement_permission_revision_mismatch'; END IF;
  SELECT CASE WHEN jsonb_typeof(retention_policy->'memoryRetentionDays')='number' AND (retention_policy->>'memoryRetentionDays')::numeric BETWEEN 1 AND 36500 THEN (retention_policy->>'memoryRetentionDays')::integer ELSE 730 END INTO retention_days FROM tenants WHERE id=NEW.tenant_id;
  IF NEW.expires_at>NEW.answer_received_at+make_interval(days=>retention_days) OR NEW.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'engagement_answer_expired'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER engagement_answer_guard BEFORE INSERT OR UPDATE ON survey_engagement_answer_revisions FOR EACH ROW EXECUTE FUNCTION engagement_answer_guard();
--> statement-breakpoint
CREATE FUNCTION engagement_definition_immutable() RETURNS trigger AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM survey_engagement_contract_questions WHERE survey_definition_id=OLD.id)
    AND (NEW.version IS DISTINCT FROM OLD.version OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.configuration IS DISTINCT FROM OLD.configuration) THEN RAISE EXCEPTION 'engagement_definition_immutable'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER engagement_definition_immutable BEFORE UPDATE ON survey_definitions FOR EACH ROW EXECUTE FUNCTION engagement_definition_immutable();
--> statement-breakpoint
CREATE FUNCTION engagement_history_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id AND tenant_id=OLD.tenant_id) THEN RETURN OLD; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('pulse-report-subject:' || OLD.tenant_id::text || ':' || OLD.user_id::text,0));
  IF TG_TABLE_NAME='survey_engagement_capture_events' THEN
    IF TG_OP='UPDATE' AND (to_jsonb(NEW)-'status')=(to_jsonb(OLD)-'status') AND OLD.status='accepted' AND NEW.status IN ('expired','withdrawn') THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'engagement_capture_event_immutable';
  END IF;
  IF EXISTS(SELECT 1 FROM survey_engagement_capture_events WHERE inbound_receipt_id=OLD.inbound_receipt_id AND status IN ('expired','withdrawn')) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'engagement_answer_history_immutable';
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER engagement_event_history BEFORE UPDATE OR DELETE ON survey_engagement_capture_events FOR EACH ROW EXECUTE FUNCTION engagement_history_guard();
CREATE TRIGGER engagement_answer_history BEFORE DELETE ON survey_engagement_answer_revisions FOR EACH ROW EXECUTE FUNCTION engagement_history_guard();
