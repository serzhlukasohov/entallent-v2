ALTER TABLE "survey_engagement_collection_contracts" DROP CONSTRAINT "survey_engagement_collection_contracts_source_definition_id_survey_definitions_id_fk";
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_engagement_collection_contracts" ADD CONSTRAINT "survey_engagement_collection_contracts_source_definition_id_survey_definitions_id_fk" FOREIGN KEY ("source_definition_id") REFERENCES "public"."survey_definitions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

--> statement-breakpoint
CREATE FUNCTION engagement_retention_days(policy jsonb) RETURNS numeric AS $$
DECLARE duration numeric;
BEGIN
  BEGIN duration:=(policy->>'memoryRetentionDays')::numeric; EXCEPTION WHEN OTHERS THEN RETURN 730; END;
  IF duration IS NULL OR duration<=0 OR duration::text IN ('NaN','Infinity','-Infinity') THEN RETURN 730; END IF;
  RETURN duration;
END; $$ LANGUAGE plpgsql IMMUTABLE;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION engagement_answer_guard() RETURNS trigger AS $$
DECLARE source messages%ROWTYPE; prompt messages%ROWTYPE; decision text; retention_days numeric;
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
  SELECT engagement_retention_days(retention_policy) INTO retention_days FROM tenants WHERE id=NEW.tenant_id;
  IF NEW.expires_at>NEW.answer_received_at+(retention_days*interval '1 day') OR NEW.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'engagement_answer_expired'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

--> statement-breakpoint
CREATE FUNCTION engagement_event_identity_guard() RETURNS trigger AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('pulse-report-subject:' || NEW.tenant_id::text || ':' || NEW.user_id::text,0));
  IF NEW.survey_window_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM survey_windows WHERE id=NEW.survey_window_id AND tenant_id=NEW.tenant_id AND user_id=NEW.user_id) THEN RAISE EXCEPTION 'engagement_event_window_mismatch'; END IF;
  IF NEW.lineage_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM survey_report_question_lineages WHERE id=NEW.lineage_id AND tenant_id=NEW.tenant_id AND user_id=NEW.user_id AND answer_kind='numeric_1_10_integer' AND answer_contract=NEW.contract_version) THEN RAISE EXCEPTION 'engagement_event_lineage_mismatch'; END IF;
  IF NEW.status='accepted' AND (NEW.survey_window_id IS NULL OR NEW.lineage_id IS NULL OR NEW.contract_version IS DISTINCT FROM 'engagement-1-10-v1') THEN RAISE EXCEPTION 'engagement_event_accepted_proof_required'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER engagement_event_identity BEFORE INSERT ON survey_engagement_capture_events FOR EACH ROW EXECUTE FUNCTION engagement_event_identity_guard();
