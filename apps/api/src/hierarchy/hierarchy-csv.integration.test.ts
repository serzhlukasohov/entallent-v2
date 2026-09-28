import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import {
  auditLogs, createDbClient, orgAdvisorAssignments, orgEmployeePlacements,
  orgHrbpScopes, orgPersonCapabilities, orgTeams, orgUnits, people, tenants, users,
  type DbClient,
} from '@entalent/database';
import { HierarchyCsvValidationError, HierarchyDraftService } from './hierarchy-draft.service';

const databaseUrl = process.env['DATABASE_URL'];
const localDatabase = databaseUrl && /^postgres(?:ql)?:\/\/(?:[^@]+@)?(?:127\.0\.0\.1|localhost):\d+\//.test(databaseUrl);
const headers = ['customerEmployeeId', 'workEmail', 'displayName', 'primaryRole', 'customerUnitKey',
  'unitName', 'customerTeamKey', 'teamName', 'assignedUnitKeys', 'hrbpScopeMode', 'companyAdmin'];
const csv = (rows: string[][]): string => [headers, ...rows].map((row) => row.join(',')).join('\n');
const row = (id: string, role: string, fields: Partial<Record<(typeof headers)[number], string>> = {}): string[] => [
  id, `${id.toLowerCase()}@fixture.test`, id, role,
  fields['customerUnitKey'] ?? '', fields['unitName'] ?? '', fields['customerTeamKey'] ?? '',
  fields['teamName'] ?? '', fields['assignedUnitKeys'] ?? '', fields['hrbpScopeMode'] ?? '',
  fields['companyAdmin'] ?? '',
];

describe.skipIf(!localDatabase)('append-only hierarchy CSV on migrated local PostgreSQL', () => {
  const tenantId = randomUUID();
  const actor = { type: 'internal_operator' as const, operatorId: 'csv-integration' };
  let client: DbClient;
  let service: HierarchyDraftService;

  beforeAll(async () => {
    client = createDbClient(databaseUrl!);
    service = new HierarchyDraftService({ client: client.db } as never);
    await client.db.insert(tenants).values({ id: tenantId, name: 'CSV integration fixture' });
  });

  afterAll(async () => {
    if (!client) return;
    await client.db.delete(tenants).where(eq(tenants.id, tenantId));
    await client.sql.end();
  });

  it('imports all roles, appends to existing keys, returns all validation errors, and rolls back persistence failure', async () => {
    const first = csv([
      row('M-1', 'manager', { customerUnitKey: 'U-1', unitName: 'Unit One', companyAdmin: 'true' }),
      row('TL-1', 'team_lead', { customerUnitKey: 'U-1', unitName: 'Unit One', customerTeamKey: 'T-1', teamName: 'Team One' }),
      row('E-1', 'employee', { customerUnitKey: 'U-1', unitName: 'Unit One', customerTeamKey: 'T-1', teamName: 'Team One' }),
      row('E-2', 'employee', { customerUnitKey: 'U-1', unitName: 'Unit One' }),
      row('HR-1', 'hr', { assignedUnitKeys: 'U-1' }),
      row('HRBP-1', 'hrbp', { hrbpScopeMode: 'all_units' }),
      row('L-1', 'leadership'),
    ]);
    expect((await service.previewCsv(tenantId, first, actor)).ok).toBe(true);
    const imported = await service.importCsv(tenantId, first, actor);
    expect(imported.personIds).toHaveLength(7);
    expect(imported.unitIds).toHaveLength(1);
    expect(imported.teamIds).toHaveLength(1);
    expect(await count(people)).toBe(7);
    expect(await count(orgEmployeePlacements)).toBe(2);
    expect(await count(orgAdvisorAssignments)).toBe(1);
    expect(await count(orgHrbpScopes)).toBe(1);
    expect(await count(orgPersonCapabilities)).toBe(1);
    expect(await count(orgUnits)).toBe(1);
    expect(await count(orgTeams)).toBe(1);

    const second = csv([row('E-3', 'employee', { customerUnitKey: 'U-1', customerTeamKey: 'T-1' })]);
    const appended = await service.importCsv(tenantId, second, actor);
    expect(appended.personIds).toHaveLength(1);
    expect(appended.unitIds).toEqual([]);
    expect(appended.teamIds).toEqual([]);
    expect(await count(people)).toBe(8);
    expect(await count(orgEmployeePlacements)).toBe(3);

    const invalid = csv([
      row('E-3', 'employee', { customerUnitKey: 'U-1' }),
      row('E-4', 'employee', { customerUnitKey: 'UNKNOWN' }),
    ]);
    try {
      await service.importCsv(tenantId, invalid, actor);
      throw new Error('expected validation rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(HierarchyCsvValidationError);
      expect((error as HierarchyCsvValidationError).errors.map((item) => item.code))
        .toEqual(expect.arrayContaining(['person_exists', 'email_exists', 'unknown_unit']));
    }
    expect(await count(people)).toBe(8);
    expect(await count(users)).toBe(8);

    const failingService = new HierarchyDraftService({ client: {
      transaction: (run: (tx: never) => Promise<unknown>, config: unknown) =>
        client.db.transaction(async (tx) => {
          await run(tx as never);
          throw new Error('synthetic_commit_failure');
        }, config as never),
      insert: client.db.insert.bind(client.db),
    } } as never);
    await expect(failingService.importCsv(tenantId,
      csv([row('E-5', 'employee', { customerUnitKey: 'U-1' })]), actor))
      .rejects.toThrow('synthetic_commit_failure');
    expect(await count(people)).toBe(8);
    expect(await count(users)).toBe(8);
    expect(await count(orgEmployeePlacements)).toBe(3);
    const [rejections] = await client.db.select({ count: sql<number>`count(*)::int` }).from(auditLogs)
      .where(eq(auditLogs.tenantId, tenantId));
    expect(rejections?.count).toBe(4);
  });

  async function count(table: typeof people | typeof users | typeof orgEmployeePlacements |
    typeof orgAdvisorAssignments | typeof orgHrbpScopes | typeof orgPersonCapabilities |
    typeof orgUnits | typeof orgTeams): Promise<number> {
    const [result] = await client.db.select({ count: sql<number>`count(*)::int` }).from(table)
      .where(eq(table.tenantId, tenantId));
    return result?.count ?? 0;
  }
});
