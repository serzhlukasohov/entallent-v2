import { afterAll, beforeAll, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  getTestDb,
  runMigrationsOnce,
  closeTestDb,
  describeIntegration,
} from './integration-setup';
import {
  tenants,
  users,
  conversations,
  messages,
  runtimeActions,
  runtimeAttempts,
  runtimeShadowDiagnostics,
} from '../schema';

describeIntegration('Runtime ledger schema (integration)', () => {
  let tenantId: string;
  let userId: string;
  let conversationId: string;
  let messageId: string;
  let attemptId: string;

  beforeAll(async () => {
    await runMigrationsOnce();
    const { db } = getTestDb();

    const [tenant] = await db
      .insert(tenants)
      .values({
        name: 'Runtime Ledger Test Corp',
        status: 'active',
        timezone: 'UTC',
        locale: 'en',
        retentionPolicy: {},
        safetyPolicy: {},
        proactiveMessagingPolicy: {},
        surveyConfiguration: {},
      })
      .returning();
    tenantId = tenant!.id;

    const [user] = await db
      .insert(users)
      .values({
        tenantId,
        status: 'active',
        preferredName: 'Ledger User',
        timezone: 'UTC',
        locale: 'en',
        communicationPreferences: {},
        proactiveMessagingEnabled: true,
        quietHours: { enabled: false },
        onboardingStatus: 'completed',
        consentState: { agreed: true },
      })
      .returning();
    userId = user!.id;

    const [conversation] = await db
      .insert(conversations)
      .values({
        tenantId,
        userId,
        channelType: 'slack',
        externalConversationId: 'runtime-ledger-test-channel',
        status: 'active',
      })
      .returning();
    conversationId = conversation!.id;

    const [message] = await db
      .insert(messages)
      .values({
        tenantId,
        conversationId,
        userId,
        direction: 'inbound',
        senderType: 'user',
        text: 'Synthetic ledger integration message.',
        occurredAt: new Date('2026-08-05T13:00:00.000Z'),
        traceId: 'trace-runtime-ledger-integration',
      })
      .returning();
    messageId = message!.id;
  });

  afterAll(async () => {
    const { db } = getTestDb();
    if (tenantId) {
      await db.delete(tenants).where(eq(tenants.id, tenantId));
    }
    await closeTestDb();
  });

  it('persists one runtime attempt per durable idempotency scope', async () => {
    const { db } = getTestDb();

    const [attempt] = await db
      .insert(runtimeAttempts)
      .values({
        tenantId,
        requestId: 'request-runtime-ledger-integration',
        eventId: 'event-runtime-ledger-integration',
        messageId,
        runtimeAttempt: 1,
        traceId: 'trace-runtime-ledger-integration',
        runtimeMode: 'maf_shadow',
        phase: 'started',
      })
      .returning();
    attemptId = attempt!.id;

    expect(attempt).toMatchObject({
      tenantId,
      requestId: 'request-runtime-ledger-integration',
      eventId: 'event-runtime-ledger-integration',
      messageId,
      runtimeAttempt: 1,
      traceId: 'trace-runtime-ledger-integration',
      runtimeMode: 'maf_shadow',
      phase: 'started',
    });

    await expect(
      db.insert(runtimeAttempts).values({
        tenantId,
        requestId: 'request-runtime-ledger-integration',
        eventId: 'event-runtime-ledger-integration',
        messageId,
        runtimeAttempt: 1,
        traceId: 'trace-runtime-ledger-integration-duplicate',
        runtimeMode: 'maf_shadow',
        phase: 'started',
      }),
    ).rejects.toThrow();
  });

  it('updates required attempt phases', async () => {
    const { db } = getTestDb();

    for (const phase of [
      'candidate_received',
      'actions_validated',
      'actions_committed',
      'reply_committed',
      'failed',
    ]) {
      const [updated] = await db
        .update(runtimeAttempts)
        .set({ phase, updatedAt: new Date() })
        .where(eq(runtimeAttempts.id, attemptId))
        .returning();

      expect(updated!.phase).toBe(phase);
    }
  });

  it('persists canonical action envelope fields idempotently per attempt', async () => {
    const { db } = getTestDb();

    const [action] = await db
      .insert(runtimeActions)
      .values({
        tenantId,
        runtimeAttemptId: attemptId,
        actionId: 'action-runtime-ledger-save-memory',
        aggregateType: 'memory',
        actionType: 'save_memory',
        idempotencyKey: 'action:runtime-ledger-save-memory',
        payload: {
          memoryCandidateId: 'memory-candidate-runtime-ledger',
        },
        validationResult: { status: 'valid', reasonCodes: [] },
        executionStatus: 'not_started',
        commitMarker: null,
      })
      .returning();

    expect(action).toMatchObject({
      tenantId,
      runtimeAttemptId: attemptId,
      actionId: 'action-runtime-ledger-save-memory',
      aggregateType: 'memory',
      actionType: 'save_memory',
      idempotencyKey: 'action:runtime-ledger-save-memory',
      executionStatus: 'not_started',
      commitMarker: null,
    });

    await expect(
      db.insert(runtimeActions).values({
        tenantId,
        runtimeAttemptId: attemptId,
        actionId: 'action-runtime-ledger-save-memory-duplicate',
        aggregateType: 'memory',
        actionType: 'save_memory',
        idempotencyKey: 'action:runtime-ledger-save-memory',
        payload: {
          memoryCandidateId: 'memory-candidate-runtime-ledger-duplicate',
        },
        validationResult: { status: 'valid', reasonCodes: [] },
        executionStatus: 'not_started',
        commitMarker: null,
      }),
    ).rejects.toThrow();

    const rows = await db
      .select()
      .from(runtimeActions)
      .where(
        and(
          eq(runtimeActions.runtimeAttemptId, attemptId),
          eq(runtimeActions.idempotencyKey, 'action:runtime-ledger-save-memory'),
        ),
      );

    expect(rows).toHaveLength(1);
  });

  it('rejects invalid durable ledger enum-like values', async () => {
    const { db } = getTestDb();

    await expect(
      db.insert(runtimeAttempts).values({
        tenantId,
        requestId: 'request-runtime-ledger-invalid-phase',
        eventId: 'event-runtime-ledger-invalid-phase',
        messageId,
        runtimeAttempt: 1,
        traceId: 'trace-runtime-ledger-invalid-phase',
        runtimeMode: 'maf_shadow',
        phase: 'invalid_phase',
      }),
    ).rejects.toThrow();

    await expect(
      db.insert(runtimeActions).values({
        tenantId,
        runtimeAttemptId: attemptId,
        actionId: 'action-runtime-ledger-invalid-type',
        aggregateType: 'memory',
        actionType: 'invalid_action',
        idempotencyKey: 'action:runtime-ledger-invalid-type',
        payload: {
          memoryCandidateId: 'memory-candidate-runtime-ledger-invalid',
        },
        validationResult: { status: 'valid', reasonCodes: [] },
        executionStatus: 'not_started',
        commitMarker: null,
      }),
    ).rejects.toThrow();
  });

  it('persists one shadow diagnostics record per runtime attempt and runtime version', async () => {
    const { db } = getTestDb();

    const [diagnostics] = await db
      .insert(runtimeShadowDiagnostics)
      .values({
        tenantId,
        messageId,
        runtimeAttemptId: attemptId,
        runtimeMode: 'maf_shadow',
        traceId: 'trace-runtime-ledger-integration',
        runtimeVersion: 'ts-runtime@integration',
        validationStatus: 'valid',
        redactionStatus: 'redacted',
        currentResult: { replyDigest: 'sha256:current', riskSeverity: 'none' },
        candidateResult: { replyDigest: 'sha256:candidate', riskSeverity: 'none' },
        riskComparison: { status: 'same' },
        memoryComparison: { status: 'same' },
        actionComparison: { status: 'same' },
        validationDetails: { reasonCodes: [] },
        redactionDetails: { reasonCodes: ['raw_text_redacted'] },
        latencyMs: 125,
        modelCallCount: 2,
        toolCallCount: 1,
        retryCount: 0,
        estimatedCost: '0.000420',
      })
      .returning();

    expect(diagnostics).toMatchObject({
      tenantId,
      messageId,
      runtimeAttemptId: attemptId,
      runtimeMode: 'maf_shadow',
      traceId: 'trace-runtime-ledger-integration',
      runtimeVersion: 'ts-runtime@integration',
      validationStatus: 'valid',
      redactionStatus: 'redacted',
    });

    await expect(
      db.insert(runtimeShadowDiagnostics).values({
        tenantId,
        messageId,
        runtimeAttemptId: attemptId,
        runtimeMode: 'maf_shadow',
        traceId: 'trace-runtime-ledger-integration',
        runtimeVersion: 'ts-runtime@integration',
        validationStatus: 'valid',
        redactionStatus: 'redacted',
        currentResult: { replyDigest: 'sha256:current-duplicate' },
        candidateResult: { replyDigest: 'sha256:candidate-duplicate' },
        riskComparison: { status: 'same' },
        memoryComparison: { status: 'same' },
        actionComparison: { status: 'same' },
        validationDetails: { reasonCodes: [] },
        redactionDetails: { reasonCodes: ['raw_text_redacted'] },
        latencyMs: 125,
        modelCallCount: 2,
        toolCallCount: 1,
        retryCount: 0,
        estimatedCost: '0.000420',
      }),
    ).rejects.toThrow();
  });

  it('rejects invalid shadow diagnostics enum-like values', async () => {
    const { db } = getTestDb();

    await expect(
      db.insert(runtimeShadowDiagnostics).values({
        tenantId,
        messageId,
        runtimeAttemptId: attemptId,
        runtimeMode: 'maf_shadow',
        traceId: 'trace-runtime-ledger-invalid-diagnostics',
        runtimeVersion: 'ts-runtime@invalid-validation-status',
        validationStatus: 'unknown',
        redactionStatus: 'redacted',
        currentResult: {},
        candidateResult: {},
        riskComparison: {},
        memoryComparison: {},
        actionComparison: {},
        validationDetails: {},
        redactionDetails: {},
        latencyMs: 1,
        modelCallCount: 0,
        toolCallCount: 0,
        retryCount: 0,
        estimatedCost: '0.000000',
      }),
    ).rejects.toThrow();

    await expect(
      db.insert(runtimeShadowDiagnostics).values({
        tenantId,
        messageId,
        runtimeAttemptId: attemptId,
        runtimeMode: 'maf_shadow',
        traceId: 'trace-runtime-ledger-invalid-redaction',
        runtimeVersion: 'ts-runtime@invalid-redaction-status',
        validationStatus: 'valid',
        redactionStatus: 'leaked',
        currentResult: {},
        candidateResult: {},
        riskComparison: {},
        memoryComparison: {},
        actionComparison: {},
        validationDetails: {},
        redactionDetails: {},
        latencyMs: 1,
        modelCallCount: 0,
        toolCallCount: 0,
        retryCount: 0,
        estimatedCost: '0.000000',
      }),
    ).rejects.toThrow();
  });

  it('rejects negative shadow diagnostics metrics', async () => {
    const { db } = getTestDb();

    await expect(
      db.insert(runtimeShadowDiagnostics).values({
        tenantId,
        messageId,
        runtimeAttemptId: attemptId,
        runtimeMode: 'maf_shadow',
        traceId: 'trace-runtime-ledger-negative-metrics',
        runtimeVersion: 'ts-runtime@negative-metrics',
        validationStatus: 'valid',
        redactionStatus: 'not_required',
        currentResult: {},
        candidateResult: {},
        riskComparison: {},
        memoryComparison: {},
        actionComparison: {},
        validationDetails: {},
        redactionDetails: {},
        latencyMs: -1,
        modelCallCount: 0,
        toolCallCount: 0,
        retryCount: 0,
        estimatedCost: '0.000000',
      }),
    ).rejects.toThrow();
  });

  it('rejects shadow diagnostics whose tenant and message do not match the runtime attempt', async () => {
    const { db } = getTestDb();

    const [otherTenant] = await db
      .insert(tenants)
      .values({
        name: 'Runtime Ledger Other Corp',
        status: 'active',
        timezone: 'UTC',
        locale: 'en',
        retentionPolicy: {},
        safetyPolicy: {},
        proactiveMessagingPolicy: {},
        surveyConfiguration: {},
      })
      .returning();

    const [otherUser] = await db
      .insert(users)
      .values({
        tenantId: otherTenant!.id,
        status: 'active',
        preferredName: 'Other Ledger User',
        timezone: 'UTC',
        locale: 'en',
        communicationPreferences: {},
        proactiveMessagingEnabled: true,
        quietHours: { enabled: false },
        onboardingStatus: 'completed',
        consentState: { agreed: true },
      })
      .returning();

    const [otherConversation] = await db
      .insert(conversations)
      .values({
        tenantId: otherTenant!.id,
        userId: otherUser!.id,
        channelType: 'slack',
        externalConversationId: 'runtime-ledger-other-channel',
        status: 'active',
      })
      .returning();

    const [otherMessage] = await db
      .insert(messages)
      .values({
        tenantId: otherTenant!.id,
        conversationId: otherConversation!.id,
        userId: otherUser!.id,
        direction: 'inbound',
        senderType: 'user',
        text: 'Synthetic ledger mismatch message.',
        occurredAt: new Date('2026-08-05T13:05:00.000Z'),
        traceId: 'trace-runtime-ledger-mismatch',
      })
      .returning();

    await expect(
      db.insert(runtimeShadowDiagnostics).values({
        tenantId: otherTenant!.id,
        messageId: otherMessage!.id,
        runtimeAttemptId: attemptId,
        runtimeMode: 'maf_shadow',
        traceId: 'trace-runtime-ledger-mismatch',
        runtimeVersion: 'ts-runtime@mismatch',
        validationStatus: 'valid',
        redactionStatus: 'not_required',
        currentResult: {},
        candidateResult: {},
        riskComparison: {},
        memoryComparison: {},
        actionComparison: {},
        validationDetails: {},
        redactionDetails: {},
        latencyMs: 1,
        modelCallCount: 0,
        toolCallCount: 0,
        retryCount: 0,
        estimatedCost: '0.000000',
      }),
    ).rejects.toThrow();

    await db.delete(tenants).where(eq(tenants.id, otherTenant!.id));
  });
});
