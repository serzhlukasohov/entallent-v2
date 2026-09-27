import { describe, expect, it } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { assertHierarchyActorAuthorized } from './hierarchy-authorization';

describe('Company Admin hierarchy authorization', () => {
  it('permits a draft setup admin with an active capability and excludes inactive Persons', async () => {
    let predicate: SQL | undefined;
    const query = {
      innerJoin: () => query,
      where: (where: SQL) => { predicate = where; return query; },
      limit: async () => [{ id: 'admin-person' }],
    };
    const tx = { select: () => ({ from: () => query }) };
    await assertHierarchyActorAuthorized(tx as never, 'tenant-1', {
      type: 'company_admin', personId: 'admin-person',
    });
    const sql = new PgDialect().sqlToQuery(predicate!);
    expect(sql.sql).toContain('"people"."lifecycle_status" <>');
    expect(sql.params).toEqual(expect.arrayContaining(['tenant-1', 'admin-person', 'inactive', 'active']));
  });
});
