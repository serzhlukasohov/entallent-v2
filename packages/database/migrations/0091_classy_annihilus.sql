ALTER TABLE "survey_report_snapshot_payloads" ADD COLUMN "contracts" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION pulse_publication_payload_purge(t uuid,cutoff timestamptz) RETURNS void LANGUAGE plpgsql AS $$
DECLARE item record;
BEGIN
 PERFORM id FROM survey_report_input_candidates WHERE tenant_id=t ORDER BY id FOR UPDATE;
 UPDATE survey_report_input_candidates c SET invalidated_at=coalesce(c.invalidated_at,clock_timestamp()) WHERE c.tenant_id=t AND (c.expires_at<=clock_timestamp() OR (c.context->>'periodStart')::timestamptz<cutoff OR EXISTS(
  SELECT 1 FROM survey_report_candidate_sources source JOIN tenants tenant ON tenant.id=source.tenant_id
  LEFT JOIN survey_report_topic_watermarks w ON w.insight_id=source.revision_id LEFT JOIN survey_question_insights insight ON insight.id=w.insight_id
  LEFT JOIN survey_engagement_answer_revisions a ON a.inbound_receipt_id=source.revision_id
  WHERE source.candidate_id=c.id AND (coalesce(w.expires_at,a.expires_at,'-infinity'::timestamptz)<=clock_timestamp() OR coalesce(insight.processed_at,a.answer_received_at,'-infinity'::timestamptz)<=clock_timestamp()-engagement_retention_days(tenant.retention_policy)*interval '1 day')));
 FOR item IN SELECT s.id,s.obligation_id FROM survey_report_native_snapshots s JOIN survey_report_snapshot_payloads p ON p.snapshot_id=s.id WHERE s.tenant_id=t AND s.purged_at IS NULL AND (s.expires_at<=clock_timestamp() OR s.created_at<cutoff OR EXISTS(SELECT 1 FROM survey_report_input_candidates c WHERE c.tenant_id=t AND c.invalidated_at IS NOT NULL AND p.contracts->'sourceCandidateIds' ? c.id::text)) ORDER BY s.id LOOP
  UPDATE survey_report_obligations SET status=CASE WHEN EXISTS(SELECT 1 FROM survey_report_attempts WHERE snapshot_id=item.id AND state IN ('attempt_started','dispatching','unknown')) THEN 'reconciliation_required' WHEN status='delivered' THEN 'delivered' ELSE 'canceled' END,disposition='retention_purged' WHERE id=item.obligation_id;
  DELETE FROM survey_report_part_payloads WHERE part_id IN(SELECT id FROM survey_report_parts WHERE snapshot_id=item.id);
  DELETE FROM survey_report_snapshot_payloads WHERE snapshot_id=item.id;
  UPDATE survey_report_native_snapshots SET purged_at=clock_timestamp() WHERE id=item.id;
 END LOOP;
 DELETE FROM survey_report_assembly_inputs WHERE tenant_id=t AND expires_at<=clock_timestamp();
 DELETE FROM survey_report_recipient_proofs WHERE tenant_id=t AND expires_at<=clock_timestamp();
END $$;
--> statement-breakpoint
CREATE FUNCTION pulse_native_support_contract_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM survey_report_snapshot_payloads p JOIN survey_cycle_scoring_policies c ON c.id=NEW.cycle_id AND c.tenant_id=NEW.tenant_id JOIN survey_scoring_policies policy ON policy.id=c.scoring_policy_id WHERE p.snapshot_id=NEW.snapshot_id AND p.tenant_id=NEW.tenant_id AND p.contracts->>'scoringPolicyId'=policy.id::text AND p.contracts->>'scoringVersion'=policy.version AND p.contracts->>'calculation'='pulse-calculation-v1' AND p.contracts->>'privacy'='question-deidentification-v2' AND p.contracts->'sourceCandidateIds' ? NEW.candidate_id::text) THEN RAISE EXCEPTION 'pulse_native_support_contract_versions'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER pulse_native_support_contract_guard BEFORE INSERT ON survey_report_completion_supports FOR EACH ROW EXECUTE FUNCTION pulse_native_support_contract_guard();
