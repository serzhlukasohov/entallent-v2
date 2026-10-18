import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Job } from 'bullmq';
import { and, eq } from 'drizzle-orm';
import { channelAccounts, conversations, createDbClient, onboardingStates, people, tenants,
  tenantWorkCalendars, users, type DbClient } from '@entalent/database';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { IngestionService } from '../channel/ingestion.service';
import { CompanyCalendarService } from '../onboarding/company-calendar.service';
import { DevOnboardingController } from './dev-onboarding.controller';

const databaseUrl = process.env['DATABASE_URL'];
const localDatabase = databaseUrl && /^postgres(?:ql)?:\/\/(?:[^@]+@)?(?:127\.0\.0\.1|localhost):\d+\//.test(databaseUrl);

// BullMQ's own check (Job#validateOptions), run without a Redis connection.
const validateJobId = (jobId: string) => (Job.prototype as unknown as { validateOptions(d: unknown): void })
  .validateOptions.call({ opts: { jobId }, name: 'n' }, { data: '{}' });

describe('DevOnboardingController security', () => {
  it('requires ApiKeyGuard on all /dev/onboarding routes', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, DevOnboardingController) ?? []).toContain(ApiKeyGuard);
  });
});

describe.skipIf(!localDatabase)('DevOnboardingController on migrated local PostgreSQL', () => {
  const tenantId = randomUUID();
  let client: DbClient;
  let controller: DevOnboardingController;
  const actionQueue = { add: vi.fn().mockResolvedValue(undefined) };
  const reminderQueue = { add: vi.fn().mockResolvedValue(undefined) };

  beforeAll(async () => {
    client = createDbClient(databaseUrl!);
    await client.db.insert(tenants).values({ id: tenantId, name: 'Dev onboarding console fixture' });
    const db = { client: client.db };
    controller = new DevOnboardingController(
      new IngestionService(db as never, { get: vi.fn() } as never),
      db as never,
      new CompanyCalendarService(db as never),
      actionQueue as never,
      reminderQueue as never,
    );
  });

  afterAll(async () => {
    if (!client) return;
    await client.db.delete(tenants).where(eq(tenants.id, tenantId));
    await client.sql.end();
  });

  const stateOf = async (personId: string) => (await client.db.select().from(onboardingStates)
    .where(and(eq(onboardingStates.tenantId, tenantId), eq(onboardingStates.personId, personId))))[0];

  it('start creates the dev calendar once, provisions an active person and enqueues dev_intro', async () => {
    actionQueue.add.mockClear();
    const first = await controller.start({ tenantId, userId: 'dev-emp', userName: 'Emp', role: 'employee' });
    expect(first).toMatchObject({ userId: 'dev-emp', calendarCreated: true, personId: expect.any(String), conversationId: expect.any(String) });
    expect((await client.db.select().from(tenantWorkCalendars).where(eq(tenantWorkCalendars.tenantId, tenantId)))[0])
      .toMatchObject({ timezone: 'Europe/Kyiv', workingDays: [1, 2, 3, 4, 5], workStart: '09:00', workEnd: '18:00' });
    const [person] = await client.db.select().from(people).where(eq(people.id, first.personId));
    expect(person).toMatchObject({ tenantId, primaryRole: 'employee', pulseParticipant: true, lifecycleStatus: 'active' });
    const [user] = await client.db.select().from(users).where(eq(users.id, first.personId));
    expect(user?.status).toBe('active');
    const [conversation] = await client.db.select().from(conversations).where(eq(conversations.id, first.conversationId));
    expect(conversation).toMatchObject({ channelType: 'dev', externalConversationId: 'dev-conv-dev-emp', userId: first.personId });
    const [account] = await client.db.select().from(channelAccounts).where(eq(channelAccounts.userId, first.personId));
    expect(account).toMatchObject({ channelType: 'dev', externalWorkspaceId: 'dev-workspace', externalUserId: 'dev-emp' });
    expect(actionQueue.add).toHaveBeenCalledWith('dev_intro', { kind: 'dev_intro', tenantId, personId: first.personId });

    const again = await controller.start({ tenantId, userId: 'dev-emp', role: 'employee' });
    expect(again).toMatchObject({ calendarCreated: false, personId: first.personId, conversationId: first.conversationId });
  });

  it('start resets an existing onboarding state (dev reset) and maps a management role to no pulse', async () => {
    const { personId } = await controller.start({ tenantId, userId: 'dev-mgr', role: 'employee' });
    await client.db.insert(onboardingStates).values({ tenantId, personId, track: 'employee', participation: 'declined' });
    await controller.start({ tenantId, userId: 'dev-mgr', role: 'manager' });
    expect(await stateOf(personId)).toBeUndefined();
    const [person] = await client.db.select().from(people).where(eq(people.id, personId));
    expect(person).toMatchObject({ primaryRole: 'manager', pulseParticipant: false });
  });

  it('start rejects an unknown role and a missing userId', async () => {
    await expect(controller.start({ tenantId, userId: 'dev-x', role: 'ceo' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.start({ tenantId, role: 'employee' } as never)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('click returns 409 before the buttons were delivered, then enqueues the Slack-shaped button job', async () => {
    const { personId } = await controller.start({ tenantId, userId: 'dev-click', role: 'employee' });
    await expect(controller.click({ tenantId, userId: 'dev-click', action: 'later' })).rejects.toBeInstanceOf(ConflictException);
    await client.db.insert(onboardingStates).values({ tenantId, personId, track: 'employee', participation: 'undecided' });
    const conflict = await controller.click({ tenantId, userId: 'dev-click', action: 'later' }).catch((e: unknown) => e);
    expect(conflict).toBeInstanceOf(ConflictException);
    expect((conflict as ConflictException).getResponse()).toMatchObject({ error: 'buttons_not_delivered' });

    await client.db.update(onboardingStates).set({ introChannelId: 'dev-conv-dev-click', introActionsMessageTs: '1791453600.123000', buttonsActive: true })
      .where(eq(onboardingStates.personId, personId));
    actionQueue.add.mockClear();
    await expect(controller.click({ tenantId, userId: 'dev-click', action: 'nope' })).rejects.toBeInstanceOf(BadRequestException);
    await controller.click({ tenantId, userId: 'dev-click', action: 'later' });
    const [name, data, opts] = actionQueue.add.mock.calls[0]!;
    expect(name).toBe('action');
    expect(data).toEqual({
      kind: 'button', tenantId, personId, action: 'later', actionTs: expect.stringMatching(/^\d+\.\d{6}$/),
      messageTs: '1791453600.123000', channelId: 'dev-conv-dev-click',
    });
    expect(opts.jobId).toBe(`onb-act:dev-click:${data.actionTs}`);
    expect(() => validateJobId(opts.jobId)).not.toThrow();
  });

  it('click for an unknown dev user is 404', async () => {
    await expect(controller.click({ tenantId, userId: 'dev-ghost', action: 'later' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('remind-now returns 409 with the reminder status unless scheduled, then moves the due time to now', async () => {
    const { personId } = await controller.start({ tenantId, userId: 'dev-remind', role: 'employee' });
    await client.db.insert(onboardingStates).values({ tenantId, personId, track: 'employee', participation: 'deferred' });
    const conflict = await controller.remindNow({ tenantId, userId: 'dev-remind' }).catch((e: unknown) => e);
    expect(conflict).toBeInstanceOf(ConflictException);
    expect((conflict as ConflictException).getResponse()).toMatchObject({ error: 'reminder_not_scheduled', reminderStatus: 'none' });

    const later = new Date(Date.now() + 86_400_000);
    await client.db.update(onboardingStates).set({ reminderStatus: 'scheduled', reminderOriginAt: new Date(), reminderDueAt: later })
      .where(eq(onboardingStates.personId, personId));
    reminderQueue.add.mockClear();
    const result = await controller.remindNow({ tenantId, userId: 'dev-remind' });
    const due = (await stateOf(personId))!.reminderDueAt!;
    expect(due.getTime()).toBeLessThanOrEqual(Date.now());
    expect(result).toMatchObject({ dueAt: due.toISOString() });
    expect(reminderQueue.add).toHaveBeenCalledWith('remind', { tenantId, personId, dueAt: due.toISOString() },
      { jobId: `onb-rem:${personId}:${due.getTime()}` });
  });

  it('role updates the person and enqueues a role_changed system job with a BullMQ-valid dev id', async () => {
    const { personId } = await controller.start({ tenantId, userId: 'dev-role', role: 'employee' });
    actionQueue.add.mockClear();
    await controller.role({ tenantId, userId: 'dev-role', role: 'hrbp' });
    const [person] = await client.db.select().from(people).where(eq(people.id, personId));
    expect(person).toMatchObject({ primaryRole: 'hrbp', pulseParticipant: false });
    const [name, data, opts] = actionQueue.add.mock.calls[0]!;
    expect(name).toBe('system');
    expect(data).toEqual({ kind: 'system', tenantId, personId, event: { type: 'role_changed', from: 'employee', to: 'hrbp' } });
    expect(opts.jobId).toMatch(new RegExp(`^onb-sys:${personId}:dev-\\d+$`));
    expect(() => validateJobId(opts.jobId)).not.toThrow();
    await expect(controller.role({ tenantId, userId: 'dev-role', role: 'hrbp' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('state returns the onboarding row and proactive messaging flag', async () => {
    const { personId } = await controller.start({ tenantId, userId: 'dev-state', role: 'team_lead' });
    expect(await controller.state('dev-state', tenantId)).toMatchObject({ personId, state: null, proactiveMessagingEnabled: true });
    await client.db.insert(onboardingStates).values({ tenantId, personId, track: 'team_lead', participation: 'undecided',
      introStatus: 'delivered', buttonsActive: true });
    expect(await controller.state('dev-state', tenantId)).toMatchObject({
      personId, proactiveMessagingEnabled: true,
      state: { track: 'team_lead', introStatus: 'delivered', participation: 'undecided', reminderStatus: 'none',
        reminderDueAt: null, buttonsActive: true },
    });
  });
});
