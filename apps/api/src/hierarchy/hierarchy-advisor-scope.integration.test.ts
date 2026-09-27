import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDbClient, orgAdvisorAssignments, orgHrbpScopes,
  orgUnits, people, tenants, users, type DbClient } from '@entalent/database';
import { HierarchyAdvisorScopeService } from './hierarchy-advisor-scope.service';
import { HierarchyDraftService } from './hierarchy-draft.service';

const databaseUrl = process.env['DATABASE_URL'];
const localDatabase = databaseUrl && /^postgres(?:ql)?:\/\/(?:[^@]+@)?(?:127\.0\.0\.1|localhost):\d+\//.test(databaseUrl);

describe.skipIf(!localDatabase)('draft advisor scope correction on migrated local PostgreSQL', () => {
  const tenantId = randomUUID();
  const personId = randomUUID();
  const unitId = randomUUID();
  const actor = { type: 'internal_operator' as const, operatorId: 'scope-integration' };
  let client: DbClient;

  beforeAll(async () => {
    client = createDbClient(databaseUrl!);
    await client.db.insert(tenants).values({ id: tenantId, name: 'Advisor scope fixture' });
    await client.db.insert(users).values({ id: personId, tenantId, status: 'inactive' });
    await client.db.insert(people).values({ id: personId, tenantId,
      customerEmployeeId: 'HRBP-1', workEmail: 'hrbp@fixture.test', displayName: 'HRBP',
      primaryRole: 'hrbp', pulseParticipant: false, lifecycleStatus: 'draft' });
    await client.db.insert(orgUnits).values({ id: unitId, tenantId, customerUnitKey: 'U-1', name: 'Unit' });
    await client.db.insert(orgAdvisorAssignments).values({ tenantId, advisorPersonId: personId,
      unitId, lifecycleStatus: 'draft' });
    await client.db.insert(orgHrbpScopes).values({ tenantId, personId,
      scopeMode: 'selected_units', lifecycleStatus: 'draft' });
  });

  afterAll(async () => {
    if (!client) return;
    await client.db.delete(tenants).where(eq(tenants.id, tenantId));
    await client.sql.end();
  });

  it('clears selected scope before changing a draft HRBP to Leadership', async () => {
    const db = { client: client.db } as never;
    const advisorScopes = new HierarchyAdvisorScopeService(db);
    const drafts = new HierarchyDraftService(db);
    await expect(drafts.updatePerson(tenantId, personId, {
      customerEmployeeId: 'HRBP-1', workEmail: 'hrbp@fixture.test',
      displayName: 'HRBP', primaryRole: 'leadership',
    }, actor)).rejects.toMatchObject({ code: 'advisor_scope_reference' });

    await expect(advisorScopes.replaceScope(tenantId, personId, {
      scopeMode: 'selected_units', unitIds: [],
    }, actor)).resolves.toMatchObject({ lifecycleStatus: 'inactive', unitIds: [] });
    expect((await client.db.select().from(orgAdvisorAssignments)
      .where(eq(orgAdvisorAssignments.advisorPersonId, personId)))[0]?.lifecycleStatus).toBe('inactive');
    expect((await client.db.select().from(orgHrbpScopes)
      .where(eq(orgHrbpScopes.personId, personId)))[0]?.lifecycleStatus).toBe('inactive');
    await expect(drafts.updatePerson(tenantId, personId, {
      customerEmployeeId: 'HRBP-1', workEmail: 'hrbp@fixture.test',
      displayName: 'HRBP', primaryRole: 'leadership',
    }, actor)).resolves.toMatchObject({ primaryRole: 'leadership', lifecycleStatus: 'draft' });
  });
});
