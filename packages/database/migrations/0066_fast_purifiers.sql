ALTER TABLE "messages" ADD COLUMN "persisted_at" timestamp with time zone;--> statement-breakpoint
-- Database receipts: provider timestamps never backdate when positive delivery became known.
CREATE FUNCTION engagement_message_clock_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    NEW.persisted_at:=clock_timestamp();
    NEW.delivery_recorded_at:=CASE WHEN NEW.sent_at IS NOT NULL THEN clock_timestamp() ELSE NULL END;
  ELSE
    NEW.persisted_at:=OLD.persisted_at;
    IF OLD.sent_at IS NULL AND NEW.sent_at IS NOT NULL THEN NEW.delivery_recorded_at:=clock_timestamp();
    ELSE NEW.delivery_recorded_at:=OLD.delivery_recorded_at; END IF;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER engagement_message_clock BEFORE INSERT OR UPDATE ON messages FOR EACH ROW EXECUTE FUNCTION engagement_message_clock_guard();

--> statement-breakpoint
CREATE OR REPLACE FUNCTION engagement_answer_guard() RETURNS trigger AS $$
DECLARE source messages%ROWTYPE; prompt messages%ROWTYPE; decision text; retention_days numeric;
BEGIN
  IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'engagement_answer_immutable'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('pulse-report-subject:' || NEW.tenant_id::text || ':' || NEW.user_id::text,0));
  SELECT * INTO source FROM messages WHERE id=NEW.inbound_receipt_id AND tenant_id=NEW.tenant_id AND user_id=NEW.user_id AND direction='inbound' AND deleted_at IS NULL;
  IF source.id IS NULL OR source.received_at IS DISTINCT FROM NEW.answer_received_at THEN RAISE EXCEPTION 'engagement_source_identity_mismatch'; END IF;
  SELECT * INTO prompt FROM messages WHERE tenant_id=NEW.tenant_id AND user_id=NEW.user_id AND conversation_id=source.conversation_id
    AND direction='outbound' AND persisted_at < source.received_at ORDER BY persisted_at DESC,id DESC LIMIT 1;
  IF prompt.delivery_recorded_at IS NULL OR prompt.delivery_recorded_at>=source.received_at OR prompt.sent_at IS NULL OR prompt.sent_at>=source.received_at OR prompt.deleted_at IS NOT NULL OR prompt.id IS DISTINCT FROM NEW.prompt_message_id OR prompt.sent_at IS DISTINCT FROM NEW.prompt_sent_at
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
CREATE OR REPLACE FUNCTION engagement_private_proof_erasure() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id AND tenant_id=OLD.tenant_id)
    OR NOT EXISTS(SELECT 1 FROM survey_windows w JOIN survey_report_window_bindings b ON b.survey_window_id=w.id
      JOIN survey_engagement_collection_contracts c ON c.survey_definition_id=w.survey_definition_id
      WHERE w.tenant_id=OLD.tenant_id AND w.user_id=OLD.user_id) THEN RETURN OLD; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('pulse-report-subject:' || OLD.tenant_id::text || ':' || OLD.user_id::text,0));
  IF OLD.direction='inbound' AND OLD.received_at IS NOT NULL THEN
    INSERT INTO survey_engagement_capture_events(inbound_receipt_id,tenant_id,user_id,status,answer_received_at)
      VALUES(OLD.id,OLD.tenant_id,OLD.user_id,'source_deleted',OLD.received_at) ON CONFLICT DO NOTHING;
  ELSIF OLD.direction='outbound' AND OLD.persisted_at IS NOT NULL THEN
    INSERT INTO survey_engagement_capture_events(inbound_receipt_id,tenant_id,user_id,status,answer_received_at)
      SELECT source.id,source.tenant_id,source.user_id,'ineligible',source.received_at FROM messages source
      WHERE source.tenant_id=OLD.tenant_id AND source.user_id=OLD.user_id AND source.conversation_id=OLD.conversation_id
        AND source.direction='inbound' AND source.received_at>OLD.persisted_at
        AND NOT EXISTS(SELECT 1 FROM messages later WHERE later.tenant_id=OLD.tenant_id AND later.user_id=OLD.user_id
          AND later.conversation_id=OLD.conversation_id AND later.direction='outbound' AND later.persisted_at<source.received_at
          AND (later.persisted_at,later.id)>(OLD.persisted_at,OLD.id)) ON CONFLICT DO NOTHING;
  END IF;
  RETURN OLD;
END; $$ LANGUAGE plpgsql;
