import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { V2_QUESTION_GROUP_BY_STABLE_KEY } from '@entalent/application';
import { QuestionInsightRepository } from './question-insight.repository';

const databaseUrl = process.env['DATABASE_URL'];
const TENANT = '11111111-1111-4111-8111-111111111111';
const PERSON = '22222222-2222-4222-8222-222222222222';
const WINDOW = '33333333-3333-4333-8333-333333333333';
const DEFINITION = '44444444-4444-4444-8444-444444444444';
const POLICY = '55555555-5555-4555-8555-555555555555';
const CONVERSATION = '66666666-6666-4666-8666-666666666666';
const QUESTION = '77777777-7777-4777-8777-777777777777';
const FIRST_MESSAGE = '88888888-8888-4888-8888-888888888888';
const SECOND_MESSAGE = '99999999-9999-4999-8999-999999999999';
const REOPEN_MESSAGE = '99999999-9999-4999-8999-999999999998';
const groups = ['autonomy', 'growth', 'purpose', 'belonging'];
const questionKeys = Object.entries(V2_QUESTION_GROUP_BY_STABLE_KEY);

describe.runIf(Boolean(databaseUrl))('V2 working question capture on PostgreSQL', () => {
  const client = databaseUrl ? postgres(databaseUrl, { max: 1 }) : null;
  const repository = client
    ? new QuestionInsightRepository({ client: drizzle(client) } as never, {} as never)
    : null;

  beforeAll(async () => {
    if (!client) return;
    await client`create temp table survey_windows (
      id uuid primary key, tenant_id uuid not null, user_id uuid not null,
      survey_definition_id uuid not null, status text not null,
      period_start timestamptz not null, period_end timestamptz not null
    )`;
    await client`create temp table survey_questions (
      id uuid primary key, survey_definition_id uuid not null,
      stable_key text not null, question_group text not null,
      response_type text not null, version text not null
    )`;
    await client`create temp table survey_scoring_policies (
      id uuid primary key, tenant_id uuid not null, rubrics jsonb not null
    )`;
    await client`create temp table survey_window_scoring_policies (
      survey_window_id uuid primary key, tenant_id uuid not null, scoring_policy_id uuid not null
    )`;
    await client`create temp table messages (
      id uuid primary key, tenant_id uuid not null, user_id uuid not null,
      conversation_id uuid not null, direction text not null,
      occurred_at timestamptz not null, deleted_at timestamptz
    )`;
    await client`create temp table survey_evidence (
      id uuid primary key, survey_window_id uuid not null,
      survey_question_id uuid not null, user_id uuid not null
    )`;
    await client`create temp table survey_group_states (
      id uuid primary key, survey_window_id uuid not null,
      tenant_id uuid not null, user_id uuid not null, question_group text not null
    )`;
    await client`create temp table survey_question_working_insights (
      id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
      user_id uuid not null, survey_window_id uuid not null,
      survey_question_id uuid not null, question_version text not null,
      status text not null default 'collecting', working_summary text,
      ready_for_confirmation boolean not null default false,
      confirmed_semantic_summary text,
      source_message_ids uuid[] not null default array[]::uuid[],
      confirmation_bundle_id uuid, confirmation_message_id uuid,
      clarification_prompt_message_id uuid,
      confirmed_at timestamptz, finalized_at timestamptz, purged_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (tenant_id, user_id, survey_window_id, survey_question_id, question_version)
    )`;
    await client`create temp table pulse_backlog (
      id uuid primary key, tenant_id uuid not null, user_id uuid not null,
      survey_window_id uuid not null, survey_question_id uuid not null,
      status text not null, done_at timestamptz,
      evidence_captured_count integer not null default 0,
      resulted_in_coverage boolean, updated_at timestamptz not null default now()
    )`;

    const rubric = { version: 'approved-v1', instructions: 'Assess meaning.', anchors: [
      { score: 0, description: 'Low' }, { score: 100, description: 'High' },
    ] };
    const questionRows = groups.flatMap((questionGroup, groupIndex) => [1, 2, 3].map((number) => ({
      stableKey: questionKeys.filter(([, group]) => group === questionGroup)[number - 1]![0],
      questionGroup,
      id: groupIndex === 0 && number === 1 ? QUESTION
        : `aaaaaaaa-aaaa-4aaa-8aaa-${String(groupIndex * 3 + number).padStart(12, '0')}`,
    })));
    const rubrics = Object.fromEntries(questionRows.map((question) => [question.stableKey, rubric]));
    await client`insert into survey_windows values
      (${WINDOW}, ${TENANT}, ${PERSON}, ${DEFINITION}, 'active',
       '2026-09-01T00:00:00Z', '2026-10-01T00:00:00Z')`;
    await client`insert into survey_scoring_policies values (${POLICY}, ${TENANT}, ${JSON.stringify(rubrics)}::jsonb)`;
    await client`insert into survey_window_scoring_policies values (${WINDOW}, ${TENANT}, ${POLICY})`;
    for (const question of questionRows) {
      await client`insert into survey_questions values
        (${question.id}, ${DEFINITION}, ${question.stableKey}, ${question.questionGroup}, 'open_ended', 'v2')`;
    }
    await client`insert into messages values
      (${FIRST_MESSAGE}, ${TENANT}, ${PERSON}, ${CONVERSATION}, 'inbound', '2026-09-15T00:00:00Z', null),
      (${SECOND_MESSAGE}, ${TENANT}, ${PERSON}, ${CONVERSATION}, 'inbound', '2026-09-16T00:00:00Z', null)`;
    await client`insert into messages values
      (${REOPEN_MESSAGE}, ${TENANT}, ${PERSON}, ${CONVERSATION}, 'inbound', '2026-09-18T00:00:00Z', null)`;
    await client`insert into pulse_backlog values
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ${TENANT}, ${PERSON}, ${WINDOW}, ${QUESTION},
       'done', '2026-09-17T00:00:00Z', 1, false, now())`;
  });

  afterAll(async () => {
    await client?.end();
  });

  it('keeps working meaning scoped, durable, and idempotent without writing V1 evidence', async () => {
    if (!client || !repository) return;
    const scope = { tenantId: TENANT, userId: PERSON, surveyWindowId: WINDOW };
    expect(await repository.getWindowMode(scope)).toBe('v2');
    const input = {
      ...scope, conversationId: CONVERSATION, surveyQuestionId: QUESTION,
      questionVersion: 'v2', sourceMessageId: FIRST_MESSAGE, meaning: 'I can choose my work methods.',
      sufficientMeaning: false,
    };
    expect(await repository.captureMeaning(input)).toBe('captured');
    expect(await repository.captureMeaning(input)).toBe('ignored');
    expect(await repository.captureMeaning({ ...input, tenantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }))
      .toBe('ignored');
    expect(await repository.captureMeaning({
      ...input, sourceMessageId: SECOND_MESSAGE, meaning: 'I have freedom to set priorities.', sufficientMeaning: true,
    })).toBe('captured');

    const rows = await client`select status, working_summary, source_message_ids, ready_for_confirmation
      from survey_question_working_insights`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: 'collecting',
      working_summary: 'I can choose my work methods.\nI have freedom to set priorities.',
      source_message_ids: [FIRST_MESSAGE, SECOND_MESSAGE],
      ready_for_confirmation: true,
    });
    expect(await client`select id from survey_evidence`).toHaveLength(0);

    await client`update survey_question_working_insights set
      status = 'declined', working_summary = null, ready_for_confirmation = false,
      source_message_ids = array[]::uuid[], purged_at = '2026-09-17T00:00:00Z'
      where survey_question_id = ${QUESTION}`;
    const reopen = { ...input, sourceMessageId: REOPEN_MESSAGE,
      meaning: 'I want to talk about how I can grow.', sufficientMeaning: false };
    expect(await repository.captureMeaning(reopen)).toBe('ignored');
    const reopenScope = {
      tenantId: TENANT, userId: PERSON, conversationId: CONVERSATION,
      surveyWindowId: WINDOW, surveyQuestionId: QUESTION, questionVersion: 'v2',
      sourceMessageId: REOPEN_MESSAGE,
    };
    expect(await repository.reopenDeclinedQuestion({
      ...reopenScope, sourceMessageId: FIRST_MESSAGE,
    })).toBe(false);
    expect(await repository.reopenDeclinedQuestion({
      ...reopenScope, conversationId: '66666666-6666-4666-8666-666666666667',
    })).toBe(false);
    expect(await repository.reopenDeclinedQuestion(reopenScope)).toBe(true);
    expect(await repository.reopenDeclinedQuestion(reopenScope)).toBe(false);
    expect(await client`select status, working_summary, source_message_ids, ready_for_confirmation
      from survey_question_working_insights where survey_question_id = ${QUESTION}`)
      .toMatchObject([{
        status: 'reset', working_summary: null,
        source_message_ids: [], ready_for_confirmation: false,
      }]);
    expect(await repository.captureMeaning(reopen)).toBe('captured');
    expect(await repository.captureMeaning(reopen)).toBe('ignored');
    expect(await client`select status, working_summary, source_message_ids, ready_for_confirmation
      from survey_question_working_insights where survey_question_id = ${QUESTION}`)
      .toMatchObject([{
        status: 'collecting', working_summary: reopen.meaning,
        source_message_ids: [REOPEN_MESSAGE], ready_for_confirmation: false,
      }]);
    expect(await client`select status, done_at, evidence_captured_count, resulted_in_coverage
      from pulse_backlog where survey_question_id = ${QUESTION}`)
      .toMatchObject([{
        status: 'pending', done_at: null, evidence_captured_count: 0,
        resulted_in_coverage: null,
      }]);

    await client`insert into survey_evidence values
      ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', ${WINDOW}, ${QUESTION}, ${PERSON})`;
    await expect(repository.getWindowMode(scope)).rejects.toThrow('v2_window_contains_legacy_open_ended_data');
  });

  it('rejects delayed capture after the window cutoff', async () => {
    if (!client || !repository) return;
    await client`update survey_windows set period_end = '2026-09-20T00:00:00Z'
      where id = ${WINDOW}`;
    const questionId = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002';
    expect(await repository.captureMeaning({
      tenantId: TENANT, userId: PERSON, conversationId: CONVERSATION,
      surveyWindowId: WINDOW, surveyQuestionId: questionId,
      questionVersion: 'v2', sourceMessageId: FIRST_MESSAGE,
      meaning: 'Delayed private text', sufficientMeaning: true,
    })).toBe('ignored');
    expect(await client`select id from survey_question_working_insights
      where survey_question_id = ${questionId}`).toHaveLength(0);
  });
});
