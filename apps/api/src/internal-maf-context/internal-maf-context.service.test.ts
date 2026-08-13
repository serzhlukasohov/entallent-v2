import { describe, expect, it } from 'vitest';
import { InternalMafContextService } from './internal-maf-context.service';

const tenantId = '00000000-0000-4000-8000-000000000000';
const workspaceId = 'T01234567';
const userId = '22222222-2222-4222-8222-222222222222';
const conversationId = '33333333-3333-4333-8333-333333333333';
const now = new Date('2026-08-06T12:00:00.000Z');

describe('InternalMafContextService', () => {
  it('returns a bounded JSON-compatible context bundle without raw full message text', async () => {
    const db = makeDb([
      [
        {
          id: userId,
          preferredName: 'Ada',
          timezone: 'Europe/Warsaw',
          locale: 'en',
          proactiveMessagingEnabled: true,
          onboardingStatus: 'complete',
          consentState: { coaching: true },
          createdAt: now,
          updatedAt: now,
        },
      ],
      [{ id: conversationId }],
      [{ id: 'account-1' }],
      [
        {
          id: 'style-1',
          dimensions: { register: 0.4 },
          phrases: [{ text: 'ship it', count: 2 }],
          adaptationWeight: '0.750',
          conversationsAnalyzed: 4,
          updatedAt: now,
        },
      ],
      [
        {
          id: 'memory-1',
          category: 'preference',
          canonicalKey: 'work_style',
          content: 'Prefers concise updates',
          confidence: '0.90',
          importance: '0.80',
          sensitivity: 'normal',
          validFrom: now,
          updatedAt: now,
        },
      ],
      [
        {
          id: 'goal-1',
          title: 'Finish migration',
          description: 'Runtime migration',
          category: 'delivery',
          priority: 'high',
          targetDate: now,
          confidence: '0.88',
          nextCheckInAt: now,
          updatedAt: now,
        },
      ],
      [
        {
          id: 'risk-1',
          type: 'burnout',
          severity: 'medium',
          confidence: '0.70',
          recommendedAction: 'Check in',
          detectedAt: now,
          expiresAt: now,
        },
      ],
      [
        {
          id: 'survey-1',
          status: 'active',
          periodType: 'quarter',
          periodStart: now,
          periodEnd: now,
          coverage: { autonomy: 0.6 },
          completedAt: null,
        },
      ],
      [
        {
          id: 'message-1',
          direction: 'inbound',
          senderType: 'user',
          messageType: 'text',
          occurredAt: now,
        },
      ],
    ]);
    const service = new InternalMafContextService({ client: db } as never);

    const result = await service.readContext({
      tenantId,
      workspaceId,
      userId,
      conversationId,
      threadId: '1700000000.001',
      recentTurnLimit: 1,
      memoryLimit: 1,
      goalLimit: 1,
      riskLimit: 1,
      traceId: 'trace-1',
    });

    expect(result.userProfile).toMatchObject({
      id: userId,
      preferredName: 'Ada',
      timezone: 'Europe/Warsaw',
      styleProfile: {
        dimensions: { register: 0.4 },
        adaptationWeight: 0.75,
        updatedAt: now.toISOString(),
      },
    });
    expect(result.memoryItems).toEqual([
      expect.objectContaining({
        id: 'memory-1',
        content: 'Prefers concise updates',
      }),
    ]);
    expect(result.goals).toHaveLength(1);
    expect(result.riskSignals).toHaveLength(1);
    expect(result.surveyState).toMatchObject({ id: 'survey-1', status: 'active' });
    expect(result.recentTurns[0]).toEqual({
      id: 'message-1',
      direction: 'inbound',
      senderType: 'user',
      messageType: 'text',
      occurredAt: now.toISOString(),
    });
    expect(JSON.stringify(result)).not.toContain('x'.repeat(300));
    expect(JSON.stringify(result)).not.toContain('raw user text');
    expect(result.diagnostics).toEqual({
      traceId: 'trace-1',
      counts: {
        memoryItems: 1,
        goals: 1,
        recentTurns: 1,
        riskSignals: 1,
        surveyWindows: 1,
      },
    });
  });

  it('returns an empty context bundle when the user or workspace membership is absent', async () => {
    const missingUserService = new InternalMafContextService({
      client: makeDb([[], [{ id: conversationId }], [{ id: 'account-1' }]]),
    } as never);
    const missingWorkspaceService = new InternalMafContextService({
      client: makeDb([[{ id: userId }], [{ id: conversationId }], []]),
    } as never);

    await expect(missingUserService.readContext(makeRequest())).resolves.toEqual(emptyResponse());
    await expect(missingWorkspaceService.readContext(makeRequest())).resolves.toEqual(emptyResponse());
  });

  it('does not expose sensitive memory content', async () => {
    const service = new InternalMafContextService({
      client: makeDb([
        [{ id: userId }],
        [{ id: conversationId }],
        [{ id: 'account-1' }],
        [],
        [
          {
            id: 'memory-secret',
            category: 'preference',
            canonicalKey: 'token',
            content: 'Bearer secret-token',
            confidence: '0.90',
            importance: '0.80',
            sensitivity: 'sensitive',
            validFrom: now,
            updatedAt: now,
          },
        ],
        [],
        [],
        [],
        [],
      ]),
    } as never);

    const result = await service.readContext(makeRequest());

    expect(result.memoryItems[0]).toMatchObject({ id: 'memory-secret', content: null });
    expect(JSON.stringify(result)).not.toContain('Bearer secret-token');
  });

  it('does not expose production regression control markers as memory content', async () => {
    const service = new InternalMafContextService({
      client: makeDb([
        [{ id: userId }],
        [{ id: conversationId }],
        [{ id: 'account-1' }],
        [],
        [
          {
            id: 'memory-marker',
            category: 'project_context',
            canonicalKey: 'main_memory_marker_20260812_0800',
            content: 'Continue with main-memory-marker-20260812-0800.',
            confidence: '0.90',
            importance: '0.80',
            sensitivity: 'normal',
            validFrom: now,
            updatedAt: now,
          },
        ],
        [],
        [],
        [],
        [],
      ]),
    } as never);

    const result = await service.readContext(makeRequest());

    expect(result.memoryItems[0]).toMatchObject({ id: 'memory-marker', content: null });
    expect(JSON.stringify(result)).not.toContain('main-memory-marker-20260812-0800');
  });

  it('applies an explicit thread filter for thread-specific reads', async () => {
    const whereCalls = [] as Array<Record<string, unknown> | undefined>;
    const service = new InternalMafContextService({
      client: makeDbTrackingWhere(
        [
          [{ id: userId }],
          [{ id: conversationId }],
          [{ id: 'account-1' }],
          [],
          [],
          [],
          [],
          [],
          [],
        ],
        whereCalls,
      ),
    } as never);

    await service.readContext({
      ...makeRequest(),
      threadId: '1700000000.001',
      recentTurnLimit: 2,
    });

    const threadWhere = whereCalls.find(isMessagesWhereClause)!;
    expect(threadWhere).toBeDefined();
    expect(hasParamValue(threadWhere, '1700000000.001')).toBe(true);
  });

  it('defaults messages to unthreaded history when threadId is omitted', async () => {
    const whereCalls = [] as Array<Record<string, unknown> | undefined>;
    const service = new InternalMafContextService({
      client: makeDbTrackingWhere(
        [
          [{ id: userId }],
          [{ id: conversationId }],
          [{ id: 'account-1' }],
          [],
          [],
          [],
          [],
          [],
          [],
        ],
        whereCalls,
      ),
    } as never);

    await service.readContext({
      ...makeRequest(),
      threadId: undefined,
      recentTurnLimit: 2,
    });

    const threadWhere = whereCalls.find(isMessagesWhereClause)!;
    expect(threadWhere).toBeDefined();
    expect(hasParamValue(threadWhere, '1700000000.001')).toBe(false);
    expect(hasThreadColumn(threadWhere)).toBe(true);
  });
});

