CREATE FUNCTION survey_insight_v2_validate_canonical_question_map() RETURNS trigger AS $$
BEGIN
  IF (SELECT count(*) FROM survey_questions
      WHERE survey_definition_id = NEW.survey_definition_id AND response_type = 'open_ended') <> 12
    OR EXISTS (
      SELECT 1 FROM (VALUES
        ('q12_expectations', 'autonomy'),
        ('q12_strengths_opportunity', 'autonomy'),
        ('q12_opinions_count', 'autonomy'),
        ('wellbeing_at_work', 'belonging'),
        ('q12_supervisor_cares', 'belonging'),
        ('belonging_psychological_safety', 'belonging'),
        ('role_clarity', 'growth'),
        ('professional_growth', 'growth'),
        ('q12_progress_discussion', 'growth'),
        ('q12_recognition', 'purpose'),
        ('purpose_meaning', 'purpose'),
        ('purpose_contribution', 'purpose')
      ) AS expected(stable_key, question_group)
      WHERE NOT EXISTS (
        SELECT 1 FROM survey_questions question
        WHERE question.survey_definition_id = NEW.survey_definition_id
          AND question.response_type = 'open_ended'
          AND question.stable_key = expected.stable_key
          AND question.question_group = expected.question_group
      )
    ) THEN
    RAISE EXCEPTION 'survey_insight_v2_cycle_question_map_invalid';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER survey_insight_v2_canonical_question_map_guard
  BEFORE INSERT ON survey_cycle_scoring_policies
  FOR EACH ROW EXECUTE FUNCTION survey_insight_v2_validate_canonical_question_map();
