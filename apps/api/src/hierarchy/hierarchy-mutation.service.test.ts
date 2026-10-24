import { describe, expect, it, vi } from 'vitest';
import { auditLogs, orgEmployeePlacements, orgTeams, orgUnits, people, users } from '@entalent/database';
import { HierarchyMutationService } from './hierarchy-mutation.service';

const tenantId = 'tenant-1';
const actor = { type: 'internal_operator' as const, operatorId: 'operator-1' };

function setup(lastTeamEmployee = false, extraUnitEmployee = false) {
  const rows = new Map<unknown, unknown[]>([
    [people, [
      { id: 'manager-a', tenantId, primaryRole: 'manager', lifecycleStatus: 'active' },
      { id: 'manager-b', tenantId, primaryRole: 'manager', lifecycleStatus: 'active' },
      { id: 'lead-a', tenantId, primaryRole: 'team_lead', lifecycleStatus: 'active' },
      { id: 'employee-a', tenantId, primaryRole: 'employee', lifecycleStatus: 'active' },
      ...lastTeamEmployee ? [] : [{ id: 'employee-b', tenantId, primaryRole: 'employee', lifecycleStatus: 'active' }],
      { id: 'employee-c', tenantId, primaryRole: 'employee', lifecycleStatus: 'active' },
      ...extraUnitEmployee ? [{ id: 'employee-d', tenantId, primaryRole: 'employee', lifecycleStatus: 'active' }] : [],
    ]],
    [orgUnits, [
      { id: 'unit-a', tenantId, managerPersonId: 'manager-a', lifecycleStatus: 'active' },
      { id: 'unit-b', tenantId, managerPersonId: 'manager-b', lifecycleStatus: 'active' },
    ]],
    [orgTeams, [{ id: 'team-a', tenantId, unitId: 'unit-a', teamLeadPersonId: 'lead-a', lifecycleStatus: 'active' }]],
    [orgEmployeePlacements, [
      { id: 'placement-a', tenantId, employeePersonId: 'employee-a', unitId: 'unit-a', teamId: 'team-a', lifecycleStatus: 'active' },
      ...lastTeamEmployee ? [] : [{ id: 'placement-b', tenantId, employeePersonId: 'employee-b', unitId: 'unit-a', teamId: 'team-a', lifecycleStatus: 'active' }],
      { id: 'placement-c', tenantId, employeePersonId: 'employee-c', unitId: 'unit-b', teamId: null, lifecycleStatus: 'active' },
      ...extraUnitEmployee ? [{ id: 'placement-d', tenantId, employeePersonId: 'employee-d', unitId: 'unit-b', teamId: null, lifecycleStatus: 'active' }] : [],
    ]],
  ]);
  const writes: Array<{ table: unknown; value: unknown }> = [];
  const update = vi.fn().mockImplementation((table: unknown) => ({
    set: (value: unknown) => ({ where: () => ({ returning: async () => {
      writes.push({ table, value }); return [{ id: 'placement-a' }];
    } }) }),
  }));
  const insert = vi.fn().mockImplementation((table: unknown) => ({
    values: (value: unknown) => {
      writes.push({ table, value });
      return Object.assign(Promise.resolve(undefined), { returning: async () => [{ id: `audit-${writes.length}` }] });
    },
  }));
  const db = {
    select: () => ({ from: (table: unknown) => ({ where: () => ({
      then: (resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(rows.get(table) ?? []).then(resolve, reject),
    }) }) }),
    update, insert,
    transaction: vi.fn(async (run: (tx: unknown) => Promise<unknown>) => run(db)),
  };
  const publisher = { publish: vi.fn().mockResolvedValue(undefined) };
  return { service: new HierarchyMutationService({ client: db } as never, publisher as never), writes, update, db, publisher };
}

describe('HierarchyMutationService.moveEmployee', () => {
  it('retries a serialization abort without recording a rejected mutation', async () => {
    const { service, writes, db } = setup();
    db.transaction.mockRejectedValueOnce({ code: '40001' });
    await service.moveEmployee(tenantId, 'employee-a', 'unit-b', null, actor);
    expect(db.transaction).toHaveBeenCalledTimes(2);
    expect(writes.filter((write) => write.table === auditLogs).map((write) =>
      (write.value as { action: string }).action)).toEqual(['org.employee.move']);
  });

  it('moves one active placement atomically and audits before and after', async () => {
    const { service, writes, update } = setup();
    await expect(service.moveEmployee(tenantId, 'employee-a', 'unit-b', null, actor))
      .resolves.toEqual({ employeePersonId: 'employee-a', placementId: 'placement-a', unitId: 'unit-b', teamId: null });
    expect(update).toHaveBeenCalledWith(orgEmployeePlacements);
    expect(writes.find((w) => w.table === orgEmployeePlacements)?.value)
      .toMatchObject({ unitId: 'unit-b', teamId: null });
    expect(writes.find((w) => w.table === auditLogs)?.value).toMatchObject({
      action: 'org.employee.move', metadata: {
        before: { unitId: 'unit-a', teamId: 'team-a' },
        after: { unitId: 'unit-b', teamId: null },
      },
    });
  });

  it('rejects a move that would orphan an active Team without writing the placement', async () => {
    const { service, writes, update } = setup(true);
    await expect(service.moveEmployee(tenantId, 'employee-a', 'unit-b', null, actor))
      .rejects.toMatchObject({ code: 'employee_move_invalid', issues: [
        { code: 'active_team_without_employee', entityId: 'team-a' },
      ] });
    expect(update).not.toHaveBeenCalled();
    expect(writes.find((w) => w.table === auditLogs)?.value).toMatchObject({
      action: 'org.employee.move.rejected', reason: 'employee_move_invalid',
    });
  });
});

describe('HierarchyMutationService.promoteTeamLead', () => {
  it('promotes a Team Employee and places the previous Lead as an Employee', async () => {
    const { service, writes } = setup();
    await expect(service.promoteTeamLead(tenantId, 'team-a', 'employee-a', 'become_employee', actor))
      .resolves.toMatchObject({ teamId: 'team-a', newLeadPersonId: 'employee-a',
        previousLeadPersonId: 'lead-a', previousLeadAction: 'become_employee' });
    expect(writes.find((w) => w.table === orgEmployeePlacements &&
      (w.value as { employeePersonId?: string }).employeePersonId === 'lead-a')?.value)
      .toMatchObject({ unitId: 'unit-a', teamId: 'team-a', lifecycleStatus: 'active' });
    expect(writes.filter((w) => w.table === people).map((w) => w.value))
      .toEqual(expect.arrayContaining([{ primaryRole: 'team_lead', updatedAt: expect.any(Date) },
        { primaryRole: 'employee', updatedAt: expect.any(Date) }]));
    expect(writes.find((w) => w.table === orgTeams)?.value)
      .toMatchObject({ teamLeadPersonId: 'employee-a' });
    expect(writes.find((w) => w.table === auditLogs)?.value)
      .toMatchObject({ action: 'org.team_lead.promote', metadata: {
        previousLeadAction: 'become_employee',
        before: { teamLeadPersonId: 'lead-a' }, after: { teamLeadPersonId: 'employee-a' },
      } });
  });

  it('deactivates the previous Lead only when explicitly chosen', async () => {
    const { service, writes } = setup();
    await service.promoteTeamLead(tenantId, 'team-a', 'employee-a', 'deactivate', actor);
    expect(writes.find((w) => w.table === users)?.value).toMatchObject({ status: 'inactive' });
    expect(writes.filter((w) => w.table === orgEmployeePlacements &&
      (w.value as { employeePersonId?: string }).employeePersonId === 'lead-a')).toHaveLength(0);
  });

  it('rejects deactivation when promotion would orphan the Team', async () => {
    const { service, writes, update } = setup(true);
    await expect(service.promoteTeamLead(tenantId, 'team-a', 'employee-a', 'deactivate', actor))
      .rejects.toMatchObject({ code: 'team_lead_promotion_invalid', issues: [
        { code: 'active_team_without_employee', entityId: 'team-a' },
      ] });
    expect(update).not.toHaveBeenCalled();
    expect(writes.find((w) => w.table === auditLogs)?.value)
      .toMatchObject({ action: 'org.team_lead.promote.rejected' });
  });
});

describe('HierarchyMutationService.promoteManager', () => {
  it('promotes a Unit Employee and places the previous Manager as a direct Employee', async () => {
    const { service, writes } = setup();
    await expect(service.promoteManager(tenantId, 'unit-b', 'employee-c', 'become_employee', actor))
      .resolves.toMatchObject({ unitId: 'unit-b', previousManagerPersonId: 'manager-b' });
    expect(writes.find((w) => w.table === orgEmployeePlacements &&
      (w.value as { employeePersonId?: string }).employeePersonId === 'manager-b')?.value)
      .toMatchObject({ unitId: 'unit-b', teamId: null, lifecycleStatus: 'active' });
    expect(writes.filter((w) => w.table === people).map((w) => w.value))
      .toEqual(expect.arrayContaining([
        { primaryRole: 'manager', pulseParticipant: false, updatedAt: expect.any(Date) },
        { primaryRole: 'employee', pulseParticipant: true, updatedAt: expect.any(Date) },
      ]));
    expect(writes.find((w) => w.table === orgUnits)?.value)
      .toMatchObject({ managerPersonId: 'employee-c' });
    expect(writes.find((w) => w.table === auditLogs)?.value)
      .toMatchObject({ action: 'org.manager.promote', metadata: {
        before: { managerPersonId: 'manager-b' }, after: { managerPersonId: 'employee-c' },
      } });
  });

  it('deactivates the previous Manager only when another subordinate remains', async () => {
    const { service, writes } = setup(false, true);
    await service.promoteManager(tenantId, 'unit-b', 'employee-c', 'deactivate', actor);
    expect(writes.find((w) => w.table === users)?.value).toMatchObject({ status: 'inactive' });
    expect(writes.find((w) => w.table === auditLogs)?.value)
      .toMatchObject({ action: 'org.manager.promote', metadata: { previousManagerAction: 'deactivate' } });
  });

  it('rejects a promotion that would leave the Unit without a subordinate', async () => {
    const { service, writes, update } = setup();
    await expect(service.promoteManager(tenantId, 'unit-b', 'employee-c', 'deactivate', actor))
      .rejects.toMatchObject({ code: 'manager_promotion_invalid', issues: [
        { code: 'active_unit_without_subordinate', entityId: 'unit-b' },
      ] });
    expect(update).not.toHaveBeenCalled();
    expect(writes.find((w) => w.table === auditLogs)?.value)
      .toMatchObject({ action: 'org.manager.promote.rejected' });
  });
});

describe('HierarchyMutationService onboarding events', () => {
  const auditId = (writes: Array<{ table: unknown; value: unknown }>) =>
    `audit-${writes.findIndex((w) => w.table === auditLogs) + 1}`;

  it('publishes role changes for a promoted Manager and a previous Manager who becomes an Employee', async () => {
    const { service, writes, publisher } = setup();
    await service.promoteManager(tenantId, 'unit-b', 'employee-c', 'become_employee', actor);
    const id = auditId(writes);
    expect(publisher.publish).toHaveBeenCalledTimes(1);
    expect(publisher.publish.mock.calls[0][0]).toBe(tenantId);
    expect(publisher.publish.mock.calls[0][1]).toEqual(expect.arrayContaining([
      { personId: 'employee-c', auditLogId: id, event: { type: 'role_changed', from: 'employee', to: 'manager' } },
      { personId: 'manager-b', auditLogId: id, event: { type: 'role_changed', from: 'manager', to: 'employee' } },
    ]));
    expect(publisher.publish.mock.calls[0][1]).toHaveLength(2);
  });

  it('publishes deactivated for a previous Manager who is deactivated', async () => {
    const { service, writes, publisher } = setup(false, true);
    await service.promoteManager(tenantId, 'unit-b', 'employee-c', 'deactivate', actor);
    const id = auditId(writes);
    expect(publisher.publish.mock.calls[0][1]).toEqual(expect.arrayContaining([
      { personId: 'employee-c', auditLogId: id, event: { type: 'role_changed', from: 'employee', to: 'manager' } },
      { personId: 'manager-b', auditLogId: id, event: { type: 'deactivated' } },
    ]));
    expect(publisher.publish.mock.calls[0][1]).toHaveLength(2);
  });

  it('publishes role changes for a promoted Team Lead and a previous Lead who becomes an Employee', async () => {
    const { service, writes, publisher } = setup();
    await service.promoteTeamLead(tenantId, 'team-a', 'employee-a', 'become_employee', actor);
    const id = auditId(writes);
    expect(publisher.publish.mock.calls[0][1]).toEqual(expect.arrayContaining([
      { personId: 'employee-a', auditLogId: id, event: { type: 'role_changed', from: 'employee', to: 'team_lead' } },
      { personId: 'lead-a', auditLogId: id, event: { type: 'role_changed', from: 'team_lead', to: 'employee' } },
    ]));
    expect(publisher.publish.mock.calls[0][1]).toHaveLength(2);
  });

  it('publishes deactivated for a previous Lead who is deactivated', async () => {
    const { service, writes, publisher } = setup();
    await service.promoteTeamLead(tenantId, 'team-a', 'employee-a', 'deactivate', actor);
    const id = auditId(writes);
    expect(publisher.publish.mock.calls[0][1]).toEqual(expect.arrayContaining([
      { personId: 'lead-a', auditLogId: id, event: { type: 'deactivated' } },
    ]));
  });

  it('publishes nothing when the transaction is rejected', async () => {
    const { service, publisher } = setup(true);
    await expect(service.promoteTeamLead(tenantId, 'team-a', 'employee-a', 'deactivate', actor)).rejects.toThrow();
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it('publishes nothing for a plain employee move', async () => {
    const { service, publisher } = setup();
    await service.moveEmployee(tenantId, 'employee-a', 'unit-b', null, actor);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it('does not fail the mutation when publishing throws', async () => {
    const { service, publisher } = setup();
    publisher.publish.mockRejectedValue(new Error('redis down'));
    await expect(service.promoteTeamLead(tenantId, 'team-a', 'employee-a', 'become_employee', actor))
      .resolves.toMatchObject({ teamId: 'team-a' });
  });
});
