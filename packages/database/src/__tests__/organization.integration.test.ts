import { afterAll, beforeAll, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeTestDb, describeIntegration, getTestDb, runMigrationsOnce } from './integration-setup';
import { orgEmployeePlacements, orgTeams, orgUnits, people, tenants, users } from '../schema';

describeIntegration('Organization hierarchy constraints (integration)', () => {
  const tenantIds: string[] = [];

  beforeAll(async () => {
    await runMigrationsOnce();
  });

  afterAll(async () => {
    const { db } = getTestDb();
    for (const tenantId of tenantIds) {
      await db.delete(tenants).where(eq(tenants.id, tenantId));
    }
    await closeTestDb();
  });

  it('keeps Team placement inside its Unit and allows direct Unit Employees', async () => {
    const { db } = getTestDb();
    const [tenantA, tenantB] = await db.insert(tenants).values([{ name: 'Org A' }, { name: 'Org B' }]).returning();
    tenantIds.push(tenantA!.id, tenantB!.id);
    const [employee, lead, manager, otherTenantUser] = await db.insert(users).values([
      { tenantId: tenantA!.id }, { tenantId: tenantA!.id }, { tenantId: tenantA!.id }, { tenantId: tenantB!.id },
    ]).returning();
    await db.insert(people).values([
      { id: employee!.id, tenantId: tenantA!.id, customerEmployeeId: 'E-1', workEmail: 'e@a.test', displayName: 'Employee', primaryRole: 'employee', pulseParticipant: true },
      { id: lead!.id, tenantId: tenantA!.id, customerEmployeeId: 'L-1', workEmail: 'l@a.test', displayName: 'Lead', primaryRole: 'team_lead', pulseParticipant: true },
      { id: manager!.id, tenantId: tenantA!.id, customerEmployeeId: 'M-1', workEmail: 'm@a.test', displayName: 'Manager', primaryRole: 'manager', pulseParticipant: false },
      { id: otherTenantUser!.id, tenantId: tenantB!.id, customerEmployeeId: 'E-1', workEmail: 'e@b.test', displayName: 'Other', primaryRole: 'employee', pulseParticipant: true },
    ]);
    const [unit, otherUnit] = await db.insert(orgUnits).values([
      { tenantId: tenantA!.id, customerUnitKey: 'U-1', name: 'Unit 1', managerPersonId: manager!.id },
      { tenantId: tenantA!.id, customerUnitKey: 'U-2', name: 'Unit 2' },
    ]).returning();
    const [team] = await db.insert(orgTeams).values({
      tenantId: tenantA!.id, unitId: unit!.id, customerTeamKey: 'T-1', name: 'Team 1', teamLeadPersonId: lead!.id,
    }).returning();

    const [direct] = await db.insert(orgEmployeePlacements).values({
      tenantId: tenantA!.id, employeePersonId: employee!.id, unitId: otherUnit!.id,
    }).returning();
    expect(direct!.teamId).toBeNull();

    await expect(db.insert(orgEmployeePlacements).values({
      tenantId: tenantA!.id, employeePersonId: employee!.id, unitId: otherUnit!.id, teamId: team!.id,
    })).rejects.toThrow();
    await expect(db.insert(orgEmployeePlacements).values({
      tenantId: tenantA!.id, employeePersonId: otherTenantUser!.id, unitId: unit!.id,
    })).rejects.toThrow();
    await db.insert(orgEmployeePlacements).values({
      tenantId: tenantA!.id, employeePersonId: employee!.id, unitId: unit!.id,
      teamId: team!.id, lifecycleStatus: 'active',
    });
    await expect(db.insert(orgEmployeePlacements).values({
      tenantId: tenantA!.id, employeePersonId: employee!.id, unitId: otherUnit!.id,
      lifecycleStatus: 'active',
    })).rejects.toThrow();
  });

  it('rejects a second active Unit owner and duplicate stable Unit key', async () => {
    const { db } = getTestDb();
    const [tenant] = await db.insert(tenants).values({ name: 'Org Owners' }).returning();
    tenantIds.push(tenant!.id);
    const [manager] = await db.insert(users).values({ tenantId: tenant!.id }).returning();
    await db.insert(people).values({
      id: manager!.id, tenantId: tenant!.id, customerEmployeeId: 'M-2', workEmail: 'm@owners.test',
      displayName: 'Manager', primaryRole: 'manager', pulseParticipant: false,
    });
    await db.insert(orgUnits).values({
      tenantId: tenant!.id, customerUnitKey: 'U-1', name: 'First', managerPersonId: manager!.id, lifecycleStatus: 'active',
    });
    await expect(db.insert(orgUnits).values({
      tenantId: tenant!.id, customerUnitKey: 'U-2', name: 'Second', managerPersonId: manager!.id, lifecycleStatus: 'active',
    })).rejects.toThrow();
    await expect(db.insert(orgUnits).values({
      tenantId: tenant!.id, customerUnitKey: 'U-1', name: 'Duplicate',
    })).rejects.toThrow();
  });
});
