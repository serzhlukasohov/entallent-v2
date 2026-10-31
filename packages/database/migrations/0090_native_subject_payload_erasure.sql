-- Lawful erasure purges restricted native payload/provenance, preserving only permitted identity/history/attempt evidence.
-- This trigger runs after existing source/subject invalidation; it requests no history/cycle locks.
CREATE FUNCTION pulse_native_subject_payload_erasure() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE item record;
BEGIN
 IF TG_OP='UPDATE' AND NOT((OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL) OR (OLD.status<>'deleted' AND NEW.status='deleted')) THEN RETURN NEW; END IF;
 IF NOT EXISTS(SELECT 1 FROM tenants WHERE id=OLD.tenant_id) THEN IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF; END IF;
 FOR item IN SELECT s.id,s.obligation_id FROM survey_report_native_snapshots s JOIN survey_report_snapshot_payloads p ON p.snapshot_id=s.id WHERE s.tenant_id=OLD.tenant_id AND (p.provenance::text LIKE '%'||OLD.id::text||'%' OR p.route->>'userId'=OLD.id::text OR p.route->>'personId'=OLD.id::text) ORDER BY s.id LOOP
  UPDATE survey_report_obligations SET status=CASE WHEN EXISTS(SELECT 1 FROM survey_report_attempts WHERE snapshot_id=item.id AND state IN ('attempt_started','dispatching','unknown')) THEN 'reconciliation_required' WHEN status='delivered' THEN 'delivered' ELSE 'canceled' END,disposition='subject_payload_erased' WHERE id=item.obligation_id;
  DELETE FROM survey_report_part_payloads WHERE part_id IN(SELECT id FROM survey_report_parts WHERE snapshot_id=item.id);
  DELETE FROM survey_report_snapshot_payloads WHERE snapshot_id=item.id;
  UPDATE survey_report_native_snapshots SET purged_at=clock_timestamp() WHERE id=item.id AND purged_at IS NULL;
 END LOOP;
 UPDATE survey_report_obligations o SET status='canceled',disposition='subject_assembly_erased',lease_until=NULL
 WHERE o.tenant_id=OLD.tenant_id AND NOT EXISTS(SELECT 1 FROM survey_report_native_snapshots WHERE obligation_id=o.id)
 AND EXISTS(SELECT 1 FROM survey_report_assembly_inputs i WHERE i.obligation_id=o.id AND i.sections::text LIKE '%'||OLD.id::text||'%');
 DELETE FROM survey_report_assembly_inputs WHERE tenant_id=OLD.tenant_id AND sections::text LIKE '%'||OLD.id::text||'%';
 DELETE FROM survey_report_recipient_proofs WHERE tenant_id=OLD.tenant_id AND (binding->>'userId'=OLD.id::text OR binding->>'personId'=OLD.id::text);
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER zzz_pulse_native_subject_payload_erasure BEFORE DELETE OR UPDATE ON users FOR EACH ROW EXECUTE FUNCTION pulse_native_subject_payload_erasure();
