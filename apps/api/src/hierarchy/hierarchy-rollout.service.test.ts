import { describe, expect, it } from 'vitest';
import {
  auditLogs, channelAccounts, orgAdvisorAssignments, orgEmployeePlacements, orgHrbpScopes, orgOnboardingDeliveries, orgTeams, orgUnits,
  people, users, workspaceConnections,
} from '@entalent/database';
import { HierarchyRolloutError, HierarchyRolloutService } from './hierarchy-rollout.service';

const tenantId = 'tenant-1';
const unitId = 'unit-1';
const workspaceId = 'T-1';
const actor = { type: 'internal_operator' as const, operatorId: 'operator-1' };

function setup(linkedIds: string[], withAdvisors = false) {
  const updates: Array<{ table: unknown; values: unknown }> = [];
  const audit: unknown[] = [];
  const onboarding: unknown[] = [];
  const rowsFor = (table: unknown, fields?: Record<string, unknown>): unknown[] => {
    if (table === workspaceConnections) return [{ id: 'workspace-1' }];
    if (table === orgUnits) return [{ id: unitId, tenantId, lifecycleStatus: 'draft', managerPersonId: 'manager-1' }];
    if (table === orgTeams) return [];
    if (table === orgEmployeePlacements) return [
      { id: 'placement-ready', tenantId, unitId, teamId: null, employeePersonId: 'employee-ready', lifecycleStatus: 'draft' },
      { id: 'placement-pending', tenantId, unitId, teamId: null, employeePersonId: 'employee-pending', lifecycleStatus: 'draft' },
    ];
    if (table === orgAdvisorAssignments) return withAdvisors
      ? [{ id: 'assignment-hr', advisorPersonId: 'hr-1' }] : [];
    if (table === orgHrbpScopes) return withAdvisors
      ? [{ personId: 'hrbp-1', scopeMode: 'all_units' }] : [];
    if (table === people && fields && Object.keys(fields).length === 1 && 'id' in fields) {
      return withAdvisors ? [{ id: 'leadership-1' }] : [];
    }
    if (table === people) return [
      { id: 'manager-1', tenantId, primaryRole: 'manager', lifecycleStatus: 'draft' },
      { id: 'employee-ready', tenantId, primaryRole: 'employee', lifecycleStatus: 'draft' },
      { id: 'employee-pending', tenantId, primaryRole: 'employee', lifecycleStatus: 'draft' },
      ...withAdvisors ? [
        { id: 'hr-1', tenantId, primaryRole: 'hr', lifecycleStatus: 'draft' },
        { id: 'hrbp-1', tenantId, primaryRole: 'hrbp', lifecycleStatus: 'draft' },
        { id: 'leadership-1', tenantId, primaryRole: 'leadership', lifecycleStatus: 'draft' },
      ] : [],
    ];
    if (table === users) return [
      { id: 'manager-1', status: 'inactive', deletedAt: null },
      { id: 'employee-ready', status: 'inactive', deletedAt: null },
      { id: 'employee-pending', status: 'inactive', deletedAt: null },
      ...withAdvisors ? [
        { id: 'hr-1', status: 'inactive', deletedAt: null },
        { id: 'hrbp-1', status: 'inactive', deletedAt: null },
        { id: 'leadership-1', status: 'inactive', deletedAt: null },
      ] : [],
    ];
    if (table === channelAccounts) return linkedIds.map((userId) => ({ userId }));
    return [];
  };
  const tx = {
    select: (fields?: Record<string, unknown>) => ({ from: (table: unknown) => {
      const rows = rowsFor(table, fields);
      const query = {
        where: () => query,
        for: () => query,
        limit: async (count: number) => rows.slice(0, count),
        then: (resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) =>
          Promise.resolve(rows).then(resolve, reject),
      };
      return query;
    } }),
    update: (table: unknown) => ({ set: (values: unknown) => ({ where: async () => { updates.push({ table, values }); } }) }),
    insert: (table: unknown) => ({ values: (value: unknown) => {
      if (table === auditLogs) audit.push(value);
      if (table === orgOnboardingDeliveries) onboarding.push(value);
      return { onConflictDoNothing: async () => undefined };
    } }),
  };
  const client = {
    transaction: async (run: (transaction: typeof tx) => Promise<unknown>) => run(tx),
    insert: tx.insert,
  };
  return { service: new HierarchyRolloutService({ client } as never), updates, audit, onboarding };
}

