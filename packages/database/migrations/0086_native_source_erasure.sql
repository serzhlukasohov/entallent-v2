-- Source-row deletion must invalidate current AND historical publication authority before removing proof.
-- Raw cascades/retention cannot turn an empty source set into apparently authorized history.
CREATE FUNCTION pulse_publication_source_deleted() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM tenants WHERE id=OLD.tenant_id) THEN
  UPDATE survey_report_input_candidates SET invalidated_at=coalesce(invalidated_at,clock_timestamp()) WHERE id=OLD.candidate_id AND tenant_id=OLD.tenant_id;
 END IF;
 RETURN OLD;
END $$;
CREATE TRIGGER aaa_pulse_publication_source_deleted BEFORE DELETE ON survey_report_candidate_sources FOR EACH ROW EXECUTE FUNCTION pulse_publication_source_deleted();
