import 'reflect-metadata';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { DEV_JOB_SCAN_LIMIT, DevSimulateController } from './dev-simulate.controller';

const validTenantId = '00000000-0000-4000-8000-000000000000';

describe('DevSimulateController security', () => {
  it('requires ApiKeyGuard on all /dev routes', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, DevSimulateController) ?? [];

    expect(guards).toContain(ApiKeyGuard);
  });

  it('rejects force-checkin without tenantId before touching storage or queues', async () => {
    const { controller, dbTouched, queueAdd } = makeController();

    await expect(controller.forceCheckIn({} as never)).rejects.toBeInstanceOf(BadRequestException);

    expect(dbTouched).not.toHaveBeenCalled();
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('rejects force-checkin with blank tenantId before touching storage or queues', async () => {
    const { controller, dbTouched, queueAdd } = makeController();

    await expect(controller.forceCheckIn({ tenantId: '   ' })).rejects.toBeInstanceOf(BadRequestException);

    expect(dbTouched).not.toHaveBeenCalled();
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('rejects force-checkin with an absent body before touching storage or queues', async () => {
    const { controller, dbTouched, queueAdd } = makeController();

    await expect(controller.forceCheckIn(undefined)).rejects.toBeInstanceOf(BadRequestException);

    expect(dbTouched).not.toHaveBeenCalled();
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('rejects force-checkin with non-string tenantId before touching storage or queues', async () => {
    const { controller, dbTouched, queueAdd } = makeController();

    await expect(controller.forceCheckIn({ tenantId: 123 } as never)).rejects.toBeInstanceOf(BadRequestException);

    expect(dbTouched).not.toHaveBeenCalled();
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('rejects force-checkin with non-UUID tenantId before touching storage or queues', async () => {
    const { controller, dbTouched, queueAdd } = makeController();

    await expect(controller.forceCheckIn({ tenantId: 'not-a-uuid' })).rejects.toBeInstanceOf(BadRequestException);

    expect(dbTouched).not.toHaveBeenCalled();
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('rejects force-checkin with malformed userIds before touching storage or queues', async () => {
    const { controller, dbTouched, queueAdd } = makeController();

    await expect(controller.forceCheckIn({ tenantId: validTenantId, userIds: 'u-1' } as never)).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.forceCheckIn({ tenantId: validTenantId, userIds: ['u-1', 42] } as never)).rejects.toBeInstanceOf(BadRequestException);

    expect(dbTouched).not.toHaveBeenCalled();
    expect(queueAdd).not.toHaveBeenCalled();
  });
});

describe('DevSimulateController reset-user', () => {
  const resetResult = {
    conversations: 1, messages: 2, memoryItems: 3, userGoals: 4, scheduledActions: 5, riskSignals: 6, surveyWindows: 7,
    surveyAssessments: 8, surveyEvidence: 9, surveyGroupStates: 10, pulseBacklog: 11, userStyleProfiles: 12, llmRuns: 13,
  };

  function makeResetController(restartResult: { stateDeleted: boolean; deliveryRequeued: boolean; unitId: string | null }) {
    const resetUser = vi.fn().mockResolvedValue(resetResult);
    const restart = vi.fn().mockResolvedValue(restartResult);
    const scanAdd = vi.fn().mockResolvedValue(undefined);
    const controller = new DevSimulateController(
      {} as never,
      {} as never,
      {} as never,
      { add: scanAdd } as never,
      {} as never,
      { resetUser } as never,
      { restart } as never,
    );
    return { controller, resetUser, restart, scanAdd };
  }

  it('restarts onboarding after the user reset and queues the intro dispatch for the delivery unit', async () => {
    const { controller, resetUser, restart, scanAdd } = makeResetController({ stateDeleted: true, deliveryRequeued: true, unitId: 'unit-1' });

    const result = await controller.resetUser({ userId: 'person-1', tenantId: validTenantId, deep: false });

    expect(resetUser).toHaveBeenCalledWith({ tenantId: validTenantId, userId: 'person-1', deleteConversationHistory: false });
    expect(restart).toHaveBeenCalledWith({ tenantId: validTenantId, personId: 'person-1' });
    expect(scanAdd).toHaveBeenCalledWith(
      'onboarding-only',
      { tenantId: validTenantId, unitId: 'unit-1' },
      expect.objectContaining({ attempts: 1, jobId: expect.stringContaining('person-1') }),
    );
    expect(result).toEqual({ ...resetResult, onboarding: { stateDeleted: true, deliveryRequeued: true, introQueued: true } });
  });

  it('queues no dispatch when the person has no onboarding delivery to requeue', async () => {
    const { controller, restart, scanAdd } = makeResetController({ stateDeleted: true, deliveryRequeued: false, unitId: null });

    const result = await controller.resetUser({ userId: 'person-2', tenantId: validTenantId, deep: true });

    expect(restart).toHaveBeenCalledOnce();
    expect(scanAdd).not.toHaveBeenCalled();
    expect(result.onboarding).toEqual({ stateDeleted: true, deliveryRequeued: false, introQueued: false });
  });
});

function makeController() {
  const dbTouched = vi.fn(() => {
    throw new Error('db should not be touched');
  });
  const queueAdd = vi.fn();
  const db = {
    client: {
      get select() {
        dbTouched();
        return undefined;
      },
    },
  };

  const controller = new DevSimulateController(
    {} as never,
    db as never,
    { add: queueAdd } as never,
    {} as never,
    {} as never,
    { resetUser: vi.fn() } as never,
    { restart: vi.fn() } as never,
  );

  return { controller, dbTouched, queueAdd };
}

// ---------------------------------------------------------------------------
// Read endpoints (Story 14.1)
// ---------------------------------------------------------------------------

const conversationId = '11111111-1111-4111-8111-111111111111';
const otherConversationId = '22222222-2222-4222-8222-222222222222';
const userId = '33333333-3333-4333-8333-333333333333';
const windowId = '44444444-4444-4444-8444-444444444444';

type FakeJob = { id: string; data: Record<string, unknown> };
type JobsByState = Partial<Record<string, FakeJob[]>>;

/** A queue exposing only getJobs; any other property access fails the test. */
function makeFakeQueue(jobsByState: JobsByState = {}) {
  const getJobs = vi.fn(async (types: string[], _start: number, _end: number, _asc: boolean) =>
    types.flatMap((type) => jobsByState[type] ?? []));
  const queue = new Proxy({ getJobs }, {
    get(target, prop) {
      if (prop === 'getJobs') return target.getJobs;
      if (prop === 'then') return undefined;
      throw new Error(`queue.${String(prop)} must not be used by read endpoints`);
    },
  });
  return { queue, getJobs };
}

/** Chainable Drizzle stand-in: each select() resolves to the next queued result and records its where clause. */
function makeFakeDb(results: unknown[][]) {
  const queued = [...results];
  const wheres: Array<SQL | undefined> = [];
  const select = vi.fn(() => {
    const result = queued.shift();
    if (result === undefined) throw new Error('unexpected select');
    const index = wheres.push(undefined) - 1;
    const builder: Record<string, unknown> = {};
    for (const method of ['from', 'innerJoin', 'leftJoin', 'orderBy', 'limit']) {
      builder[method] = () => builder;
    }
    builder['where'] = (condition: SQL | undefined) => {
      wheres[index] = condition;
      return builder;
    };
    builder['then'] = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject);
    return builder;
  });
  return { db: { client: { select } }, select, wheres };
}

function makeReadController(db: unknown, queue: unknown) {
  return new DevSimulateController(
    {} as never, db as never, queue as never, {} as never, {} as never, {} as never, {} as never,
  );
}

function whereParams(condition: SQL | undefined): unknown[] {
  if (!condition) return [];
  return new PgDialect().sqlToQuery(condition).params;
}

function messageRow(id: string, direction: 'inbound' | 'outbound', minute: number) {
  return {
    id, direction, text: `${direction} ${id}`, occurredAt: new Date(Date.UTC(2026, 9, 25, 10, minute)),
    traceId: `trace-${id}`, messageType: 'text', sentAt: direction === 'outbound' ? new Date() : null,
    metadata: { source: id },
  };
}

let nextJobId = 0;
function conversationJob(messageId: string, conversation = conversationId, id = `job-${++nextJobId}`): FakeJob {
  return { id, data: { messageId, conversationId: conversation, requestId: 'r', eventId: 'e', userId, tenantId: validTenantId } };
}

describe('DevSimulateController messages jobStatus', () => {
  it('reports processing for an inbound with an active job, null for outbound, and keeps metadata', async () => {
    const { db } = makeFakeDb([[messageRow('in-1', 'inbound', 0), messageRow('out-1', 'outbound', 1)]]);
    const { queue, getJobs } = makeFakeQueue({ active: [conversationJob('in-1')] });

    const rows = await makeReadController(db, queue).getMessages(conversationId);

    expect(rows.map((row) => [row.id, row.jobStatus])).toEqual([['in-1', 'processing'], ['out-1', null]]);
    expect(rows[0]!.metadata).toEqual({ source: 'in-1' });
    expect(rows[1]!.metadata).toEqual({ source: 'out-1' });
    expect(getJobs).toHaveBeenCalledTimes(4);
    expect(getJobs).toHaveBeenCalledWith(['active'], 0, DEV_JOB_SCAN_LIMIT - 1, false);
  });

  it('maps waiting, delayed, completed and failed jobs and scans each state group with the bound', async () => {
    const { db } = makeFakeDb([[
      messageRow('in-wait', 'inbound', 0), messageRow('in-delay', 'inbound', 1),
      messageRow('in-done', 'inbound', 2), messageRow('in-fail', 'inbound', 3),
    ]]);
    const { queue, getJobs } = makeFakeQueue({
      waiting: [conversationJob('in-wait')], delayed: [conversationJob('in-delay')],
      completed: [conversationJob('in-done')], failed: [conversationJob('in-fail')],
    });

    const rows = await makeReadController(db, queue).getMessages(conversationId);

    expect(Object.fromEntries(rows.map((row) => [row.id, row.jobStatus]))).toEqual({
      'in-wait': 'queued', 'in-delay': 'queued', 'in-done': 'completed', 'in-fail': 'failed',
    });
    expect(getJobs.mock.calls).toEqual([
      [['waiting', 'delayed', 'prioritized', 'paused', 'waiting-children'], 0, DEV_JOB_SCAN_LIMIT - 1, false],
      [['active'], 0, DEV_JOB_SCAN_LIMIT - 1, false],
      [['failed'], 0, DEV_JOB_SCAN_LIMIT - 1, false],
      [['completed'], 0, DEV_JOB_SCAN_LIMIT - 1, false],
    ]);
  });

  it('prefers processing over queued over failed over completed when one message matches several jobs', async () => {
    const { db } = makeFakeDb([[messageRow('in-a', 'inbound', 0), messageRow('in-b', 'inbound', 1)]]);
    const { queue } = makeFakeQueue({
      completed: [conversationJob('in-a'), conversationJob('in-b')],
      failed: [conversationJob('in-a'), conversationJob('in-b')],
      waiting: [conversationJob('in-a')],
      active: [conversationJob('in-b')],
    });

    const rows = await makeReadController(db, queue).getMessages(conversationId);

    expect(rows.map((row) => row.jobStatus)).toEqual(['queued', 'processing']);
  });

  it.each([
    ['waiting -> active', 'active', 'processing'],
    ['waiting -> completed', 'completed', 'completed'],
  ])('keeps the latest state of a job that moves %s between scans', async (_label, nextState, expected) => {
    const { db } = makeFakeDb([[messageRow('in-1', 'inbound', 0)]]);
    const job = conversationJob('in-1', conversationId, 'moving-job');
    let state = 'waiting';
    const getJobs = vi.fn(async (types: string[]) => {
      const seen = types.includes(state) ? [job] : [];
      state = nextState; // the job moves right after the first (queued) scan
      return seen;
    });

    const rows = await makeReadController(db, { getJobs }).getMessages(conversationId);

    expect(rows[0]!.jobStatus).toBe(expected);
  });

  it('returns null when no job matches, including jobs of another conversation and check-in jobs', async () => {
    const { db } = makeFakeDb([[messageRow('in-1', 'inbound', 0)]]);
    const { queue, getJobs } = makeFakeQueue({
      active: [conversationJob('in-1', otherConversationId), { id: 'check-in-1', data: { conversationId, userId, tenantId: validTenantId } }],
    });

    const rows = await makeReadController(db, queue).getMessages(conversationId);

    expect(rows[0]!.jobStatus).toBeNull();
    expect(getJobs).toHaveBeenCalledTimes(4);
  });

  it('returns only rows after a known after id, with jobStatus', async () => {
    const { db } = makeFakeDb([[
      messageRow('in-1', 'inbound', 0), messageRow('out-1', 'outbound', 1), messageRow('in-2', 'inbound', 2),
    ]]);
    const { queue } = makeFakeQueue({ completed: [conversationJob('in-2')] });

    const rows = await makeReadController(db, queue).getMessages(conversationId, 'in-1');

    expect(rows.map((row) => [row.id, row.jobStatus])).toEqual([['out-1', null], ['in-2', 'completed']]);
  });

  it('rejects an unknown after id with 400 before any queue call', async () => {
    const { db } = makeFakeDb([[messageRow('in-1', 'inbound', 0)]]);
    const { queue, getJobs } = makeFakeQueue();

    const request = makeReadController(db, queue).getMessages(conversationId, 'not-in-conversation');

    await expect(request).rejects.toBeInstanceOf(BadRequestException);
    await expect(request).rejects.toThrow('after message not found in conversation');
    expect(getJobs).not.toHaveBeenCalled();
  });

  it('returns the full history for an empty or absent after', async () => {
    const rowsFor = async (after: string | undefined) => {
      const { db } = makeFakeDb([[messageRow('out-1', 'outbound', 0), messageRow('out-2', 'outbound', 1)]]);
      return makeReadController(db, makeFakeQueue().queue).getMessages(conversationId, after);
    };

    expect((await rowsFor(undefined)).map((row) => row.id)).toEqual(['out-1', 'out-2']);
    expect((await rowsFor('')).map((row) => row.id)).toEqual(['out-1', 'out-2']);
  });

  it('makes no queue call when the returned rows hold no inbound message', async () => {
    const { db } = makeFakeDb([[messageRow('in-1', 'inbound', 0), messageRow('out-1', 'outbound', 1)]]);
    const { queue, getJobs } = makeFakeQueue();

    const rows = await makeReadController(db, queue).getMessages(conversationId, 'in-1');

    expect(rows).toEqual([expect.objectContaining({ id: 'out-1', jobStatus: null })]);
    expect(getJobs).not.toHaveBeenCalled();
  });

  it('propagates a queue read error', async () => {
    const { db } = makeFakeDb([[messageRow('in-1', 'inbound', 0)]]);
    const getJobs = vi.fn().mockRejectedValue(new Error('redis down'));

    await expect(makeReadController(db, { getJobs }).getMessages(conversationId)).rejects.toThrow('redis down');
  });
});

describe('DevSimulateController question-confirmation', () => {
  const growthQuestions = [
    { id: 'q-g1', stableKey: 'growth_1', questionGroup: 'growth', displayOrder: 1 },
    { id: 'q-g2', stableKey: 'growth_2', questionGroup: 'growth', displayOrder: 2 },
    { id: 'q-g3', stableKey: 'growth_3', questionGroup: 'growth', displayOrder: 3 },
  ];
  const autonomyQuestion = { id: 'q-a1', stableKey: 'autonomy_1', questionGroup: 'autonomy', displayOrder: 0 };

  it('returns the empty state when the user has no active window', async () => {
    const { db, select } = makeFakeDb([[]]);

    const state = await makeReadController(db, makeFakeQueue().queue).getQuestionConfirmation(userId, validTenantId);

    expect(state).toEqual({
      surveyWindowId: null, group: null, questions: [], progress: { answered: 0, total: 0 },
      appliedVerdicts: [], stagedBundleCount: 0, pendingClarification: null,
    });
    expect(select).toHaveBeenCalledTimes(1);
  });

  it('reports group progress, staged bundles, applied verdicts and the pending clarification', async () => {
    const appliedAt = new Date('2026-10-25T10:00:00Z');
    const { db, select, wheres } = makeFakeDb([
      [{ id: windowId, surveyDefinitionId: 'def-1' }],
      [autonomyQuestion, ...growthQuestions],
      [
        { surveyQuestionId: 'q-g1', status: 'confirmed', clarificationAttempts: 0, purgedAt: null, promptSentAt: null },
        { surveyQuestionId: 'q-g2', status: 'pending_clarification', clarificationAttempts: 1, purgedAt: null, promptSentAt: new Date() },
        { surveyQuestionId: 'q-a1', status: 'confirmed', clarificationAttempts: 0, purgedAt: null, promptSentAt: null },
      ],
      [{ inboundMessageId: 'in-1', questionGroup: 'growth', verdictKind: 'partial', appliedAt }],
      [{ id: 'bundle-1' }],
    ]);

    const state = await makeReadController(db, makeFakeQueue().queue)
      .getQuestionConfirmation(userId, validTenantId, 'growth');

    expect(state).toEqual({
      surveyWindowId: windowId,
      group: 'growth',
      questions: [
        { surveyQuestionId: 'q-g1', stableKey: 'growth_1', questionGroup: 'growth', status: 'confirmed' },
        { surveyQuestionId: 'q-g2', stableKey: 'growth_2', questionGroup: 'growth', status: 'pending_clarification' },
        { surveyQuestionId: 'q-g3', stableKey: 'growth_3', questionGroup: 'growth', status: 'no_data' },
      ],
      progress: { answered: 1, total: 3 },
      appliedVerdicts: [{ inboundMessageId: 'in-1', questionGroup: 'growth', verdictKind: 'partial', appliedAt }],
      stagedBundleCount: 1,
      pendingClarification: { surveyQuestionId: 'q-g2', questionGroup: 'growth', clarificationAttempts: 1, promptSent: true },
    });
    expect(JSON.stringify(state)).not.toMatch(/workingSummary|statement|displayedText/);
    expect(select).toHaveBeenCalledTimes(5);
    for (const where of wheres) {
      const params = whereParams(where);
      expect(params).toContain(validTenantId);
      expect(params).toContain(userId);
    }
    expect(whereParams(wheres[3])).toContain('growth');
    expect(whereParams(wheres[0])).toContain('active');
    expect(whereParams(wheres[1])).toContain('open_ended');
    for (const where of wheres.slice(1)) expect(whereParams(where)).toContain(windowId);
  });

  it.each([
    ['reports promptSent false when the prompt has not been sent', null, { surveyQuestionId: 'q-g1', questionGroup: 'growth', clarificationAttempts: 2, promptSent: false }],
    ['excludes a purged pending clarification', new Date(), null],
  ])('%s', async (_label, purgedAt, expected) => {
    const { db } = makeFakeDb([
      [{ id: windowId, surveyDefinitionId: 'def-1' }],
      growthQuestions,
      [{ surveyQuestionId: 'q-g1', status: 'pending_clarification', clarificationAttempts: 2, purgedAt, promptSentAt: null }],
      [],
      [],
    ]);

    const state = await makeReadController(db, makeFakeQueue().queue).getQuestionConfirmation(userId, validTenantId);

    expect(state.pendingClarification).toEqual(expected);
  });

  it('reports the whole window when group is absent', async () => {
    const { db } = makeFakeDb([
      [{ id: windowId, surveyDefinitionId: 'def-1' }],
      [autonomyQuestion, ...growthQuestions],
      [{ surveyQuestionId: 'q-a1', status: 'confirmed', clarificationAttempts: 0, purgedAt: null, promptSentAt: null }],
      [],
      [],
    ]);

    const state = await makeReadController(db, makeFakeQueue().queue).getQuestionConfirmation(userId, validTenantId);

    expect(state.group).toBeNull();
    expect(state.progress).toEqual({ answered: 1, total: 4 });
    expect(state.pendingClarification).toBeNull();
  });

  it.each([
    ['missing tenantId', userId, undefined, undefined],
    ['non-UUID tenantId', userId, 'tenant-1', undefined],
    ['non-UUID userId', 'user-1', validTenantId, undefined],
    ['unknown group', userId, validTenantId, 'bogus'],
  ])('rejects %s with 400 before touching storage', async (_label, user, tenant, group) => {
    const { controller, dbTouched } = makeController();

    await expect(controller.getQuestionConfirmation(user, tenant, group)).rejects.toBeInstanceOf(BadRequestException);
    expect(dbTouched).not.toHaveBeenCalled();
  });

  it('returns 409 when the user has two active windows', async () => {
    const { db } = makeFakeDb([[
      { id: windowId, surveyDefinitionId: 'def-1' }, { id: 'window-2', surveyDefinitionId: 'def-1' },
    ]]);

    await expect(makeReadController(db, makeFakeQueue().queue).getQuestionConfirmation(userId, validTenantId))
      .rejects.toBeInstanceOf(ConflictException);
  });
});

describe('DevSimulateController survey-state', () => {
  it('returns the evidence count with the rows', async () => {
    const rows = [{ id: 'ev-1' }, { id: 'ev-2' }];
    const { db } = makeFakeDb([rows]);

    const state = await makeReadController(db, makeFakeQueue().queue).getSurveyState(userId);

    expect(state).toEqual({ count: 2, evidence: rows });
  });
});
