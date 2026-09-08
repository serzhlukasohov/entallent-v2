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
      tenantId: 'tenant-1',
      teamName: 'Platform Team',
      managerSlackUserId: null,
      activeTeamSize: 1,
      memberUserIds: ['user-1'],
      reportingCohortId: null,
      reportingSurveyDefinitionId: null,
      reportingPeriodStart: null,
      reportingPeriodEnd: null,
    });

    await repository.findTeamByMemberId('user-1', 'tenant-1');

    expect(repository.findTeamById).toHaveBeenCalledWith('team-1', 'tenant-1');

    expect(innerJoin).toHaveBeenCalledOnce();
    const query = compileSql(where.mock.calls[0]?.[0]);
    expect(query.sql).toContain('"team_memberships"."user_id"');
    expect(query.sql).toContain('"teams"."tenant_id"');
    expect(query.params).toEqual(['user-1', 'member', 'tenant-1']);
  });

  it('resolves a report team and roster from the tenant-scoped survey window snapshot', async () => {
    const limit = vi.fn().mockResolvedValue([{
      reportingCohortId: 'cohort-1',
      teamId: 'team-1',
      memberUserIds: ['user-1', 'user-2', 'user-3', 'user-4', 'user-5'],
    }]);
    const where = vi.fn((_value: unknown) => ({ limit }));
    const chain: { where: typeof where; innerJoin: ReturnType<typeof vi.fn> } = {
      where,
      innerJoin: vi.fn(),
    };
    chain.innerJoin.mockReturnValue(chain);
    const from = vi.fn(() => chain);
    const select = vi.fn(() => ({ from }));
    const repository = new TeamRepository({ client: { select } } as never);
    vi.spyOn(repository, 'findTeamById').mockResolvedValue({
      teamId: 'team-1',
      tenantId: 'tenant-1',
      teamName: 'Platform Team',
      managerSlackUserId: 'manager-1',
      activeTeamSize: 5,
      memberUserIds: ['user-1', 'user-2', 'user-3', 'user-4', 'user-5'],
      reportingCohortId: 'cohort-1',
      reportingSurveyDefinitionId: 'definition-1',
      reportingPeriodStart: new Date('2026-07-01T00:00:00.000Z'),
      reportingPeriodEnd: new Date('2026-09-30T23:59:59.999Z'),
    });

    await expect(repository.findTeamByMemberId('user-1', 'tenant-1', 'window-1'))
      .resolves.toMatchObject({ teamId: 'team-1', activeTeamSize: 5 });

    const query = compileSql(where.mock.calls[0]?.[0]);
    expect(query.sql).toContain('"survey_windows"."id"');
    expect(query.sql).toContain('"survey_windows"."tenant_id"');
    expect(query.sql).toContain('"survey_windows"."user_id"');
    expect(query.params).toEqual(['window-1', 'tenant-1', 'user-1']);
    expect(repository.findTeamById).toHaveBeenCalledWith('team-1', 'tenant-1', 'cohort-1');
  });

});
