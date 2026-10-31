ALTER TABLE "messages" ADD COLUMN "delivery_attempted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "engagement_delivery_proof" jsonb;--> statement-breakpoint
ALTER TABLE "survey_engagement_answer_revisions" ADD COLUMN "accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "survey_engagement_capture_events" ADD COLUMN "captured_at" timestamp with time zone;
--> statement-breakpoint
-- Historical rows retain NULL clocks/proof; only actual new events acquire DB-authored time.
CREATE OR REPLACE FUNCTION engagement_message_clock_guard() RETURNS trigger AS $$
DECLARE first_ack boolean; erasure boolean;
BEGIN
  IF TG_OP='INSERT' THEN
    NEW.persisted_at:=clock_timestamp();
    NEW.delivery_attempted_at:=CASE WHEN NEW.delivery_attempted_at IS NOT NULL THEN clock_timestamp() ELSE NULL END;
    NEW.delivery_recorded_at:=CASE WHEN NEW.sent_at IS NOT NULL THEN clock_timestamp() ELSE NULL END;
    NEW.engagement_delivery_proof:=NULL;
    first_ack:=NEW.sent_at IS NOT NULL;
  ELSE
    NEW.persisted_at:=OLD.persisted_at;
    NEW.delivery_attempted_at:=CASE WHEN OLD.delivery_attempted_at IS NULL AND NEW.delivery_attempted_at IS NOT NULL THEN clock_timestamp() ELSE OLD.delivery_attempted_at END;
    first_ack:=OLD.delivery_recorded_at IS NULL AND NEW.sent_at IS NOT NULL;
    NEW.delivery_recorded_at:=CASE WHEN first_ack THEN clock_timestamp() ELSE OLD.delivery_recorded_at END;
    NEW.engagement_delivery_proof:=OLD.engagement_delivery_proof;
    IF OLD.engagement_delivery_proof IS NOT NULL THEN
      erasure:=NEW.deleted_at IS NOT NULL AND NEW.text='[deleted]' AND NEW.normalized_text IS NULL AND NEW.metadata='{}'::jsonb;
      IF NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.user_id IS DISTINCT FROM OLD.user_id
        OR NEW.conversation_id IS DISTINCT FROM OLD.conversation_id OR NEW.direction IS DISTINCT FROM OLD.direction
        OR NEW.sent_at IS DISTINCT FROM OLD.sent_at OR NEW.external_message_id IS DISTINCT FROM OLD.external_message_id
        OR NEW.external_thread_id IS DISTINCT FROM OLD.external_thread_id
        OR (NOT erasure AND (NEW.text IS DISTINCT FROM OLD.text OR NEW.metadata->'engagementProbe' IS DISTINCT FROM OLD.metadata->'engagementProbe'
          OR (OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL))) THEN
        RAISE EXCEPTION 'engagement_delivered_form_immutable';
      END IF;
    END IF;
  END IF;
  IF first_ack AND NEW.direction='outbound' AND NEW.metadata ? 'engagementProbe' THEN
    -- Whitelist identifiers and hashes; never copy arbitrary metadata or private text.
    NEW.engagement_delivery_proof:=jsonb_build_object(
      'contractVersion',NEW.metadata->'engagementProbe'->>'contractVersion',
      'surveyDefinitionId',NEW.metadata->'engagementProbe'->>'surveyDefinitionId',
      'surveyWindowId',NEW.metadata->'engagementProbe'->>'surveyWindowId',
      'questionId',NEW.metadata->'engagementProbe'->>'questionId',
      'questionVersion',NEW.metadata->'engagementProbe'->>'questionVersion',
      'stableKey',NEW.metadata->'engagementProbe'->>'stableKey',
      'displayedFormHash',NEW.metadata->'engagementProbe'->>'displayedFormHash',
      'actualFormHash',encode(sha256(convert_to(NEW.text,'UTF8')),'hex'));
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION engagement_answer_guard() RETURNS trigger AS $$
DECLARE source messages%ROWTYPE; prompt messages%ROWTYPE; decision text; retention_days numeric;
BEGIN
  IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'engagement_answer_immutable'; END IF;
  NEW.accepted_at:=clock_timestamp();
  PERFORM pg_advisory_xact_lock(hashtextextended('pulse-report-subject:' || NEW.tenant_id::text || ':' || NEW.user_id::text,0));
  SELECT * INTO source FROM messages WHERE id=NEW.inbound_receipt_id AND tenant_id=NEW.tenant_id AND user_id=NEW.user_id AND direction='inbound' AND deleted_at IS NULL;
  IF source.id IS NULL OR source.received_at IS DISTINCT FROM NEW.answer_received_at THEN RAISE EXCEPTION 'engagement_source_identity_mismatch'; END IF;
  IF EXISTS(SELECT 1 FROM messages WHERE tenant_id=NEW.tenant_id AND user_id=NEW.user_id AND conversation_id=source.conversation_id
      AND direction='outbound' AND persisted_at<source.received_at
      AND (delivery_attempted_at<source.received_at OR delivery_recorded_at IS NOT NULL)
      AND (delivery_recorded_at IS NULL OR delivery_recorded_at>=source.received_at)) THEN RAISE EXCEPTION 'engagement_delivery_ambiguous'; END IF;
  SELECT * INTO prompt FROM messages WHERE tenant_id=NEW.tenant_id AND user_id=NEW.user_id AND conversation_id=source.conversation_id
    AND direction='outbound' AND sent_at < source.received_at AND delivery_recorded_at < source.received_at ORDER BY sent_at DESC,id DESC LIMIT 1;
  IF prompt.engagement_delivery_proof IS NULL
    OR prompt.engagement_delivery_proof-'actualFormHash' IS DISTINCT FROM prompt.metadata->'engagementProbe'
    OR prompt.engagement_delivery_proof->>'actualFormHash' IS DISTINCT FROM NEW.displayed_form_hash
    OR NEW.prompt_acknowledged_at IS NULL OR NEW.prompt_acknowledged_at IS DISTINCT FROM prompt.delivery_recorded_at OR prompt.delivery_recorded_at IS NULL OR prompt.delivery_recorded_at>=source.received_at OR prompt.sent_at IS NULL OR prompt.sent_at>=source.received_at OR prompt.deleted_at IS NOT NULL OR prompt.id IS DISTINCT FROM NEW.prompt_message_id OR prompt.sent_at IS DISTINCT FROM NEW.prompt_sent_at
    OR prompt.metadata->'engagementProbe'->>'surveyWindowId' IS DISTINCT FROM NEW.survey_window_id::text
    OR prompt.metadata->'engagementProbe'->>'surveyDefinitionId' IS DISTINCT FROM NEW.survey_definition_id::text
    OR prompt.metadata->'engagementProbe'->>'stableKey' IS DISTINCT FROM NEW.stable_key
    OR prompt.metadata->'engagementProbe'->>'questionId' IS DISTINCT FROM NEW.survey_question_id::text
    OR prompt.metadata->'engagementProbe'->>'questionVersion' IS DISTINCT FROM NEW.question_version
    OR prompt.metadata->'engagementProbe'->>'contractVersion' IS DISTINCT FROM NEW.contract_version
    OR prompt.metadata->'engagementProbe'->>'displayedFormHash' IS DISTINCT FROM NEW.displayed_form_hash
    OR encode(sha256(convert_to(prompt.text,'UTF8')),'hex') <> NEW.displayed_form_hash THEN RAISE EXCEPTION 'engagement_prompt_identity_mismatch'; END IF;
  IF NOT EXISTS(SELECT 1 FROM survey_engagement_contract_questions q JOIN survey_windows w ON w.id=NEW.survey_window_id
      JOIN survey_engagement_collection_contracts envelope ON envelope.survey_definition_id=w.survey_definition_id AND envelope.tenant_id=w.tenant_id AND envelope.contract_version=q.contract_version
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
CREATE OR REPLACE FUNCTION engagement_event_identity_guard() RETURNS trigger AS $$
BEGIN
  NEW.captured_at:=clock_timestamp();
  PERFORM pg_advisory_xact_lock(hashtextextended('pulse-report-subject:' || NEW.tenant_id::text || ':' || NEW.user_id::text,0));
  IF NEW.survey_window_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM survey_windows WHERE id=NEW.survey_window_id AND tenant_id=NEW.tenant_id AND user_id=NEW.user_id) THEN RAISE EXCEPTION 'engagement_event_window_mismatch'; END IF;
  IF NEW.lineage_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM survey_report_question_lineages WHERE id=NEW.lineage_id AND tenant_id=NEW.tenant_id AND user_id=NEW.user_id AND answer_kind='numeric_1_10_integer' AND answer_contract=NEW.contract_version) THEN RAISE EXCEPTION 'engagement_event_lineage_mismatch'; END IF;
  IF NEW.status='accepted' AND (NEW.survey_window_id IS NULL OR NEW.lineage_id IS NULL OR NEW.contract_version IS DISTINCT FROM 'engagement-1-10-v1') THEN RAISE EXCEPTION 'engagement_event_accepted_proof_required'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
