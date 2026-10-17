import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { ManagerTeamController } from './manager-team.controller';
import { ManagerTrendsController } from './manager-trends.controller';
import {
  buildEmptyTeamOverview,
  ManagerDashboardReadModel,
  resolveManagerTeamInput,
  resolveManagerTrendsInput,
} from './manager-dashboard.read-model';

const TENANT_ID = '7d1e0163-6d53-4713-bd24-254690cc5090';
const DEFAULT_TENANT_ID = '8d1e0163-6d53-4713-bd24-254690cc5090';

describe('manager dashboard read model boundary', () => {
  it('keeps the team controller as a read-model adapter', async () => {
    const response = {
      tenantId: TENANT_ID,
      teamSize: 0,
      employees: [],
      generatedAt: '2026-08-12T00:00:00.000Z',
    };
    const readModel = {
      getTeamOverview: vi.fn().mockResolvedValue(response),
    } as unknown as ManagerDashboardReadModel;
    const config = { get: vi.fn(() => true) };

    await expect(new ManagerTeamController(readModel, config as never).getTeamOverview(TENANT_ID)).resolves.toBe(
      response,
    );
    expect(readModel.getTeamOverview).toHaveBeenCalledWith(TENANT_ID);
  });

  it('keeps the trends controller as a read-model adapter', async () => {
    const response = {
      rangeStart: '2026-07-30',
      rangeEnd: '2026-08-12',
      suppressed: false,
      engagement: [],
      signalCapture: [],
      coverageFunnel: {
        unknown: 0,
        insufficient_evidence: 0,
        partially_covered: 0,
        covered: 0,
        scored: 0,
        needs_review: 0,
        suppressed: 0,
      },
      questionSentiment: [],
    };
    const readModel = {
      getTrends: vi.fn().mockResolvedValue(response),
    } as unknown as ManagerDashboardReadModel;
    const config = { get: vi.fn(() => true) };

    await expect(new ManagerTrendsController(readModel, config as never).getTrends(undefined, '999')).resolves.toBe(
      response,
    );
    expect(readModel.getTrends).toHaveBeenCalledWith(undefined, '999');
  });

  it('refuses manager trends when the internal dashboard gate is disabled', async () => {
    const readModel = { getTrends: vi.fn().mockResolvedValue({}) };
    const config = { get: vi.fn(() => false) };
    const controller = new ManagerTrendsController(readModel as never, config as never);

    await expect(controller.getTrends(TENANT_ID, '14')).rejects.toBeInstanceOf(ForbiddenException);
    expect(readModel.getTrends).not.toHaveBeenCalled();
  });

  it('normalizes trends tenant fallback and preserves day clamping', () => {
    expect(resolveManagerTrendsInput(undefined, undefined, DEFAULT_TENANT_ID)).toEqual({
      tenantId: DEFAULT_TENANT_ID,
      days: 14,
    });
    expect(resolveManagerTrendsInput(` ${TENANT_ID} `, '999', DEFAULT_TENANT_ID)).toEqual({
      tenantId: TENANT_ID,
      days: 120,
    });
  });

  it('preserves missing tenant behavior for trends', () => {
    expect(() => resolveManagerTrendsInput(undefined, '14', undefined)).toThrow(
      BadRequestException,
    );
  });

  it('rejects explicit blank and malformed trends tenants', () => {
    expect(() => resolveManagerTrendsInput('   ', '14', DEFAULT_TENANT_ID)).toThrow(
      BadRequestException,
    );
    expect(() => resolveManagerTrendsInput('tenant-1', '14', DEFAULT_TENANT_ID)).toThrow(
      BadRequestException,
    );
    expect(() => resolveManagerTrendsInput(undefined, '14', 'default-tenant')).toThrow(
      BadRequestException,
    );
    expect(() => resolveManagerTrendsInput([TENANT_ID], '14', DEFAULT_TENANT_ID)).toThrow(
      BadRequestException,
    );
  });

  it('rejects non-integer or out-of-range trends days', () => {
    expect(() => resolveManagerTrendsInput(TENANT_ID, '12abc', undefined)).toThrow(
      BadRequestException,
    );
    expect(() => resolveManagerTrendsInput(TENANT_ID, '1.5', undefined)).toThrow(
      BadRequestException,
    );
    expect(() => resolveManagerTrendsInput(TENANT_ID, '0', undefined)).toThrow(
      BadRequestException,
    );
    expect(() => resolveManagerTrendsInput(TENANT_ID, ['14'], undefined)).toThrow(
      BadRequestException,
    );
    expect(resolveManagerTrendsInput(TENANT_ID, '   ', undefined)).toEqual({
      tenantId: TENANT_ID,
      days: 14,
    });
  });

  it('normalizes team tenant ids', () => {
    expect(resolveManagerTeamInput(` ${TENANT_ID} `)).toEqual({ tenantId: TENANT_ID });
    expect(() => resolveManagerTeamInput('tenant-1')).toThrow(BadRequestException);
    expect(() => resolveManagerTeamInput('   ')).toThrow(BadRequestException);
    expect(() => resolveManagerTeamInput([TENANT_ID])).toThrow(BadRequestException);
  });

  it('preserves the empty team response envelope', () => {
    expect(buildEmptyTeamOverview(TENANT_ID)).toMatchObject({
      tenantId: TENANT_ID,
      teamSize: 0,
      employees: [],
    });
  });

  it('short-circuits team detail queries when the tenant has no active users', async () => {
    const client = {
      select: vi
        .fn()
        .mockReturnValueOnce(queryRows([]))
        .mockReturnValueOnce(queryRows([])),
      selectDistinctOn: vi.fn(),
      execute: vi.fn(),
    };
    const readModel = new ManagerDashboardReadModel(
      { client } as never,
      { get: vi.fn() } as never,
    );

    await expect(readModel.getTeamOverview(` ${TENANT_ID} `)).resolves.toMatchObject({
      tenantId: TENANT_ID,
      teamSize: 0,
      employees: [],
    });

    expect(client.select).toHaveBeenCalledTimes(2);
    expect(client.selectDistinctOn).not.toHaveBeenCalled();
    expect(client.execute).not.toHaveBeenCalled();
  });

  it('filters provisioned non-Pulse Persons from each internal trends query', async () => {
    const execute = vi.fn().mockResolvedValue([]);
    const readModel = new ManagerDashboardReadModel({ client: { execute } } as never,
      { get: vi.fn() } as never);
    await readModel.getTrends(TENANT_ID, '7');
    expect(execute).toHaveBeenCalledTimes(4);
    const dialect = new PgDialect();
    for (const [fragment] of execute.mock.calls) {
      const query = dialect.sqlToQuery(fragment as SQL);
      expect(query.sql).toContain('not exists');
      expect(query.sql).toContain('"people"."pulse_participant" = false');
    }
    for (const [fragment] of execute.mock.calls.slice(1)) {
      const query = dialect.sqlToQuery(fragment as SQL);
      expect(query.sql).toContain('FROM survey_window_scoring_policies v2');
      expect(query.sql).toContain('v2.survey_window_id = w.id');
      expect(query.sql).toMatch(/count\(DISTINCT (e|w)\.user_id\)/);
    }
    const activityQuery = dialect.sqlToQuery(execute.mock.calls[0]![0] as SQL);
    expect(activityQuery.sql).toContain('FROM conversation_activity_daily activity');
    expect(activityQuery.sql).not.toContain('FROM messages');
  });

  it('rejects invalid team tenant before querying', async () => {
    const client = {
      select: vi.fn(),
      selectDistinctOn: vi.fn(),
      execute: vi.fn(),
    };
    const readModel = new ManagerDashboardReadModel(
      { client } as never,
      { get: vi.fn() } as never,
    );

    await expect(readModel.getTeamOverview('tenant-1')).rejects.toThrow(BadRequestException);

    expect(client.select).not.toHaveBeenCalled();
    expect(client.selectDistinctOn).not.toHaveBeenCalled();
    expect(client.execute).not.toHaveBeenCalled();
  });

  it('suppresses trends when any daily or question cell has fewer than five employees', async () => {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setUTCDate(today.getUTCDate() - 1);
    const todayKey = today.toISOString().slice(0, 10);
    const yesterdayKey = yesterday.toISOString().slice(0, 10);
    const client = {
      select: vi.fn(),
      selectDistinctOn: vi.fn(),
      execute: vi.fn()
        .mockResolvedValueOnce([
          { day: yesterdayKey, activeUsers: 2, inboundMessages: 5 },
          { day: todayKey, activeUsers: 1, inboundMessages: 3 },
        ])
        .mockResolvedValueOnce([
          { day: yesterdayKey, polarity: 'positive', count: 2, cohortUsers: 2 },
          { day: yesterdayKey, polarity: 'negative', count: 1, cohortUsers: 1 },
          { day: todayKey, polarity: 'mixed', count: 1, cohortUsers: 1 },
        ])
        .mockResolvedValueOnce([
          { status: 'scored', count: 2, cohortUsers: 2 },
          { status: 'insufficient_evidence', count: 1, cohortUsers: 1 },
        ])
        .mockResolvedValueOnce([
          {
            stableKey: 'role_clarity',
            title: 'Role clarity',
            dimension: 'engagement',
            polarity: 'positive',
            count: 2,
            cohortUsers: 2,
          },
          {
            stableKey: 'burnout_load',
            title: 'Burnout load',
            dimension: 'safety',
            polarity: 'negative',
            count: 2,
            cohortUsers: 2,
          },
        ]),
    };
    const readModel = new ManagerDashboardReadModel(
      { client } as never,
      { get: vi.fn() } as never,
    );

    const response = await readModel.getTrends(TENANT_ID, '2');

    expect(client.execute).toHaveBeenCalledTimes(4);
    expect(response).toMatchObject({
      suppressed: true,
      engagement: [],
      signalCapture: [],
      coverageFunnel: {},
      questionSentiment: [],
    });
  });

  it('returns aggregate trends when every populated cell has five distinct employees', async () => {
    const day = new Date().toISOString().slice(0, 10);
    const execute = vi.fn()
      .mockResolvedValueOnce([{ day, activeUsers: 5, inboundMessages: 8 }])
      .mockResolvedValueOnce([{ day, polarity: 'positive', count: 6, cohortUsers: 5 }])
      .mockResolvedValueOnce([{ status: 'scored', count: 7, cohortUsers: 5 }])
      .mockResolvedValueOnce([{
        stableKey: 'role_clarity', title: 'Role clarity', dimension: 'engagement',
        polarity: 'positive', count: 6, cohortUsers: 5,
      }]);
    const readModel = new ManagerDashboardReadModel({ client: { execute } } as never,
      { get: vi.fn() } as never);

    const response = await readModel.getTrends(TENANT_ID, '1');

    expect(response.suppressed).toBe(false);
    expect(response.engagement).toEqual([{ date: day, activeUsers: 5, inboundMessages: 8 }]);
    expect(response.questionSentiment).toEqual([
      expect.objectContaining({ stableKey: 'role_clarity', total: 6 }),
    ]);
  });
});

function queryRows(rows: unknown[]) {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve(rows)),
    })),
  };
}
