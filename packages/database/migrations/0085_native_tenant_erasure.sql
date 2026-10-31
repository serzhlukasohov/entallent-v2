-- Source invalidation and generation can be triggered by tenant cascades after the parent is already absent.
-- No publication state needs repair for a deleted tenant, and no FK should be resurrected.
CREATE OR REPLACE FUNCTION pulse_publication_candidate_invalidated() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM tenants WHERE id=NEW.tenant_id) THEN RETURN NEW; END IF;
 IF OLD.invalidated_at IS NULL AND NEW.invalidated_at IS NOT NULL THEN
  UPDATE survey_report_obligations o SET status=CASE WHEN EXISTS(SELECT 1 FROM survey_report_attempts a WHERE a.snapshot_id=s.id AND a.state IN ('attempt_started','dispatching','unknown')) THEN 'reconciliation_required' ELSE 'canceled' END,disposition='source_invalidated'
  FROM survey_report_native_snapshots s JOIN survey_report_snapshot_payloads p ON p.snapshot_id=s.id
  WHERE o.id=s.obligation_id AND o.status<>'delivered' AND (p.provenance->'sections')::text LIKE '%'||NEW.id::text||'%';
 END IF; RETURN NEW;
END $$;
