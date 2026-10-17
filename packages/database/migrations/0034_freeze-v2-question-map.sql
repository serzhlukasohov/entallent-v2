CREATE FUNCTION survey_insight_v2_freeze_question_map() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.response_type = 'open_ended' AND EXISTS (
      SELECT 1 FROM survey_cycle_scoring_policies cycle
      WHERE cycle.survey_definition_id = NEW.survey_definition_id
    ) THEN
      RAISE EXCEPTION 'survey_insight_v2_cycle_question_map_immutable';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF pg_trigger_depth() = 1 AND OLD.response_type = 'open_ended' AND EXISTS (
      SELECT 1 FROM survey_cycle_scoring_policies cycle
      WHERE cycle.survey_definition_id = OLD.survey_definition_id
    ) THEN
      RAISE EXCEPTION 'survey_insight_v2_cycle_question_map_immutable';
    END IF;
    RETURN OLD;
  END IF;

  IF ROW(OLD.survey_definition_id, OLD.stable_key, OLD.question_group, OLD.response_type)
    IS DISTINCT FROM ROW(NEW.survey_definition_id, NEW.stable_key, NEW.question_group, NEW.response_type)
    AND (
      (OLD.response_type = 'open_ended' AND EXISTS (
        SELECT 1 FROM survey_cycle_scoring_policies cycle
        WHERE cycle.survey_definition_id = OLD.survey_definition_id
      ))
      OR (NEW.response_type = 'open_ended' AND EXISTS (
        SELECT 1 FROM survey_cycle_scoring_policies cycle
        WHERE cycle.survey_definition_id = NEW.survey_definition_id
      ))
    ) THEN
    RAISE EXCEPTION 'survey_insight_v2_cycle_question_map_immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER survey_insight_v2_question_map_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON survey_questions
  FOR EACH ROW EXECUTE FUNCTION survey_insight_v2_freeze_question_map();
