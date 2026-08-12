import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ManagerTeamController } from './manager-team.controller';
import { ManagerTrendsController } from './manager-trends.controller';
import {
  buildEmptyTeamOverview,
  ManagerDashboardReadModel,
  resolveManagerTrendsInput,
} from './manager-dashboard.read-model';

describe('manager dashboard read model boundary', () => {
  it('keeps the team controller as a read-model adapter', async () => {
    const response = {
      tenantId: 'tenant-1',
      teamSize: 0,
      employees: [],
      generatedAt: '2026-08-12T00:00:00.000Z',
    };
    const readModel = {
      getTeamOverview: vi.fn().mockResolvedValue(response),
    } as unknown as ManagerDashboardReadModel;

    await expect(new ManagerTeamController(readModel).getTeamOverview('tenant-1')).resolves.toBe(
      response,
    );
    expect(readModel.getTeamOverview).toHaveBeenCalledWith('tenant-1');
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

  it('preserves trends tenant fallback and day clamping', () => {
    expect(resolveManagerTrendsInput(undefined, undefined, 'default-tenant')).toEqual({
      tenantId: 'default-tenant',
      days: 14,
    });
    expect(resolveManagerTrendsInput('tenant-1', '999', 'default-tenant')).toEqual({
      tenantId: 'tenant-1',
      days: 120,
    });
    expect(resolveManagerTrendsInput('tenant-1', 'bad', undefined)).toEqual({
      tenantId: 'tenant-1',
      days: 14,
    });
  });

  it('preserves missing tenant behavior for trends', () => {
    expect(() => resolveManagerTrendsInput(undefined, '14', undefined)).toThrow(
      BadRequestException,
    );
  });

  it('preserves the empty team response envelope', () => {
    expect(buildEmptyTeamOverview('tenant-1')).toMatchObject({
      tenantId: 'tenant-1',
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

    await expect(readModel.getTeamOverview('tenant-1')).resolves.toMatchObject({
      tenantId: 'tenant-1',
      teamSize: 0,
      employees: [],
    });

    expect(client.select).toHaveBeenCalledTimes(2);
    expect(client.selectDistinctOn).not.toHaveBeenCalled();
    expect(client.execute).not.toHaveBeenCalled();
  });
});

function queryRows(rows: unknown[]) {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve(rows)),
    })),
  };
}
