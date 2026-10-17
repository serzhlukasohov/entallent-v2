import { describe, expect, it, vi } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { DEFAULT_RETENTION_POLICY } from '@entalent/domain';
import { RetentionRepository } from './retention.repository';

function compileSql(value: unknown) {
  return new PgDialect().sqlToQuery(value as SQL);
}

describe('RetentionRepository', () => {
  it('loads active tenant retention policies with defaults and optional tenant scope', async () => {
    const execute = vi.fn().mockResolvedValue([{
      tenant_id: '00000000-0000-0000-0000-000000000001',
      retention_policy: { messagesRetentionDays: 30 },
    }]);
    const repository = new RetentionRepository(
      { client: { execute } } as never,
      '00000000-0000-0000-0000-000000000001',
    );

    await expect(repository.findRetentionTenants()).resolves.toEqual([{
      tenantId: '00000000-0000-0000-0000-000000000001',
      retentionPolicy: {
        ...DEFAULT_RETENTION_POLICY,
        messagesRetentionDays: 30,
      },
    }]);

    const query = compileSql(execute.mock.calls[0]?.[0]);
    expect(query.sql).toContain("where status = 'active'");
    expect(query.sql).toContain('and id = $1::uuid');
    expect(query.params).toEqual(['00000000-0000-0000-0000-000000000001']);
  });

  it('applies retention to each durable survey and conversation store for one tenant', async () => {
    const execute = vi.fn().mockResolvedValue([{ id: 'row-1' }]);
    const repository = new RetentionRepository({ client: { execute } } as never);
    const now = new Date('2026-10-31T00:00:00.000Z');

    await expect(repository.applyRetention({
      tenantId: '00000000-0000-0000-0000-000000000001',
      now,
      messagesCutoff: new Date('2026-10-21T00:00:00.000Z'),
      memoryCutoff: new Date('2026-10-11T00:00:00.000Z'),
      riskSignalCutoff: new Date('2026-10-28T00:00:00.000Z'),
      auditLogCutoff: new Date('2026-10-01T00:00:00.000Z'),
    })).resolves.toEqual({
      messagesDeleted: 1,
      surveyEvidenceExpired: 1,
      surveyAssessmentsExpired: 1,
      memoryItemsExpired: 1,
      riskSignalsExpired: 1,
      temporaryGroupStatesExpired: 1,
      confirmedGroupStatesExpired: 1,
      withdrawnGroupStatesExpired: 1,
      workingQuestionInsightsExpired: 1,
      questionBundlesExpired: 1,
      questionInsightsDeleted: 1,
      auditLogsDeleted: 1,
      reportSnapshotsDeleted: 2,
    });

    const queries = execute.mock.calls.map((call) => compileSql(call[0]));
    expect(queries).toHaveLength(14);
    expect(queries.map((query) => query.sql)).toEqual([
      expect.stringContaining('update messages'),
      expect.stringContaining('update survey_evidence'),
      expect.stringContaining('update survey_assessments'),
      expect.stringContaining('update memory_items'),
      expect.stringContaining('update risk_signals'),
      expect.stringContaining('update survey_group_states'),
      expect.stringContaining('update survey_group_states'),
      expect.stringContaining('update survey_group_states'),
      expect.stringContaining('update survey_question_working_insights'),
      expect.stringContaining('update survey_question_confirmation_bundles'),
      expect.stringContaining('delete from survey_question_insights'),
      expect.stringContaining('delete from survey_report_snapshots'),
      expect.stringContaining('delete from survey_v2_report_snapshots'),
      expect.stringContaining('delete from audit_logs'),
    ]);
    for (const query of queries) {
      expect(query.sql).toContain('tenant_id = $');
      expect(query.params).toContain('00000000-0000-0000-0000-000000000001');
    }
    expect(queries[0].sql).toContain("text = '[deleted]'");
    expect(queries[1].sql).toContain("evidence_summary = '[deleted]'");
    expect(queries[2].sql).toContain("status = 'suppressed'");
    expect(queries[3].sql).toContain("content = '[deleted]'");
    expect(queries[4].sql).toContain('recommended_action = null');
    expect(queries[5].sql).toContain("'in_progress', 'pending_confirmation', 'awaiting_confirmation'");
    expect(queries[6].sql).toContain("status = 'confirmed'");
    expect(queries[7].sql).toContain("status = 'withdrawn'");
    expect(queries[8].params).toContain('2026-10-11T00:00:00.000Z');
    expect(queries[8].sql).toContain('source_message_ids = ARRAY[]::uuid[]');
    expect(queries[9].sql).toContain('components = null');
    expect(queries[10].sql).toContain('v2.question_insight_withdrawal_retained');
    expect(queries[10].sql).toContain('processed_at <');
    expect(queries[12].sql).toContain('created_at <');
    expect(queries[13].sql).toContain('created_at <');
  });
});
