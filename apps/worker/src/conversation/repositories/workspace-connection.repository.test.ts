import { describe, expect, it } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { WorkspaceConnectionRepository } from './workspace-connection.repository';

describe('WorkspaceConnectionRepository', () => {
  it('selects only linked Slack accounts for outbound delivery', async () => {
    let predicate: SQL | undefined;
    const query = {
      where: (value: SQL) => { predicate = value; return query; },
      limit: async () => [{ externalWorkspaceId: 'T-1', externalUserId: 'U-1' }],
    };
    const repo = new WorkspaceConnectionRepository({
      client: { select: () => ({ from: () => query }) },
    } as never, {} as never);
    await expect(repo.findSlackAccountByUserId('person-1', 'tenant-1', 'T-1'))
      .resolves.toEqual({ externalWorkspaceId: 'T-1', externalUserId: 'U-1' });
    const sql = new PgDialect().sqlToQuery(predicate!);
    expect(sql.sql).toContain('"channel_accounts"."link_status"');
    expect(sql.params).toContain('linked');
  });
});
