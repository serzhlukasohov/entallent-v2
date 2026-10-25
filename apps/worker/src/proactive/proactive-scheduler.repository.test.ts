import { readFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  conversations, createDbClient, messages, onboardingStates, people, surveyDefinitions, surveyReportingCohorts, teams, tenants,
  users, type DbClient,
} from '@entalent/database';
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
  const DAY = 24 * 60 * 60 * 1000;
  const scanStart = Date.now();
  const legacyInboundAt = new Date(scanStart - 10 * DAY);
  const legacyCheckInAt = new Date(scanStart - 5 * DAY);
  const HOUR = 60 * 60 * 1000;
  const qaUserId = randomUUID();
  const qaLastContactAt = new Date(scanStart - 5 * HOUR);
  const qaLastReplyAt = new Date(scanStart - 4.5 * HOUR);
  const requestUserId = randomUUID();
  const checkInRequestAt = new Date(scanStart - 4 * DAY);

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
    // Cadence facts for the legacy user: an old reply, a later unanswered check-in, and an
    // `__init__` bootstrap message that must not count as inbound. All are outside the 1-day prefilter.
    const [legacyConversation] = await client.db.select({ id: conversations.id }).from(conversations)
      .where(eq(conversations.userId, legacyUserId));
    const base = { tenantId, conversationId: legacyConversation!.id, userId: legacyUserId };
    await client.db.insert(messages).values([
      { ...base, direction: 'inbound', senderType: 'user', text: 'hello', occurredAt: legacyInboundAt },
      { ...base, direction: 'outbound', senderType: 'agent', text: 'check-in', messageType: 'proactive_check_in',
        occurredAt: legacyCheckInAt },
      { ...base, direction: 'inbound', senderType: 'user', text: '__init__', occurredAt: new Date(scanStart - 2 * DAY) },
    ]);

    // QA cohort user: two answered proactive messages inside 24 h (older than the 4 h gap) and one older than 24 h.
    const [team] = await client.db.insert(teams).values({ tenantId, name: 'QA cadence team' }).returning();
    const [definition] = await client.db.insert(surveyDefinitions).values({ tenantId, name: 'QA cadence', version: '1' })
      .returning();
    await client.db.insert(users).values({ id: qaUserId, tenantId, status: 'active', proactiveMessagingEnabled: true });
    const [cohort] = await client.db.insert(surveyReportingCohorts).values({
      tenantId, teamId: team!.id, surveyDefinitionId: definition!.id,
      periodStart: new Date(scanStart - 7 * DAY), periodEnd: new Date(scanStart + 7 * DAY),
      rosterUserIds: [qaUserId], openedAt: new Date(scanStart - 7 * DAY),
    }).returning();
    await client.db.update(tenants).set({ proactiveMessagingPolicy: { qaThreePerDayCohortId: cohort!.id } })
      .where(eq(tenants.id, tenantId));
    const [qaConversation] = await client.db.insert(conversations).values({
      tenantId, userId: qaUserId, channelType: 'dev', externalConversationId: `dev-${qaUserId}`,
    }).returning();
    const qa = { tenantId, conversationId: qaConversation!.id, userId: qaUserId };
    const proactive = { direction: 'outbound', senderType: 'agent', text: 'check-in', messageType: 'proactive_check_in' };
    const reply = { direction: 'inbound', senderType: 'user', text: 'reply' };
    await client.db.insert(messages).values([
      { ...qa, ...proactive, occurredAt: new Date(scanStart - 30 * HOUR) },
      { ...qa, ...proactive, occurredAt: new Date(scanStart - 6 * HOUR) },
      { ...qa, ...reply, occurredAt: new Date(scanStart - 5.5 * HOUR) },
      { ...qa, ...proactive, occurredAt: qaLastContactAt },
      { ...qa, ...reply, occurredAt: qaLastReplyAt },
    ]);

    // A user whose latest proactive contact is an inbound system check-in request.
    await client.db.insert(users).values({ id: requestUserId, tenantId, status: 'active', proactiveMessagingEnabled: true });
    const [requestConversation] = await client.db.insert(conversations).values({
      tenantId, userId: requestUserId, channelType: 'dev', externalConversationId: `dev-${requestUserId}`,
    }).returning();
    const req = { tenantId, conversationId: requestConversation!.id, userId: requestUserId };
    await client.db.insert(messages).values([
      { ...req, ...proactive, occurredAt: new Date(scanStart - 6 * DAY) },
      { ...req, direction: 'inbound', senderType: 'system', text: 'check-in request',
        messageType: 'proactive_check_in_request', occurredAt: checkInRequestAt },
    ]);
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

  it('returns per-user cadence facts with the same message filters as the prefilter', async () => {
    const repo = new ProactiveSchedulerRepository({ client: client.db } as never);
    const found = await repo.findCheckInCandidates({ tenantId, minSilenceDays: 1, minCheckInGapDays: 1, limit: 50 } as never);

    expect(found.find((c) => c.userId === legacyUserId)?.cadence).toEqual({
      lastInboundAt: legacyInboundAt,
      lastProactiveContactAt: legacyCheckInAt,
      recentProactiveCount: 0,
      hasUnansweredProactive: true,
      inQaCadenceCohort: false,
    });
    expect(found.find((c) => c.userId === qaUserId)?.cadence).toEqual({
      lastInboundAt: qaLastReplyAt,
      lastProactiveContactAt: qaLastContactAt,
      recentProactiveCount: 2,
      hasUnansweredProactive: false, // every proactive message has a later reply
      inQaCadenceCohort: true,
    });
    expect(found.find((c) => c.userId === requestUserId)?.cadence.lastProactiveContactAt).toEqual(checkInRequestAt);
    expect(found.find((c) => c.userId === employeeId)?.cadence).toEqual({
      lastInboundAt: null,
      lastProactiveContactAt: null,
      recentProactiveCount: 0,
      hasUnansweredProactive: false,
      inQaCadenceCohort: false,
    });
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

  it('selects the per-user cadence facts consumed by checkInCadencePolicy', () => {
    const source = readFileSync(join(__dirname, 'proactive-scheduler.repository.ts'), 'utf8');
    const select = source.slice(source.indexOf('SELECT\n'), source.indexOf('FROM users u'));

    for (const column of [
      'AS last_inbound_at',
      'AS last_proactive_contact_at',
      'AS recent_proactive_count',
      'AS has_unanswered_proactive',
      '${qaCadence} AS in_qa_cadence_cohort',
    ]) {
      expect(select).toContain(column);
    }
    expect(select).toContain("fi.direction = 'inbound' AND fi.text <> '__init__'");
    expect(select).toContain("fc.message_type = 'proactive_check_in_request'");
    expect(select).toContain("fr.occurred_at > now() - interval '24 hours'");
    expect(select).toContain('fur.occurred_at > fu.occurred_at');
    // The facts only add SELECT columns: the cadence prefilter and LIMIT stay in place.
    expect(source.slice(source.indexOf('FROM users u'))).toContain('LIMIT ${params.limit}');
  });
});
