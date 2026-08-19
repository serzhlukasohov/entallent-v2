WITH bounds AS (
  SELECT
    $1::uuid AS tenant_id,
    date_trunc('day', now(), 'UTC') AS current_end,
    date_trunc('day', now(), 'UTC') - interval '14 days' AS current_start,
    date_trunc('day', now(), 'UTC') - interval '28 days' AS previous_start
),
report_windows AS (
  SELECT 'current'::text AS window_name, current_start AS from_at, current_end AS to_at
  FROM bounds
  UNION ALL
  SELECT 'previous'::text, previous_start, current_start
  FROM bounds
),
inbound_base AS (
  SELECT
    m.id,
    m.tenant_id,
    m.conversation_id,
    m.user_id,
    m.trace_id,
    m.occurred_at
  FROM messages m
  JOIN conversations c ON c.id = m.conversation_id AND c.tenant_id = m.tenant_id
  JOIN users u ON u.id = m.user_id AND u.tenant_id = m.tenant_id
  CROSS JOIN bounds b
  WHERE m.tenant_id = b.tenant_id
    AND m.direction = 'inbound'
    AND m.sender_type = 'user'
    AND m.message_type = 'text'
    AND m.deleted_at IS NULL
    AND u.deleted_at IS NULL
    AND u.status <> 'deleted'
    AND c.status <> 'deleted'
    AND c.channel_type NOT IN ('dev', 'sim')
    AND m.text <> '__init__'
    AND COALESCE(m.metadata->>'synthetic', 'false') <> 'true'
    AND COALESCE(m.metadata->>'control', 'false') <> 'true'
    AND m.occurred_at >= b.previous_start
    AND m.occurred_at < b.current_end + interval '1 day'
),
eligible_inbound AS (
  SELECT i.*, w.window_name
  FROM inbound_base i
  JOIN report_windows w ON i.occurred_at >= w.from_at AND i.occurred_at < w.to_at
),
outbound_base AS (
  SELECT
    m.id,
    m.tenant_id,
    m.conversation_id,
    m.user_id,
    m.trace_id,
    m.occurred_at,
    m.metadata
  FROM messages m
  JOIN conversations c ON c.id = m.conversation_id AND c.tenant_id = m.tenant_id
  JOIN users u ON u.id = m.user_id AND u.tenant_id = m.tenant_id
  CROSS JOIN bounds b
  WHERE m.tenant_id = b.tenant_id
    AND m.direction = 'outbound'
    AND m.sender_type = 'agent'
    AND m.message_type = 'text'
    AND m.deleted_at IS NULL
    AND u.deleted_at IS NULL
    AND u.status <> 'deleted'
    AND c.status <> 'deleted'
    AND c.channel_type NOT IN ('dev', 'sim')
    AND m.occurred_at >= b.previous_start
    AND m.occurred_at < b.current_end + interval '30 minutes'
),
paired_turns AS (
  SELECT
    i.window_name,
    i.id AS inbound_id,
    i.conversation_id,
    i.user_id,
    i.trace_id,
    i.occurred_at AS inbound_at,
    o.id AS outbound_id,
    o.occurred_at AS outbound_at,
    EXTRACT(epoch FROM (o.occurred_at - i.occurred_at)) * 1000 AS reply_latency_ms,
    o.metadata->>'measurementVersion' AS measurement_version,
    o.metadata->>'dialogueAct' AS dialogue_act,
    o.metadata->>'responseMove' AS response_move,
    (o.metadata#>>'{replyShape,askedQuestion}')::boolean AS asked_question,
    COALESCE((o.metadata->>'containsSurveyProbe')::boolean, false) AS contains_survey_probe,
    o.metadata->>'surveyProbeQuestionId' AS survey_probe_question_id
  FROM eligible_inbound i
  LEFT JOIN LATERAL (
    SELECT candidate.*
    FROM outbound_base candidate
    WHERE candidate.tenant_id = i.tenant_id
      AND candidate.conversation_id = i.conversation_id
      AND candidate.user_id = i.user_id
      AND candidate.trace_id = i.trace_id
      AND candidate.occurred_at >= i.occurred_at
      AND candidate.occurred_at <= i.occurred_at + interval '30 minutes'
    ORDER BY candidate.occurred_at, candidate.id
    LIMIT 1
  ) o ON true
),
turn_outcomes AS (
  SELECT
    t.*,
    t.outbound_at IS NOT NULL AND t.outbound_at <= now() - interval '24 hours' AS return_cohort_matured,
    CASE WHEN t.outbound_at IS NULL THEN false ELSE EXISTS (
      SELECT 1
      FROM inbound_base follow
      WHERE follow.tenant_id = (SELECT tenant_id FROM bounds)
        AND follow.conversation_id = t.conversation_id
        AND follow.user_id = t.user_id
        AND follow.occurred_at > t.outbound_at
        AND follow.occurred_at <= t.outbound_at + interval '24 hours'
    ) END AS returned_within_24h
  FROM paired_turns t
),
turn_summary AS (
  SELECT
    window_name,
    COUNT(*) AS inbound_count,
    COUNT(outbound_id) AS reply_count,
    COUNT(outbound_id) FILTER (
      WHERE measurement_version = 'ts-conversation-decision-v1'
    ) AS measured_reply_count,
    COUNT(DISTINCT conversation_id) AS active_conversation_count,
    ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY reply_latency_ms)::numeric, 1) AS p50_reply_latency_ms,
    ROUND(percentile_cont(0.95) WITHIN GROUP (ORDER BY reply_latency_ms)::numeric, 1) AS p95_reply_latency_ms,
    COUNT(*) FILTER (WHERE return_cohort_matured) AS matured_return_cohort,
    COUNT(*) FILTER (WHERE return_cohort_matured AND returned_within_24h) AS returned_within_24h
  FROM turn_outcomes
  GROUP BY window_name
),
llm_summary AS (
  SELECT
    i.window_name,
    COUNT(DISTINCT l.id) AS run_count,
    COUNT(DISTINCT l.id) FILTER (WHERE l.status = 'error') AS error_count,
    ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY l.latency_ms)::numeric, 1) AS p50_runtime_latency_ms,
    ROUND(percentile_cont(0.95) WITHIN GROUP (ORDER BY l.latency_ms)::numeric, 1) AS p95_runtime_latency_ms
  FROM eligible_inbound i
  JOIN llm_runs l
    ON l.tenant_id = i.tenant_id
   AND l.trace_id = i.trace_id
   AND l.task_type = 'conversation'
  GROUP BY i.window_name
),
decision_summary AS (
  SELECT
    window_name,
    dialogue_act,
    response_move,
    asked_question,
    COUNT(*) AS reply_count,
    COUNT(*) FILTER (WHERE return_cohort_matured) AS matured_return_cohort,
    COUNT(*) FILTER (WHERE return_cohort_matured AND returned_within_24h) AS returned_within_24h
  FROM turn_outcomes
  WHERE outbound_id IS NOT NULL
    AND measurement_version = 'ts-conversation-decision-v1'
    AND dialogue_act IS NOT NULL
    AND response_move IS NOT NULL
    AND asked_question IS NOT NULL
  GROUP BY window_name, dialogue_act, response_move, asked_question
),
probe_outcomes AS (
  SELECT
    t.window_name,
    t.outbound_at <= now() - interval '7 days' AS conversion_cohort_matured,
    EXISTS (
      SELECT 1
      FROM survey_evidence e
      JOIN survey_windows sw ON sw.id = e.survey_window_id
      CROSS JOIN bounds b
      WHERE sw.tenant_id = b.tenant_id
        AND e.user_id = t.user_id
        AND e.survey_question_id::text = t.survey_probe_question_id
        AND e.superseded_at IS NULL
        AND e.created_at > t.outbound_at
        AND e.created_at <= t.outbound_at + interval '7 days'
        AND EXISTS (
          SELECT 1
          FROM inbound_base source
          WHERE source.id = ANY(e.source_message_ids)
            AND source.tenant_id = b.tenant_id
            AND source.conversation_id = t.conversation_id
            AND source.user_id = t.user_id
            AND source.occurred_at > t.outbound_at
            AND source.occurred_at <= t.outbound_at + interval '7 days'
        )
    ) AS converted_to_evidence
  FROM turn_outcomes t
  WHERE t.outbound_id IS NOT NULL
    AND t.measurement_version = 'ts-conversation-decision-v1'
    AND t.contains_survey_probe
    AND t.survey_probe_question_id IS NOT NULL
),
probe_summary AS (
  SELECT
    window_name,
    COUNT(*) AS probe_count,
    COUNT(*) FILTER (WHERE conversion_cohort_matured) AS matured_probe_count,
    COUNT(*) FILTER (WHERE conversion_cohort_matured AND converted_to_evidence) AS converted_probe_count
  FROM probe_outcomes
  GROUP BY window_name
),
state_summary AS (
  SELECT
    w.window_name,
    (SELECT COUNT(*) FROM survey_evidence e
      JOIN survey_windows sw ON sw.id = e.survey_window_id
      WHERE sw.tenant_id = b.tenant_id
        AND EXISTS (
          SELECT 1 FROM eligible_inbound i
          WHERE i.window_name = w.window_name
            AND i.id = ANY(e.source_message_ids)
        )
    ) AS survey_evidence_count,
    (SELECT COUNT(*) FROM memory_items mi
      WHERE mi.tenant_id = b.tenant_id
        AND EXISTS (
          SELECT 1 FROM eligible_inbound i
          WHERE i.window_name = w.window_name
            AND i.id = ANY(mi.source_message_ids)
        )
    ) AS memory_count,
    (SELECT COUNT(*) FROM memory_items mi
      WHERE mi.tenant_id = b.tenant_id
        AND (mi.status = 'superseded' OR mi.superseded_by_id IS NOT NULL)
        AND EXISTS (
          SELECT 1 FROM eligible_inbound i
          WHERE i.window_name = w.window_name
            AND i.id = ANY(mi.source_message_ids)
        )
    ) AS superseded_memory_count,
    (SELECT COUNT(*) FROM user_goals g
      WHERE g.tenant_id = b.tenant_id
        AND EXISTS (
          SELECT 1 FROM eligible_inbound i
          WHERE i.window_name = w.window_name
            AND i.id = ANY(g.source_message_ids)
        )
    ) AS goal_count,
    (SELECT COUNT(*) FROM scheduled_actions a
      WHERE a.tenant_id = b.tenant_id AND a.type = 'follow_up'
        AND EXISTS (
          SELECT 1 FROM eligible_inbound i
          WHERE i.window_name = w.window_name
            AND i.id = ANY(a.source_message_ids)
        )
    ) AS follow_up_count
  FROM report_windows w
  CROSS JOIN bounds b
),
reliability_json AS (
  SELECT jsonb_agg(
    jsonb_build_object(
      'window', w.window_name,
      'inboundCount', COALESCE(t.inbound_count, 0),
      'replyCount', COALESCE(t.reply_count, 0),
      'measuredReplyCount', COALESCE(t.measured_reply_count, 0),
      'replySuccessRate', COALESCE(ROUND(t.reply_count::numeric / NULLIF(t.inbound_count, 0), 4), 0),
      'p50ReplyLatencyMs', t.p50_reply_latency_ms,
      'p95ReplyLatencyMs', t.p95_reply_latency_ms,
      'llmRunCount', COALESCE(l.run_count, 0),
      'llmErrorCount', COALESCE(l.error_count, 0),
      'llmErrorRate', COALESCE(ROUND(l.error_count::numeric / NULLIF(l.run_count, 0), 4), 0),
      'p50RuntimeLatencyMs', l.p50_runtime_latency_ms,
      'p95RuntimeLatencyMs', l.p95_runtime_latency_ms
    ) ORDER BY CASE w.window_name WHEN 'current' THEN 1 ELSE 2 END
  ) AS value
  FROM report_windows w
  LEFT JOIN turn_summary t USING (window_name)
  LEFT JOIN llm_summary l USING (window_name)
),
continuity_json AS (
  SELECT jsonb_agg(
    jsonb_build_object(
      'window', w.window_name,
      'activeConversationCount', COALESCE(t.active_conversation_count, 0),
      'turnsPerActiveConversation', COALESCE(ROUND(t.inbound_count::numeric / NULLIF(t.active_conversation_count, 0), 2), 0),
      'matured24hReturnCohort', COALESCE(t.matured_return_cohort, 0),
      'returnedWithin24h', COALESCE(t.returned_within_24h, 0),
      'returnRate24h', ROUND(t.returned_within_24h::numeric / NULLIF(t.matured_return_cohort, 0), 4)
    ) ORDER BY CASE w.window_name WHEN 'current' THEN 1 ELSE 2 END
  ) AS value
  FROM report_windows w
  LEFT JOIN turn_summary t USING (window_name)
),
decision_json AS (
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'window', window_name,
      'dialogueAct', dialogue_act,
      'responseMove', response_move,
      'askedQuestion', asked_question,
      'replyCount', reply_count,
      'matured24hReturnCohort', matured_return_cohort,
      'returnedWithin24h', returned_within_24h,
      'returnRate24h', ROUND(returned_within_24h::numeric / NULLIF(matured_return_cohort, 0), 4)
    ) ORDER BY window_name, dialogue_act, response_move, asked_question), '[]'::jsonb) AS value
  FROM decision_summary
),
useful_state_json AS (
  SELECT jsonb_agg(
    jsonb_build_object(
      'window', w.window_name,
      'surveyEvidenceCount', s.survey_evidence_count,
      'surveyEvidencePer100Inbound', COALESCE(ROUND(s.survey_evidence_count::numeric * 100 / NULLIF(t.inbound_count, 0), 2), 0),
      'memoryCount', s.memory_count,
      'memoryPer100Inbound', COALESCE(ROUND(s.memory_count::numeric * 100 / NULLIF(t.inbound_count, 0), 2), 0),
      'supersededMemoryCount', s.superseded_memory_count,
      'memorySupersessionRate', COALESCE(ROUND(s.superseded_memory_count::numeric / NULLIF(s.memory_count, 0), 4), 0),
      'goalCount', s.goal_count,
      'goalsPer100Inbound', COALESCE(ROUND(s.goal_count::numeric * 100 / NULLIF(t.inbound_count, 0), 2), 0),
      'followUpCount', s.follow_up_count,
      'followUpsPer100Inbound', COALESCE(ROUND(s.follow_up_count::numeric * 100 / NULLIF(t.inbound_count, 0), 2), 0),
      'surveyProbeCount', COALESCE(p.probe_count, 0),
      'maturedSurveyProbeCount', COALESCE(p.matured_probe_count, 0),
      'surveyProbeConversions', COALESCE(p.converted_probe_count, 0),
      'surveyProbeConversionRate', ROUND(p.converted_probe_count::numeric / NULLIF(p.matured_probe_count, 0), 4)
    ) ORDER BY CASE w.window_name WHEN 'current' THEN 1 ELSE 2 END
  ) AS value
  FROM report_windows w
  JOIN state_summary s USING (window_name)
  LEFT JOIN turn_summary t USING (window_name)
  LEFT JOIN probe_summary p USING (window_name)
)
SELECT jsonb_build_object(
  'schemaVersion', 1,
  'measurementVersion', 'ts-conversation-decision-v1',
  'generatedAt', now(),
  'tenantId', b.tenant_id,
  'windows', jsonb_build_object(
    'current', jsonb_build_object('from', b.current_start, 'to', b.current_end),
    'previous', jsonb_build_object('from', b.previous_start, 'to', b.current_start)
  ),
  'reliability', r.value,
  'continuity', c.value,
  'decisionCohorts', d.value,
  'usefulState', s.value
) AS report
FROM bounds b
CROSS JOIN reliability_json r
CROSS JOIN continuity_json c
CROSS JOIN decision_json d
CROSS JOIN useful_state_json s;
