ALTER TABLE "survey_report_assembly_inputs" ADD COLUMN "source_candidate_ids" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL;--> statement-breakpoint
-- Canonical source dependencies and deadlines are shared by every restricted native copy.
CREATE FUNCTION pulse_candidate_content_deadline(t uuid,ids uuid[]) RETURNS timestamptz LANGUAGE sql STABLE AS $$
 SELECT CASE WHEN count(DISTINCT c.id)<>cardinality(ids) OR bool_or(c.invalidated_at IS NOT NULL) THEN '-infinity'::timestamptz
 ELSE least(min(c.expires_at),min(coalesce(w.expires_at,a.expires_at,'-infinity'::timestamptz)) FILTER(WHERE source.candidate_id IS NOT NULL),min(coalesce(i.processed_at,a.answer_received_at,'-infinity'::timestamptz)+engagement_retention_days(tenant.retention_policy)*interval '1 day') FILTER(WHERE source.candidate_id IS NOT NULL)) END
 FROM survey_report_input_candidates c JOIN tenants tenant ON tenant.id=c.tenant_id
 LEFT JOIN survey_report_candidate_sources source ON source.candidate_id=c.id AND source.tenant_id=c.tenant_id
 LEFT JOIN survey_report_topic_watermarks w ON w.insight_id=source.revision_id AND w.lineage_id=source.lineage_id
 LEFT JOIN survey_question_insights i ON i.id=w.insight_id
 LEFT JOIN survey_engagement_answer_revisions a ON a.inbound_receipt_id=source.revision_id AND a.lineage_id=source.lineage_id
 WHERE c.tenant_id=t AND c.id=ANY(ids)
$$;
--> statement-breakpoint
CREATE FUNCTION pulse_native_section_candidate_ids(sections jsonb) RETURNS uuid[] LANGUAGE sql IMMUTABLE AS $$
 SELECT coalesce(array_agg(DISTINCT id ORDER BY id),ARRAY[]::uuid[]) FROM (
 SELECT (s->>'candidateId')::uuid id FROM jsonb_array_elements(sections) s
 UNION SELECT (h->>'candidateId')::uuid FROM jsonb_array_elements(sections) s CROSS JOIN LATERAL jsonb_array_elements(coalesce(s->'baselineInventory','[]')) h
 WHERE h->>'authorized'='true' AND EXISTS(SELECT 1 FROM jsonb_each(coalesce(s->'baselines','{}')) b WHERE b.value->>'status'='comparable' AND b.value->>'priorCycleId'=h->>'cycleId')
 ) ids WHERE id IS NOT NULL
