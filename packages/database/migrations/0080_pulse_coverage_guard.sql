CREATE FUNCTION pulse_input_coverage_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN IF EXISTS(SELECT 1 FROM tenants WHERE id=OLD.tenant_id) THEN RAISE EXCEPTION 'pulse_coverage_deletion_forbidden'; END IF; RETURN OLD; END IF;
 IF TG_OP='INSERT' THEN NEW.supported_from:=clock_timestamp();
 ELSIF NEW.tenant_id<>OLD.tenant_id OR NEW.supported_from<OLD.supported_from THEN RAISE EXCEPTION 'pulse_coverage_cannot_upgrade_history'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER pulse_input_coverage_guard BEFORE INSERT OR UPDATE OR DELETE ON survey_report_input_coverage FOR EACH ROW EXECUTE FUNCTION pulse_input_coverage_guard();
