import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { AnalyticsController } from './analytics.controller';

describe('internal analytics Person eligibility', () => {
  it('excludes provisioned non-Pulse Persons from all six current metrics', async () => {
    const predicates: SQL[] = [];
    const query = {
      from: () => query,
      innerJoin: () => query,
      where: (predicate: SQL) => { predicates.push(predicate); return query; },
      groupBy: () => query,
      then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve([]).then(resolve),
    };
    const select = vi.fn(() => query);
    const controller = new AnalyticsController({ client: { select } } as never);
    await controller.overview('tenant-1');
    expect(predicates).toHaveLength(6);
    const dialect = new PgDialect();
    for (const predicate of predicates) {
      const compiled = dialect.sqlToQuery(predicate);
      expect(compiled.sql).toContain('not exists');
      expect(compiled.sql).toContain('"people"."pulse_participant" = false');
    }
  });
});
