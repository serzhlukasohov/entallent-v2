import { describe, expect, it } from 'vitest';
import {
  auditLogs, orgAdvisorAssignments, orgEmployeePlacements, orgHrbpScopes,
  orgOnboardingDeliveries, orgTeams, orgUnits, people, users,
} from '@entalent/database';
import { HierarchyDeactivationService } from './hierarchy-deactivation.service';

const tenantId = 'tenant-1';
const actor = { type: 'internal_operator' as const, operatorId: 'operator-1' };

function setup(role: 'employee' | 'hrbp' | 'leadership' | 'team_lead', lastTeamEmployee = false, withTargetUnit = false) {
  const personId = 'target';
  const rows = new Map<unknown, unknown[]>([
    [people, [
      { id: personId, tenantId, primaryRole: role, lifecycleStatus: 'active' },
      { id: 'manager', tenantId, primaryRole: 'manager', lifecycleStatus: 'active' },
      { id: 'lead', tenantId, primaryRole: 'team_lead', lifecycleStatus: 'active' },
      ...lastTeamEmployee ? [] : [{ id: 'employee-b', tenantId, primaryRole: 'employee', lifecycleStatus: 'active' }],
      ...withTargetUnit ? [
        { id: 'target-manager', tenantId, primaryRole: 'manager', lifecycleStatus: 'active' },
        { id: 'target-employee', tenantId, primaryRole: 'employee', lifecycleStatus: 'active' },
      ] : [],
    ]],
    [orgUnits, [
      { id: 'unit-a', tenantId, managerPersonId: 'manager', lifecycleStatus: 'active' },
      ...withTargetUnit ? [{ id: 'unit-b', tenantId, managerPersonId: 'target-manager', lifecycleStatus: 'active' }] : [],
    ]],
    [orgTeams, [{ id: 'team-a', tenantId, unitId: 'unit-a', teamLeadPersonId: 'lead', lifecycleStatus: 'active' }]],
    [orgEmployeePlacements, [
      ...role === 'employee' ? [{ id: 'placement-a', tenantId, employeePersonId: personId,
        unitId: 'unit-a', teamId: 'team-a', lifecycleStatus: 'active' }] : [],
      ...lastTeamEmployee ? [] : [{ id: 'placement-b', tenantId, employeePersonId: 'employee-b',
        unitId: 'unit-a', teamId: 'team-a', lifecycleStatus: 'active' }],
      ...withTargetUnit ? [{ id: 'placement-target', tenantId, employeePersonId: 'target-employee',
        unitId: 'unit-b', teamId: null, lifecycleStatus: 'active' }] : [],
    ]],
  ]);
  const writes: Array<{ table: unknown; value: unknown }> = [];
  const db = {
    select: () => ({ from: (table: unknown) => ({ where: () => {
      const result = Promise.resolve(rows.get(table) ?? []);
      return { then: result.then.bind(result), for: () => ({
        then: result.then.bind(result), limit: () => result,
      }) };
    } }) }),
    update: (table: unknown) => ({ set: (value: unknown) => ({ where: () => {
      writes.push({ table, value });
      return { then: (resolve: (value: unknown[]) => unknown) => Promise.resolve([{ id: personId }]).then(resolve),
        returning: async () => [{ id: personId }] };
    } }) }),
    insert: (table: unknown) => ({ values: async (value: unknown) => { writes.push({ table, value }); } }),
    transaction: async (run: (tx: unknown) => Promise<unknown>) => run(db),
  };
  return { service: new HierarchyDeactivationService({ client: db } as never), writes, personId, rows };
}

describe('HierarchyDeactivationService.deactivatePerson', () => {
  it('ends an Employee placement and cancels unsent onboarding in one transaction', async () => {
    const { service, writes, personId } = setup('employee');
    await expect(service.deactivatePerson(tenantId, personId, actor))
      .resolves.toMatchObject({ lifecycleStatus: 'inactive', previousRole: 'employee' });
    expect(writes.find((w) => w.table === orgEmployeePlacements)?.value)
      .toMatchObject({ lifecycleStatus: 'inactive' });
    expect(writes.find((w) => w.table === users)?.value).toMatchObject({ status: 'inactive' });
    expect(writes.find((w) => w.table === orgOnboardingDeliveries)?.value)
      .toMatchObject({ status: 'cancelled' });
    expect(writes.find((w) => w.table === auditLogs)?.value)
      .toMatchObject({ action: 'org.person.deactivate', metadata: {
        before: { primaryRole: 'employee', lifecycleStatus: 'active' },
        after: { primaryRole: 'employee', lifecycleStatus: 'inactive' },
      } });
  });

  it('rejects deactivation that would orphan a Team', async () => {
    const { service, writes, personId } = setup('employee', true);
    await expect(service.deactivatePerson(tenantId, personId, actor))
      .rejects.toMatchObject({ code: 'employee_deactivation_invalid' });
    expect(writes.some((w) => w.table === people)).toBe(false);
    expect(writes.find((w) => w.table === auditLogs)?.value)
      .toMatchObject({ action: 'org.person.deactivate.rejected' });
  });

  it('ends HRBP assignments and scope', async () => {
    const { service, writes, personId } = setup('hrbp');
    await service.deactivatePerson(tenantId, personId, actor);
    expect(writes.find((w) => w.table === orgAdvisorAssignments)?.value)
      .toMatchObject({ lifecycleStatus: 'inactive' });
    expect(writes.find((w) => w.table === orgHrbpScopes)?.value)
      .toMatchObject({ lifecycleStatus: 'inactive' });
  });

  it('protects the final Leadership Person while a Unit is active', async () => {
    const { service, writes, personId } = setup('leadership');
    await expect(service.deactivatePerson(tenantId, personId, actor))
      .rejects.toMatchObject({ code: 'final_leadership_required' });
    expect(writes.some((w) => w.table === people)).toBe(false);
  });

  it('requires owner replacement instead of standalone Team Lead deactivation', async () => {
    const { service, writes, personId } = setup('team_lead');
    await expect(service.deactivatePerson(tenantId, personId, actor))
      .rejects.toMatchObject({ code: 'owner_replacement_required' });
    expect(writes.some((w) => w.table === people)).toBe(false);
  });
});

