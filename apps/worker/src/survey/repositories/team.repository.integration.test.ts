import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  channelAccounts, createDbClient, orgEmployeePlacements, orgTeams, orgUnits,
  people, teams, tenants, users, type DbClient,
} from '@entalent/database';
import { TeamRepository } from './team.repository';

const databaseUrl = process.env['DATABASE_URL'];
const localDatabase = databaseUrl && /^postgres(?:ql)?:\/\/(?:[^@]+@)?(?:127\.0\.0\.1|localhost):\d+\//.test(databaseUrl);

describe.skipIf(!localDatabase)('current hierarchy identifiers on migrated local PostgreSQL', () => {
  const tenantId = randomUUID();
  const unitId = randomUUID();
  const teamId = randomUUID();
  const legacyTeamId = randomUUID();
  const managerId = randomUUID();
  const leadId = randomUUID();
  const teamEmployeeId = randomUUID();
  const directEmployeeId = randomUUID();
  const identities = [
    { id: managerId, role: 'manager', name: 'Manager One', pulse: false },
    { id: leadId, role: 'team_lead', name: 'Lead One', pulse: true },
    { id: teamEmployeeId, role: 'employee', name: 'Team Member', pulse: true },
    { id: directEmployeeId, role: 'employee', name: 'Direct Member', pulse: true },
  ] as const;
  let client: DbClient;
  let repository: TeamRepository;

  beforeAll(async () => {
    client = createDbClient(databaseUrl!);
    repository = new TeamRepository({ client: client.db } as never);
    await client.db.insert(tenants).values({ id: tenantId, name: 'Hierarchy identifiers fixture' });
    await client.db.insert(users).values(identities.map(({ id }) => ({ id, tenantId, status: 'active' })));
    await client.db.insert(people).values(identities.map(({ id, role, name, pulse }, index) => ({
      id, tenantId, customerEmployeeId: `P-${index}`, workEmail: `person${index}@fixture.test`,
      displayName: name, primaryRole: role, pulseParticipant: pulse, lifecycleStatus: 'active',
    })));
    await client.db.insert(orgUnits).values({ id: unitId, tenantId, customerUnitKey: 'U-1',
      name: 'Engineering Unit', managerPersonId: managerId, lifecycleStatus: 'active' });
    await client.db.insert(orgTeams).values({ id: teamId, tenantId, unitId,
      customerTeamKey: 'T-1', name: 'Platform Team', teamLeadPersonId: leadId,
      lifecycleStatus: 'active' });
    await client.db.insert(orgEmployeePlacements).values([
      { tenantId, unitId, teamId, employeePersonId: teamEmployeeId, lifecycleStatus: 'active' },
      { tenantId, unitId, teamId: null, employeePersonId: directEmployeeId, lifecycleStatus: 'active' },
    ]);
    await client.db.insert(channelAccounts).values({ tenantId, userId: leadId,
      channelType: 'slack', externalWorkspaceId: 'T-fixture', externalUserId: 'U-LEAD' });
    await client.db.insert(teams).values({ id: legacyTeamId, tenantId,
      name: 'V2 fixture', managerSlackUserId: 'D-MANAGER' });
    await client.db.insert(channelAccounts).values({ tenantId, userId: managerId,
      channelType: 'slack', externalWorkspaceId: 'T-fixture', externalUserId: 'U-MANAGER' });
  });

  afterAll(async () => {
    if (!client) return;
    await client.db.delete(tenants).where(eq(tenants.id, tenantId));
    await client.sql.end();
  });

  it('uses active Unit and Team identifiers for safety without changing legacy report membership', async () => {
    const teamIdentifiers = await repository.findCurrentHierarchyIdentifiers(teamEmployeeId, tenantId);
    expect(teamIdentifiers).toEqual(expect.arrayContaining([
      unitId, 'Engineering Unit', teamId, 'Platform Team',
      managerId, 'Manager One', leadId, 'Lead One', 'U-LEAD',
      teamEmployeeId, 'Team Member',
    ]));
    expect(await repository.findCurrentHierarchyIdentifiers(leadId, tenantId))
      .toEqual(expect.arrayContaining(['Engineering Unit', 'Platform Team', 'Team Member']));

    const directIdentifiers = await repository.findCurrentHierarchyIdentifiers(directEmployeeId, tenantId);
    expect(directIdentifiers).toEqual(expect.arrayContaining([
      'Engineering Unit', 'Manager One', 'Direct Member',
    ]));
    expect(directIdentifiers).not.toContain('Platform Team');
    expect(directIdentifiers).not.toContain('Team Member');
    expect(await repository.findCurrentHierarchyIdentifiers(teamEmployeeId, randomUUID())).toEqual([]);
    expect(await repository.findTeamByMemberId(teamEmployeeId, tenantId)).toBeNull();
  });

  it('resolves a V2 recipient only while the manager role and Slack link remain active', async () => {
    expect(await repository.findV2ManagerExternalUserIds(tenantId, 'T-fixture'))
      .toEqual(['U-MANAGER']);
    expect(await repository.findV2ManagerExternalUserIds(tenantId, 'T-other'))
      .toEqual([]);
    await client.db.update(users).set({ status: 'deleted', deletedAt: new Date() })
      .where(eq(users.id, managerId));
    expect(await repository.findV2ManagerExternalUserIds(tenantId, 'T-fixture'))
      .toEqual([]);
  });
});
