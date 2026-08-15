import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
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

    await expect(new ManagerTeamController(readModel).getTeamOverview(TENANT_ID)).resolves.toBe(
      response,
    );
    expect(readModel.getTeamOverview).toHaveBeenCalledWith(TENANT_ID);
  });

  it('keeps the trends controller as a read-model adapter', async () => {
    const response = {
      rangeStart: '2026-07-30',
      rangeEnd: '2026-08-12',
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

    await expect(new ManagerTrendsController(readModel).getTrends(undefined, '999')).resolves.toBe(
      response,
    );
    expect(readModel.getTrends).toHaveBeenCalledWith(undefined, '999');
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

  it('Manager Trends maf_primary regression aggregates MAF-created messages and survey evidence', async () => {
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
          { day: yesterdayKey, polarity: 'positive', count: 2 },
          { day: yesterdayKey, polarity: 'negative', count: 1 },
          { day: todayKey, polarity: 'mixed', count: 1, evidenceSummary: 'raw MAF evidence' },
        ])
        .mockResolvedValueOnce([
          { status: 'scored', count: 2 },
          { status: 'insufficient_evidence', count: 1 },
        ])
        .mockResolvedValueOnce([
          {
            stableKey: 'role_clarity',
            title: 'Role clarity',
            dimension: 'engagement',
            polarity: 'positive',
            count: 2,
          },
          {
            stableKey: 'burnout_load',
            title: 'Burnout load',
            dimension: 'safety',
            polarity: 'negative',
            count: 2,
          },
        ]),
    };
    const readModel = new ManagerDashboardReadModel(
      { client } as never,
      { get: vi.fn() } as never,
    );

    const response = await readModel.getTrends(TENANT_ID, '2');

    expect(client.execute).toHaveBeenCalledTimes(4);
    expect(response.engagement).toEqual([
      { date: yesterdayKey, activeUsers: 2, inboundMessages: 5 },
      { date: todayKey, activeUsers: 1, inboundMessages: 3 },
    ]);
    expect(response.signalCapture).toEqual([
      { date: yesterdayKey, total: 3, positive: 2, negative: 1, mixed: 0, neutral: 0 },
      { date: todayKey, total: 1, positive: 0, negative: 0, mixed: 1, neutral: 0 },
    ]);
    expect(response.coverageFunnel).toMatchObject({
      unknown: 0,
      insufficient_evidence: 1,
      scored: 2,
    });
    expect(response.questionSentiment).toEqual([
      expect.objectContaining({ stableKey: 'burnout_load', total: 2, net: -1 }),
      expect.objectContaining({ stableKey: 'role_clarity', total: 2, net: 1 }),
    ]);
    expect(JSON.stringify(response)).not.toContain('raw MAF evidence');
  });
});

function queryRows(rows: unknown[]) {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve(rows)),
    })),
  };
}
