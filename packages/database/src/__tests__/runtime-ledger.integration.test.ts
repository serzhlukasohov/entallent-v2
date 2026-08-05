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
});
