import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { initialOnboardingState, reminderCopy } from '@entalent/application';
import {
  channelAccounts, conversations, createDbClient, messages, onboardingStates, people, tenants,
  tenantWorkCalendars, users, type DbClient,
} from '@entalent/database';
import { OnboardingEffectsService } from './onboarding-effects.service';
import { OnboardingReminderProcessor } from './onboarding-reminder.processor';
import { OnboardingReminderRepository } from './onboarding-reminder.repository';
import { OnboardingReminderSweepService } from './onboarding-reminder-sweep.service';
import { OnboardingStateRepository } from './onboarding-state.repository';
import { OnboardingService } from './onboarding.service';

const databaseUrl = process.env['DATABASE_URL'];
const localDatabase = databaseUrl && /^postgres(?:ql)?:\/\/(?:[^@]+@)?(?:127\.0\.0\.1|localhost):\d+\//.test(databaseUrl);

describe.skipIf(!localDatabase)('onboarding reminder against PostgreSQL', () => {
  const tenantId = randomUUID();
  const personId = randomUUID();
  const conversationId = randomUUID();
  const due = new Date(Date.now() - 20 * 60_000); // overdue for the sweep
  let client: DbClient;
  let processor: OnboardingReminderProcessor;
  let sweep: OnboardingReminderSweepService;
  const reminderQueue = { add: vi.fn().mockResolvedValue(undefined) };
  const messageSendQueue = { add: vi.fn().mockResolvedValue(undefined) };

  beforeAll(async () => {
    client = createDbClient(databaseUrl!);
    const db = client.db;
    await db.insert(tenants).values({ id: tenantId, name: 'Reminder fixture' });
    await db.insert(users).values({ id: personId, tenantId, status: 'active', proactiveMessagingEnabled: false });
    await db.insert(people).values({ id: personId, tenantId, customerEmployeeId: 'R-1', workEmail: 'r1@fixture.test',
      displayName: 'R', primaryRole: 'employee', pulseParticipant: true, lifecycleStatus: 'active' });
    // Working every day around the clock so the test is independent of wall time.
    await db.insert(tenantWorkCalendars).values({ tenantId, timezone: 'UTC', workingDays: [1, 2, 3, 4, 5, 6, 7],
      workStart: '00:00', workEnd: '23:59', updatedBy: 'test' });
    await db.insert(channelAccounts).values({ tenantId, userId: personId, channelType: 'slack',
      externalWorkspaceId: 'W1', externalUserId: 'U1', linkStatus: 'linked' } as never);
    await db.insert(conversations).values({ id: conversationId, tenantId, userId: personId, channelType: 'slack',
      externalConversationId: 'D1', status: 'active' } as never);
    const s = initialOnboardingState('employee');
    await db.insert(onboardingStates).values({ tenantId, personId, track: s.track, introStatus: 'delivered',
      participation: 'deferred', reminderStatus: 'scheduled', reminderOriginAt: new Date(due.getTime() - 3 * 86_400_000),
      reminderDueAt: due, introActionsMessageTs: '1.2' });
    const dbService = { client: db } as never;
    const effects = new OnboardingEffectsService(reminderQueue as never, {} as never, dbService, messageSendQueue as never, {} as never);
    const onboarding = new OnboardingService(new OnboardingStateRepository(dbService), effects);
    processor = new OnboardingReminderProcessor(new OnboardingReminderRepository(dbService), onboarding, effects, reminderQueue as never);
    sweep = new OnboardingReminderSweepService(reminderQueue as never, dbService);
  });

  afterAll(async () => {
    if (client) {
      await client.db.delete(tenants).where(eq(tenants.id, tenantId));
      await client.sql.end();
    }
  });

  const job = () => ({ name: 'remind', data: { tenantId, personId, dueAt: due.toISOString() } }) as never;

  it('sweep finds the overdue scheduled row and enqueues the canonical job', async () => {
    await sweep.sweep(tenantId);
    expect(reminderQueue.add).toHaveBeenCalledWith('remind', expect.objectContaining({ personId, dueAt: due.toISOString() }),
      expect.objectContaining({ jobId: `onb-rem:${personId}:${due.getTime()}` }));
  });

  it('sends once: persists a button-less reminder, marks sent, enqueues message-send; a replay is a no-op', async () => {
    await processor.process(job());
    const rows = await client.db.select().from(messages).where(and(eq(messages.userId, personId), eq(messages.messageType, 'onboarding_reminder')));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ text: reminderCopy('employee'), direction: 'outbound', conversationId });
    expect(rows[0]!.metadata).toEqual({});
    const [state] = await client.db.select().from(onboardingStates).where(eq(onboardingStates.personId, personId));
    expect(state!.reminderStatus).toBe('sent');
    expect(state!.reminderSentAt).not.toBeNull();
    expect(messageSendQueue.add).toHaveBeenCalledTimes(1);

    await processor.process(job());
    expect(messageSendQueue.add).toHaveBeenCalledTimes(1);
    const again = await client.db.select().from(messages).where(eq(messages.messageType, 'onboarding_reminder'));
    expect(again.filter((m) => m.userId === personId)).toHaveLength(1);
  });
});
