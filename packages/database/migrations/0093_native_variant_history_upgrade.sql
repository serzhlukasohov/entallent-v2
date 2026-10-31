-- Normalize old producer copies by their authoritative report variant, including metrics within a selected candidate.
CREATE FUNCTION pulse_native_restrict_history(sections jsonb,purpose text,index_key text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT pulse_native_minimize_history(coalesce(jsonb_agg(section||jsonb_build_object('baselines',CASE
  WHEN (purpose<>'final' OR sections->0->>'finalGate'='eligible') AND EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(section->'metrics','[]')) metric WHERE metric->>'metricKey'=CASE WHEN purpose='final' THEN 'engagement' ELSE index_key END AND metric->>'status'='eligible')
  THEN (SELECT coalesce(jsonb_object_agg(key,value),'{}'::jsonb) FROM jsonb_each(coalesce(section->'baselines','{}')) WHERE key=CASE WHEN purpose='final' THEN 'engagement' ELSE index_key END)
  ELSE '{}'::jsonb END) ORDER BY ordinal),'[]'::jsonb))
 FROM jsonb_array_elements(sections) WITH ORDINALITY AS entries(section,ordinal)
$$;
--> statement-breakpoint
-- Content-free old baseline statuses are not copied historical scalars and do not invalidate immutable bytes.
CREATE OR REPLACE FUNCTION pulse_native_historical_content(sections jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT coalesce(jsonb_agg(section||jsonb_build_object('baselines',(SELECT coalesce(jsonb_object_agg(key,value),'{}'::jsonb) FROM jsonb_each(coalesce(section->'baselines','{}')) WHERE value NOT IN ('{"status":"baseline_established"}'::jsonb,'{"status":"no_previous_final"}'::jsonb))) ORDER BY ordinal),'[]'::jsonb)
 FROM jsonb_array_elements(sections) WITH ORDINALITY AS entries(section,ordinal)
$$;
--> statement-breakpoint
CREATE FUNCTION pulse_native_upgrade_history_inventory(t uuid DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
DECLARE item record; narrowed jsonb; ids uuid[];
BEGIN
 -- A frozen artifact is never rewritten to change provenance/hash. Purge the content, keep identity and attempts.
 FOR item IN SELECT snapshot.id FROM survey_report_native_snapshots snapshot
 JOIN survey_report_snapshot_payloads payload ON payload.snapshot_id=snapshot.id
 JOIN survey_report_obligations obligation ON obligation.id=snapshot.obligation_id AND obligation.tenant_id=snapshot.tenant_id
 WHERE (t IS NULL OR snapshot.tenant_id=t) AND pulse_native_historical_content(payload.provenance->'sections') IS DISTINCT FROM pulse_native_historical_content(pulse_native_restrict_history(payload.provenance->'sections',obligation.purpose,obligation.index_key))
 ORDER BY snapshot.tenant_id,snapshot.id LOOP
  PERFORM pulse_native_purge_snapshot(item.id,'historical_variant_content_purged');
 END LOOP;
 FOR item IN SELECT inputs.obligation_id,inputs.tenant_id,inputs.sections,inputs.source_candidate_ids,obligation.purpose,obligation.index_key FROM survey_report_assembly_inputs inputs
 JOIN survey_report_obligations obligation ON obligation.id=inputs.obligation_id AND obligation.tenant_id=inputs.tenant_id
 WHERE (t IS NULL OR inputs.tenant_id=t) AND NOT EXISTS(SELECT 1 FROM survey_report_native_snapshots WHERE obligation_id=inputs.obligation_id)
 ORDER BY inputs.tenant_id,inputs.obligation_id LOOP
  narrowed:=pulse_native_restrict_history(item.sections,item.purpose,item.index_key);
  ids:=pulse_native_section_candidate_ids(narrowed);
  IF item.sections IS DISTINCT FROM narrowed OR item.source_candidate_ids IS DISTINCT FROM ids THEN
   UPDATE survey_report_assembly_inputs SET sections=narrowed,source_candidate_ids=ids,expires_at=pulse_candidate_content_deadline(item.tenant_id,ids) WHERE obligation_id=item.obligation_id AND tenant_id=item.tenant_id;
   UPDATE survey_report_obligations SET assembly_token=assembly_token+1,status='pending',disposition='historical_variant_rebuild_required',lease_until=NULL,next_action_at=clock_timestamp() WHERE id=item.obligation_id AND tenant_id=item.tenant_id AND status IN('observing','assembling','pending','blocked');
  END IF;
 END LOOP;
END $$;
--> statement-breakpoint
SELECT pulse_native_upgrade_history_inventory();
