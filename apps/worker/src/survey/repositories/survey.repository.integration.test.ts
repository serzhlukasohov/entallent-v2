import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createDbClient } from '@entalent/database';
import { SurveyRepository } from './survey.repository';

const databaseUrl = process.env.CAP8_TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)('CAP-8 PostgreSQL provenance', () => {
  it('filters exact UUID evidence and excludes deleted or foreign sources', async () => {
    const target = new URL(databaseUrl!);
    if (!['localhost', '127.0.0.1', '::1'].includes(target.hostname)
      || !target.pathname.endsWith('_test')) {
      throw new Error('CAP8_TEST_DATABASE_URL must point to a local *_test database');
    }
    const { db, sql: client } = createDbClient(databaseUrl!);
    try {
      await db.transaction(async (tx) => {
        await tx.execute(sql`create temporary table messages (
          id uuid, tenant_id uuid, user_id uuid, conversation_id uuid,
          direction text, deleted_at timestamptz, occurred_at timestamptz, metadata jsonb
        ) on commit drop`);
        await tx.execute(sql`create temporary table survey_windows (id uuid, tenant_id uuid, user_id uuid) on commit drop`);
        await tx.execute(sql`create temporary table survey_questions (id uuid, question_group text) on commit drop`);
        await tx.execute(sql`create temporary table survey_evidence (
          id uuid, survey_window_id uuid, survey_question_id uuid, user_id uuid,
          source_message_ids uuid[], evidence_summary text, superseded_at timestamptz, created_at timestamptz
        ) on commit drop`);
        await tx.execute(sql`create temporary table survey_group_states (
          survey_window_id uuid, user_id uuid, question_group text, tenant_id uuid,
          status text, confirmation_prompt_message_id uuid
        ) on commit drop`);

        const tenantId = randomUUID();
        const userId = randomUUID();
        const otherUserId = randomUUID();
        const conversationId = randomUUID();
        const otherConversationId = randomUUID();
        const windowId = randomUUID();
        const questionId = randomUUID();
        const [sourceId, unrelatedId, deletedId, foreignId] = Array.from({ length: 4 }, () => randomUUID());
        const before = new Date('2026-09-25T10:00:00.000Z');
        const beforeIso = before.toISOString();

        await tx.execute(sql`insert into survey_windows values (${windowId}::uuid, ${tenantId}::uuid, ${userId}::uuid)`);
        await tx.execute(sql`insert into survey_questions values (${questionId}::uuid, 'belonging')`);
        for (const [id, owner, conversation, occurredAt, deletedAt] of [
          [sourceId, userId, conversationId, beforeIso, null],
          [unrelatedId, userId, conversationId, new Date(before.getTime() - 1_000).toISOString(), null],
          [deletedId, userId, conversationId, new Date(before.getTime() - 2_000).toISOString(), beforeIso],
          [foreignId, otherUserId, otherConversationId, new Date(before.getTime() - 3_000).toISOString(), null],
        ]) {
          await tx.execute(sql`insert into messages values (
            ${id}::uuid, ${tenantId}::uuid, ${owner}::uuid, ${conversation}::uuid,
            'inbound', ${deletedAt}::timestamptz, ${occurredAt}::timestamptz, '{}'::jsonb
          )`);
        }
        for (const [sourceMessageId, summary] of [
          [sourceId, 'Target only'],
          [unrelatedId, 'Unrelated'],
          [deletedId, 'Deleted'],
          [foreignId, 'Foreign'],
        ]) {
          await tx.execute(sql`insert into survey_evidence values (
            ${randomUUID()}::uuid, ${windowId}::uuid, ${questionId}::uuid, ${userId}::uuid,
            array[${sourceMessageId}::uuid], ${summary}, null, now()
          )`);
        }

        const repository = new SurveyRepository({ client: tx } as never, {} as never, {} as never);
        const scope = { tenantId, userId, conversationId, beforeOccurredAt: before };
        await expect(repository.findPulseCaptureForConversation({ ...scope, sourceMessageId: sourceId }))
          .resolves.toEqual([{ evidenceSummary: 'Target only', questionGroup: 'belonging', sourceMessageIds: [sourceId], status: 'temporary' }]);
        await expect(repository.findPulseCaptureForConversation(scope))
          .resolves.toEqual([{ evidenceSummary: 'Unrelated', questionGroup: 'belonging', sourceMessageIds: [unrelatedId], status: 'temporary' }]);

        await tx.execute(sql`insert into survey_evidence values (
          ${randomUUID()}::uuid, ${windowId}::uuid, ${questionId}::uuid, ${userId}::uuid,
          array[${sourceId}::uuid, ${unrelatedId}::uuid], 'Mixed sources', null, now()
        )`);
        const confirmationPromptId = randomUUID();
        await tx.execute(sql`insert into messages values (
          ${confirmationPromptId}::uuid, ${tenantId}::uuid, ${userId}::uuid, ${conversationId}::uuid,
          'outbound', null, ${beforeIso}::timestamptz,
          jsonb_build_object('confirmationSourceMessageIds', jsonb_build_array(${sourceId}::text), 'confirmationSummary', 'Final target')
        )`);
        await tx.execute(sql`insert into survey_group_states values (
          ${windowId}::uuid, ${userId}::uuid, 'belonging', ${tenantId}::uuid,
          'confirmed', ${confirmationPromptId}::uuid
        )`);
        const finalCaptures = await repository.findPulseCaptureForConversation({ ...scope, sourceMessageId: sourceId });
        expect(finalCaptures).toHaveLength(2);
        expect(finalCaptures).toEqual(expect.arrayContaining([
          { evidenceSummary: 'Final target', questionGroup: 'belonging', sourceMessageIds: [sourceId], status: 'confirmed' },
          { evidenceSummary: 'Mixed sources', questionGroup: 'belonging', sourceMessageIds: [sourceId, unrelatedId], status: 'temporary' },
        ]));
      });
    } finally {
      await client.end();
    }
  });
});