function makeRequest() {
  return {
    tenantId,
    workspaceId,
      userId,
      conversationId,
      recentTurnLimit: 1,
      memoryLimit: 1,
      goalLimit: 1,
      riskLimit: 1,
    };
}

function emptyResponse() {
  return {
    userProfile: null,
    memoryItems: [],
    goals: [],
    recentTurns: [],
    surveyState: null,
    riskSignals: [],
    diagnostics: {
      counts: {
        memoryItems: 0,
        goals: 0,
        recentTurns: 0,
        riskSignals: 0,
        surveyWindows: 0,
      },
    },
  };
}

function makeDb(rowsByQuery: unknown[][]) {
  let queryIndex = 0;
  const db = {
    select: () => {
      const rows = rowsByQuery[queryIndex++] ?? [];
      const chain = {
        from: () => chain,
        where: () => chain,
        orderBy: () => chain,
        limit: () => Promise.resolve(rows),
      };
      return chain;
    },
  };
  return db;
}

function makeDbTrackingWhere(rowsByQuery: unknown[][], whereCalls: Array<Record<string, unknown> | undefined>) {
  let queryIndex = 0;
  const db = {
    select: () => {
      const rows = rowsByQuery[queryIndex] ?? [];
      const chain = {
        from: () => chain,
        where: (clause: Record<string, unknown>) => {
          whereCalls[queryIndex] = clause;
          return chain;
        },
        orderBy: () => chain,
        limit: () => {
          queryIndex += 1;
          return Promise.resolve(rows);
        },
      };
      return chain;
    },
  };
  return db;
}

