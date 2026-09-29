import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { conversationActivityDaily } from '@entalent/database';
import { AnalyticsController } from './analytics.controller';

describe('internal analytics Person eligibility', () => {
  it('requires a tenant before reading aggregate data', async () => {
    const select = vi.fn();
    const controller = new AnalyticsController({ client: { select } } as never);
    await expect(controller.overview()).rejects.toThrow('tenantId query param is required');
    await expect(controller.overview(' ')).rejects.toThrow('tenantId query param is required');
    expect(select).not.toHaveBeenCalled();
  });

  it('excludes provisioned non-Pulse Persons from all six current metrics', async () => {
    const predicates: SQL[] = [];
    const sources: unknown[] = [];
    const query = {
      from: (source: unknown) => { sources.push(source); return query; },
      innerJoin: () => query,
      where: (predicate: SQL) => { predicates.push(predicate); return query; },
      groupBy: () => query,
      then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve([]).then(resolve),
    };
    const select = vi.fn(() => query);
    const controller = new AnalyticsController({ client: { select } } as never);
    await controller.overview('tenant-1');
    const dialect = new PgDialect();
    const eligibilityQueries = predicates
      .map((predicate) => dialect.sqlToQuery(predicate))
      .filter((compiled) => compiled.sql.includes('"people"."pulse_participant" = false'));
    expect(eligibilityQueries).toHaveLength(6);
    for (const compiled of eligibilityQueries) {
      expect(compiled.sql).toContain('not exists');
      expect(compiled.sql).toMatch(/"(conversation_activity_daily|users|risk_signals|survey_windows)"\."tenant_id" = \$\d+/);
      expect(compiled.params).toContain('tenant-1');
    }
    expect(eligibilityQueries[5]?.sql).toContain('survey_window_scoring_policies v2');
    expect(sources.slice(0, 3)).toEqual([
      conversationActivityDaily, conversationActivityDaily, conversationActivityDaily,
    ]);
  });

  it('suppresses output when a populated activity or risk slice has fewer than five people', async () => {
    const overview = async (inboundUsers: number, riskUsers: number) => {
      const responses = [
        [{ count: 5 }], [{ count: 5 }],
        [{ inbound: 8, outbound: 8, inboundUsers, outboundUsers: 5 }],
        [{ count: 5 }],
        [{ severity: 'high', count: 8, contributorCount: riskUsers }],
        [{ count: 5 }],
      ];
      const select = vi.fn(() => {
        const rows = responses.shift() ?? [];
        const query = {
          from: () => query,
          innerJoin: () => query,
          where: () => query,
          groupBy: () => query,
          then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows).then(resolve),
        };
        return query;
      });
      return new AnalyticsController({ client: { select } } as never).overview('tenant-1');
    };

    expect(await overview(1, 5)).toMatchObject({ cohortInsufficient: true });
    expect(await overview(5, 1)).toMatchObject({ cohortInsufficient: true });
    expect(await overview(5, 5)).toMatchObject({
      users: { total: 5 },
      safety: { activeRiskSignalsBySeverity: { high: 8 } },
    });
  });
});
