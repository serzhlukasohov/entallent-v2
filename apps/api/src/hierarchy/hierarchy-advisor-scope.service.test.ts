import { describe, expect, it } from 'vitest';
import { auditLogs, orgAdvisorAssignments, orgHrbpScopes, orgUnits, people } from '@entalent/database';
import { HierarchyAdvisorScopeService } from './hierarchy-advisor-scope.service';

const tenantId = 'tenant-1';
const personId = '00000000-0000-4000-8000-000000000001';
const unitA = '00000000-0000-4000-8000-000000000002';
const actor = { type: 'internal_operator' as const, operatorId: 'operator-1' };

function setup(role: 'hr' | 'hrbp', existingUnitIds: string[] = [], lifecycle = 'active') {
  const rows = new Map<unknown, unknown[]>([
    [people, [{ role, lifecycle }]],
    [orgUnits, [{ id: unitA, lifecycle: 'active' }]],
    [orgAdvisorAssignments, existingUnitIds.map((unitId, index) => ({
      id: `assignment-${index}`, unitId, lifecycle: 'active',
    }))],
    [orgHrbpScopes, role === 'hrbp' ? [{ mode: 'selected_units', lifecycle: 'active' }] : []],
  ]);
  const writes: Array<{ table: unknown; value: unknown }> = [];
  const db = {
    select: () => ({ from: (table: unknown) => ({ where: () => {
      const result = Promise.resolve(rows.get(table) ?? []);
      return { then: result.then.bind(result), for: () => ({
        then: result.then.bind(result), limit: () => result,
      }) };
    } }) }),
    update: (table: unknown) => ({ set: (value: unknown) => ({ where: async () => {
      writes.push({ table, value });
    } }) }),
    insert: (table: unknown) => ({ values: (value: unknown) => {
      writes.push({ table, value });
      return { then: (resolve: (value: unknown) => unknown) => Promise.resolve(undefined).then(resolve),
        onConflictDoUpdate: async (args: unknown) => { writes.push({ table, value: args }); } };
    } }),
    transaction: async (run: (tx: unknown) => Promise<unknown>) => run(db),
  };
  return { service: new HierarchyAdvisorScopeService({ client: db } as never), rows, writes };
}

describe('HierarchyAdvisorScopeService.replaceScope', () => {
  it('assigns an active HR to selected Units without changing line-management tables', async () => {
    const { service, writes } = setup('hr');
    await expect(service.replaceScope(tenantId, personId, {
      scopeMode: 'selected_units', unitIds: [unitA],
    }, actor)).resolves.toMatchObject({ scopeMode: 'selected_units', unitIds: [unitA], lifecycleStatus: 'active' });
    expect(writes.find((w) => w.table === orgAdvisorAssignments)?.value)
      .toMatchObject([{ advisorPersonId: personId, unitId: unitA, lifecycleStatus: 'active' }]);
    expect(writes.find((w) => w.table === auditLogs)?.value)
      .toMatchObject({ action: 'org.advisor_scope.replace', metadata: {
        before: { unitIds: [] }, after: { unitIds: [unitA] },
      } });
    expect(writes.some((w) => w.table === orgHrbpScopes)).toBe(false);
  });

  it('sets HRBP all-Unit scope and ends old explicit assignments', async () => {
    const { service, writes } = setup('hrbp', [unitA]);
    await service.replaceScope(tenantId, personId, { scopeMode: 'all_units', unitIds: [] }, actor);
    expect(writes.find((w) => w.table === orgAdvisorAssignments)?.value)
      .toMatchObject({ lifecycleStatus: 'inactive' });
    expect(writes.filter((w) => w.table === orgHrbpScopes).map((w) => w.value))
      .toEqual(expect.arrayContaining([expect.objectContaining({ scopeMode: 'all_units' })]));
  });

  it('rejects an invalid active selected scope before changing assignments', async () => {
    const { service, writes } = setup('hrbp');
    await expect(service.replaceScope(tenantId, personId, {
      scopeMode: 'selected_units', unitIds: [],
    }, actor)).rejects.toMatchObject({ code: 'selected_units_required' });
    expect(writes.filter((w) => w.table === orgAdvisorAssignments)).toHaveLength(0);
    expect(writes.find((w) => w.table === auditLogs)?.value)
      .toMatchObject({ action: 'org.advisor_scope.replace.rejected', reason: 'selected_units_required' });
  });

  it('clears a draft HRBP selected scope so the draft role can be corrected', async () => {
    const { service, writes } = setup('hrbp', [unitA], 'draft');
    await expect(service.replaceScope(tenantId, personId, {
      scopeMode: 'selected_units', unitIds: [],
    }, actor)).resolves.toMatchObject({ unitIds: [], lifecycleStatus: 'inactive' });
    expect(writes.find((w) => w.table === orgAdvisorAssignments)?.value)
      .toMatchObject({ lifecycleStatus: 'inactive' });
    expect(writes.filter((w) => w.table === orgHrbpScopes).map((w) => w.value))
      .toEqual(expect.arrayContaining([expect.objectContaining({ lifecycleStatus: 'inactive' })]));
  });

  it('rejects Unit IDs not found in this tenant', async () => {
    const { service, rows, writes } = setup('hr');
    rows.set(orgUnits, []);
    await expect(service.replaceScope(tenantId, personId, {
      unitIds: [unitA],
    }, actor)).rejects.toMatchObject({ code: 'eligible_units_required' });
    expect(writes.some((w) => w.table === orgAdvisorAssignments)).toBe(false);
  });
});