describe('HierarchyDeactivationService.deactivateTeam', () => {
  it('moves members to direct Unit placement and makes the old Lead an Employee', async () => {
    const { service, writes } = setup('hrbp');
    await expect(service.deactivateTeam(tenantId, 'team-a', 'become_employee', actor))
      .resolves.toMatchObject({ teamId: 'team-a', leadPersonId: 'lead',
        movedPlacementIds: ['placement-b'] });
    expect(writes.find((w) => w.table === orgEmployeePlacements)?.value)
      .toMatchObject({ teamId: null });
    expect(writes.find((w) => w.table === orgTeams)?.value)
      .toMatchObject({ lifecycleStatus: 'inactive' });
    expect(writes.find((w) => w.table === people)?.value)
      .toMatchObject({ primaryRole: 'employee' });
    expect(writes.find((w) => w.table === auditLogs)?.value)
      .toMatchObject({ action: 'org.team.deactivate', metadata: {
        before: { team: { id: 'team-a', lifecycleStatus: 'active' } },
        after: { team: { id: 'team-a', lifecycleStatus: 'inactive' } },
      } });
  });

  it('deactivates the old Lead only when explicitly chosen', async () => {
    const { service, writes } = setup('hrbp');
    await service.deactivateTeam(tenantId, 'team-a', 'deactivate', actor);
    expect(writes.find((w) => w.table === users)?.value).toMatchObject({ status: 'inactive' });
    expect(writes.find((w) => w.table === orgOnboardingDeliveries)?.value)
      .toMatchObject({ status: 'cancelled' });
  });

  it('rejects an inactive Team before any relationship write', async () => {
    const { service, writes, rows } = setup('hrbp');
    rows.set(orgTeams, [{ id: 'team-a', tenantId, unitId: 'unit-a',
      teamLeadPersonId: 'lead', lifecycleStatus: 'inactive' }]);
    await expect(service.deactivateTeam(tenantId, 'team-a', 'deactivate', actor))
      .rejects.toMatchObject({ code: 'team_deactivation_invalid' });
    expect(writes.some((w) => w.table === orgEmployeePlacements)).toBe(false);
  });
});

describe('HierarchyDeactivationService.transferAndDeactivateUnit', () => {
  it('moves Team identity and members to the target before ending the source Unit', async () => {
    const { service, writes } = setup('hrbp', false, true);
    await expect(service.transferAndDeactivateUnit(
      tenantId, 'unit-a', 'unit-b', 'become_employee', actor,
    )).resolves.toMatchObject({ sourceUnitId: 'unit-a', targetUnitId: 'unit-b',
      managerPersonId: 'manager', movedTeamIds: ['team-a'] });
    const relevant = writes.filter((write) => [orgEmployeePlacements, orgTeams].includes(write.table as never));
    expect(relevant.slice(0, 3).map((write) => write.value)).toEqual([
      expect.objectContaining({ teamId: null, unitId: 'unit-b' }),
      expect.objectContaining({ unitId: 'unit-b' }),
      expect.objectContaining({ teamId: 'team-a' }),
    ]);
    expect(writes.find((write) => write.table === people)?.value)
      .toMatchObject({ primaryRole: 'employee', pulseParticipant: true });
    expect(writes.find((write) => write.table === orgUnits)?.value)
      .toMatchObject({ lifecycleStatus: 'inactive' });
    expect(writes.find((write) => write.table === auditLogs)?.value)
      .toMatchObject({ action: 'org.unit.transfer_deactivate', metadata: {
        before: { unit: { id: 'unit-a', lifecycleStatus: 'active' } },
        after: { unit: { id: 'unit-a', lifecycleStatus: 'inactive' } },
      } });
  });

  it('explicitly deactivates the old Manager and cancels their pending onboarding', async () => {
    const { service, writes } = setup('hrbp', false, true);
    await service.transferAndDeactivateUnit(tenantId, 'unit-a', 'unit-b', 'deactivate', actor);
    expect(writes.find((write) => write.table === users)?.value).toMatchObject({ status: 'inactive' });
    expect(writes.find((write) => write.table === orgOnboardingDeliveries)?.value)
      .toMatchObject({ status: 'cancelled' });
  });

  it('rejects the same target Unit before any structural write', async () => {
    const { service, writes } = setup('hrbp', false, true);
    await expect(service.transferAndDeactivateUnit(
      tenantId, 'unit-a', 'unit-a', 'deactivate', actor,
    )).rejects.toMatchObject({ code: 'unit_deactivation_invalid' });
    expect(writes.some((write) => write.table === orgUnits)).toBe(false);
  });
});
