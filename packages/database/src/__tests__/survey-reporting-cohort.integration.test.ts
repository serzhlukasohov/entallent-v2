import { afterAll, beforeAll, expect, it } from 'vitest';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  closeTestDb,
  describeIntegration,
  getTestDb,
  runMigrationsOnce,
} from './integration-setup';
import {
  surveyDefinitions,
  surveyReportSnapshots,
  surveyReportingCohorts,
  surveyWindows,
  teamMemberships,
  teams,
  tenants,
  users,
} from '../schema';

describeIntegration('Survey reporting cohort lifecycle (integration)', () => {
  const tenantIds: string[] = [];

  beforeAll(async () => {
    await runMigrationsOnce();
  });

  afterAll(async () => {
    const { db } = getTestDb();
    if (tenantIds.length > 0) await db.delete(tenants).where(inArray(tenants.id, tenantIds));
    await closeTestDb();
  });

  it('keeps the frozen denominator after later opt-out while current eligibility shrinks', async () => {
    const { db } = getTestDb();
    const [tenant] = await db.insert(tenants).values({
      name: 'Cohort Test Corp', status: 'active', timezone: 'UTC', locale: 'en',
      retentionPolicy: {}, safetyPolicy: {}, proactiveMessagingPolicy: {}, surveyConfiguration: {},
    }).returning();
    const tenantId = tenant!.id;
    tenantIds.push(tenantId);

    const [definition] = await db.insert(surveyDefinitions).values({
      tenantId, name: 'Quarterly Pulse', version: '1', active: true, configuration: {},
    }).returning();
    const [team] = await db.insert(teams).values({ tenantId, name: 'Platform' }).returning();
    const createdUsers = await db.insert(users).values(
      Array.from({ length: 5 }, (_, index) => ({
        tenantId: tenantId!,
        preferredName: `Member ${index + 1}`,
        status: 'active',
        consentState: { surveyEnabled: true },
      })),
    ).returning({ id: users.id });
    const rosterUserIds = createdUsers.map((user) => user.id).sort();
    const periodStart = new Date('2026-07-01T00:00:00.000Z');
    const periodEnd = new Date('2026-10-01T00:00:00.000Z');

    await db.insert(teamMemberships).values(rosterUserIds.map((userId) => ({
      teamId: team!.id,
      userId,
      role: 'member',
      joinedAt: periodStart,
    })));
    const [cohort] = await db.insert(surveyReportingCohorts).values({
      tenantId,
      teamId: team!.id,
      surveyDefinitionId: definition!.id,
      periodStart,
      periodEnd,
      rosterUserIds,
      openedAt: periodStart,
    }).returning();
    await db.insert(surveyWindows).values({
      tenantId,
      userId: rosterUserIds[0]!,
      surveyDefinitionId: definition!.id,
      periodStart,
      periodEnd,
      reportingCohortId: cohort!.id,
      reportingTeamId: team!.id,
      reportingRosterUserIds: rosterUserIds,
    });

    await db.update(users)
      .set({ consentState: { surveyEnabled: false } })
      .where(eq(users.id, rosterUserIds[4]!));

    const [persisted] = await db.select().from(surveyReportingCohorts)
      .where(eq(surveyReportingCohorts.id, cohort!.id));
    const currentlyEligible = await db.select({ id: users.id }).from(users).where(and(
      inArray(users.id, persisted!.rosterUserIds),
      eq(users.status, 'active'),
      isNull(users.deletedAt),
      sql`${users.consentState}->'surveyEnabled' = 'true'::jsonb`,
    ));

    expect(persisted!.rosterUserIds).toEqual(rosterUserIds);
    expect(persisted!.rosterUserIds).toHaveLength(5);
    expect(currentlyEligible).toHaveLength(4);
  });

  it('lets cancelled first snapshots release the delivery slot while delivered and unknown occupy it', async () => {
    const { db } = getTestDb();
    const [tenant] = await db.insert(tenants).values({
      name: 'Snapshot Test Corp', status: 'active', timezone: 'UTC', locale: 'en',
      retentionPolicy: {}, safetyPolicy: {}, proactiveMessagingPolicy: {}, surveyConfiguration: {},
    }).returning();
    const tenantId = tenant!.id;
    tenantIds.push(tenantId);

    const [definition] = await db.insert(surveyDefinitions).values({
      tenantId, name: 'Quarterly Pulse', version: '1', active: true, configuration: {},
    }).returning();
    const [team] = await db.insert(teams).values({ tenantId, name: 'Platform' }).returning();
    const createdUsers = await db.insert(users).values(
      Array.from({ length: 5 }, (_, index) => ({
        tenantId,
        preferredName: `Snapshot Member ${index + 1}`,
        status: 'active',
        consentState: { surveyEnabled: true },
      })),
    ).returning({ id: users.id });
    const rosterUserIds = createdUsers.map((user) => user.id).sort();
    const periodStart = new Date('2026-07-01T00:00:00.000Z');
    const periodEnd = new Date('2026-10-01T00:00:00.000Z');
    const [cohort] = await db.insert(surveyReportingCohorts).values({
      tenantId,
      teamId: team!.id,
      surveyDefinitionId: definition!.id,
      periodStart,
      periodEnd,
      rosterUserIds,
      openedAt: periodStart,
    }).returning();
    const snapshot = {
      tenantId,
      reportingCohortId: cohort!.id,
      teamId: team!.id,
      questionGroup: 'growth',
      snapshotVersion: 1,
      managerPayload: { message: 'Manager report.', teamScore: 82, confirmedCount: 5 },
      contributorUserIds: rosterUserIds,
      sourceGroupStateIds: rosterUserIds,
      policyVersion: 'group-report-snapshot-v1',
      managerSlackUserId: 'manager-1',
    };

    await db.insert(surveyReportSnapshots).values({ ...snapshot, status: 'cancelled' });
    await expect(db.insert(surveyReportSnapshots).values({ ...snapshot, status: 'delivered' }))
      .resolves.toBeDefined();
    await expect(db.insert(surveyReportSnapshots).values({ ...snapshot, snapshotVersion: 2, status: 'delivered' }))
      .resolves.toBeDefined();
    await expect(db.insert(surveyReportSnapshots).values({ ...snapshot, status: 'delivery_unknown' }))
      .rejects.toThrow();
  });

  it('rejects a second active member team for the same employee', async () => {
    const { db } = getTestDb();
    const [tenant] = await db.insert(tenants).values({
      name: 'Transfer Constraint Corp', status: 'active', timezone: 'UTC', locale: 'en',
      retentionPolicy: {}, safetyPolicy: {}, proactiveMessagingPolicy: {}, surveyConfiguration: {},
    }).returning();
    const tenantId = tenant!.id;
    tenantIds.push(tenantId);
    const [user] = await db.insert(users).values({
      tenantId,
      preferredName: 'Transfer Member',
      status: 'active',
      consentState: { surveyEnabled: true },
    }).returning();
    const [firstTeam, secondTeam] = await db.insert(teams).values([
      { tenantId, name: 'Before Transfer' },
      { tenantId, name: 'After Transfer' },
    ]).returning();

    await db.insert(teamMemberships).values({
      teamId: firstTeam!.id,
      userId: user!.id,
      role: 'member',
    });

    await expect(db.insert(teamMemberships).values({
      teamId: secondTeam!.id,
      userId: user!.id,
      role: 'member',
    })).rejects.toThrow();
  });
});
