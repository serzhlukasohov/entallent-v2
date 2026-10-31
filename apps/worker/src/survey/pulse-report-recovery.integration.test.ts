import { randomUUID } from 'node:crypto';
import { Queue, QueueEvents, Worker } from 'bullmq';
import { describe, expect, it } from 'vitest';
import { QuestionCutoffProcessor } from './question-cutoff.processor';

const enabled = process.env.V2_CONVERSATION_QUEUE_TEST === '1' && Boolean(process.env.REDIS_URL);
describe.runIf(enabled)('RPT05 R8 authoritative queue recovery', () => {
  async function fixture() {
    const url = new URL(process.env.REDIS_URL!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/15')
      throw Error('isolated_redis_db15_required');
    const connection = { host: url.hostname, port: Number(url.port), db: 15 };
    const queue = new Queue(`rpt05-review-${randomUUID()}`, { connection });
    const events = new QueueEvents(queue.name, { connection });
    await events.waitUntilReady();
    const row = {
      inbound_receipt_id: randomUUID(),
      tenant_id: randomUUID(),
      user_id: randomUUID(),
      conversation_id: randomUUID(),
      request_id: randomUUID(),
      event_id: randomUUID(),
      trace_id: randomUUID(),
      committed: true,
      evidence_pending: true,
      native_verdict: 'applied',
      finalization: 'pending',
      failure_code: null,
    };
    let rows: Record<string, unknown>[] = [row];
    const payload = {
      tenantId: row.tenant_id,
      userId: row.user_id,
      conversationId: row.conversation_id,
      inboundMessageId: row.inbound_receipt_id,
      traceId: row.trace_id,
    };
    const processor = new QuestionCutoffProcessor(
      {
        execute: async () => ({
          tenantsProcessed: 0,
          expiredQuestionCount: 0,
          overdueReplyCount: 0,
        }),
      } as never,
      { execute: async () => ({ finalizedQuestionCount: 0, failedUserCount: 0 }) } as never,
      {} as never,
      {
        findUndispatchedTimelyQuestionReplies: async () => [],
        findQueuedTimelyQuestionRepliesWithoutReceipt: async () => [],
      } as never,
      { add: async () => {}, getJob: async () => undefined } as never,
      { findRecoverableSurveyEvidence: async () => [] } as never,
      undefined,
      undefined,
      undefined,
      undefined,
      queue as never,
      undefined,
      undefined,
      {
        recoveryBatch: async () => rows,
        reconcileOnly: async () => {
          throw Error('unexpected_reconciliation');
        },
      } as never,
    );
    const scan = () => processor.process({ name: 'cutoff' } as never);
    return {
      row,
      payload,
      queue,
      events,
      connection,
      scan,
      settle: () => {
        rows = [];
      },
      close: async () => {
        await queue.obliterate({ force: true });
        await events.close();
        await queue.close();
      },
    };
  }
  it.each(['waiting', 'delayed'] as const)(
    'retained legacy-generation %s job survives concurrent repeated scans without another provider job',
    async (state) => {
      const f = await fixture();
      try {
        await f.queue.add('extract', f.payload, {
          jobId: `native-evidence-${f.row.inbound_receipt_id}-old-generation`,
          ...(state === 'delayed' ? { delay: 600000 } : {}),
        });
        await Promise.all([f.scan(), f.scan()]);
        await f.scan();
        const pending = await f.queue.getJobs(['active', 'waiting', 'delayed']);
        expect(pending).toHaveLength(1);
      } finally {
        await f.close();
      }
    },
  );
  it('genuinely lost safe extraction recovers once under concurrent scans, then an active provider job suppresses further recovery', async () => {
    const f = await fixture();
    let worker: Worker | undefined;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let started!: () => void;
    const entered = new Promise<void>((r) => (started = r));
    let providerCalls = 0;
    try {
      await Promise.all([f.scan(), f.scan()]);
      expect(await f.queue.getJobs(['waiting'])).toHaveLength(1);
      const completed = new Promise<void>((r) => f.events.once('completed', () => r()));
      worker = new Worker(
        f.queue.name,
        async () => {
          providerCalls++;
          started();
          await gate;
          f.settle();
        },
        { connection: f.connection },
      );
      await entered;
      await Promise.all([f.scan(), f.scan()]);
      expect(await f.queue.getJobs(['active', 'waiting', 'delayed'])).toHaveLength(1);
      release();
      await completed;
      await f.scan();
      expect(providerCalls).toBe(1);
    } finally {
      release();
      await worker?.close();
      await f.close();
    }
  });
  it('an exhausted original attempt permits one safe recovery while the new recovery remains deduplicated', async () => {
    const f = await fixture();
    let worker: Worker | undefined;
    let providerCalls = 0;
    try {
      const failed = new Promise<void>((r) => f.events.once('failed', () => r()));
      await f.queue.add('extract', f.payload, {
        jobId: `survey-evidence-${f.row.inbound_receipt_id}`,
        attempts: 1,
        removeOnFail: false,
      });
      worker = new Worker(
        f.queue.name,
        async (): Promise<void> => {
          providerCalls++;
          throw Error('synthetic_provider_failure');
        },
        { connection: f.connection },
      );
      await failed;
      await worker.close();
      worker = undefined;
      await Promise.all([f.scan(), f.scan()]);
      expect(await f.queue.getJobs(['waiting'])).toHaveLength(1);
      const completed = new Promise<void>((r) => f.events.once('completed', () => r()));
      worker = new Worker(
        f.queue.name,
        async () => {
          providerCalls++;
          f.settle();
        },
        { connection: f.connection },
      );
      await completed;
      await f.scan();
      expect(providerCalls).toBe(2);
    } finally {
      await worker?.close();
      await f.close();
    }
  });
});
