import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { isRuntimeEligibleUser } from '@entalent/application';
import {
  channelAccounts, conversations, createDbClient, messages, orgEmployeePlacements,
  orgOnboardingDeliveries, orgUnits, people, teamMemberships, teams, tenants, users,
  workspaceConnections, type DbClient,
} from '@entalent/database';
import { HierarchyRolloutService, type LegacyEmployeeAdoption } from './hierarchy-rollout.service';
import type { SlackDirectoryService } from './slack-directory.service';

const databaseUrl = process.env['DATABASE_URL'];
const localDatabase = databaseUrl && /^postgres(?:ql)?:\/\/(?:[^@]+@)?(?:127\.0\.0\.1|localhost):\d+\//.test(databaseUrl);

describe.skipIf(!localDatabase)('legacy Employee adoption during Unit rollout', () => {
  const tenantId = randomUUID();
  const managerId = randomUUID();
  const employeeId = randomUUID();
  const unitId = randomUUID();
  const workspaceId = `T-${randomUUID()}`;
  const managerSlackId = `U-${randomUUID()}`;
  const employeeSlackId = `U-${randomUUID()}`;
  const actor = { type: 'internal_operator' as const, operatorId: 'legacy-adoption-test' };
  const adoption: LegacyEmployeeAdoption = {
    userId: employeeId, externalSlackUserId: employeeSlackId, unitId,
    customerEmployeeId: 'E-legacy', workEmail: 'legacy@fixture.test', displayName: 'Legacy Employee',
  };
  const directory = {
    listUsers: async () => [{ externalUserId: employeeSlackId, email: adoption.workEmail, isBot: false, deleted: false }],
  } as unknown as SlackDirectoryService;
  let client: DbClient;
  let service: HierarchyRolloutService;
  let conversationId: string;
  let messageId: string;
  let membershipId: string;

  beforeAll(async () => {
    client = createDbClient(databaseUrl!);
    service = new HierarchyRolloutService({ client: client.db } as never, directory);
    await client.db.insert(tenants).values({ id: tenantId, name: 'Legacy adoption fixture' });
    await client.db.insert(users).values([
      { id: managerId, tenantId, status: 'inactive' },
      { id: employeeId, tenantId, status: 'active' },
    ]);
    await client.db.insert(people).values({ id: managerId, tenantId, customerEmployeeId: 'M-new',
      workEmail: 'manager@fixture.test', displayName: 'Manager', primaryRole: 'manager',
      pulseParticipant: false, lifecycleStatus: 'draft' });
    await client.db.insert(workspaceConnections).values({ tenantId, channelType: 'slack',
      externalWorkspaceId: workspaceId, encryptedCredentials: 'synthetic' });
    await client.db.insert(orgUnits).values({ id: unitId, tenantId, customerUnitKey: 'pilot',
      name: 'Pilot Unit', managerPersonId: managerId });
    await client.db.insert(channelAccounts).values({ tenantId, userId: employeeId, channelType: 'slack',
      externalWorkspaceId: workspaceId, externalUserId: employeeSlackId });
    const [conversation] = await client.db.insert(conversations).values({ tenantId, userId: employeeId,
      channelType: 'slack', externalConversationId: `D-${randomUUID()}` }).returning({ id: conversations.id });
    conversationId = conversation!.id;
    const [message] = await client.db.insert(messages).values({ tenantId, userId: employeeId,
      conversationId, direction: 'inbound', senderType: 'user', text: 'Historical fixture',
      occurredAt: new Date() }).returning({ id: messages.id });
    messageId = message!.id;
    const [legacyTeam] = await client.db.insert(teams).values({ tenantId, name: 'Quarantined QA' })
      .returning({ id: teams.id });
    const [membership] = await client.db.insert(teamMemberships).values({ teamId: legacyTeam!.id,
      userId: employeeId }).returning({ id: teamMemberships.id });
    membershipId = membership!.id;
  });

  afterAll(async () => {
    if (!client) return;
    await client.db.delete(tenants).where(eq(tenants.id, tenantId));
    await client.sql.end();
  });

  it('rejects an ambiguous Slack email without creating a Person', async () => {
    const ambiguousDirectory = { listUsers: async () => [
      { externalUserId: employeeSlackId, email: adoption.workEmail, isBot: false, deleted: false },
      { externalUserId: `U-${randomUUID()}`, email: adoption.workEmail, isBot: false, deleted: false },
    ] } as unknown as SlackDirectoryService;
    const ambiguousService = new HierarchyRolloutService({ client: client.db } as never, ambiguousDirectory);
    await expect(ambiguousService.activateUnits(tenantId, [unitId], workspaceId, actor, [adoption]))
      .rejects.toMatchObject({ code: 'legacy_slack_email_mismatch' });
    expect(await client.db.select().from(people).where(eq(people.id, employeeId))).toEqual([]);
  });

  it('preserves legacy identity and history, rolling back adoption when Unit is not ready', async () => {
    await expect(service.activateUnits(tenantId, [unitId], workspaceId, actor, [adoption]))
      .rejects.toMatchObject({ code: 'unit_not_ready' });
    expect(await client.db.select().from(people).where(eq(people.id, employeeId))).toEqual([]);
    expect(await client.db.select().from(orgEmployeePlacements)
      .where(eq(orgEmployeePlacements.employeePersonId, employeeId))).toEqual([]);
    const [legacyUser] = await client.db.select().from(users).where(eq(users.id, employeeId));
    expect(isRuntimeEligibleUser({ userStatus: legacyUser!.status, deletedAt: legacyUser!.deletedAt,
      personLifecycle: null, pulseParticipant: null })).toBe(true);

    await client.db.insert(channelAccounts).values({ tenantId, userId: managerId, channelType: 'slack',
      externalWorkspaceId: workspaceId, externalUserId: managerSlackId });
    const result = await service.activateUnits(tenantId, [unitId], workspaceId, actor, [adoption]);
    expect(result[0]!.activatedPersonIds).toEqual([employeeId, managerId].sort());
    const [person] = await client.db.select().from(people).where(eq(people.id, employeeId));
    expect(person).toMatchObject({ id: employeeId, lifecycleStatus: 'active', primaryRole: 'employee',
      workEmail: adoption.workEmail });
    expect(isRuntimeEligibleUser({ userStatus: legacyUser!.status, deletedAt: legacyUser!.deletedAt,
      personLifecycle: person!.lifecycleStatus, pulseParticipant: person!.pulseParticipant })).toBe(true);
    const [account] = await client.db.select().from(channelAccounts).where(and(
      eq(channelAccounts.externalWorkspaceId, workspaceId), eq(channelAccounts.externalUserId, employeeSlackId)));
    expect(account!.userId).toBe(employeeId);
    expect(await client.db.select().from(conversations).where(eq(conversations.id, conversationId))).toHaveLength(1);
    expect(await client.db.select().from(messages).where(eq(messages.id, messageId))).toHaveLength(1);
    expect(await client.db.select().from(teamMemberships).where(eq(teamMemberships.id, membershipId))).toHaveLength(1);
    expect(await client.db.select().from(orgOnboardingDeliveries)
      .where(eq(orgOnboardingDeliveries.tenantId, tenantId))).toHaveLength(2);
    expect((await service.activateUnits(tenantId, [unitId], workspaceId, actor))[0]!.activatedPersonIds).toEqual([]);
    expect(await client.db.select().from(orgOnboardingDeliveries)
      .where(eq(orgOnboardingDeliveries.tenantId, tenantId))).toHaveLength(2);
  });
});
