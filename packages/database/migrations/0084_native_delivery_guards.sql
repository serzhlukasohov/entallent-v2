-- RPT07 follow-up from the migrated native RED fixture: tenant erasure can trigger generation cleanup after tenant removal.
CREATE OR REPLACE FUNCTION pulse_publication_wakeup() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM tenants WHERE id=NEW.tenant_id) THEN RETURN NEW; END IF;
 INSERT INTO survey_report_observations(tenant_id,cycle_id,generation) VALUES(NEW.tenant_id,NEW.cycle_id,NEW.generation)
 ON CONFLICT(tenant_id,cycle_id) DO UPDATE SET generation=EXCLUDED.generation,next_observation_at=least(survey_report_observations.next_observation_at,clock_timestamp());
 RETURN NEW;
END $$;
--> statement-breakpoint
-- Status cannot manufacture publication, clear an unresolved attempt or bypass immutable receipt evidence.
CREATE FUNCTION pulse_publication_state_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_TABLE_NAME='survey_report_attempts' THEN
  IF TG_OP='INSERT' AND NEW.state<>'attempt_started' THEN RAISE EXCEPTION 'pulse_attempt_requires_write_ahead'; END IF;
  IF TG_OP='UPDATE' THEN
   IF OLD.state='delivered' AND NEW.state<>'delivered' THEN RAISE EXCEPTION 'pulse_delivered_attempt_terminal'; END IF;
   IF NEW.state='delivered' AND NOT EXISTS(SELECT 1 FROM survey_report_receipts WHERE attempt_id=NEW.id) THEN RAISE EXCEPTION 'pulse_attempt_receipt_required'; END IF;
   IF OLD.state='unknown' AND NEW.state<>'unknown' AND NOT EXISTS(SELECT 1 FROM survey_report_reconciliations WHERE attempt_id=NEW.id AND token=NEW.token AND decision=CASE WHEN NEW.state='delivered' THEN 'confirmed_delivered' WHEN NEW.state='definitely_not_sent' THEN 'confirmed_not_sent' ELSE '' END) THEN RAISE EXCEPTION 'pulse_unknown_requires_explicit_reconciliation'; END IF;
  END IF;
 ELSIF TG_TABLE_NAME='survey_report_parts' THEN
  IF TG_OP='INSERT' AND (NEW.status<>'pending' OR NEW.attempt_token<>0) THEN RAISE EXCEPTION 'pulse_part_requires_pending_origin'; END IF;
  IF TG_OP='UPDATE' THEN
   IF OLD.status='delivered' AND NEW.status<>'delivered' THEN RAISE EXCEPTION 'pulse_delivered_part_terminal'; END IF;
   IF NEW.status='delivered' AND NOT EXISTS(SELECT 1 FROM survey_report_attempts a JOIN survey_report_receipts r ON r.attempt_id=a.id WHERE a.part_id=NEW.id AND a.token=NEW.attempt_token AND a.state='delivered') THEN RAISE EXCEPTION 'pulse_part_receipt_required'; END IF;
   IF NEW.status IN ('attempt_started','dispatching','unknown') AND NOT EXISTS(SELECT 1 FROM survey_report_attempts a WHERE a.part_id=NEW.id AND a.token=NEW.attempt_token AND a.state=NEW.status) THEN RAISE EXCEPTION 'pulse_part_attempt_required'; END IF;
  END IF;
 ELSIF TG_TABLE_NAME='survey_report_obligations' AND NEW.status='delivered' THEN
  IF NOT EXISTS(SELECT 1 FROM survey_report_native_snapshots WHERE obligation_id=NEW.id) OR EXISTS(SELECT 1 FROM survey_report_parts p JOIN survey_report_native_snapshots s ON s.id=p.snapshot_id WHERE s.obligation_id=NEW.id AND p.status<>'delivered') THEN RAISE EXCEPTION 'pulse_logical_delivery_receipts_required'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER zzz_pulse_attempt_state_guard BEFORE INSERT OR UPDATE ON survey_report_attempts FOR EACH ROW EXECUTE FUNCTION pulse_publication_state_guard();
CREATE TRIGGER zzz_pulse_part_state_guard BEFORE INSERT OR UPDATE ON survey_report_parts FOR EACH ROW EXECUTE FUNCTION pulse_publication_state_guard();
CREATE TRIGGER zzz_pulse_logical_state_guard BEFORE INSERT OR UPDATE ON survey_report_obligations FOR EACH ROW EXECUTE FUNCTION pulse_publication_state_guard();