function setupBatch(linkedIds: string[]) {
  const updates: unknown[] = [];
  const onboarding: Array<Array<{ personId: string; unitId: string }>> = [];
  let selectedUnit = '';
  let unitReads = 0;
  const rowsFor = (table: unknown, fields?: Record<string, unknown>): unknown[] => {
    if (table === workspaceConnections) return [{ id: 'workspace-1' }];
    if (table === orgUnits) {
      selectedUnit = `unit-${++unitReads}`;
      return [{ id: selectedUnit, tenantId, lifecycleStatus: 'draft', managerPersonId: `manager-${unitReads}` }];
    }
    if (table === orgTeams || table === orgAdvisorAssignments || table === orgHrbpScopes) return [];
    if (table === orgEmployeePlacements) return [{ id: `placement-${selectedUnit}`, tenantId,
      unitId: selectedUnit, teamId: null, employeePersonId: `employee-${unitReads}`, lifecycleStatus: 'draft' }];
    if (table === people && fields && Object.keys(fields).length === 1 && 'id' in fields) {
      return [{ id: 'leadership-1' }];
    }
    if (table === people) return [
      { id: `manager-${unitReads}`, tenantId, primaryRole: 'manager', lifecycleStatus: 'draft' },
      { id: `employee-${unitReads}`, tenantId, primaryRole: 'employee', lifecycleStatus: 'draft' },
      { id: 'leadership-1', tenantId, primaryRole: 'leadership', lifecycleStatus: 'draft' },
    ];
    if (table === users) return [`manager-${unitReads}`, `employee-${unitReads}`, 'leadership-1']
      .map((id) => ({ id, status: 'inactive', deletedAt: null }));
    if (table === channelAccounts) return linkedIds.map((userId) => ({ userId }));
    return [];
  };
  const tx = {
    select: (fields?: Record<string, unknown>) => ({ from: (table: unknown) => {
      const rows = rowsFor(table, fields);
      const query = { where: () => query, for: () => query,
        limit: async (count: number) => rows.slice(0, count),
        then: (resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) =>
          Promise.resolve(rows).then(resolve, reject) };
      return query;
    } }),
    update: (table: unknown) => ({ set: () => ({ where: async () => { updates.push(table); } }) }),
    insert: (table: unknown) => ({ values: (value: unknown) => {
      if (table === orgOnboardingDeliveries) onboarding.push(value as Array<{ personId: string; unitId: string }>);
      return { onConflictDoNothing: async () => undefined };
    } }),
  };
  const client = { transaction: async (run: (transaction: typeof tx) => Promise<unknown>) => run(tx), insert: tx.insert };
  return { service: new HierarchyRolloutService({ client } as never), updates, onboarding };
}

