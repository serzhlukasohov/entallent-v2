import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { auditLogs, createDbClient, orgEmployeePlacements, orgOnboardingDeliveries,
  orgTeams, orgUnits, people, tenants, users, type DbClient } from '@entalent/database';
import { HierarchyMutationService } from './hierarchy-mutation.service';

const databaseUrl = process.env['DATABASE_URL'];
const localDatabase = databaseUrl && /^postgres(?:ql)?:\/\/(?:[^@]+@)?(?:127\.0\.0\.1|localhost):\d+\//.test(databaseUrl);

describe.skipIf(!localDatabase)('owner replacement on migrated local PostgreSQL', () => {
  const tenantId = randomUUID();
  const unitId = randomUUID();
  const teamId = randomUUID();
  const managerId = randomUUID();
  const leadId = randomUUID();
  const teamEmployees = [randomUUID(), randomUUID()];
  const directEmployeeId = randomUUID();
  const personIds = [managerId, leadId, ...teamEmployees, directEmployeeId];
  const actor = { type: 'internal_operator' as const, operatorId: 'owner-integration' };
  let client: DbClient;
  let service: HierarchyMutationService;

  beforeAll(async () => {
    client = createDbClient(databaseUrl!);
    service = new HierarchyMutationService({ client: client.db } as never);
    await client.db.insert(tenants).values({ id: tenantId, name: 'Owner replacement fixture' });
    await client.db.insert(users).values(personIds.map((id) => ({ id, tenantId, status: 'active' })));
    await client.db.insert(people).values(personIds.map((id, index) => ({ id, tenantId,
      customerEmployeeId: `P-${index}`, workEmail: `p${index}@fixture.test`, displayName: `Person ${index}`,
      primaryRole: index === 0 ? 'manager' : index === 1 ? 'team_lead' : 'employee',
      pulseParticipant: index > 0, lifecycleStatus: 'active' })));
    await client.db.insert(orgUnits).values({ id: unitId, tenantId, customerUnitKey: 'U-1',
      name: 'Unit', managerPersonId: managerId, lifecycleStatus: 'active' });
    await client.db.insert(orgTeams).values({ id: teamId, tenantId, unitId,
      customerTeamKey: 'T-1', name: 'Team', teamLeadPersonId: leadId, lifecycleStatus: 'active' });
    await client.db.insert(orgEmployeePlacements).values([
      ...teamEmployees.map((id) => ({ tenantId, unitId, teamId, employeePersonId: id, lifecycleStatus: 'active' })),
      { tenantId, unitId, teamId: null, employeePersonId: directEmployeeId, lifecycleStatus: 'active' },
    ]);
    await client.db.insert(orgOnboardingDeliveries).values([
      { tenantId, personId: managerId, unitId, externalWorkspaceId: 'T-fixture', status: 'pending' },
      { tenantId, personId: leadId, unitId, externalWorkspaceId: 'T-fixture', status: 'failed' },
    ]);
  });

  afterAll(async () => {
    if (!client) return;
    await client.db.delete(tenants).where(eq(tenants.id, tenantId));
    await client.sql.end();
  });

  it('rejects an invalid replacement without changing the graph, then deactivates previous owners and their pending contact', async () => {
    await expect(service.promoteManager(tenantId, unitId, leadId, 'deactivate', actor))
      .rejects.toMatchObject({ code: 'manager_promotion_invalid' });
    const rejectedAudit = await client.db.select().from(auditLogs).where(eq(auditLogs.tenantId, tenantId));
    expect(rejectedAudit).toEqual([expect.objectContaining({
      action: 'org.manager.promote.rejected', resourceId: unitId,
      reason: 'manager_promotion_invalid',
    })]);
    expect((await client.db.select().from(orgUnits).where(eq(orgUnits.id, unitId)))[0]?.managerPersonId)
      .toBe(managerId);
    expect((await client.db.select().from(orgOnboardingDeliveries)
      .where(eq(orgOnboardingDeliveries.personId, managerId)))[0]?.status).toBe('pending');

    await service.promoteTeamLead(tenantId, teamId, teamEmployees[0]!, 'deactivate', actor);
    await service.promoteManager(tenantId, unitId, directEmployeeId, 'deactivate', actor);
    const completedAudit = await client.db.select().from(auditLogs).where(eq(auditLogs.tenantId, tenantId));
    expect(completedAudit.map((row) => row.action)).toEqual(expect.arrayContaining([
      'org.team_lead.promote', 'org.manager.promote',
    ]));
    expect((await client.db.select().from(orgTeams).where(eq(orgTeams.id, teamId)))[0]?.teamLeadPersonId)
      .toBe(teamEmployees[0]);
    expect((await client.db.select().from(orgUnits).where(eq(orgUnits.id, unitId)))[0]?.managerPersonId)
      .toBe(directEmployeeId);
    for (const id of [leadId, managerId]) {
      expect((await client.db.select().from(people).where(eq(people.id, id)))[0]?.lifecycleStatus)
        .toBe('inactive');
      expect((await client.db.select().from(users).where(eq(users.id, id)))[0]?.status)
        .toBe('inactive');
      expect((await client.db.select().from(orgOnboardingDeliveries)
        .where(eq(orgOnboardingDeliveries.personId, id)))[0]?.status).toBe('cancelled');
    }
    const activePlacements = (await client.db.select().from(orgEmployeePlacements)
      .where(eq(orgEmployeePlacements.tenantId, tenantId)))
      .filter((row) => row.lifecycleStatus === 'active');
    expect(activePlacements.map((row) => row.employeePersonId)).toEqual([teamEmployees[1]]);
  });
});
