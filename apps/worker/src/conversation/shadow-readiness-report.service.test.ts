import { describe, expect, it, vi } from 'vitest';
import {
  REQUIRED_SHADOW_READINESS_MIGRATION_CASE_IDS,
  ShadowReadinessReportService,
  buildShadowReadinessReport,
} from './shadow-readiness-report.service';

const generatedAt = new Date('2026-08-05T21:50:00.000Z');

function diagnostic(overrides: Record<string, unknown> = {}) {
  return {
    id: 'diagnostic-1',
    tenantId: 'tenant-1',
    messageId: 'message-1',
    runtimeAttemptId: 'attempt-1',
    runtimeMode: 'maf_shadow',
    traceId: 'trace-1',
    runtimeVersion: 'maf-candidate@3.3-test',
    validationStatus: 'valid',
    redactionStatus: 'not_required',
    currentResult: { replyDigest: 'sha256:current' },
    candidateResult: { replyDigest: 'sha256:candidate' },
    riskComparison: {
      status: 'same',
      currentSeverity: 'none',
      candidateSeverity: 'none',
      falseNegative: false,
      criticalFalseNegative: false,
    },
    memoryComparison: { status: 'same', falsePositiveCount: 0 },
    actionComparison: { status: 'same', duplicateProposalCount: 0 },
    validationDetails: {
      scenarioId: 'planning-memory',
      migrationCaseIds: ['casual-conversation'],
      reasonCodes: [],
    },
    redactionDetails: { reasonCodes: [] },
    latencyMs: 100,
    modelCallCount: 1,
    toolCallCount: 0,
    retryCount: 0,
    estimatedCost: '0.000100',
    createdAt: new Date('2026-08-05T21:45:00.000Z'),
    updatedAt: new Date('2026-08-05T21:45:00.000Z'),
    ...overrides,
  };
}

function passedGateSummary(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    status: 'passed',
    manualReview: {
      requiredScenarioIds: [],
      requiredCaseIds: [],
    },
    scenarios: [],
    ...overrides,
  };
}

function createDbMock(rows: unknown[]) {
  const orderBy = vi.fn().mockResolvedValue(rows);
  const where = vi.fn(() => ({ orderBy }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));

  return {
    client: {
      select,
    },
    calls: {
      select,
      from,
      where,
      orderBy,
    },
  };
}

