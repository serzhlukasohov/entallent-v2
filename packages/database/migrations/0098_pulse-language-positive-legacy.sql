-- A definition version alone is not a durable mode proof. Native and legacy openings are immutable positive authorities.
CREATE OR REPLACE FUNCTION pulse_language_source_kind(i uuid) RETURNS text LANGUAGE sql STABLE AS $$
 SELECT CASE
 WHEN d.version='v2-report-engagement-1.0.0'
   OR EXISTS(SELECT 1 FROM survey_engagement_collection_contracts c WHERE c.tenant_id=q.tenant_id AND c.survey_definition_id=q.survey_definition_id)
   OR EXISTS(SELECT 1 FROM survey_windows sw JOIN survey_cycle_scoring_policies c ON c.tenant_id=sw.tenant_id AND c.survey_definition_id=sw.survey_definition_id AND c.period_start=sw.period_start AND c.period_end=sw.period_end JOIN survey_report_cycle_openings o ON o.tenant_id=c.tenant_id AND o.cycle_scoring_policy_id=c.id WHERE sw.id=q.survey_window_id AND sw.tenant_id=q.tenant_id)
   OR EXISTS(SELECT 1 FROM survey_report_window_bindings b WHERE b.tenant_id=q.tenant_id AND b.survey_window_id=q.survey_window_id)
   OR EXISTS(SELECT 1 FROM survey_report_insight_revisions r WHERE r.tenant_id=q.tenant_id AND r.insight_id=q.id)
   OR EXISTS(SELECT 1 FROM survey_report_topic_watermarks w WHERE w.tenant_id=q.tenant_id AND w.insight_id=q.id)
 THEN 'native'
 WHEN d.version='v2-policy-1.0.0' AND EXISTS(
   SELECT 1 FROM survey_windows sw JOIN survey_window_scoring_policies b ON b.survey_window_id=sw.id AND b.tenant_id=sw.tenant_id
   JOIN survey_scoring_policies p ON p.id=b.scoring_policy_id AND p.tenant_id=sw.tenant_id
   WHERE sw.id=q.survey_window_id AND sw.tenant_id=q.tenant_id AND sw.user_id=q.user_id AND sw.survey_definition_id=q.survey_definition_id AND p.version='1.0.0' AND EXISTS(SELECT 1 FROM survey_report_legacy_cycle_openings opening WHERE opening.tenant_id=sw.tenant_id AND opening.survey_definition_id=sw.survey_definition_id AND opening.period_start=sw.period_start AND opening.period_end=sw.period_end))
 THEN 'approved_legacy' ELSE 'unknown' END
 FROM survey_question_insights q JOIN survey_definitions d ON d.id=q.survey_definition_id WHERE q.id=i
$$;
--> statement-breakpoint
UPDATE pulse_analytical_source_authorities a SET source_kind=pulse_language_source_kind(a.analytical_id),
 dependency_lost_at=CASE WHEN pulse_language_source_kind(a.analytical_id)='native' THEN coalesce(a.dependency_lost_at,clock_timestamp()) ELSE a.dependency_lost_at END
 WHERE a.source_kind<>'native' AND a.source_kind IS DISTINCT FROM pulse_language_source_kind(a.analytical_id);
--> statement-breakpoint
DELETE FROM pulse_analytical_renditions d WHERE NOT EXISTS(SELECT 1 FROM pulse_language_permitted_source(d.tenant_id,d.analytical_id));