$$;
--> statement-breakpoint
CREATE FUNCTION pulse_native_purge_snapshot(snapshot uuid,reason text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 UPDATE survey_report_obligations o SET status=CASE WHEN EXISTS(SELECT 1 FROM survey_report_attempts WHERE snapshot_id=snapshot AND state IN ('attempt_started','dispatching','unknown')) THEN 'reconciliation_required' WHEN o.status='delivered' THEN 'delivered' ELSE 'canceled' END,disposition=reason,lease_until=NULL WHERE id=(SELECT obligation_id FROM survey_report_native_snapshots WHERE id=snapshot);
 DELETE FROM survey_report_part_payloads WHERE part_id IN(SELECT id FROM survey_report_parts WHERE snapshot_id=snapshot);
 DELETE FROM survey_report_snapshot_payloads WHERE snapshot_id=snapshot;
 UPDATE survey_report_native_snapshots SET purged_at=clock_timestamp() WHERE id=snapshot AND purged_at IS NULL;
END $$;
--> statement-breakpoint
CREATE FUNCTION pulse_native_scrub_candidate_dependencies(t uuid,candidate uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE item record; retained jsonb; ids uuid[];
BEGIN
 FOR item IN SELECT s.id FROM survey_report_native_snapshots s JOIN survey_report_snapshot_payloads p ON p.snapshot_id=s.id WHERE s.tenant_id=t AND p.contracts->'sourceCandidateIds' ? candidate::text ORDER BY s.id LOOP
  PERFORM pulse_native_purge_snapshot(item.id,'source_content_invalidated');
 END LOOP;
 FOR item IN SELECT i.obligation_id,i.sections FROM survey_report_assembly_inputs i WHERE i.tenant_id=t AND candidate=ANY(i.source_candidate_ids) ORDER BY i.obligation_id LOOP
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(item.sections) s WHERE s->>'candidateId'=candidate::text) THEN
   UPDATE survey_report_obligations SET status='canceled',disposition='current_source_content_invalidated',lease_until=NULL WHERE id=item.obligation_id AND NOT EXISTS(SELECT 1 FROM survey_report_native_snapshots WHERE obligation_id=item.obligation_id);
   DELETE FROM survey_report_assembly_inputs WHERE obligation_id=item.obligation_id;
  ELSE
   -- Historical-only invalidation fences the old prose computation but retains the SAME current observation.
   SELECT jsonb_agg(s||jsonb_build_object('baselines','{}'::jsonb,'baselineInventory',(SELECT coalesce(jsonb_agg(h||jsonb_build_object('metrics','[]'::jsonb)),'[]'::jsonb) FROM jsonb_array_elements(coalesce(s->'baselineInventory','[]')) h))) INTO retained FROM jsonb_array_elements(item.sections) s;
   ids:=pulse_native_section_candidate_ids(retained);
   UPDATE survey_report_assembly_inputs SET sections=retained,source_candidate_ids=ids,expires_at=pulse_candidate_content_deadline(t,ids) WHERE obligation_id=item.obligation_id;
   UPDATE survey_report_obligations SET status='pending',disposition='historical_source_content_invalidated',assembly_token=assembly_token+1,lease_until=NULL,next_action_at=clock_timestamp() WHERE id=item.obligation_id AND status IN('observing','assembling','pending','blocked');
  END IF;
 END LOOP;
END $$;
--> statement-breakpoint
CREATE FUNCTION pulse_native_candidate_invalidated() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 PERFORM pulse_native_scrub_candidate_dependencies(NEW.tenant_id,NEW.id);
 UPDATE survey_report_input_candidates SET metrics='[]'::jsonb WHERE id=NEW.id AND metrics<>'[]'::jsonb;
 RETURN NEW;
END $$;
CREATE TRIGGER pulse_native_candidate_invalidated AFTER UPDATE OF invalidated_at ON survey_report_input_candidates FOR EACH ROW WHEN(NEW.invalidated_at IS NOT NULL AND OLD.invalidated_at IS NULL) EXECUTE FUNCTION pulse_native_candidate_invalidated();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION pulse_native_subject_payload_erasure() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE item record;
BEGIN
 IF TG_OP='UPDATE' AND NOT((OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL) OR (OLD.status<>'deleted' AND NEW.status='deleted')) THEN RETURN NEW; END IF;
 IF NOT EXISTS(SELECT 1 FROM tenants WHERE id=OLD.tenant_id) THEN IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF; END IF;
 -- Canonical ownership is still present here, before subject/source cascades.
 FOR item IN SELECT DISTINCT candidate_id FROM survey_report_candidate_sources WHERE tenant_id=OLD.tenant_id AND user_id=OLD.id ORDER BY candidate_id LOOP
  PERFORM pulse_native_scrub_candidate_dependencies(OLD.tenant_id,item.candidate_id);
  UPDATE survey_report_input_candidates SET invalidated_at=coalesce(invalidated_at,clock_timestamp()),metrics='[]'::jsonb WHERE id=item.candidate_id;
 END LOOP;
 FOR item IN SELECT s.id FROM survey_report_native_snapshots s JOIN survey_report_snapshot_payloads p ON p.snapshot_id=s.id WHERE s.tenant_id=OLD.tenant_id AND (p.route->>'userId'=OLD.id::text OR p.route->>'personId'=OLD.id::text) ORDER BY s.id LOOP
  PERFORM pulse_native_purge_snapshot(item.id,'recipient_content_erased');
 END LOOP;
 FOR item IN SELECT o.id FROM survey_report_obligations o JOIN survey_report_scopes scope ON scope.id=o.scope_id LEFT JOIN org_units unit ON unit.id=scope.org_unit_id LEFT JOIN org_teams team ON team.id=scope.org_team_id WHERE o.tenant_id=OLD.tenant_id AND (CASE WHEN scope.kind='team' THEN team.team_lead_person_id ELSE unit.manager_person_id END)=OLD.id AND EXISTS(SELECT 1 FROM survey_report_assembly_inputs WHERE obligation_id=o.id) ORDER BY o.id LOOP
  UPDATE survey_report_obligations SET status='canceled',disposition='recipient_assembly_erased',lease_until=NULL WHERE id=item.id;
  DELETE FROM survey_report_assembly_inputs WHERE obligation_id=item.id;
 END LOOP;
 DELETE FROM survey_report_recipient_proofs WHERE tenant_id=OLD.tenant_id AND (binding->>'userId'=OLD.id::text OR binding->>'personId'=OLD.id::text);
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
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
 FOR item IN SELECT id FROM survey_report_input_candidates WHERE tenant_id=t AND invalidated_at IS NOT NULL ORDER BY id LOOP
  PERFORM pulse_native_scrub_candidate_dependencies(t,item.id);
 END LOOP;
 -- Completed rows remain as latest-cycle tombstones, never as expired scalar storage.
 UPDATE survey_report_input_candidates SET metrics='[]'::jsonb WHERE tenant_id=t AND invalidated_at IS NOT NULL AND metrics<>'[]'::jsonb;
 DELETE FROM survey_report_candidate_sources source USING survey_report_input_candidates c WHERE source.candidate_id=c.id AND c.tenant_id=t AND c.invalidated_at IS NOT NULL;
 FOR item IN SELECT s.id FROM survey_report_native_snapshots s WHERE s.tenant_id=t AND s.purged_at IS NULL AND (s.expires_at<=clock_timestamp() OR s.created_at<cutoff) ORDER BY s.id LOOP
  PERFORM pulse_native_purge_snapshot(item.id,'retention_purged');
 END LOOP;
 DELETE FROM survey_report_assembly_inputs WHERE tenant_id=t AND (expires_at<=clock_timestamp() OR pulse_candidate_content_deadline(t,source_candidate_ids)<=clock_timestamp());
 DELETE FROM survey_report_recipient_proofs WHERE tenant_id=t AND expires_at<=clock_timestamp();
END $$;
--> statement-breakpoint
-- Upgrade any already-stored copies without mutating a frozen artifact or extending its lifetime.
UPDATE survey_report_assembly_inputs SET source_candidate_ids=pulse_native_section_candidate_ids(sections);
UPDATE survey_report_assembly_inputs SET expires_at=least(expires_at,pulse_candidate_content_deadline(tenant_id,source_candidate_ids));
DO $$ DECLARE item record; BEGIN
 FOR item IN SELECT DISTINCT s.id FROM survey_report_native_snapshots s JOIN survey_report_snapshot_payloads p ON p.snapshot_id=s.id CROSS JOIN LATERAL jsonb_array_elements(p.provenance->'sections') section CROSS JOIN LATERAL jsonb_array_elements(coalesce(section->'baselineInventory','[]')) h WHERE h->'metrics'<>'[]'::jsonb AND NOT(p.contracts->'sourceCandidateIds' ? (h->>'candidateId')) LOOP PERFORM pulse_native_purge_snapshot(item.id,'historical_inventory_minimized'); END LOOP;
END $$;
--> statement-breakpoint
CREATE FUNCTION pulse_native_minimize_history(sections jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT coalesce(jsonb_agg(s||jsonb_build_object('baselineInventory',(SELECT coalesce(jsonb_agg(h||jsonb_build_object('metrics',(SELECT coalesce(jsonb_agg(m),'[]'::jsonb) FROM jsonb_array_elements(coalesce(h->'metrics','[]')) m WHERE h->>'authorized'='true' AND EXISTS(SELECT 1 FROM jsonb_each(coalesce(s->'baselines','{}')) b WHERE b.key=m->>'metricKey' AND b.value->>'status'='comparable' AND b.value->>'priorCycleId'=h->>'cycleId')))),'[]'::jsonb) FROM jsonb_array_elements(coalesce(s->'baselineInventory','[]')) h))),'[]'::jsonb) FROM jsonb_array_elements(sections) s
$$;
UPDATE survey_report_assembly_inputs SET sections=pulse_native_minimize_history(sections);
