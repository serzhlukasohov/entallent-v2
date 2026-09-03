import { describe, expect, it, vi } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { TeamRepository } from './team.repository';

function compileSql(value: unknown) {
  return new PgDialect().sqlToQuery(value as SQL);
}

describe('TeamRepository', () => {
  it('finds a member team only inside the requested tenant', async () => {
    const limit = vi.fn().mockResolvedValue([{ teamId: 'team-1' }]);
    const where = vi.fn((_value: unknown) => ({ limit }));
    const innerJoin = vi.fn((_table: unknown, _on: unknown) => ({ where }));
    const from = vi.fn(() => ({ innerJoin }));
    const select = vi.fn(() => ({ from }));
    const repository = new TeamRepository({ client: { select } } as never);
    vi.spyOn(repository, 'findTeamById').mockResolvedValue({
      teamId: 'team-1',
      managerSlackUserId: null,
      activeTeamSize: 1,
      memberUserIds: ['user-1'],
    });

    await repository.findTeamByMemberId('user-1', 'tenant-1');

    expect(innerJoin).toHaveBeenCalledOnce();
    const query = compileSql(where.mock.calls[0]?.[0]);
    expect(query.sql).toContain('"team_memberships"."user_id"');
    expect(query.sql).toContain('"teams"."tenant_id"');
    expect(query.params).toEqual(['user-1', 'member', 'tenant-1']);
  });
});
