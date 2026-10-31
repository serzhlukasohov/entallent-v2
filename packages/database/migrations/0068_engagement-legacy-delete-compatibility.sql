-- Preserve legacy DELETE trigger execution: NEW is null for DELETE and would cancel the operation.
CREATE OR REPLACE FUNCTION engagement_question_immutable() RETURNS trigger AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM survey_engagement_collection_contracts WHERE survey_definition_id=OLD.survey_definition_id)
    OR EXISTS(SELECT 1 FROM survey_engagement_contract_questions WHERE survey_question_id=OLD.id) THEN
    IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM survey_definitions WHERE id=OLD.survey_definition_id) THEN RETURN OLD; END IF;
    IF TG_OP='DELETE' OR to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN RAISE EXCEPTION 'engagement_question_immutable'; END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