describe('buildShadowReadinessReport', () => {
  it('summarizes mapped diagnostics, runtime versions, traces, and metrics as ready', () => {
    const report = buildShadowReadinessReport({
      tenantId: 'tenant-1',
      generatedAt,
      requiredMigrationCaseIds: ['casual-conversation', 'explicit-reminder'],
      gateSummary: passedGateSummary(),
      diagnostics: [
        diagnostic({
          id: 'diagnostic-1',
          traceId: 'trace-1',
          validationDetails: {
            scenarioId: 'planning-memory',
            migrationCaseIds: ['casual-conversation'],
            reasonCodes: [],
          },
          latencyMs: 100,
          modelCallCount: 1,
          toolCallCount: 0,
          retryCount: 0,
          estimatedCost: '0.000100',
        }),
        diagnostic({
          id: 'diagnostic-2',
          traceId: 'trace-2',
          runtimeVersion: 'maf-candidate@3.3-test-2',
          validationDetails: {
            scenarioId: 'proactivity-reminders',
            migrationCaseIds: ['explicit-reminder'],
            reasonCodes: [],
          },
          latencyMs: 200,
          modelCallCount: 3,
          toolCallCount: 2,
          retryCount: 1,
          estimatedCost: '0.000300',
        }),
      ],
    });

    expect(report.status).toBe('ready');
    expect(report.metadata).toMatchObject({
      tenantId: 'tenant-1',
      diagnosticCount: 2,
      runtimeVersions: ['maf-candidate@3.3-test', 'maf-candidate@3.3-test-2'],
      scenarioIds: ['planning-memory', 'proactivity-reminders'],
      migrationCaseIds: ['casual-conversation', 'explicit-reminder'],
      traceIds: ['trace-1', 'trace-2'],
    });
    expect(report.metrics.latencyMs).toMatchObject({ count: 2, mean: 150, max: 200, p95: 200 });
    expect(report.metrics.modelCallCount.mean).toBe(2);
    expect(report.metrics.toolCallCount.max).toBe(2);
    expect(report.metrics.estimatedCost.mean).toBe(0.0002);
  });

  it('blocks readiness for critical risk false negatives and duplicate action proposals', () => {
    const report = buildShadowReadinessReport({
      tenantId: 'tenant-1',
      generatedAt,
      requiredMigrationCaseIds: ['crisis-self-harm'],
      gateSummary: passedGateSummary(),
      diagnostics: [
        diagnostic({
          riskComparison: {
            status: 'worse',
            currentSeverity: 'critical',
            candidateSeverity: 'none',
            falseNegative: true,
            criticalFalseNegative: true,
          },
          actionComparison: {
            status: 'worse',
            duplicateProposalCount: 1,
          },
          validationDetails: {
            scenarioId: 'crisis-self-harm',
            migrationCaseIds: ['crisis-self-harm'],
            reasonCodes: [],
          },
        }),
      ],
    });

    expect(report.status).toBe('blocked');
    expect(report.blockers.map((blocker) => blocker.reasonCode)).toEqual(
      expect.arrayContaining(['critical_risk_false_negative', 'duplicate_action_proposal']),
    );
  });

  it('keeps manual review as a non-ready status when automated gate output requires review', () => {
    const report = buildShadowReadinessReport({
      tenantId: 'tenant-1',
      generatedAt,
      requiredMigrationCaseIds: ['burnout-severe-stress'],
      gateSummary: passedGateSummary({
        status: 'manual_review_required',
        manualReview: {
          requiredScenarioIds: ['burnout'],
          requiredCaseIds: ['burnout-severe-stress'],
        },
      }),
      diagnostics: [
        diagnostic({
          validationDetails: {
            scenarioId: 'burnout',
            migrationCaseIds: ['burnout-severe-stress'],
            reasonCodes: [],
          },
        }),
      ],
    });

    expect(report.status).toBe('manual_review_required');
    expect(report.manualReview).toEqual({
      requiredScenarioIds: ['burnout'],
      requiredCaseIds: ['burnout-severe-stress'],
    });
    expect(report.blockers).toHaveLength(0);
  });

  it('reports insufficient data when required baseline cases have no mapped diagnostics', () => {
    const report = buildShadowReadinessReport({
      tenantId: 'tenant-1',
      generatedAt,
      requiredMigrationCaseIds: ['casual-conversation', 'terse-acknowledgement'],
      gateSummary: passedGateSummary(),
      diagnostics: [
        diagnostic({
          validationDetails: {
            scenarioId: 'planning-memory',
            migrationCaseIds: ['casual-conversation'],
            reasonCodes: [],
          },
        }),
      ],
    });

    expect(report.status).toBe('insufficient_data');
    expect(report.insufficientDataReasons).toEqual([
      {
        reasonCode: 'missing_baseline_coverage',
        migrationCaseIds: ['terse-acknowledgement'],
      },
    ]);
  });

  it('blocks validation and redaction failures without serializing raw diagnostic content', () => {
    const report = buildShadowReadinessReport({
      tenantId: 'tenant-1',
      generatedAt,
      requiredMigrationCaseIds: ['casual-conversation'],
      gateSummary: passedGateSummary(),
      diagnostics: [
        diagnostic({
          validationStatus: 'invalid',
          redactionStatus: 'rejected',
          currentResult: { text: 'raw current response text' },
          candidateResult: { reply: 'raw candidate response text' },
          riskComparison: { evidence: 'raw risk evidence' },
          memoryComparison: { memoryContent: 'raw memory content' },
          actionComparison: { actionPayload: 'raw action payload' },
          validationDetails: {
            scenarioId: 'planning-memory',
            migrationCaseIds: ['casual-conversation'],
            reasonCodes: ['candidate_schema_invalid'],
            providerError: 'raw provider stack trace',
          },
        }),
      ],
    });

    const serialized = JSON.stringify(report);
    expect(report.status).toBe('blocked');
    expect(report.blockers.map((blocker) => blocker.reasonCode)).toEqual(
      expect.arrayContaining(['validation_failure', 'redaction_rejected']),
    );
    expect(serialized).not.toContain('raw current response text');
    expect(serialized).not.toContain('raw candidate response text');
    expect(serialized).not.toContain('raw risk evidence');
    expect(serialized).not.toContain('raw memory content');
    expect(serialized).not.toContain('raw action payload');
    expect(serialized).not.toContain('raw provider stack trace');
  });

  it('keeps the default required baseline case list independent and complete', () => {
    expect(REQUIRED_SHADOW_READINESS_MIGRATION_CASE_IDS).toEqual([
      'burnout-severe-stress',
      'crisis-self-harm',
      'workplace-harassment',
      'manager-privacy-request',
      'unwanted-proactivity',
      'explicit-reminder',
      'delayed-follow-up',
      'assessment-preparation',
      'goal-create-update',
      'memory-extraction',
      'incorrect-memory-correction',
      'casual-conversation',
      'terse-acknowledgement',
    ]);
  });
});

describe('ShadowReadinessReportService', () => {
  it('loads tenant-scoped diagnostics read-only before building a report', async () => {
    const db = createDbMock([
      diagnostic({
        validationDetails: {
          scenarioId: 'planning-memory',
          migrationCaseIds: ['casual-conversation'],
          reasonCodes: [],
        },
      }),
    ]);
    const service = new ShadowReadinessReportService(db as never);

    const report = await service.generateReport({
      tenantId: 'tenant-1',
      generatedAt,
      requiredMigrationCaseIds: ['casual-conversation'],
      gateSummary: passedGateSummary(),
      from: new Date('2026-08-05T20:00:00.000Z'),
      to: new Date('2026-08-05T22:00:00.000Z'),
    });

    expect(report.status).toBe('ready');
    expect(db.calls.select).toHaveBeenCalledTimes(1);
    expect(db.calls.from).toHaveBeenCalledTimes(1);
    expect(db.calls.where).toHaveBeenCalledTimes(1);
    expect(db.calls.orderBy).toHaveBeenCalledTimes(1);
  });
});
