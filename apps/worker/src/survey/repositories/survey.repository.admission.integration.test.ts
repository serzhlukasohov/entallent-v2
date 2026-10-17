import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { SurveyRepository } from './survey.repository';

const databaseUrl = process.env['DATABASE_URL'];
const tenantId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const conversationId = '33333333-3333-4333-8333-333333333333';
const windowId = '44444444-4444-4444-8444-444444444444';
const promptId = '55555555-5555-4555-8555-555555555555';
const timelyId = '66666666-6666-4666-8666-666666666666';
const persistedLateId = '77777777-7777-4777-8777-777777777777';

describe.runIf(Boolean(databaseUrl))('V2 conversation admission recovery on PostgreSQL', () => {
  const client = databaseUrl ? postgres(databaseUrl, { max: 1 }) : null;
  const repository = client
    ? new SurveyRepository({ client: drizzle(client) } as never, {} as never, {} as never)
    : null;

  beforeAll(async () => {
    if (!client) return;
    await client`create temp table survey_windows (
      id uuid primary key, tenant_id uuid not null, user_id uuid not null,
      period_start timestamptz not null, period_end timestamptz not null
    )`;
    await client`create temp table survey_question_confirmation_bundles (
      id uuid primary key, tenant_id uuid not null, user_id uuid not null,
      survey_window_id uuid not null, prompt_message_id uuid, status text not null,
      purged_at timestamptz
    )`;
    await client`create temp table messages (
      id uuid primary key, tenant_id uuid not null, user_id uuid not null,
      conversation_id uuid not null, direction text not null,
      occurred_at timestamptz not null, received_at timestamptz,
      sent_at timestamptz, deleted_at timestamptz
    )`;
    await client`create temp table conversation_job_receipts (message_id uuid primary key)`;
    await client`create temp table conversation_turn_effects (
      inbound_message_id uuid primary key, tenant_id uuid not null,
      user_id uuid not null, conversation_id uuid not null
    )`;
    await client`create temp table conversation_job_admissions (
      message_id uuid primary key, tenant_id uuid not null, user_id uuid not null,
      conversation_id uuid not null, external_workspace_id text not null,
      external_conversation_id text not null, event_id text not null,
      request_id uuid not null, trace_id uuid not null, queued_at timestamptz
    )`;
    await client`insert into survey_windows values
      (${windowId}, ${tenantId}, ${userId}, '2026-09-01T00:00:00Z', '2026-09-29T00:00:00Z')`;
    await client`insert into messages values
      (${promptId}, ${tenantId}, ${userId}, ${conversationId}, 'outbound',
       '2026-09-28T23:57:00Z', null, '2026-09-28T23:58:00Z', null),
      (${timelyId}, ${tenantId}, ${userId}, ${conversationId}, 'inbound',
       '2026-09-28T23:59:00Z', '2026-09-28T23:59:01Z', null, null),
      (${persistedLateId}, ${tenantId}, ${userId}, ${conversationId}, 'inbound',
       '2026-09-28T23:59:30Z', '2026-09-29T00:00:01Z', null, null)`;
    await client`insert into survey_question_confirmation_bundles values
      ('88888888-8888-4888-8888-888888888888', ${tenantId}, ${userId},
       ${windowId}, ${promptId}, 'awaiting_confirmation', null)`;
    await client`insert into conversation_job_admissions values
      (${timelyId}, ${tenantId}, ${userId}, ${conversationId}, 'T1', 'D1', 'event-1',
       '99999999-9999-4999-8999-999999999999', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null),
      (${persistedLateId}, ${tenantId}, ${userId}, ${conversationId}, 'T1', 'D1', 'event-2',
       'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', null)`;
  });

  afterAll(async () => { await client?.end({ timeout: 2 }); });

  it('selects pre-cutoff events even when API receives one after cutoff', async () => {
    if (!repository) return;
    const pending = await repository.findUndispatchedTimelyQuestionReplies(new Date('2026-09-29T00:05:00Z'));
    expect(pending).toEqual([
      {
        messageId: timelyId, tenantId, userId, conversationId,
        externalWorkspaceId: 'T1', externalConversationId: 'D1', eventId: 'event-1',
        requestId: '99999999-9999-4999-8999-999999999999',
        traceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      },
      {
        messageId: persistedLateId, tenantId, userId, conversationId,
        externalWorkspaceId: 'T1', externalConversationId: 'D1', eventId: 'event-2',
        requestId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        traceId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      },
    ]);
    await repository.markQuestionReplyAdmissionQueued(timelyId, tenantId);
    await repository.markQuestionReplyAdmissionQueued(persistedLateId, tenantId);
    expect(await repository.findUndispatchedTimelyQuestionReplies(new Date('2026-09-29T00:05:00Z')))
      .toEqual([]);
    expect(await repository.findQueuedTimelyQuestionRepliesWithoutReceipt(new Date('2026-09-29T00:05:00Z')))
      .toEqual([
        { messageId: timelyId, tenantId, userId, conversationId },
        { messageId: persistedLateId, tenantId, userId, conversationId },
      ]);
    await client!`insert into conversation_job_receipts values (${timelyId})`;
    await client!`insert into conversation_job_receipts values (${persistedLateId})`;
    expect(await repository.findQueuedTimelyQuestionRepliesWithoutReceipt(new Date('2026-09-29T00:05:00Z')))
      .toEqual([]);
  });

  it('paginates queued replies in PostgreSQL UUID order', async () => {
    if (!repository || !client) return;
    const lowerId = '10000000-0000-4000-8000-000000000001';
    const higherId = '90000000-0000-4000-8000-000000000001';
    for (const messageId of [lowerId, higherId]) {
      await client`insert into messages values
        (${messageId}, ${tenantId}, ${userId}, ${conversationId}, 'inbound',
         '2026-09-28T23:59:00Z', '2026-09-28T23:59:01Z', null, null)`;
      await client`insert into conversation_job_admissions values
        (${messageId}, ${tenantId}, ${userId}, ${conversationId}, 'T1', 'D1', 'event-page',
         '99999999-9999-4999-8999-999999999999', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
         '2026-09-28T23:59:02Z')`;
    }
    const now = new Date('2026-09-29T00:05:00Z');
    expect((await repository.findQueuedTimelyQuestionRepliesWithoutReceipt(now)).map((row) => row.messageId))
      .toEqual([lowerId, higherId]);
    expect((await repository.findQueuedTimelyQuestionRepliesWithoutReceipt(now, lowerId)).map((row) => row.messageId))
      .toEqual([higherId]);
    expect(await repository.findQueuedTimelyQuestionRepliesWithoutReceipt(now, higherId))
      .toEqual([]);
  });

  it('recovers a purged bundle only when its queued reply has a scoped committed turn', async () => {
    if (!repository || !client) return;
    const now = new Date('2026-09-29T00:05:00Z');
    await client`delete from conversation_job_receipts where message_id = ${timelyId}`;
    await client`update survey_question_confirmation_bundles
      set status = 'resolved', purged_at = '2026-09-29T00:01:00Z'`;
    expect(await repository.findQueuedTimelyQuestionRepliesWithoutReceipt(now)).toEqual([]);
    await client`insert into conversation_turn_effects values
      (${timelyId}, ${tenantId}, ${userId}, ${conversationId})`;
    expect((await repository.findQueuedTimelyQuestionRepliesWithoutReceipt(now)).map((row) => row.messageId))
      .toContain(timelyId);
    expect(await repository.findUndispatchedTimelyQuestionReplies(now)).toEqual([]);
  });
});
