-- Custom SQL migration file, put you code below! --
CREATE FUNCTION pulse_report_backfill_lineages(requested_tenant uuid) RETURNS TABLE(resolved integer, unresolved integer) AS $$
BEGIN
INSERT INTO survey_report_question_lineages(tenant_id, cycle_scoring_policy_id, user_id, question_stable_key, survey_question_id, question_version, scoring_policy_id)
SELECT DISTINCT i.tenant_id, c.id, i.user_id, q.stable_key, q.id, q.version, c.scoring_policy_id
FROM survey_question_insights i JOIN survey_windows w ON w.id = i.survey_window_id AND w.tenant_id = i.tenant_id AND w.user_id = i.user_id AND w.survey_definition_id = i.survey_definition_id
JOIN survey_questions q ON q.id = i.survey_question_id AND q.survey_definition_id = i.survey_definition_id AND q.version = i.question_version AND q.response_type = 'open_ended'
JOIN survey_window_scoring_policies b ON b.survey_window_id = w.id AND b.tenant_id = i.tenant_id
JOIN survey_cycle_scoring_policies c ON c.tenant_id = i.tenant_id AND c.survey_definition_id = w.survey_definition_id AND c.period_start = w.period_start AND c.period_end = w.period_end AND c.scoring_policy_id = b.scoring_policy_id
JOIN survey_scoring_policies policy ON policy.id = c.scoring_policy_id AND policy.tenant_id = i.tenant_id AND policy.version = i.scoring_policy_version AND jsonb_typeof(policy.rubrics -> q.stable_key) = 'object'
WHERE i.tenant_id = requested_tenant
ON CONFLICT DO NOTHING;
INSERT INTO survey_report_insight_revisions(insight_id, tenant_id, user_id, lineage_id, proof_status)
SELECT i.id, i.tenant_id, i.user_id, l.id, 'unverified_historical' FROM survey_question_insights i
JOIN survey_windows w ON w.id = i.survey_window_id AND w.tenant_id = i.tenant_id AND w.user_id = i.user_id AND w.survey_definition_id = i.survey_definition_id
JOIN survey_questions q ON q.id = i.survey_question_id AND q.survey_definition_id = i.survey_definition_id AND q.version = i.question_version
JOIN survey_cycle_scoring_policies c ON c.tenant_id = i.tenant_id AND c.survey_definition_id = w.survey_definition_id AND c.period_start = w.period_start AND c.period_end = w.period_end
JOIN survey_window_scoring_policies b ON b.survey_window_id = w.id AND b.tenant_id = i.tenant_id AND b.scoring_policy_id = c.scoring_policy_id
JOIN survey_scoring_policies policy ON policy.id = c.scoring_policy_id AND policy.tenant_id = i.tenant_id AND policy.version = i.scoring_policy_version
JOIN survey_report_question_lineages l ON l.tenant_id = i.tenant_id AND l.cycle_scoring_policy_id = c.id AND l.user_id = i.user_id AND l.survey_question_id = i.survey_question_id AND l.question_version = i.question_version
WHERE i.tenant_id = requested_tenant
ON CONFLICT DO NOTHING;

RETURN QUERY SELECT count(*) filter (where revision.insight_id is not null)::int, count(*) filter (where revision.insight_id is null)::int FROM survey_question_insights insight LEFT JOIN survey_report_insight_revisions revision ON revision.insight_id = insight.id WHERE insight.tenant_id = requested_tenant;
END; $$ LANGUAGE plpgsql;

--> statement-breakpoint
CREATE FUNCTION pulse_report_revision_no_resurrection() RETURNS trigger AS $$
BEGIN
 IF OLD.withdrawn_at IS NOT NULL AND NEW.withdrawn_at IS NULL THEN RAISE EXCEPTION 'pulse_report_withdrawal_immutable'; END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER report_revision_no_resurrection BEFORE UPDATE ON survey_question_insights FOR EACH ROW EXECUTE FUNCTION pulse_report_revision_no_resurrection();
