-- A real deleted parent, never a session setting or trigger-depth hint, permits identity erasure.
CREATE FUNCTION pulse_native_identity_delete_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE tenant uuid;
BEGIN
 tenant:=(to_jsonb(OLD)->>'tenant_id')::uuid;
 IF TG_TABLE_NAME='survey_report_final_completions' THEN
  SELECT tenant_id INTO tenant FROM survey_report_native_snapshots WHERE id=OLD.canonical_snapshot_id;
 END IF;
 IF tenant IS NULL OR EXISTS(SELECT 1 FROM tenants WHERE id=tenant) THEN RAISE EXCEPTION 'pulse_native_identity_delete_requires_actual_tenant_erasure'; END IF;
 RETURN OLD;
END $$;
CREATE TRIGGER pulse_native_identity_delete_guard BEFORE DELETE ON survey_report_obligations FOR EACH ROW EXECUTE FUNCTION pulse_native_identity_delete_guard();
CREATE TRIGGER pulse_native_identity_delete_guard BEFORE DELETE ON survey_report_native_snapshots FOR EACH ROW EXECUTE FUNCTION pulse_native_identity_delete_guard();
CREATE TRIGGER pulse_native_identity_delete_guard BEFORE DELETE ON survey_report_parts FOR EACH ROW EXECUTE FUNCTION pulse_native_identity_delete_guard();
CREATE TRIGGER pulse_native_identity_delete_guard BEFORE DELETE ON survey_report_attempts FOR EACH ROW EXECUTE FUNCTION pulse_native_identity_delete_guard();
CREATE TRIGGER pulse_native_identity_delete_guard BEFORE DELETE ON survey_report_receipts FOR EACH ROW EXECUTE FUNCTION pulse_native_identity_delete_guard();
CREATE TRIGGER pulse_native_identity_delete_guard BEFORE DELETE ON survey_report_reconciliations FOR EACH ROW EXECUTE FUNCTION pulse_native_identity_delete_guard();
CREATE TRIGGER pulse_native_identity_delete_guard BEFORE DELETE ON survey_report_completion_supports FOR EACH ROW EXECUTE FUNCTION pulse_native_identity_delete_guard();
CREATE TRIGGER pulse_native_identity_delete_guard BEFORE DELETE ON survey_report_final_completions FOR EACH ROW EXECUTE FUNCTION pulse_native_identity_delete_guard();
--> statement-breakpoint
CREATE FUNCTION pulse_native_tenant_erasure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM tenants WHERE id=OLD.id) THEN RAISE EXCEPTION 'pulse_tenant_erasure_parent_must_be_absent'; END IF;
 -- Explicit dependency order runs BEFORE RI cascade triggers. Missing rows are harmless.
 DELETE FROM survey_report_reconciliations WHERE tenant_id=OLD.id;
 DELETE FROM survey_report_receipts WHERE tenant_id=OLD.id;
 DELETE FROM survey_report_attempts WHERE tenant_id=OLD.id;
 DELETE FROM survey_report_part_payloads WHERE part_id IN(SELECT id FROM survey_report_parts WHERE tenant_id=OLD.id);
 DELETE FROM survey_report_parts WHERE tenant_id=OLD.id;
 DELETE FROM survey_report_snapshot_payloads WHERE tenant_id=OLD.id;
 DELETE FROM survey_report_completion_supports WHERE tenant_id=OLD.id;
 DELETE FROM survey_report_final_completions WHERE canonical_snapshot_id IN(SELECT id FROM survey_report_native_snapshots WHERE tenant_id=OLD.id);
 DELETE FROM survey_report_native_snapshots WHERE tenant_id=OLD.id;
 DELETE FROM survey_report_assembly_inputs WHERE tenant_id=OLD.id;
 DELETE FROM survey_report_obligations WHERE tenant_id=OLD.id;
 DELETE FROM survey_report_recipient_proofs WHERE tenant_id=OLD.id;
 DELETE FROM survey_report_observations WHERE tenant_id=OLD.id;
 RETURN OLD;
END $$;
-- PostgreSQL fires same-kind triggers alphabetically; numeric prefix precedes RI_ConstraintTrigger cascades.
CREATE TRIGGER "000_pulse_native_tenant_erasure" AFTER DELETE ON tenants FOR EACH ROW EXECUTE FUNCTION pulse_native_tenant_erasure();
