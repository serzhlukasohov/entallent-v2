import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import {
  channelAccounts, createDbClient, orgEmployeePlacements, orgOnboardingDeliveries,
  orgUnits, people, tenants, users, workspaceConnections,
  type DbClient,
} from '@entalent/database';
import { HierarchyRolloutService } from './hierarchy-rollout.service';

const databaseUrl = process.env['DATABASE_URL'];
const localDatabase = databaseUrl && /^postgres(?:ql)?:\/\/(?:[^@]+@)?(?:127\.0\.0\.1|localhost):\d+\//.test(databaseUrl);

describe.skipIf(!localDatabase)('multi-Unit rollout on migrated local PostgreSQL', () => {
  const tenantId = randomUUID();
  const workspaceId = `T-${randomUUID()}`;
  const unitIds = [randomUUID(), randomUUID()].sort();
  const managers = [randomUUID(), randomUUID()];
  const employees = [randomUUID(), randomUUID()];
  const leadershipId = randomUUID();
  const personIds = [...managers, ...employees, leadershipId];
  let client: DbClient;
  let service: HierarchyRolloutService;

  beforeAll(async () => {
    client = createDbClient(databaseUrl!);
    service = new HierarchyRolloutService({ client: client.db } as never);
    await client.db.insert(tenants).values({ id: tenantId, name: 'Rollout integration fixture' });
    await client.db.insert(users).values(personIds.map((id) => ({ id, tenantId, status: 'inactive' })));
    await client.db.insert(people).values([
      ...managers.map((id, index) => ({ id, tenantId, customerEmployeeId: `M-${index}`, workEmail: `m${index}@fixture.test`,
        displayName: `Manager ${index}`, primaryRole: 'manager', pulseParticipant: false, lifecycleStatus: 'draft' })),
      ...employees.map((id, index) => ({ id, tenantId, customerEmployeeId: `E-${index}`, workEmail: `e${index}@fixture.test`,
        displayName: `Employee ${index}`, primaryRole: 'employee', pulseParticipant: true, lifecycleStatus: 'draft' })),
      { id: leadershipId, tenantId, customerEmployeeId: 'L-0', workEmail: 'leadership@fixture.test',
        displayName: 'Leadership', primaryRole: 'leadership', pulseParticipant: false, lifecycleStatus: 'draft' },
    ]);
    await client.db.insert(workspaceConnections).values({ tenantId, channelType: 'slack',
      externalWorkspaceId: workspaceId, encryptedCredentials: 'synthetic' });
    await client.db.insert(orgUnits).values(unitIds.map((id, index) => ({ id, tenantId,
      customerUnitKey: `U-${index}`, name: `Unit ${index}`, managerPersonId: managers[index]! })));
    await client.db.insert(orgEmployeePlacements).values(unitIds.map((id, index) => ({ tenantId,
      unitId: id, employeePersonId: employees[index]! })));
    await client.db.insert(channelAccounts).values([managers[0]!, ...employees, leadershipId].map((id) => ({
      tenantId, userId: id, channelType: 'slack', externalWorkspaceId: workspaceId,
      externalUserId: `U-${id}`,
    })));
  });

  afterAll(async () => {
    if (!client) return;
    await client.db.delete(tenants).where(eq(tenants.id, tenantId));
    await client.sql.end();
  });

  it('does not write for a batch with a missing second Manager link, then activates once per Person', async () => {
    const actor = { type: 'internal_operator' as const, operatorId: 'rollout-integration' };
    await expect(service.activateUnits(tenantId, unitIds, workspaceId, actor))
      .rejects.toMatchObject({ code: 'unit_not_ready' });
    const before = await client.db.select({ status: orgUnits.lifecycleStatus }).from(orgUnits)
      .where(eq(orgUnits.tenantId, tenantId));
    expect(before.map((row) => row.status)).toEqual(['draft', 'draft']);
    expect(await client.db.select().from(orgOnboardingDeliveries).where(eq(orgOnboardingDeliveries.tenantId, tenantId)))
      .toEqual([]);

    await client.db.insert(channelAccounts).values({ tenantId, userId: managers[1]!, channelType: 'slack',
      externalWorkspaceId: workspaceId, externalUserId: `U-${managers[1]}` });
    const preview = await service.previewUnits(tenantId, unitIds, workspaceId, actor);
    expect(preview.ready).toBe(true);
    const result = await service.activateUnits(tenantId, unitIds, workspaceId, actor);
    expect(result.flatMap((row) => row.activatedPersonIds).sort()).toEqual([...personIds].sort());
    const delivered = await client.db.select().from(orgOnboardingDeliveries)
      .where(eq(orgOnboardingDeliveries.tenantId, tenantId));
    expect(delivered).toHaveLength(5);
    expect(delivered.filter((row) => row.personId === leadershipId)).toHaveLength(1);
    const activePeople = await client.db.select({ id: people.id }).from(people).where(and(
      eq(people.tenantId, tenantId), eq(people.lifecycleStatus, 'active'), inArray(people.id, personIds),
    ));
    expect(activePeople).toHaveLength(5);
    expect((await service.activateUnits(tenantId, unitIds, workspaceId, actor))
      .flatMap((row) => row.activatedPersonIds)).toEqual([]);
  });
});
