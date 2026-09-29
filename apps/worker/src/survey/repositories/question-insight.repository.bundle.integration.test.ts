import { randomUUID } from 'node:crypto';
import { Queue, QueueEvents, Worker } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { V2_QUESTION_GROUP_BY_STABLE_KEY } from '@entalent/application';
import { MessageSendProcessor } from '../../message-send/message-send.processor';
import { ConversationRepository } from '../../conversation/repositories/conversation.repository';
import { QuestionInsightRepository } from './question-insight.repository';
import { SurveyRepository } from './survey.repository';

const databaseUrl = process.env['DATABASE_URL'];
const tenantId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const surveyWindowId = '33333333-3333-4333-8333-333333333333';
const definitionId = '44444444-4444-4444-8444-444444444444';
const policyId = '55555555-5555-4555-8555-555555555555';
const conversationId = '66666666-6666-4666-8666-666666666666';
const promptMessageId = '77777777-7777-4777-8777-777777777777';
const inboundMessageId = '77777777-7777-4777-8777-777777777778';
const questionIds = [
  '88888888-8888-4888-8888-888888888881',
  '88888888-8888-4888-8888-888888888882',
  '88888888-8888-4888-8888-888888888883',
];
const statements = ['I can choose my methods.', 'I can set priorities.', 'I can challenge decisions.'];
const displayedText = `I heard that ${statements.join(' ')} Is that fair?`;
const secondaryIds = (groupIndex: number) => [1, 2, 3].map((number) =>
  `aaaaaaaa-aaaa-4aaa-8aaa-${String(groupIndex * 3 + number).padStart(12, '0')}`);

