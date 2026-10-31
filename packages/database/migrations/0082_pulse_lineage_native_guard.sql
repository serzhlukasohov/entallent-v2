-- Historical/legacy lineages remain archive metadata without becoming native report cycles.
CREATE OR REPLACE FUNCTION pulse_input_bump_lineage(t uuid,u uuid,lineage uuid,revision uuid DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO survey_report_input_generations(tenant_id,cycle_id,generation)
 SELECT l.tenant_id,l.cycle_scoring_policy_id,1 FROM survey_report_question_lineages l
 JOIN survey_report_cycle_openings opening ON opening.tenant_id=l.tenant_id AND opening.cycle_scoring_policy_id=l.cycle_scoring_policy_id
 WHERE l.id=lineage AND l.tenant_id=t AND l.user_id=u
 ON CONFLICT(tenant_id,cycle_id) DO UPDATE SET generation=survey_report_input_generations.generation+1,certified_generation=NULL;
 UPDATE survey_report_input_candidates candidate SET invalidated_at=clock_timestamp() WHERE candidate.tenant_id=t AND candidate.invalidated_at IS NULL
  AND EXISTS(SELECT 1 FROM survey_report_candidate_sources source WHERE source.candidate_id=candidate.id AND source.tenant_id=t AND source.user_id=u AND source.lineage_id=lineage AND (revision IS NULL OR source.revision_id=revision));
END $$;
