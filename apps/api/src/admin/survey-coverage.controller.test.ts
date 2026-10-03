import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { SurveyCoverageController } from './survey-coverage.controller';

describe('survey coverage V2 boundary', () => {
  it('requires a tenant before reading coverage', async () => {
    const select = vi.fn();
    const controller = new SurveyCoverageController({ client: { select } } as never);
    await expect(controller.getCoverage()).rejects.toThrow('tenantId query param is required');
    await expect(controller.getCoverage(' ')).rejects.toThrow('tenantId query param is required');
    expect(select).not.toHaveBeenCalled();
  });

  it('excludes windows bound to a V2 scoring policy from V1 coverage', async () => {
    const predicates: SQL[] = [];
    const query = {
      from: () => query,
      innerJoin: () => query,
      where: (predicate: SQL) => { predicates.push(predicate); return query; },
      then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve([]).then(resolve),
    };
    const controller = new SurveyCoverageController({ client: { select: vi.fn(() => query) } } as never);

    await expect(controller.getCoverage('tenant-1')).resolves.toMatchObject({
      questions: [],
      cohortSize: null,
    });

    const compiled = predicates.map((predicate) => new PgDialect().sqlToQuery(predicate));
    expect(compiled.some(({ sql }) => sql.includes('survey_window_scoring_policies v2'))).toBe(true);
    expect(compiled.some(({ sql }) => sql.toLowerCase().includes('not exists'))).toBe(true);
    expect(compiled[0]?.sql).toMatch(/"survey_windows"\."tenant_id" = \$\d+/);
    expect(compiled[0]?.params).toContain('tenant-1');
  });

  it('does not disclose the exact size of a small cohort', async () => {
    const rows = Array.from({ length: 4 }, (_, index) => ({
      questionId: 'q1', stableKey: 'autonomy_1', title: 'Autonomy', dimension: 'autonomy',
      status: 'scored', score: '70', userId: `employee-${index}`,
    }));
    const query = {
      from: () => query,
      innerJoin: () => query,
      where: () => Promise.resolve(rows),
    };
    const controller = new SurveyCoverageController({ client: { select: () => query } } as never);

    const result = await controller.getCoverage('tenant-1');
    expect(result.questions).toEqual([]);
    expect(result.cohortSize).toBeNull();
    expect(JSON.stringify(result)).not.toContain('4');
  });

  it('hides question breakdowns and averages when a displayed slice has fewer than five employees', async () => {
    const rows = Array.from({ length: 5 }, (_, index) => ({
      questionId: 'q1', stableKey: 'autonomy_1', title: 'Autonomy', dimension: 'autonomy',
      status: index === 4 ? 'no_data' : 'scored', score: index === 4 ? null : '70',
      userId: `employee-${index}`,
    }));
    const query = {
      from: () => query,
      innerJoin: () => query,
      where: () => Promise.resolve(rows),
    };
    const controller = new SurveyCoverageController({ client: { select: () => query } } as never);

    expect(await controller.getCoverage('tenant-1')).toMatchObject({
      cohortSize: 5,
      questions: [],
    });

    rows[4] = { ...rows[4]!, status: 'scored', score: '80' };
    expect(await controller.getCoverage('tenant-1')).toMatchObject({
      cohortSize: 5,
      questions: [{ statusDistribution: { scored: 5 }, avgScore: 72 }],
    });
  });
});
