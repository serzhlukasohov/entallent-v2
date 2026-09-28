import { describe, expect, it, vi } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { channelAccounts, teamMemberships, teams, tenants } from '@entalent/database';
import { readLegacyHierarchyInput } from './legacy-reconciliation.read';
import { reconcileLegacyHierarchy } from './legacy-reconciliation';

const tenantId = 'tenant-1';

function oldSchemaReader(flags: [boolean, boolean, boolean, boolean, boolean]) {
  const seenTables: unknown[] = [];
  const selections: Array<Record<string, unknown>> = [];
  const rows = new Map<unknown, unknown[]>([
    [tenants, [{ id: tenantId }]],
    [teams, [{ id: 'legacy-team', name: 'Original Team', managerSlackUserId: 'U-MANAGER' }]],
    [teamMemberships, [{ teamId: 'legacy-team', userId: 'legacy-user', role: 'member',
      leftAt: null, userTenantId: tenantId }]],
    [channelAccounts, [{ userId: 'legacy-manager', externalWorkspaceId: 'T-1',
      externalUserId: 'U-MANAGER', linkStatus: 'linked' }]],
  ]);
  const tx = {
    execute: vi.fn().mockResolvedValue([{
      peopleReady: flags[0], teamsReady: flags[1],
      unitsReady: flags[2], placementsReady: flags[3],
      linkStatusReady: flags[4],
    }]),
    select: (fields: Record<string, unknown>) => {
      selections.push(fields);
      return { from: (table: unknown) => {
      seenTables.push(table);
      const query = {
        leftJoin: () => query,
        where: () => query,
        limit: async () => rows.get(table) ?? [],
        then: (resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) =>
          Promise.resolve(rows.get(table) ?? []).then(resolve, reject),
      };
      return query;
    } };
    },
  };
  return { tx, seenTables, selections, rows };
}

describe('readLegacyHierarchyInput', () => {
  it('reports old schema data without querying tables that have not been migrated', async () => {
    const { tx, seenTables, selections } = oldSchemaReader([false, false, false, false, false]);
    const input = await readLegacyHierarchyInput(tx as never, tenantId);
    expect(input).toMatchObject({ schemaReady: false,
      legacyTeams: [{ id: 'legacy-team' }], memberships: [{ userId: 'legacy-user' }],
      people: [], orgTeams: [], orgUnits: [], placements: [],
    });
    expect(seenTables).toEqual([tenants, teams, teamMemberships, channelAccounts]);
    const accountSelection = selections.find((fields) => 'externalWorkspaceId' in fields);
    expect(new PgDialect().sqlToQuery(accountSelection?.linkStatus as SQL).sql).toBe("'linked'");
    expect(reconcileLegacyHierarchy(input).schemaReady).toBe(false);
  });

  it('fails closed when the new hierarchy schema is only partly present', async () => {
    const { tx, seenTables } = oldSchemaReader([true, false, false, false, false]);
    await expect(readLegacyHierarchyInput(tx as never, tenantId))
      .rejects.toThrow('hierarchy_schema_partially_applied');
    expect(seenTables).toEqual([]);
  });

  it('fails closed when hierarchy tables exist but Slack link status is missing', async () => {
    const { tx, seenTables } = oldSchemaReader([true, true, true, true, false]);
    await expect(readLegacyHierarchyInput(tx as never, tenantId))
      .rejects.toThrow('hierarchy_schema_partially_applied');
    expect(seenTables).toEqual([]);
  });

  it('rejects an unknown tenant instead of returning an empty approval report', async () => {
    const { tx, rows, seenTables } = oldSchemaReader([false, false, false, false, false]);
    rows.set(tenants, []);
    await expect(readLegacyHierarchyInput(tx as never, tenantId)).rejects.toThrow('tenant_not_found');
    expect(seenTables).toEqual([tenants]);
  });
});
