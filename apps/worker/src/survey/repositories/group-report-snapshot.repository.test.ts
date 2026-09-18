import { describe, expect, it, vi } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { GroupReportSnapshotRepository } from './group-report-snapshot.repository';

function compileSql(value: unknown) {
  return new PgDialect().sqlToQuery(value as SQL);
}

describe('GroupReportSnapshotRepository', () => {
  it('loads the latest non-cancelled snapshot for the reporting scope', async () => {
    const limit = vi.fn().mockResolvedValue([{
      snapshotVersion: 2,
      status: 'delivered',
      contributorUserIds: ['user-1'],
      sourceGroupStateIds: ['state-1'],
    }]);
    const orderBy = vi.fn(() => ({ limit }));
    const where = vi.fn((_value: unknown) => ({ orderBy }));
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    const repository = new GroupReportSnapshotRepository({ client: { select } } as never);

    await expect(repository.findLatestNonCancelledSnapshot({
      tenantId: 'tenant-1',
      reportingCohortId: 'cohort-1',
      questionGroup: 'growth',
    })).resolves.toEqual({
      snapshotVersion: 2,
      status: 'delivered',
      reportKind: 'intermediate',
      contributorUserIds: ['user-1'],
      sourceGroupStateIds: ['state-1'],
    });

    expect(orderBy).toHaveBeenCalledOnce();
    expect(limit).toHaveBeenCalledWith(1);
    const query = compileSql(where.mock.calls[0]?.[0]);
    expect(query.sql).toContain('"survey_report_snapshots"."tenant_id"');
    expect(query.sql).toContain('"survey_report_snapshots"."reporting_cohort_id"');
    expect(query.sql).toContain('"survey_report_snapshots"."question_group"');
    expect(query.sql).toContain('"survey_report_snapshots"."status" <>');
    expect(query.params).toEqual(['tenant-1', 'cohort-1', 'growth', 'cancelled']);
  });

  it('loads final snapshot kind from the immutable manager payload', async () => {
    const limit = vi.fn().mockResolvedValue([{
      snapshotVersion: 3,
      status: 'delivered',
      managerPayload: { reportKind: 'final' },
      contributorUserIds: ['user-1'],
      sourceGroupStateIds: ['state-1'],
    }]);
    const orderBy = vi.fn(() => ({ limit }));
    const where = vi.fn((_value: unknown) => ({ orderBy }));
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    const repository = new GroupReportSnapshotRepository({ client: { select } } as never);

    await expect(repository.findLatestNonCancelledSnapshot({
      tenantId: 'tenant-1',
      reportingCohortId: 'cohort-1',
      questionGroup: 'growth',
    })).resolves.toMatchObject({ reportKind: 'final' });
  });
});