describe.runIf(Boolean(databaseUrl))('V2 question confirmation bundle on PostgreSQL', () => {
  const client = databaseUrl ? postgres(databaseUrl, { max: 1 }) : null;
  const repository = client
    ? new QuestionInsightRepository({ client: drizzle(client) } as never, {} as never)
    : null;

  beforeAll(async () => {
    if (!client) return;
    await client`create temp table survey_windows (
      id uuid primary key, tenant_id uuid not null, user_id uuid not null,
      survey_definition_id uuid not null, status text not null,
      period_start timestamptz not null default '2026-07-01T00:00:00Z',
      period_end timestamptz not null
    )`;
    await client`create temp table survey_questions (
      id uuid primary key, survey_definition_id uuid not null,
      stable_key text not null, question_group text not null,
      response_type text not null, version text not null, display_order integer not null
    )`;
    await client`create temp table survey_scoring_policies (
      id uuid primary key, tenant_id uuid not null, rubrics jsonb not null
    )`;
    await client`create temp table survey_window_scoring_policies (
      survey_window_id uuid primary key, tenant_id uuid not null, scoring_policy_id uuid not null
    )`;
    await client`create temp table survey_evidence (
      id uuid primary key, survey_window_id uuid not null,
      survey_question_id uuid not null, user_id uuid not null
    )`;
    await client`create temp table survey_group_states (
      id uuid primary key, survey_window_id uuid not null,
      tenant_id uuid not null, user_id uuid not null, question_group text not null
    )`;
    await client`create temp table messages (
      id uuid primary key, tenant_id uuid not null, user_id uuid not null,
      conversation_id uuid not null, direction text not null, text text not null,
      occurred_at timestamptz not null, sent_at timestamptz, deleted_at timestamptz
    )`;
    await client`create temp table conversation_job_receipts (
      message_id uuid primary key, processed_at timestamptz not null default now()
    )`;
    await client`create temp table survey_question_verdict_receipts (
      inbound_message_id uuid primary key, tenant_id uuid not null,
      user_id uuid not null, conversation_id uuid not null,
      question_group text not null, verdict_kind text not null,
      bundle_id uuid, working_insight_id uuid,
      applied_at timestamptz not null default now()
    )`;
    await client`create temp table survey_question_confirmation_bundles (
      id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
      user_id uuid not null, survey_window_id uuid not null, question_group text not null,
      version text not null, displayed_text text, components jsonb, prompt_message_id uuid,
      status text not null default 'pending_delivery', created_at timestamptz not null default now(),
      purged_at timestamptz, unique (tenant_id, user_id, survey_window_id, question_group, version)
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
      updated_at timestamptz not null default now()
    )`;
    await client`create temp table pulse_backlog (
      id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
      user_id uuid not null, survey_window_id uuid not null, survey_question_id uuid not null,
      status text not null default 'done', done_at timestamptz,
      evidence_captured_count integer not null default 1,
      resulted_in_coverage boolean, updated_at timestamptz not null default now()
    )`;
    await client`insert into survey_windows
      (id, tenant_id, user_id, survey_definition_id, status, period_end) values
      (${surveyWindowId}, ${tenantId}, ${userId}, ${definitionId}, 'active', '2026-10-01T00:00:00Z')`;
    const groups = ['autonomy', 'growth', 'purpose', 'belonging'];
    const questionKeys = Object.entries(V2_QUESTION_GROUP_BY_STABLE_KEY);
    const rubric = { version: 'approved-v1', instructions: 'Assess meaning.', anchors: [
      { score: 0, description: 'Low' }, { score: 100, description: 'High' },
    ] };
    const rubrics = Object.fromEntries(questionKeys.map(([key]) => [key, rubric]));
    await client`insert into survey_scoring_policies values (${policyId}, ${tenantId}, ${JSON.stringify(rubrics)}::jsonb)`;
    await client`insert into survey_window_scoring_policies values (${surveyWindowId}, ${tenantId}, ${policyId})`;
    await client`insert into messages values
      (${promptMessageId}, ${tenantId}, ${userId}, ${conversationId}, 'outbound', ${displayedText},
       '2026-09-28T17:59:00Z', null, null)`;
    for (const [index, questionId] of questionIds.entries()) {
      await client`insert into survey_questions values
        (${questionId}, ${definitionId}, ${questionKeys.filter(([, group]) => group === 'autonomy')[index]![0]}, 'autonomy', 'open_ended', 'v2', ${index + 1})`;
      await client`insert into survey_question_working_insights (
        tenant_id, user_id, survey_window_id, survey_question_id, question_version,
        working_summary, source_message_ids, ready_for_confirmation
      ) values (${tenantId}, ${userId}, ${surveyWindowId}, ${questionId}, 'v2',
        ${statements[index]}, array[${questionId}]::uuid[], true)`;
    }
    for (const [groupIndex, group] of groups.slice(1).entries()) {
      for (const number of [1, 2, 3]) {
        const id = secondaryIds(groupIndex)[number - 1];
        await client`insert into survey_questions values
          (${id}, ${definitionId}, ${questionKeys.filter(([, value]) => value === group)[number - 1]![0]}, ${group}, 'open_ended', 'v2', ${number})`;
      }
    }
  });

  afterAll(async () => { await client?.end(); });

  it('stages an exact mapping before delivery and activates only after persisted delivery', async () => {
    if (!client || !repository) return;
    const input = {
      tenantId, userId, conversationId, surveyWindowId, questionGroup: 'autonomy',
      promptMessageId, displayedText,
      components: questionIds.map((surveyQuestionId, index) => ({
        surveyQuestionId, questionVersion: 'v2', statement: statements[index],
        expectedWorkingSummary: statements[index],
      })),
    };
    await expect(repository.stageQuestionConfirmationBundle({ ...input, displayedText: 'different text' }))
      .rejects.toThrow('v2_confirmation_bundle_invalid_composition');
    await client`update survey_question_working_insights set ready_for_confirmation = false
      where survey_question_id = ${questionIds[2]}`;
    expect(await repository.findReadyQuestionBundle({ tenantId, userId })).toBeNull();
    await expect(repository.stageQuestionConfirmationBundle(input))
      .rejects.toThrow('v2_confirmation_bundle_working_state_stale');
    await client`update survey_question_working_insights set ready_for_confirmation = true
      where survey_question_id = ${questionIds[2]}`;
    expect(await repository.findReadyQuestionBundle({ tenantId, userId }))
      .toMatchObject({
        surveyWindowId, questionGroup: 'autonomy',
        questions: questionIds.map((surveyQuestionId, index) => ({
          surveyQuestionId, questionVersion: 'v2', workingSummary: statements[index],
        })),
      });
    await client`update survey_windows set period_end = '2026-09-01T00:00:00Z'
      where id = ${surveyWindowId}`;
    expect(await repository.findReadyQuestionBundle({ tenantId, userId })).toBeNull();
    await expect(repository.stageQuestionConfirmationBundle(input))
      .rejects.toThrow('v2_confirmation_bundle_scope_mismatch');
    await client`update survey_windows set period_end = '2026-10-01T00:00:00Z'
      where id = ${surveyWindowId}`;
    await client`update survey_question_working_insights set working_summary = 'A newer meaning.'
      where survey_question_id = ${questionIds[2]}`;
    await expect(repository.stageQuestionConfirmationBundle(input))
      .rejects.toThrow('v2_confirmation_bundle_working_state_stale');
    await client`update survey_question_working_insights set working_summary = ${statements[2]}
      where survey_question_id = ${questionIds[2]}`;
    const bundleId = await repository.stageQuestionConfirmationBundle(input);
    expect(await repository.findReadyQuestionBundle({ tenantId, userId })).toBeNull();
    expect(await client`select status, components from survey_question_confirmation_bundles where id = ${bundleId}`)
      .toMatchObject([{ status: 'pending_delivery', components: input.components.map((component, index) => ({
        surveyQuestionId: component.surveyQuestionId,
        questionVersion: component.questionVersion,
        statement: component.statement,
        sourceMessageIds: [questionIds[index]],
      })) }]);
    expect((await client`select status from survey_question_working_insights`).map((row) => row.status))
      .toEqual(['pending_confirmation', 'pending_confirmation', 'pending_confirmation']);
    const deliveredAt = new Date('2026-09-28T18:00:00Z');
    await expect(repository.activateDeliveredQuestionBundle({
      promptMessageId, tenantId, conversationId, deliveredAt,
    })).rejects.toThrow('v2_confirmation_delivery_not_recorded');
    await client`update messages set sent_at = ${deliveredAt.toISOString()}::timestamptz where id = ${promptMessageId}`;
    await repository.activateDeliveredQuestionBundle({ promptMessageId, tenantId, conversationId, deliveredAt });
    await repository.activateDeliveredQuestionBundle({ promptMessageId, tenantId, conversationId, deliveredAt });
    expect(await client`select status from survey_question_confirmation_bundles where id = ${bundleId}`)
      .toMatchObject([{ status: 'awaiting_confirmation' }]);
    await client`insert into messages values
      (${inboundMessageId}, ${tenantId}, ${userId}, ${conversationId}, 'inbound', 'Yes, exactly.',
       '2026-09-28T18:01:00Z', null, null)`;
    expect(await repository.findAwaitingQuestionBundle({
      tenantId, userId, conversationId, inboundMessageId,
    })).toMatchObject({ id: bundleId, questionGroup: 'autonomy' });
    expect(await repository.applyQuestionBundleVerdict({
      tenantId, userId, conversationId, inboundMessageId, bundleId, verdict: { kind: 'agree' },
    })).toBe(true);
    expect(await repository.applyQuestionBundleVerdict({
      tenantId, userId, conversationId, inboundMessageId, bundleId, verdict: { kind: 'agree' },
    })).toBe(false);
    const confirmed = await client`select survey_question_id, status, confirmed_semantic_summary,
      confirmation_message_id from survey_question_working_insights
      where confirmation_bundle_id = ${bundleId} order by survey_question_id`;
    expect(confirmed).toMatchObject(questionIds.map((surveyQuestionId, index) => ({
      survey_question_id: surveyQuestionId,
      status: 'confirmed',
      confirmed_semantic_summary: statements[index],
      confirmation_message_id: inboundMessageId,
    })));
    expect(await client`select status, displayed_text, components from survey_question_confirmation_bundles
      where id = ${bundleId}`).toMatchObject([{ status: 'resolved', displayed_text: null, components: null }]);

    for (const [groupIndex, group] of ['growth', 'purpose'].entries()) {
      for (const [index, id] of secondaryIds(groupIndex).entries()) {
        await client`insert into survey_question_working_insights (
          tenant_id, user_id, survey_window_id, survey_question_id, question_version,
          working_summary, source_message_ids, ready_for_confirmation
        ) values (${tenantId}, ${userId}, ${surveyWindowId}, ${id}, 'v2',
          ${`${group} meaning ${index + 1}.`}, array[${id}]::uuid[], true)`;
        await client`insert into pulse_backlog (tenant_id, user_id, survey_window_id, survey_question_id,
          status, done_at, resulted_in_coverage)
          values (${tenantId}, ${userId}, ${surveyWindowId}, ${id}, 'done', now(), true)`;
      }
    }

    const purposeIds = secondaryIds(1);
    const purposePromptId = '77777777-7777-4777-8777-777777777779';
    const purposeInboundId = '77777777-7777-4777-8777-777777777780';
    const purposeStatements = [1, 2, 3].map((number) => `purpose meaning ${number}.`);
    const purposeText = `I heard that ${purposeStatements.join(' ')} Is that fair?`;
    await client`insert into messages values
      (${purposePromptId}, ${tenantId}, ${userId}, ${conversationId}, 'outbound', ${purposeText},
       '2026-09-28T18:02:00Z', null, null)`;
    const purposeBundleId = await repository.stageQuestionConfirmationBundle({
      tenantId, userId, conversationId, surveyWindowId, questionGroup: 'purpose',
      promptMessageId: purposePromptId, displayedText: purposeText,
      components: purposeIds.map((surveyQuestionId, index) => ({
        surveyQuestionId, questionVersion: 'v2', statement: purposeStatements[index],
        expectedWorkingSummary: purposeStatements[index],
      })),
    });
    await client`update messages set sent_at = '2026-09-28T18:03:00Z' where id = ${purposePromptId}`;
    await repository.activateDeliveredQuestionBundle({
      promptMessageId: purposePromptId, tenantId, conversationId,
      deliveredAt: new Date('2026-09-28T18:03:00Z'),
    });
    await client`insert into messages values
      (${purposeInboundId}, ${tenantId}, ${userId}, ${conversationId}, 'inbound', 'That is all wrong.',
       '2026-09-28T18:04:00Z', null, null)`;
    await client`update messages set deleted_at = '2026-09-28T18:03:30Z'
      where id = ${purposePromptId}`;
    expect(await repository.findAwaitingQuestionBundle({
      tenantId, userId, conversationId, inboundMessageId: purposeInboundId,
    })).toBeNull();
    await expect(repository.applyQuestionBundleVerdict({
      tenantId, userId, conversationId, inboundMessageId: purposeInboundId,
      bundleId: purposeBundleId, verdict: { kind: 'reject' },
    })).rejects.toThrow('v2_confirmation_reply_scope_mismatch');
    await client`update messages set deleted_at = null where id = ${purposePromptId}`;
    expect(await repository.applyQuestionBundleVerdict({
      tenantId, userId, conversationId, inboundMessageId: purposeInboundId,
      bundleId: purposeBundleId, verdict: { kind: 'reject' },
    })).toBe(true);
    expect(await client`select status, working_summary, confirmed_semantic_summary,
      source_message_ids, purged_at is not null as was_purged from survey_question_working_insights
      where confirmation_bundle_id = ${purposeBundleId}`).toMatchObject(
      purposeIds.map(() => ({ status: 'reset', working_summary: null,
        confirmed_semantic_summary: null, source_message_ids: [], was_purged: true })),
    );
    expect(await client`select status, displayed_text, components, purged_at is not null as was_purged
      from survey_question_confirmation_bundles where id = ${purposeBundleId}`)
      .toMatchObject([{ status: 'rejected', displayed_text: null,
        components: null, was_purged: true }]);
    expect(await client`select text, deleted_at from messages where id = ${purposePromptId}`)
      .toMatchObject([{ text: purposeText, deleted_at: null }]);
    expect(await client`select status, evidence_captured_count, done_at from pulse_backlog
      where survey_question_id = any(${purposeIds}::uuid[])`).toMatchObject(
      purposeIds.map(() => ({ status: 'pending', evidence_captured_count: 0, done_at: null })),
    );

    const growthIds = secondaryIds(0);
    const growthPromptId = '77777777-7777-4777-8777-777777777781';
    const growthInboundId = '77777777-7777-4777-8777-777777777782';
    const growthStatements = [1, 2, 3].map((number) => `growth meaning ${number}.`);
    const growthText = `I heard that ${growthStatements.join(' ')} Is that fair?`;
    await client`insert into messages values
      (${growthPromptId}, ${tenantId}, ${userId}, ${conversationId}, 'outbound', ${growthText},
       '2026-09-28T18:05:00Z', null, null)`;
    const growthBundleId = await repository.stageQuestionConfirmationBundle({
      tenantId, userId, conversationId, surveyWindowId, questionGroup: 'growth',
      promptMessageId: growthPromptId, displayedText: growthText,
      components: growthIds.map((surveyQuestionId, index) => ({
        surveyQuestionId, questionVersion: 'v2', statement: growthStatements[index],
        expectedWorkingSummary: growthStatements[index],
      })),
    });
    await client`update messages set sent_at = '2026-09-28T18:06:00Z' where id = ${growthPromptId}`;
    await repository.activateDeliveredQuestionBundle({
      promptMessageId: growthPromptId, tenantId, conversationId,
      deliveredAt: new Date('2026-09-28T18:06:00Z'),
    });
    await client`insert into messages values
      (${growthInboundId}, ${tenantId}, ${userId}, ${conversationId}, 'inbound',
       'The first is right, the second is not, and skip the third.',
       '2026-09-28T18:07:00Z', null, null)`;
    expect(await repository.previewPendingQuestionClarificationAfterBundleVerdict({
      tenantId, userId, conversationId, inboundMessageId: growthInboundId,
      bundleId: growthBundleId, disputedQuestionIds: [growthIds[1]],
    })).toMatchObject({
      surveyQuestionId: growthIds[1], workingSummary: growthStatements[1],
      disputedStatement: growthStatements[1], clarificationPromptMessageId: null,
    });
    expect(await client`select status from survey_question_working_insights
      where confirmation_bundle_id = ${growthBundleId}`)
      .toMatchObject([{ status: 'pending_confirmation' },
        { status: 'pending_confirmation' }, { status: 'pending_confirmation' }]);
    expect(await repository.applyQuestionBundleVerdict({
      tenantId, userId, conversationId, inboundMessageId: growthInboundId,
      bundleId: growthBundleId,
      verdict: { kind: 'partial', acceptedQuestionIds: [growthIds[0]],
        disputedQuestionIds: [growthIds[1]], declinedQuestionIds: [growthIds[2]] },
    })).toBe(true);
    expect(await client`select survey_question_id, status, confirmed_semantic_summary
      from survey_question_working_insights where confirmation_bundle_id = ${growthBundleId}
      order by survey_question_id`).toMatchObject([
      { survey_question_id: growthIds[0], status: 'confirmed', confirmed_semantic_summary: growthStatements[0] },
      { survey_question_id: growthIds[1], status: 'pending_clarification', confirmed_semantic_summary: null },
      { survey_question_id: growthIds[2], status: 'declined', confirmed_semantic_summary: null },
    ]);
    const [partialBundle] = await client`select displayed_text, components
      from survey_question_confirmation_bundles where id = ${growthBundleId}`;
    expect(partialBundle.displayed_text).toBeNull();
    expect(partialBundle.components).toMatchObject([{
      surveyQuestionId: growthIds[1], statement: growthStatements[1],
    }]);
    expect(partialBundle.components).toHaveLength(1);
    expect(await repository.findReadyQuestionBundle({ tenantId, userId })).toBeNull();

    const disputed = await repository.findPendingQuestionClarification({ tenantId, userId, conversationId, inboundMessageId: growthInboundId });
    expect(disputed).toMatchObject({
      surveyQuestionId: growthIds[1], workingSummary: growthStatements[1],
      disputedStatement: growthStatements[1], clarificationPromptMessageId: null,
    });
    await client`update messages set deleted_at = '2026-09-28T18:07:30Z'
      where id = ${growthPromptId}`;
    expect(await repository.findPendingQuestionClarification({ tenantId, userId, conversationId, inboundMessageId: growthInboundId }))
      .toBeNull();
    const clarificationPromptId = '77777777-7777-4777-8777-777777777783';
    const clarificationText = 'What did I miss about your opportunities to grow?';
    await client`insert into messages values
      (${clarificationPromptId}, ${tenantId}, ${userId}, ${conversationId}, 'outbound',
       ${clarificationText}, '2026-09-28T18:08:00Z', null, null)`;
    await expect(repository.stageQuestionClarificationPrompt({
      tenantId, userId, conversationId: '99999999-9999-4999-8999-999999999999',
      workingInsightId: disputed!.workingInsightId, promptMessageId: clarificationPromptId,
      displayedText: clarificationText,
    })).rejects.toThrow('v2_clarification_bundle_scope_mismatch');
    await expect(repository.stageQuestionClarificationPrompt({
      tenantId, userId, conversationId, workingInsightId: disputed!.workingInsightId,
      promptMessageId: clarificationPromptId, displayedText: clarificationText,
    })).rejects.toThrow('v2_clarification_bundle_scope_mismatch');
    await client`update messages set deleted_at = null where id = ${growthPromptId}`;
    expect(await repository.stageQuestionClarificationPrompt({
      tenantId, userId, conversationId, workingInsightId: disputed!.workingInsightId,
      promptMessageId: clarificationPromptId, displayedText: clarificationText,
    })).toBe(true);
    expect(await repository.stageQuestionClarificationPrompt({
      tenantId, userId, conversationId, workingInsightId: disputed!.workingInsightId,
      promptMessageId: clarificationPromptId, displayedText: clarificationText,
    })).toBe(false);
    expect(await repository.findPendingQuestionClarification({ tenantId, userId, conversationId, inboundMessageId: growthInboundId }))
      .toMatchObject({ clarificationPromptMessageId: clarificationPromptId, clarificationPromptSentAt: null });
    const clarificationInboundId = '77777777-7777-4777-8777-777777777784';
    await client`insert into messages values
      (${clarificationInboundId}, ${tenantId}, ${userId}, ${conversationId}, 'inbound',
       'I have room to learn, but no time allocated for training.',
       '2026-09-28T18:09:00Z', null, null)`;
    const clarifiedInput = {
      tenantId, userId, conversationId, workingInsightId: disputed!.workingInsightId,
      inboundMessageId: clarificationInboundId,
      verdict: { kind: 'clarified' as const,
        correctedSummary: 'I can learn, but have no time allocated for training.' },
    };
    await expect(repository.applyQuestionClarificationVerdict(clarifiedInput))
      .rejects.toThrow('v2_clarification_reply_scope_mismatch');
    expect(await client`select status from survey_question_working_insights
      where id = ${disputed!.workingInsightId}`).toMatchObject([{ status: 'pending_clarification' }]);
    await client`update messages set sent_at = '2026-09-28T18:08:30Z'
      where id = ${clarificationPromptId}`;
    expect(await repository.findPendingQuestionClarification({ tenantId, userId, conversationId, inboundMessageId: clarificationInboundId }))
      .toMatchObject({ clarificationPromptSentAt: new Date('2026-09-28T18:08:30Z') });
    await client`update messages set deleted_at = '2026-09-28T18:09:00Z'
      where id = ${clarificationPromptId}`;
    await expect(repository.applyQuestionClarificationVerdict(clarifiedInput))
      .rejects.toThrow('v2_clarification_reply_scope_mismatch');
    await client`update messages set deleted_at = null where id = ${clarificationPromptId}`;
    await client`update messages set deleted_at = '2026-09-28T18:09:30Z'
      where id = ${growthPromptId}`;
    await expect(repository.applyQuestionClarificationVerdict(clarifiedInput))
      .rejects.toThrow('v2_clarification_bundle_scope_mismatch');
    await client`update messages set deleted_at = null where id = ${growthPromptId}`;
    await expect(repository.applyQuestionClarificationVerdict({
      ...clarifiedInput, conversationId: '99999999-9999-4999-8999-999999999999',
    })).rejects.toThrow('v2_clarification_bundle_scope_mismatch');
    await client`update survey_windows set period_end = '2026-09-28T18:09:30Z'
      where id = ${surveyWindowId}`;
    expect(await repository.findPendingQuestionClarification({
      tenantId, userId, conversationId, inboundMessageId: clarificationInboundId,
    })).toMatchObject({ workingInsightId: disputed!.workingInsightId });
    const lateInboundId = '77777777-7777-4777-8777-777777777799';
    await client`insert into messages values
      (${lateInboundId}, ${tenantId}, ${userId}, ${conversationId}, 'inbound',
       'Late clarification', '2026-09-28T18:10:00Z', null, null)`;
    expect(await repository.findPendingQuestionClarification({
      tenantId, userId, conversationId, inboundMessageId: lateInboundId,
    })).toBeNull();
    expect(await repository.applyQuestionClarificationVerdict(clarifiedInput)).toBe(true);
    expect(await repository.applyQuestionClarificationVerdict(clarifiedInput)).toBe(false);
    expect(await client`select status, confirmed_semantic_summary, confirmation_message_id
      from survey_question_working_insights where id = ${disputed!.workingInsightId}`)
      .toMatchObject([{
        status: 'confirmed', confirmed_semantic_summary: clarifiedInput.verdict.correctedSummary,
        confirmation_message_id: clarificationInboundId,
      }]);
    expect(await repository.findPendingQuestionClarification({ tenantId, userId, conversationId, inboundMessageId: clarificationInboundId })).toBeNull();
    expect(await client`select displayed_text, components from survey_question_confirmation_bundles
      where id = ${growthBundleId}`).toMatchObject([{ displayed_text: null, components: null }]);
    await client`update survey_windows set period_end = '2026-10-01T00:00:00Z'
      where id = ${surveyWindowId}`;
  });

  it('removes each resolved clarification component before the other disputes finish', async () => {
    if (!client || !repository) return;
    const ids = secondaryIds(2);
    const meanings = ['I feel included.', 'I am heard in meetings.', 'I know my teammates.'];
    const text = `I heard that ${meanings.join(' ')} Is that fair?`;
    const bundlePromptId = '77777777-7777-4777-8777-777777777785';
    const bundleReplyId = '77777777-7777-4777-8777-777777777786';
    for (const [index, id] of ids.entries()) {
      await client`insert into survey_question_working_insights (
        tenant_id, user_id, survey_window_id, survey_question_id, question_version,
        working_summary, source_message_ids, ready_for_confirmation)
        values (${tenantId}, ${userId}, ${surveyWindowId}, ${id}, 'v2',
          ${meanings[index]}, array[${id}]::uuid[], true)`;
    }
    await client`insert into messages values
      (${bundlePromptId}, ${tenantId}, ${userId}, ${conversationId}, 'outbound', ${text},
       '2026-09-28T18:10:00Z', null, null)`;
    const bundleId = await repository.stageQuestionConfirmationBundle({
      tenantId, userId, conversationId, surveyWindowId, questionGroup: 'belonging',
      promptMessageId: bundlePromptId, displayedText: text,
      components: ids.map((surveyQuestionId, index) => ({
        surveyQuestionId, questionVersion: 'v2', statement: meanings[index],
        expectedWorkingSummary: meanings[index],
      })),
    });
    await client`update messages set sent_at = '2026-09-28T18:11:00Z' where id = ${bundlePromptId}`;
    await repository.activateDeliveredQuestionBundle({
      promptMessageId: bundlePromptId, tenantId, conversationId,
      deliveredAt: new Date('2026-09-28T18:11:00Z'),
    });
    await client`insert into messages values
      (${bundleReplyId}, ${tenantId}, ${userId}, ${conversationId}, 'inbound',
       'The first is right; the other two need correction.',
       '2026-09-28T18:12:00Z', null, null)`;
    expect(await repository.applyQuestionBundleVerdict({
      tenantId, userId, conversationId, inboundMessageId: bundleReplyId, bundleId,
      verdict: { kind: 'partial', acceptedQuestionIds: [ids[0]],
        disputedQuestionIds: [ids[1], ids[2]], declinedQuestionIds: [] },
    })).toBe(true);

    const resolveDispute = async (index: 1 | 2, kind: 'clarified' | 'declined') => {
      const promptId = index === 1
        ? '77777777-7777-4777-8777-777777777787'
        : '77777777-7777-4777-8777-777777777789';
      const replyId = index === 1
        ? '77777777-7777-4777-8777-777777777788'
        : '77777777-7777-4777-8777-777777777790';
      const promptText = 'What should I change in that understanding?';
      const promptAt = index === 1 ? '2026-09-28T18:13:00Z' : '2026-09-28T18:15:00Z';
      const sentAt = index === 1 ? '2026-09-28T18:13:30Z' : '2026-09-28T18:15:30Z';
      const replyAt = index === 1 ? '2026-09-28T18:14:00Z' : '2026-09-28T18:16:00Z';
      const [working] = await client`select id from survey_question_working_insights
        where survey_question_id = ${ids[index]}`;
      await client`insert into messages values
        (${promptId}, ${tenantId}, ${userId}, ${conversationId}, 'outbound',
         ${promptText}, ${promptAt}::timestamptz, null, null)`;
      expect(await repository.stageQuestionClarificationPrompt({
        tenantId, userId, conversationId, workingInsightId: working.id,
        promptMessageId: promptId, displayedText: promptText,
      })).toBe(true);
      await client`update messages set sent_at = ${sentAt}::timestamptz where id = ${promptId}`;
      await client`insert into messages values
        (${replyId}, ${tenantId}, ${userId}, ${conversationId}, 'inbound',
         'Please correct that.', ${replyAt}::timestamptz, null, null)`;
      const preview = await repository.previewPendingQuestionClarificationAfterVerdict({
        tenantId, userId, conversationId, workingInsightId: working.id,
      });
      if (index === 1) {
        expect(preview).toMatchObject({
          surveyQuestionId: ids[2], workingSummary: meanings[2],
          clarificationPromptMessageId: null,
        });
      } else {
        expect(preview).toBeNull();
      }
      expect(await repository.applyQuestionClarificationVerdict({
        tenantId, userId, conversationId, workingInsightId: working.id,
        inboundMessageId: replyId,
        verdict: kind === 'clarified'
          ? { kind, correctedSummary: 'I can contribute when given room.' }
          : { kind },
      })).toBe(true);
    };

    await resolveDispute(1, 'clarified');
    const [partiallyResolved] = await client`select components from survey_question_confirmation_bundles
      where id = ${bundleId}`;
    expect(partiallyResolved.components).toMatchObject([
      { surveyQuestionId: ids[2], statement: meanings[2] },
    ]);
    expect(partiallyResolved.components).toHaveLength(1);

    await resolveDispute(2, 'declined');
    const [fullyResolved] = await client`select components, purged_at
      from survey_question_confirmation_bundles where id = ${bundleId}`;
    expect(fullyResolved.components).toBeNull();
    expect(fullyResolved.purged_at).not.toBeNull();
  });

  it.each([true, false])(
    'accepts an in-period confirmation after cutoff when delivery activation completed=%s',
    async (activationCompleted) => {
      if (!client || !repository) return;
      const delayedWindowId = randomUUID();
      const delayedPromptId = randomUUID();
      const delayedInboundId = randomUUID();
      const ids = secondaryIds(0);
      const meanings = ids.map((_, index) => `Growth statement ${index + 1}.`);
      const text = `I heard that ${meanings.join(' ')} Is that fair?`;
      await client`insert into survey_windows (id, tenant_id, user_id, survey_definition_id, status, period_end)
        values (${delayedWindowId}, ${tenantId}, ${userId}, ${definitionId}, 'active',
          '2026-10-01T00:00:00Z')`;
      await client`insert into survey_window_scoring_policies values
        (${delayedWindowId}, ${tenantId}, ${policyId})`;
      for (const [index, id] of ids.entries()) {
        await client`insert into survey_question_working_insights (
          tenant_id, user_id, survey_window_id, survey_question_id, question_version,
          working_summary, source_message_ids, ready_for_confirmation)
          values (${tenantId}, ${userId}, ${delayedWindowId}, ${id}, 'v2',
            ${meanings[index]}, array[${id}]::uuid[], true)`;
      }
      await client`insert into messages values
        (${delayedPromptId}, ${tenantId}, ${userId}, ${conversationId}, 'outbound', ${text},
          '2026-09-28T18:20:00Z', null, null)`;
      const bundleId = await repository.stageQuestionConfirmationBundle({
        tenantId, userId, conversationId, surveyWindowId: delayedWindowId,
        questionGroup: 'growth', promptMessageId: delayedPromptId, displayedText: text,
        components: ids.map((surveyQuestionId, index) => ({
          surveyQuestionId, questionVersion: 'v2', statement: meanings[index],
          expectedWorkingSummary: meanings[index],
        })),
      });
      await client`update messages set sent_at = '2026-09-28T18:21:00Z'
        where id = ${delayedPromptId}`;
      if (activationCompleted) {
        await repository.activateDeliveredQuestionBundle({
          promptMessageId: delayedPromptId, tenantId, conversationId,
          deliveredAt: new Date('2026-09-28T18:21:00Z'),
        });
      }
      await client`insert into messages values
        (${delayedInboundId}, ${tenantId}, ${userId}, ${conversationId}, 'inbound', 'Yes.',
          '2026-09-28T18:22:00Z', null, null)`;
      await client`update survey_windows set period_end = '2026-09-29T00:00:00Z'
        where id = ${delayedWindowId}`;
      const cutoff = new SurveyRepository({ client: drizzle(client) } as never, {} as never, {} as never);
      expect(await cutoff.hasUnresolvedQuestionConfirmationForInbound({
        tenantId, userId, conversationId, messageId: delayedInboundId,
      })).toBe(true);
      expect(await cutoff.expireTemporaryQuestionInsightsForClosedWindows({
        tenantId, now: new Date('2026-09-29T00:01:00Z'),
      })).toBe(0);

      const awaiting = await repository.findAwaitingQuestionBundle({
        tenantId, userId, conversationId, inboundMessageId: delayedInboundId,
      });
      const applied = await repository.applyQuestionBundleVerdict({
        tenantId, userId, conversationId, inboundMessageId: delayedInboundId,
        bundleId, verdict: { kind: 'agree' },
      });
      expect({ awaitingId: awaiting?.id ?? null, applied }).toEqual({
        awaitingId: bundleId, applied: true,
      });
      await client`insert into conversation_job_receipts (message_id) values (${delayedInboundId})`;
      expect(await cutoff.expireTemporaryQuestionInsightsForClosedWindows({
        tenantId, now: new Date('2026-09-29T00:02:00Z'),
      })).toBe(0);
      expect(await client`select status, confirmed_semantic_summary from survey_question_working_insights
        where survey_window_id = ${delayedWindowId} order by survey_question_id`)
        .toMatchObject(meanings.map((meaning) => ({
          status: 'confirmed', confirmed_semantic_summary: meaning,
        })));
    },
  );

  it.runIf(process.env['V2_BUNDLE_QUEUE_TEST'] === '1')(
    'activates a delivered bundle after a BullMQ worker restart', async () => {
      if (!client || !repository) return;
      const rawUrl = process.env['REDIS_URL'];
      if (!rawUrl) throw new Error('isolated_redis_url_required');
      const url = new URL(rawUrl);
      const dbUrl = new URL(databaseUrl!);
      if (!['127.0.0.1', 'localhost'].includes(dbUrl.hostname) || !dbUrl.port) {
        throw new Error('isolated_postgres_required');
      }
      if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/15') {
        throw new Error('isolated_redis_db_15_required');
      }

      const queuedWindowId = randomUUID();
      const queuedMessageId = randomUUID();
      const queuedText = 'I hear that you choose methods, set priorities, and raise concerns. Is that fair?';
      const queuedStatements = [
        'you choose methods', 'set priorities', 'raise concerns',
      ];
      await client`create temp table conversations (
        id uuid primary key, tenant_id uuid not null, user_id uuid not null,
        channel_type text not null, external_conversation_id text not null
      )`;
      await client`insert into conversations values
        (${conversationId}, ${tenantId}, ${userId}, 'dev', 'queue-dev')`;
      await client`alter table messages
        add column metadata jsonb not null default '{}'::jsonb,
        add column external_message_id text,
        add column external_thread_id text`;
      await client`insert into survey_windows values
        (${queuedWindowId}, ${tenantId}, ${userId}, ${definitionId}, 'active', '2026-10-01T00:00:00Z')`;
      await client`insert into survey_window_scoring_policies values
        (${queuedWindowId}, ${tenantId}, ${policyId})`;
      await client`insert into messages (
        id, tenant_id, user_id, conversation_id, direction, text, occurred_at, sent_at, deleted_at
      ) values (${queuedMessageId}, ${tenantId}, ${userId}, ${conversationId}, 'outbound',
        ${queuedText}, '2026-09-28T19:00:00Z', null, null)`;
      for (const [index, surveyQuestionId] of questionIds.entries()) {
        await client`insert into survey_question_working_insights (
          tenant_id, user_id, survey_window_id, survey_question_id, question_version,
          working_summary, source_message_ids, ready_for_confirmation
        ) values (${tenantId}, ${userId}, ${queuedWindowId}, ${surveyQuestionId}, 'v2',
          ${queuedStatements[index]}, array[${surveyQuestionId}]::uuid[], true)`;
      }
      const bundleId = await repository.stageQuestionConfirmationBundle({
        tenantId, userId, conversationId, surveyWindowId: queuedWindowId,
        questionGroup: 'autonomy', promptMessageId: queuedMessageId, displayedText: queuedText,
        components: questionIds.map((surveyQuestionId, index) => ({
          surveyQuestionId, questionVersion: 'v2',
          statement: queuedStatements[index], expectedWorkingSummary: queuedStatements[index],
        })),
      });

      const connection = {
        host: url.hostname, port: Number(url.port) || 6379, db: 15,
        maxRetriesPerRequest: null,
      };
      const queue = new Queue(`v2-bundle-delivery-${randomUUID()}`, { connection });
      const events = new QueueEvents(queue.name, { connection });
      let activationAttempts = 0;
      const conversationRepo = new ConversationRepository({ client: drizzle(client) } as never);
      vi.spyOn(conversationRepo, 'findOnboardingDelivery').mockResolvedValue(null);
      vi.spyOn(conversationRepo, 'isUserRuntimeEligible').mockResolvedValue(true);
      const deliveryWrite = vi.spyOn(conversationRepo, 'updateMessageDelivery');
      const processor = new MessageSendProcessor({} as never, conversationRepo, {
        activateDeliveredConfirmation: async () => {
          if (++activationAttempts === 1) throw new Error('synthetic_activation_failure');
        },
      } as never, repository);
      let firstWorker: Worker | undefined;
      let restartedWorker: Worker | undefined;
      try {
        await events.waitUntilReady();
        firstWorker = new Worker(queue.name, (job) => processor.process(job), { connection });
        const firstFailure = new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('bundle_first_failure_timeout')), 5_000);
          firstWorker!.once('failed', (_job, error) => {
            clearTimeout(timer);
            try {
              expect(error.message).toBe('synthetic_activation_failure');
              resolve();
            } catch (assertionError) { reject(assertionError); }
          });
        });

        const job = await queue.add('send', {
          messageId: queuedMessageId, tenantId, conversationId, channelType: 'dev',
          externalWorkspaceId: 'queue-dev-workspace', externalChannelId: 'queue-dev',
        }, { attempts: 2, backoff: { type: 'fixed', delay: 1_000 } });
        expect(JSON.stringify(job.data)).not.toContain(queuedText);
        await firstFailure;
        expect(await client`select status from survey_question_confirmation_bundles where id = ${bundleId}`)
          .toMatchObject([{ status: 'pending_delivery' }]);
        await firstWorker.close();
        firstWorker = undefined;
        restartedWorker = new Worker(queue.name, (queued) => processor.process(queued), { connection });
        await job.waitUntilFinished(events, 10_000);
        expect(deliveryWrite).toHaveBeenCalledOnce();
        expect(activationAttempts).toBe(2);
        expect(await client`select sent_at is not null as delivered, external_message_id
          from messages where id = ${queuedMessageId}`)
          .toMatchObject([{ delivered: true, external_message_id: `dev:${queuedMessageId}` }]);
        expect(await client`select status from survey_question_confirmation_bundles where id = ${bundleId}`)
          .toMatchObject([{ status: 'awaiting_confirmation' }]);
      } finally {
        await firstWorker?.close();
        await restartedWorker?.close();
        await events.close();
        await queue.obliterate({ force: true });
        await queue.close();
      }
    },
    20_000,
  );
});