describe('HierarchyRolloutService', () => {
  it('activates only linked ready Persons and their placement in one transaction', async () => {
    const { service, updates, audit, onboarding } = setup(['manager-1', 'employee-ready']);
    await expect(service.activateUnit(tenantId, unitId, workspaceId, actor)).resolves.toMatchObject({
      unitId,
      activatedPersonIds: ['employee-ready', 'manager-1'],
      activatedTeamIds: [],
      pendingPersonIds: ['employee-pending'],
    });
    expect(updates.map((write) => write.table)).toEqual([users, people, orgEmployeePlacements, orgUnits]);
    expect(onboarding).toEqual([[
      expect.objectContaining({ personId: 'employee-ready', unitId, externalWorkspaceId: workspaceId }),
      expect.objectContaining({ personId: 'manager-1', unitId, externalWorkspaceId: workspaceId }),
    ]]);
    expect(audit).toContainEqual(expect.objectContaining({ action: 'org.unit.rollout',
      metadata: expect.objectContaining({
        affectedPersonIds: ['employee-ready', 'manager-1'],
        pendingPersonIds: ['employee-pending'],
        before: expect.objectContaining({ unitLifecycleStatus: 'draft' }),
        after: expect.objectContaining({ unitLifecycleStatus: 'active' }),
      }),
    }));
  });

  it('audits an invalid Unit selection before any transaction', async () => {
    const { service, updates, audit } = setup(['manager-1', 'employee-ready']);
    await expect(service.activateUnits(tenantId, [], workspaceId, actor))
      .rejects.toMatchObject({ code: 'invalid_unit_selection' });
    expect(updates).toEqual([]);
    expect(audit).toContainEqual(expect.objectContaining({
      action: 'org.unit.rollout.rejected', reason: 'invalid_unit_selection',
      resourceId: 'empty_selection',
    }));
  });

  it('rejects a Unit without a linked Manager before changing lifecycle state', async () => {
    const { service, updates, audit } = setup(['employee-ready']);
    await expect(service.activateUnit(tenantId, unitId, workspaceId, actor))
      .rejects.toMatchObject({ code: 'unit_not_ready' } satisfies Partial<HierarchyRolloutError>);
    expect(updates).toEqual([]);
    expect(audit).toContainEqual(expect.objectContaining({ action: 'org.unit.rollout.rejected', reason: 'unit_not_ready' }));
  });

  it('activates linked scoped HR and Leadership while retaining an unlinked HRBP draft', async () => {
    const { service, updates, onboarding } = setup([
      'manager-1', 'employee-ready', 'hr-1', 'leadership-1',
    ], true);
    await expect(service.activateUnit(tenantId, unitId, workspaceId, actor)).resolves.toMatchObject({
      activatedPersonIds: ['employee-ready', 'hr-1', 'leadership-1', 'manager-1'],
      pendingPersonIds: ['employee-pending', 'hrbp-1'],
    });
    expect(updates.map((write) => write.table)).toContain(orgAdvisorAssignments);
    expect(updates.map((write) => write.table)).not.toContain(orgHrbpScopes);
    expect(onboarding[0]).toEqual(expect.arrayContaining([
      expect.objectContaining({ personId: 'hr-1' }),
      expect.objectContaining({ personId: 'leadership-1' }),
    ]));
  });

  it('activates a linked all-Unit HRBP scope', async () => {
    const { service, updates } = setup([
      'manager-1', 'employee-ready', 'hrbp-1',
    ], true);
    await expect(service.activateUnit(tenantId, unitId, workspaceId, actor)).resolves.toMatchObject({
      activatedPersonIds: ['employee-ready', 'hrbp-1', 'manager-1'],
    });
    expect(updates.find((write) => write.table === orgHrbpScopes)?.values)
      .toMatchObject({ lifecycleStatus: 'active' });
  });

  it('activates two selected Units in one transaction and queues shared Leadership once', async () => {
    const { service, onboarding } = setupBatch([
      'manager-1', 'employee-1', 'manager-2', 'employee-2', 'leadership-1',
    ]);
    const results = await service.activateUnits(tenantId, ['unit-2', 'unit-1'], workspaceId, actor);
    expect(results.map((row) => row.unitId)).toEqual(['unit-1', 'unit-2']);
    expect(results[0]?.activatedPersonIds).toContain('leadership-1');
    expect(results[1]?.activatedPersonIds).not.toContain('leadership-1');
    expect(onboarding.flat().map((row) => row.personId).sort()).toEqual([
      'employee-1', 'employee-2', 'leadership-1', 'manager-1', 'manager-2',
    ]);
  });

  it('writes nothing when the second selected Unit is not ready', async () => {
    const { service, updates, onboarding } = setupBatch([
      'manager-1', 'employee-1', 'employee-2', 'leadership-1',
    ]);
    await expect(service.activateUnits(tenantId, ['unit-1', 'unit-2'], workspaceId, actor))
      .rejects.toMatchObject({ code: 'unit_not_ready' });
    expect(updates).toEqual([]);
    expect(onboarding).toEqual([]);
  });
});
