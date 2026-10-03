CREATE FUNCTION survey_insight_v2_company_policy_guard() RETURNS trigger AS $$
DECLARE
  scoped_window survey_windows%ROWTYPE;
BEGIN
  SELECT * INTO scoped_window FROM survey_windows
    WHERE id = NEW.survey_window_id FOR SHARE;
  IF NOT FOUND OR scoped_window.tenant_id <> NEW.tenant_id THEN
    RAISE EXCEPTION 'survey_insight_v2_window_tenant_mismatch';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    NEW.tenant_id::text || ':' || scoped_window.survey_definition_id::text || ':'
      || scoped_window.period_start::text || ':' || scoped_window.period_end::text,
    0
  ));
  IF EXISTS (
    SELECT 1 FROM survey_window_scoring_policies binding
      JOIN survey_windows other_window ON other_window.id = binding.survey_window_id
    WHERE binding.tenant_id = NEW.tenant_id
      AND other_window.tenant_id = NEW.tenant_id
      AND other_window.survey_definition_id = scoped_window.survey_definition_id
      AND other_window.period_start = scoped_window.period_start
      AND other_window.period_end = scoped_window.period_end
      AND binding.scoring_policy_id <> NEW.scoring_policy_id
  ) THEN
    RAISE EXCEPTION 'survey_insight_v2_company_cycle_policy_mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER survey_insight_v2_binding_company_guard BEFORE INSERT ON survey_window_scoring_policies
  FOR EACH ROW EXECUTE FUNCTION survey_insight_v2_company_policy_guard();
--> statement-breakpoint
CREATE FUNCTION survey_insight_v2_binding_delete_guard() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM survey_windows WHERE id = OLD.survey_window_id) THEN
    RAISE EXCEPTION 'survey_insight_v2_binding_immutable';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER survey_insight_v2_binding_delete_guard BEFORE DELETE ON survey_window_scoring_policies
  FOR EACH ROW EXECUTE FUNCTION survey_insight_v2_binding_delete_guard();
