import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Queue, QueueEvents, Worker } from 'bullmq';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { SurveyRepository } from './survey.repository';
import { ExpireQuestionInsightsAtCutoffUseCase } from '@entalent/application';
import { QuestionCutoffProcessor } from '../question-cutoff.processor';
import { ConversationProcessor, type ConversationJob } from '../../conversation/conversation.processor';

const databaseUrl = process.env['DATABASE_URL'];
const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT = '22222222-2222-4222-8222-222222222222';
const PERSON = '33333333-3333-4333-8333-333333333333';
const DEFINITION = '44444444-4444-4444-8444-444444444444';
const OTHER_DEFINITION = '55555555-5555-4555-8555-555555555555';
const CLOSED = '66666666-6666-4666-8666-666666666666';
const FUTURE = '77777777-7777-4777-8777-777777777777';
const FOREIGN = '88888888-8888-4888-8888-888888888888';
const OTHER_DEFINITION_WINDOW = '99999999-9999-4999-8999-999999999999';
const UNBOUND_TENANT = '12121212-1212-4212-8212-121212121212';
const UNBOUND_WINDOW = '13131313-1313-4313-8313-131313131313';

describe.runIf(Boolean(databaseUrl))('V2 question cutoff on PostgreSQL', () => {
  const client = databaseUrl ? postgres(databaseUrl, { max: 1 }) : null;
  const repository = client
    ? new SurveyRepository({ client: drizzle(client) } as never, {} as never, {} as never)
    : null;

  beforeAll(async () => {
    if (!client) return;
    await client`create temp table survey_windows (
      id uuid primary key, tenant_id uuid not null, user_id uuid not null,
      survey_definition_id uuid not null,
      period_start timestamptz not null default '2026-06-01T00:00:00Z',
      period_end timestamptz not null
    )`;
    await client`create temp table survey_question_working_insights (
      id uuid primary key, tenant_id uuid not null, user_id uuid not null,
      survey_window_id uuid not null, status text not null,
      working_summary text, confirmed_semantic_summary text,
      source_message_ids uuid[] not null, clarification_prompt_message_id uuid,
      confirmation_message_id uuid,
      confirmed_at timestamptz, purged_at timestamptz, updated_at timestamptz not null
    )`;
    await client`create temp table survey_question_confirmation_bundles (
      id uuid primary key, tenant_id uuid not null, user_id uuid not null,
      survey_window_id uuid not null, displayed_text text, components jsonb,
      prompt_message_id uuid, status text not null, purged_at timestamptz
    )`;
    await client`create temp table messages (
      id uuid primary key, tenant_id uuid not null, user_id uuid not null,
      conversation_id uuid not null, direction text not null,
      occurred_at timestamptz not null, received_at timestamptz,
      sent_at timestamptz, deleted_at timestamptz
    )`;
    await client`create temp table conversation_job_receipts (
      message_id uuid primary key, processed_at timestamptz not null default now()
    )`;
    await client`create temp table survey_window_scoring_policies (
      survey_window_id uuid primary key, tenant_id uuid not null
    )`;
    await client`insert into survey_windows (id, tenant_id, user_id, survey_definition_id, period_end)
      values
      (${CLOSED}, ${TENANT}, ${PERSON}, ${DEFINITION}, '2026-09-01T00:00:00Z'),
      (${FUTURE}, ${TENANT}, ${PERSON}, ${DEFINITION}, '2026-12-01T00:00:00Z'),
      (${FOREIGN}, ${OTHER_TENANT}, ${PERSON}, ${DEFINITION}, '2026-09-01T00:00:00Z'),
      (${OTHER_DEFINITION_WINDOW}, ${TENANT}, ${PERSON}, ${OTHER_DEFINITION}, '2026-09-01T00:00:00Z')`;
    await client`insert into survey_window_scoring_policies (survey_window_id, tenant_id)
      values (${CLOSED}, ${TENANT}), (${FUTURE}, ${TENANT}),
        (${FOREIGN}, ${OTHER_TENANT}), (${OTHER_DEFINITION_WINDOW}, ${TENANT})`;
    await client`insert into survey_question_working_insights
      (id, tenant_id, user_id, survey_window_id, status, working_summary,
        confirmed_semantic_summary, source_message_ids, confirmation_message_id,
        confirmed_at, updated_at)
      values
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ${TENANT}, ${PERSON}, ${CLOSED},
        'pending_clarification', 'Private working meaning', 'Private confirmation',
        array['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab']::uuid[],
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac', null, now()),
      ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', ${TENANT}, ${PERSON}, ${CLOSED},
        'confirmed', 'Confirmed working meaning', 'Confirmed semantic meaning',
        array[]::uuid[], null, now(), now()),
      ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', ${TENANT}, ${PERSON}, ${FUTURE},
        'pending_clarification', 'Future meaning', null, array[]::uuid[], null, null, now()),
      ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', ${OTHER_TENANT}, ${PERSON}, ${FOREIGN},
        'pending_clarification', 'Other tenant meaning', null, array[]::uuid[], null, null, now()),
      ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', ${TENANT}, ${PERSON}, ${OTHER_DEFINITION_WINDOW},
        'pending_clarification', 'Other definition meaning', null, array[]::uuid[], null, null, now())`;
    await client`update survey_question_working_insights
      set clarification_prompt_message_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad'
      where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'`;
    await client`insert into survey_question_confirmation_bundles
      (id, tenant_id, user_id, survey_window_id, displayed_text, components, status)
      values
      ('ffffffff-ffff-4fff-8fff-ffffffffffff', ${TENANT}, ${PERSON}, ${CLOSED},
        'Private bundle', '{"one":"Private detail"}'::jsonb, 'awaiting_confirmation'),
      ('abababab-abab-4aba-8aba-abababababab', ${TENANT}, ${PERSON}, ${FUTURE},
        'Future bundle', '{}'::jsonb, 'awaiting_confirmation')`;
  });

  afterAll(async () => {
    await client?.end();
  });

  it('purges only unresolved questions in the selected closed windows, idempotently', async () => {
    if (!client || !repository) return;
    const scope = {
      tenantId: TENANT,
      surveyDefinitionId: DEFINITION,
      now: new Date('2026-09-28T00:00:00Z'),
    };
    expect(await repository.findTenantsWithClosedTemporaryQuestionInsights(scope.now))
      .toEqual([TENANT, OTHER_TENANT]);
    await expect(repository.expireTemporaryQuestionInsightsForClosedWindows(scope)).resolves.toBe(2);
    await expect(repository.expireTemporaryQuestionInsightsForClosedWindows(scope)).resolves.toBe(0);

    const rows = await client`select id, status, working_summary, confirmed_semantic_summary,
      cardinality(source_message_ids) as source_count, clarification_prompt_message_id,
      confirmation_message_id, purged_at
      from survey_question_working_insights order by id`;
    expect(rows[0]).toMatchObject({
      status: 'no_data', working_summary: null, confirmed_semantic_summary: null,
      source_count: 0, clarification_prompt_message_id: null, confirmation_message_id: null,
    });
    expect(rows[0]?.['purged_at']).not.toBeNull();
    expect(rows[1]).toMatchObject({
      status: 'no_data', working_summary: null, confirmed_semantic_summary: null,
      source_count: 0, confirmation_message_id: null,
    });
    expect(rows[1]?.['purged_at']).not.toBeNull();
    expect(rows.slice(2).map((row) => row['status'])).toEqual([
      'pending_clarification', 'pending_clarification', 'pending_clarification',
    ]);
    const bundles = await client`select id, displayed_text, components, status from survey_question_confirmation_bundles`;
    expect(bundles.find((row) => row['id'] === 'ffffffff-ffff-4fff-8fff-ffffffffffff'))
      .toMatchObject({ displayed_text: null, components: null, status: 'purged' });
    expect(bundles.find((row) => row['id'] === 'abababab-abab-4aba-8aba-abababababab'))
      .toMatchObject({ displayed_text: 'Future bundle', status: 'awaiting_confirmation' });
  });

  it('discovers remaining closed V2 content and expires every tenant without queuing reports', async () => {
    if (!client || !repository) return;
    const now = new Date('2026-09-28T00:00:00Z');
    const cutoff = new ExpireQuestionInsightsAtCutoffUseCase(repository);
    await expect(cutoff.execute(now)).resolves.toEqual({
      tenantsProcessed: 2, expiredQuestionCount: 2, overdueReplyCount: 0,
    });
    await expect(cutoff.execute(now)).resolves.toEqual({
      tenantsProcessed: 0, expiredQuestionCount: 0, overdueReplyCount: 0,
    });
    const rows = await client`select id, status, working_summary from survey_question_working_insights`;
    expect(rows.filter((row) => row['status'] === 'pending_clarification'))
      .toMatchObject([{ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', working_summary: 'Future meaning' }]);
  });

  it('discovers and purges a late confirmed row even when no unresolved row remains', async () => {
    if (!client || !repository) return;
    const now = new Date('2026-09-28T00:00:00Z');
    await client`update survey_question_working_insights set
      status = 'confirmed', working_summary = 'Orphaned private meaning',
      confirmed_semantic_summary = 'Orphaned private confirmation',
      confirmed_at = '2026-09-01T00:00:00Z', purged_at = null, updated_at = now()
      where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'`;
    expect(await repository.findTenantsWithClosedTemporaryQuestionInsights(now)).toEqual([TENANT]);
    expect(await repository.expireTemporaryQuestionInsightsForClosedWindows({
      tenantId: TENANT, surveyDefinitionId: DEFINITION, now,
    })).toBe(1);
    const [row] = await client`select status, working_summary, confirmed_semantic_summary, purged_at
      from survey_question_working_insights where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'`;
    expect(row).toMatchObject({
      status: 'no_data', working_summary: null, confirmed_semantic_summary: null,
    });
    expect(row?.['purged_at']).not.toBeNull();
  });

  it('expires a V2 working row even when the closed window has no scoring-policy binding', async () => {
    if (!client || !repository) return;
    const now = new Date('2026-09-28T00:00:00Z');
    await client`insert into survey_windows
      (id, tenant_id, user_id, survey_definition_id, period_end)
      values (${UNBOUND_WINDOW}, ${UNBOUND_TENANT}, ${PERSON}, ${DEFINITION},
        '2026-09-01T00:00:00Z')`;
    await client`insert into survey_question_working_insights
      (id, tenant_id, user_id, survey_window_id, status, working_summary,
        source_message_ids, updated_at)
      values ('14141414-1414-4414-8414-141414141414', ${UNBOUND_TENANT}, ${PERSON},
        ${UNBOUND_WINDOW}, 'pending_clarification', 'Unbound private meaning',
        array[]::uuid[], now())`;
    expect(await repository.findTenantsWithClosedTemporaryQuestionInsights(now))
      .toEqual([UNBOUND_TENANT]);
    const cutoff = new ExpireQuestionInsightsAtCutoffUseCase(repository);
    expect(await cutoff.execute(now)).toEqual({ tenantsProcessed: 1, expiredQuestionCount: 1, overdueReplyCount: 0 });
  });

  it('holds a closed Bundle only until its timely inbound job has a durable receipt', async () => {
    if (!client || !repository) return;
    const windowId = randomUUID();
    const workingId = randomUUID();
    const bundleId = randomUUID();
    const promptId = randomUUID();
    const inboundId = randomUUID();
    const conversationId = randomUUID();
    const now = new Date('2026-09-29T00:01:00Z');
    await client`insert into survey_windows (id, tenant_id, user_id, survey_definition_id,
      period_end) values (${windowId}, ${TENANT}, ${PERSON}, ${DEFINITION},
        '2026-09-29T00:00:00Z')`;
    await client`insert into survey_question_working_insights
      (id, tenant_id, user_id, survey_window_id, status, working_summary,
        source_message_ids, updated_at) values
      (${workingId}, ${TENANT}, ${PERSON}, ${windowId}, 'pending_confirmation',
        'Private timely meaning', array[]::uuid[], now())`;
    await client`insert into messages
      (id, tenant_id, user_id, conversation_id, direction, occurred_at, received_at, sent_at) values
      (${promptId}, ${TENANT}, ${PERSON}, ${conversationId}, 'outbound',
        '2026-09-28T18:20:00Z', null, '2026-09-28T18:21:00Z'),
      (${inboundId}, ${TENANT}, ${PERSON}, ${conversationId}, 'inbound',
        '2026-09-28T18:22:00Z', '2026-09-29T00:00:01Z', null)`;
    await client`insert into survey_question_confirmation_bundles
      (id, tenant_id, user_id, survey_window_id, prompt_message_id,
        displayed_text, components, status) values
      (${bundleId}, ${TENANT}, ${PERSON}, ${windowId}, ${promptId},
        'Private timely Bundle', '{"one":"Private detail"}'::jsonb,
        'awaiting_confirmation')`;
    expect(await repository.expireTemporaryQuestionInsightsForClosedWindows({
      tenantId: TENANT, now,
    })).toBe(0);
    expect(await client`select status, working_summary from survey_question_working_insights
      where id = ${workingId}`).toMatchObject([{
        status: 'pending_confirmation', working_summary: 'Private timely meaning',
      }]);
    expect(await repository.countOverdueQuestionConfirmationReplies(now)).toBe(0);
    expect(await repository.countOverdueQuestionConfirmationReplies(
      new Date('2026-09-29T00:16:00Z'))).toBe(1);

    await client`insert into conversation_job_receipts (message_id) values (${inboundId})`;
    expect(await repository.countOverdueQuestionConfirmationReplies(
      new Date('2026-09-29T00:16:00Z'))).toBe(0);
    expect(await repository.expireTemporaryQuestionInsightsForClosedWindows({
      tenantId: TENANT, now: new Date('2026-09-29T00:02:00Z'),
    })).toBe(1);
    expect(await client`select status, working_summary from survey_question_working_insights
      where id = ${workingId}`).toMatchObject([{ status: 'no_data', working_summary: null }]);
    expect(await client`select status, displayed_text, components from survey_question_confirmation_bundles
      where id = ${bundleId}`).toMatchObject([{
        status: 'purged', displayed_text: null, components: null,
      }]);
    expect(await client`select id from messages where id in (${promptId}, ${inboundId})`).toHaveLength(2);
  });

  it.runIf(process.env['V2_CUTOFF_QUEUE_TEST'] === '1')(
    'keeps a timely Bundle after three failed conversation attempts and purges after retry', async () => {
      if (!client || !repository) return;
      const rawUrl = process.env['REDIS_URL'];
      if (!rawUrl) throw new Error('isolated_redis_url_required');
      const url = new URL(rawUrl);
      if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/15') {
        throw new Error('isolated_redis_db_15_required');
      }
      const windowId = randomUUID();
      const workingId = randomUUID();
      const bundleId = randomUUID();
      const promptId = randomUUID();
      const inboundId = randomUUID();
      const conversationId = randomUUID();
      const cutoffNow = new Date('2026-09-29T00:16:00Z');
      await client`insert into survey_windows (id, tenant_id, user_id, survey_definition_id,
        period_end) values (${windowId}, ${TENANT}, ${PERSON}, ${DEFINITION},
          '2026-09-29T00:00:00Z')`;
      await client`insert into survey_question_working_insights
        (id, tenant_id, user_id, survey_window_id, status, working_summary,
          source_message_ids, updated_at) values
        (${workingId}, ${TENANT}, ${PERSON}, ${windowId}, 'pending_confirmation',
          'Private retry meaning', array[]::uuid[], now())`;
      await client`insert into messages
        (id, tenant_id, user_id, conversation_id, direction, occurred_at, received_at, sent_at) values
        (${promptId}, ${TENANT}, ${PERSON}, ${conversationId}, 'outbound',
          '2026-09-28T18:20:00Z', null, '2026-09-28T18:21:00Z'),
        (${inboundId}, ${TENANT}, ${PERSON}, ${conversationId}, 'inbound',
          '2026-09-28T18:22:00Z', '2026-09-28T18:22:01Z', null)`;
      await client`insert into survey_question_confirmation_bundles
        (id, tenant_id, user_id, survey_window_id, prompt_message_id,
          displayed_text, components, status) values
        (${bundleId}, ${TENANT}, ${PERSON}, ${windowId}, ${promptId},
          'Private retry Bundle', '{"one":"Private detail"}'::jsonb,
          'awaiting_confirmation')`;

      const connection = {
        host: url.hostname, port: Number(url.port) || 6379, db: 15, maxRetriesPerRequest: null,
      };
      const queue = new Queue(`conversation-cutoff-smoke-${randomUUID()}`, { connection });
      const events = new QueueEvents(queue.name, { connection });
      let failOrchestration = true;
      const processor = new ConversationProcessor(
        { orchestrate: async () => {
          if (failOrchestration) throw new Error('private_model_failure');
          return { mode: 'continuation', classification: { primaryIntent: 'survey' }, risk: { severity: 'none' } };
        } } as never,
        {} as never,
        { record: async () => undefined } as never,
        {} as never,
        {
          isUserRuntimeEligible: async () => true,
          markInboundConversationJobProcessed: async () => {
            await client`insert into conversation_job_receipts (message_id)
              values (${inboundId}) on conflict do nothing`;
          },
        } as never,
        repository,
        queue,
      );
      const worker = new Worker(queue.name, (job) => processor.process(job), { connection });
      try {
        await events.waitUntilReady();
        const jobData: ConversationJob = {
          requestId: randomUUID(), eventId: randomUUID(), messageId: inboundId,
          conversationId, userId: PERSON, tenantId: TENANT,
          externalWorkspaceId: 'synthetic', externalConversationId: 'synthetic', traceId: randomUUID(),
        };
        const job = await queue.add('conversation', jobData, {
          attempts: 3, backoff: { type: 'fixed', delay: 20 },
          removeOnComplete: false, removeOnFail: false,
        });
        await expect(job.waitUntilFinished(events, 10_000)).rejects.toThrow('conversation_processing_failed');
        expect(await job.getState()).toBe('failed');
        expect((await queue.getJob(job.id!))?.attemptsMade).toBe(3);
        expect(await repository.expireTemporaryQuestionInsightsForClosedWindows({
          tenantId: TENANT, now: cutoffNow,
        })).toBe(0);
        expect(await repository.countOverdueQuestionConfirmationReplies(cutoffNow)).toBe(1);
        expect(await client`select displayed_text from survey_question_confirmation_bundles
          where id = ${bundleId}`).toMatchObject([{ displayed_text: 'Private retry Bundle' }]);

        failOrchestration = false;
        await job.retry();
        await job.waitUntilFinished(events, 10_000);
        expect(await repository.countOverdueQuestionConfirmationReplies(cutoffNow)).toBe(0);
        expect(await client`select status, displayed_text from survey_question_confirmation_bundles
          where id = ${bundleId}`).toMatchObject([{ status: 'purged', displayed_text: null }]);
      } finally {
        await worker.close();
        await events.close();
        await queue.obliterate({ force: true });
        await queue.close();
      }
    },
    20_000,
  );

  it.runIf(process.env['V2_CUTOFF_QUEUE_TEST'] === '1')(
    'retries a repeatable cutoff after worker restart and purges the closed question', async () => {
      if (!client || !repository) return;
      const rawUrl = process.env['REDIS_URL'];
      if (!rawUrl) throw new Error('isolated_redis_url_required');
      const url = new URL(rawUrl);
      if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/15') {
        throw new Error('isolated_redis_db_15_required');
      }
      await client`insert into survey_question_working_insights
        (id, tenant_id, user_id, survey_window_id, status, working_summary,
          confirmed_semantic_summary, source_message_ids, confirmed_at, updated_at)
        values ('12121212-1212-4212-8212-121212121212', ${TENANT}, ${PERSON}, ${CLOSED},
          'pending_clarification', 'Private queue meaning', null, array[]::uuid[], null, now())`;

      const connection = {
        host: url.hostname,
        port: Number(url.port) || 6379,
        db: 15,
        maxRetriesPerRequest: null,
      };
      const queue = new Queue(`survey-cutoff-smoke-${randomUUID()}`, { connection });
      const events = new QueueEvents(queue.name, { connection });
      const cutoff = new ExpireQuestionInsightsAtCutoffUseCase(repository);
      let attempts = 0;
      const processor = new QuestionCutoffProcessor(
        { execute: async (now: Date) => {
          if (++attempts === 1) throw new Error('private_failure_detail');
          return cutoff.execute(now);
        } } as never,
        { execute: async () => ({ usersScanned: 0, finalizedQuestionCount: 0, failedUserCount: 0 }) } as never,
        queue,
        { findUndispatchedTimelyQuestionReplies: async () => [],
          findQueuedTimelyQuestionRepliesWithoutReceipt: async () => [] } as never,
        {} as never,
      );
      let firstWorker: Worker | undefined;
      let restartedWorker: Worker | undefined;
      try {
        await events.waitUntilReady();
        await processor.onModuleInit();
        await processor.onModuleInit();
        const repeatable = await queue.getRepeatableJobs();
        expect(repeatable).toHaveLength(1);
        expect(repeatable[0]).toMatchObject({ name: 'cutoff', every: '300000' });

        firstWorker = new Worker(queue.name, (job) => processor.process(job), { connection });
        const firstFailure = new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('cutoff_first_failure_timeout')), 5_000);
          firstWorker!.once('failed', (_job, error) => {
            clearTimeout(timer);
            try {
              expect(error.message).toBe('v2_question_cutoff_failed');
              resolve();
            } catch (assertionError) {
              reject(assertionError);
            }
          });
        });
        const job = await queue.add('cutoff', {}, {
          jobId: 'manual-cutoff-smoke', attempts: 2,
          backoff: { type: 'fixed', delay: 1_000 },
        });
        await firstFailure;
        await firstWorker.close();
        firstWorker = undefined;
        restartedWorker = new Worker(queue.name, (queued) => processor.process(queued), { connection });
        await job.waitUntilFinished(events, 10_000);
        expect(attempts).toBe(2);
        const rows = await client`select status, working_summary, purged_at
          from survey_question_working_insights
          where id = '12121212-1212-4212-8212-121212121212'`;
        expect(rows[0]).toMatchObject({ status: 'no_data', working_summary: null });
        expect(rows[0]?.['purged_at']).not.toBeNull();
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