function hasThreadColumn(whereClause: Record<string, unknown> | undefined): boolean {
  if (!whereClause || !Array.isArray(whereClause['queryChunks'])) {
    return false;
  }

  return hasExternalThreadChunk(whereClause['queryChunks'] as unknown[]);
}

function hasParamValue(whereClause: Record<string, unknown> | undefined, expected: string): boolean {
  if (!whereClause || !Array.isArray(whereClause['queryChunks'])) {
    return false;
  }

  return hasParamValueInChunks(whereClause['queryChunks'] as unknown[], expected);
}

function hasExternalThreadChunk(chunks: unknown[]): boolean {
  return chunks.some((chunk) => isExternalThreadChunk(chunk) || hasNestedExternalThreadChunk(chunk));
}

function hasParamValueInChunks(chunks: unknown[], expected: string): boolean {
  return chunks.some((chunk) => isMatchingParamChunk(chunk, expected) || hasNestedMatchingParamChunk(chunk, expected));
}

function hasNestedExternalThreadChunk(chunk: unknown): boolean {
  if (!chunk || typeof chunk !== 'object') {
    return false;
  }

  const nested = (chunk as { queryChunks?: unknown[] }).queryChunks;
  if (Array.isArray(nested)) {
    return hasExternalThreadChunk(nested);
  }

  return false;
}

function hasNestedMatchingParamChunk(chunk: unknown, expected: string): boolean {
  if (!chunk || typeof chunk !== 'object') {
    return false;
  }

  const nested = (chunk as { queryChunks?: unknown[] }).queryChunks;
  if (Array.isArray(nested)) {
    return hasParamValueInChunks(nested, expected);
  }

  return false;
}

function isExternalThreadChunk(chunk: unknown): boolean {
  return (
    !!chunk &&
    typeof chunk === 'object' &&
    (chunk as { name?: string }).name === 'external_thread_id'
  );
}

function isMatchingParamChunk(chunk: unknown, expected: string): boolean {
  return (
    !!chunk &&
    typeof chunk === 'object' &&
    (chunk as { constructor?: { name?: string }; value?: unknown }).constructor?.name === 'Param' &&
    (chunk as { value?: unknown }).value === expected
  );
}

function isMessagesWhereClause(whereClause: Record<string, unknown> | undefined): boolean {
  return hasThreadColumn(whereClause);
}
