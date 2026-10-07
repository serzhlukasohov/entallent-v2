import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { initialOnboardingState } from '@entalent/application';
import { auditLogs, createDbClient, onboardingStates, people, tenants, tenantWorkCalendars, users, type DbClient } from '@entalent/database';
import { OnboardingStateRepository } from './onboarding-state.repository';
import { OnboardingService } from './onboarding.service';

const databaseUrl = process.env['DATABASE_URL'];
const localDatabase = databaseUrl && /^postgres(?:ql)?:\/\/(?:[^@]+@)?(?:127\.0\.0\.1|localhost):\d+\//.test(databaseUrl);

describe.skipIf(!localDatabase)('OnboardingService against PostgreSQL', () => {
  const tenantId = randomUUID();
  const personId = randomUUID();
  const at = new Date('2026-10-07T10:00:00Z');
  let client: DbClient;
  let service: OnboardingService;
  const effects = {
    scheduleReminder: vi.fn().mockResolvedValue(undefined),
    replaceIntroActions: vi.fn().mockResolvedValue(undefined),
    sendAcknowledgement: vi.fn().mockResolvedValue(undefined),
    startConversation: vi.fn().mockResolvedValue(undefined),
  };

  beforeAll(async () => {
    client = createDbClient(databaseUrl!);
    await client.db.insert(tenants).values({ id: tenantId, name: 'Onboarding service fixture' });
    await client.db.insert(users).values({ id: personId, tenantId, status: 'active', proactiveMessagingEnabled: false });
    await client.db.insert(people).values({ id: personId, tenantId, customerEmployeeId: 'E-1',
      workEmail: 'e1@fixture.test', displayName: 'E', primaryRole: 'employee', pulseParticipant: true, lifecycleStatus: 'active' });
    await client.db.insert(tenantWorkCalendars).values({ tenantId, timezone: 'Europe/Kyiv', workingDays: [1, 2, 3, 4, 5],
      workStart: '09:00', workEnd: '18:00', updatedBy: 'test' });
    const s = initialOnboardingState('employee');
    await client.db.insert(onboardingStates).values({ tenantId, personId, track: s.track, introStatus: 'delivered',
      participation: s.participation, buttonsActive: true, introChannelId: 'D1', introActionsMessageTs: '1.2' });
    const repo = new OnboardingStateRepository({ client: client.db } as never);
    service = new OnboardingService(repo, effects);
  });

  afterAll(async () => {
    if (client) {
      await client.db.delete(tenants).where(eq(tenants.id, tenantId));
      await client.sql.end();
    }
  });

  it('serialises two parallel start clicks into one transition', async () => {
    const event = { type: 'action', action: 'start', source: 'button', at } as const;
    const results = await Promise.all([service.apply(tenantId, personId, event), service.apply(tenantId, personId, event)]);
    expect(results.filter((r) => r.changed)).toHaveLength(1);
    expect(effects.startConversation).toHaveBeenCalledTimes(1);

    const [row] = await client.db.select().from(onboardingStates).where(eq(onboardingStates.personId, personId));
    expect(row!.participation).toBe('active');
    expect(row!.buttonsActive).toBe(false);
    expect(row!.version).toBe(1);
    const [user] = await client.db.select().from(users).where(eq(users.id, personId));
    expect(user!.proactiveMessagingEnabled).toBe(true);
    const audits = await client.db.select().from(auditLogs).where(eq(auditLogs.resourceId, personId));
    expect(audits).toHaveLength(1);
  });

  it('returns unchanged for a person without a state row', async () => {
    const r = await service.apply(tenantId, randomUUID(), { type: 'substantive_turn', at });
    expect(r).toEqual({ changed: false, effects: [], state: null });
  });
});
