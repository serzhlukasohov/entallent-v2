import { readFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { conversations, createDbClient, onboardingStates, people, tenants, users, type DbClient } from '@entalent/database';
import { ProactiveSchedulerRepository } from './proactive-scheduler.repository';

const databaseUrl = process.env['DATABASE_URL'];
const localDatabase = databaseUrl && /^postgres(?:ql)?:\/\/(?:[^@]+@)?(?:127\.0\.0\.1|localhost):\d+\//.test(databaseUrl);

describe.skipIf(!localDatabase)('ProactiveSchedulerRepository Pulse gating (PostgreSQL)', () => {
  const tenantId = randomUUID();
  const managerId = randomUUID();
  const employeeId = randomUUID();
  const legacyUserId = randomUUID();
  const deferredId = randomUUID();
  const activeId = randomUUID();
  let client: DbClient;

  beforeAll(async () => {
    client = createDbClient(databaseUrl!);
    await client.db.insert(tenants).values({ id: tenantId, name: 'Scheduler gating fixture' });
    for (const [id, role, pulse] of [[managerId, 'manager', false], [employeeId, 'employee', true]] as const) {
      await client.db.insert(users).values({ id, tenantId, status: 'active', proactiveMessagingEnabled: true });
      await client.db.insert(people).values({ id, tenantId, customerEmployeeId: id.slice(0, 8),
        workEmail: `${id}@fixture.test`, displayName: role, primaryRole: role, pulseParticipant: pulse,
        lifecycleStatus: 'active' });
    }
    // A user without a people row (dev/legacy) is not gated by Pulse participation.
    await client.db.insert(users).values({ id: legacyUserId, tenantId, status: 'active', proactiveMessagingEnabled: true });
    for (const id of [managerId, employeeId, legacyUserId]) {
      await client.db.insert(conversations).values({ tenantId, userId: id, channelType: 'dev', externalConversationId: `dev-${id}` });
    }
    // Pulse employees with onboarding state: only 'active' participation may be contacted proactively.
    for (const [id, participation] of [[deferredId, 'deferred'], [activeId, 'active']] as const) {
      await client.db.insert(users).values({ id, tenantId, status: 'active', proactiveMessagingEnabled: true });
      await client.db.insert(people).values({ id, tenantId, customerEmployeeId: id.slice(0, 8),
        workEmail: `${id}@fixture.test`, displayName: participation, primaryRole: 'employee', pulseParticipant: true,
        lifecycleStatus: 'active' });
      await client.db.insert(onboardingStates).values({ tenantId, personId: id, track: 'employee',
        introStatus: participation === 'active' ? 'completed' : 'delivered', participation });
      await client.db.insert(conversations).values({ tenantId, userId: id, channelType: 'dev', externalConversationId: `dev-${id}` });
    }
  });

  afterAll(async () => {
    if (client) {
      await client.db.delete(tenants).where(eq(tenants.id, tenantId));
      await client.sql.end();
    }
  });

  it('excludes a non-Pulse manager even when proactive messaging is enabled', async () => {
    const repo = new ProactiveSchedulerRepository({ client: client.db } as never);
    const found = await repo.findCheckInCandidates({ tenantId, minSilenceDays: 1, minCheckInGapDays: 1, limit: 50 } as never);
    const ids = found.map((c) => c.userId);
    expect(ids).not.toContain(managerId);
    expect(ids).toContain(employeeId);
    expect(ids).toContain(legacyUserId);
  });

  it('requires onboarding participation active when a state row exists, regardless of the users flag', async () => {
    const repo = new ProactiveSchedulerRepository({ client: client.db } as never);
    const ids = (await repo.findCheckInCandidates({ tenantId, minSilenceDays: 1, minCheckInGapDays: 1, limit: 50 } as never))
      .map((c) => c.userId);
    expect(ids).not.toContain(deferredId);
    expect(ids).toContain(activeId);
    expect(ids).toContain(employeeId); // no onboarding_states row
  });
});


describe('ProactiveSchedulerRepository', () => {
  it('keeps the global cooldown and scopes accelerated QA cadence to an active frozen cohort', () => {
    const source = readFileSync(join(__dirname, 'proactive-scheduler.repository.ts'), 'utf8');

    expect(source).toContain("m.message_type = 'proactive_check_in_request'");
    expect(source).toContain("m.sender_type = 'system'");
    expect(source).toContain("THEN interval '4 hours' ELSE make_interval(days => ${params.minCheckInGapDays}) END");
    expect(source).toContain("cohort.id::text = t.proactive_messaging_policy->>'qaThreePerDayCohortId'");
    expect(source).toContain('u.id = ANY(cohort.roster_user_ids)');
    expect(source).toContain('now() >= cohort.period_start AND now() < cohort.period_end');
    expect(source).toContain('recent.occurred_at > now() - interval \'24 hours\'');
    expect(source).toContain('reply.occurred_at > unanswered.occurred_at');
  });
});
