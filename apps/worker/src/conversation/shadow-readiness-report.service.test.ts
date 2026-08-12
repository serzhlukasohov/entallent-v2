import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  REQUIRED_SHADOW_READINESS_MIGRATION_CASE_IDS,
  ShadowReadinessReportService,
  buildCanaryGateDecision,
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
    expect(report.metrics.latencyMs).toMatchObject({ count: 2, mean: 150, max: 200, p95: null });
    expect(report.metrics.modelCallCount.mean).toBe(2);
    expect(report.metrics.toolCallCount.max).toBe(2);
    expect(report.metrics.estimatedCost.mean).toBe(0.0002);
    expect(report.migrationCases).toEqual([
      expect.objectContaining({
        migrationCaseId: 'casual-conversation',
        diagnosticCount: 1,
        scenarioIds: ['planning-memory'],
        traceIds: ['trace-1'],
      }),
      expect.objectContaining({
        migrationCaseId: 'explicit-reminder',
        diagnosticCount: 1,
        scenarioIds: ['proactivity-reminders'],
        traceIds: ['trace-2'],
      }),
    ]);
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

  it('blocks critical severity regressions and duplicate statuses when explicit flags are missing', () => {
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
          },
          actionComparison: {
            status: 'duplicate_proposal',
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

  it('keeps observed sensitive cases manual-review-required even when gate arrays are missing', () => {
    const report = buildShadowReadinessReport({
      tenantId: 'tenant-1',
      generatedAt,
      requiredMigrationCaseIds: ['crisis-self-harm'],
      gateSummary: passedGateSummary({
        manualReview: {},
      }),
      diagnostics: [
        diagnostic({
          validationDetails: {
            scenarioId: 'crisis-self-harm',
            migrationCaseIds: ['crisis-self-harm'],
            reasonCodes: [],
          },
        }),
      ],
    });

    expect(report.status).toBe('manual_review_required');
    expect(report.manualReview).toEqual({
      requiredScenarioIds: ['crisis-self-harm'],
      requiredCaseIds: ['crisis-self-harm'],
    });
  });

  it('reports insufficient data when baseline gate summary is omitted', () => {
    const report = buildShadowReadinessReport({
      tenantId: 'tenant-1',
      generatedAt,
      requiredMigrationCaseIds: ['casual-conversation'],
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
        reasonCode: 'missing_baseline_gate_summary',
        migrationCaseIds: ['casual-conversation'],
      },
    ]);
  });

  it('reports insufficient data when baseline gate summary status is invalid', () => {
    const report = buildShadowReadinessReport({
      tenantId: 'tenant-1',
      generatedAt,
      requiredMigrationCaseIds: ['casual-conversation'],
      gateSummary: passedGateSummary({
        status: 'unknown',
        manualReview: {
          requiredScenarioIds: ['ignored-scenario'],
          requiredCaseIds: ['ignored-case'],
        },
      }),
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
    expect(report.manualReview).toEqual({ requiredScenarioIds: [], requiredCaseIds: [] });
    expect(report.insufficientDataReasons).toEqual([
      {
        reasonCode: 'missing_baseline_gate_summary',
        migrationCaseIds: ['casual-conversation'],
      },
    ]);
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

  it('blocks malformed diagnostic payloads instead of treating them as clean', () => {
    const report = buildShadowReadinessReport({
      tenantId: 'tenant-1',
      generatedAt,
      requiredMigrationCaseIds: ['casual-conversation'],
      gateSummary: passedGateSummary(),
      diagnostics: [
        diagnostic({
          validationDetails: {
            scenarioId: 'planning-memory',
            migrationCaseIds: ['casual-conversation'],
            reasonCodes: [],
          },
          riskComparison: null,
          memoryComparison: [],
          actionComparison: { duplicateProposalCount: 0 },
        }),
      ],
    });

    expect(report.status).toBe('blocked');
    expect(report.blockers.map((blocker) => blocker.reasonCode)).toEqual(
      expect.arrayContaining(['diagnostic_payload_malformed']),
    );
  });

  it('accepts maf_candidate_invalid as a safe validation reason code', () => {
    const report = buildShadowReadinessReport({
      tenantId: 'tenant-1',
      generatedAt,
      requiredMigrationCaseIds: ['casual-conversation'],
      gateSummary: passedGateSummary(),
      diagnostics: [
        diagnostic({
          validationStatus: 'invalid',
          redactionStatus: 'not_required',
          validationDetails: {
            scenarioId: 'planning-memory',
            migrationCaseIds: ['casual-conversation'],
            reasonCodes: ['maf_candidate_invalid'],
          },
          redactionDetails: { reasonCodes: [] },
        }),
      ],
    });

    expect(report.status).toBe('blocked');
    expect(report.blockers.map((blocker) => blocker.reasonCode)).toContain('validation_failure');
    expect(report.blockers.map((blocker) => blocker.reasonCode)).not.toContain('redaction_rejected');
    expect(report.quality.validationReasonCodes).toContain('maf_candidate_invalid');
  });

  it('blocks unstable validation reason codes before report serialization', () => {
    const report = buildShadowReadinessReport({
      tenantId: 'tenant-1',
      generatedAt,
      requiredMigrationCaseIds: ['casual-conversation'],
      gateSummary: passedGateSummary(),
      diagnostics: [
        diagnostic({
          validationDetails: {
            scenarioId: 'planning-memory',
            migrationCaseIds: ['casual-conversation'],
            reasonCodes: ['raw provider stack trace'],
          },
        }),
      ],
    });

    const serialized = JSON.stringify(report);
    expect(report.status).toBe('blocked');
    expect(report.blockers.map((blocker) => blocker.reasonCode)).toContain('redaction_rejected');
    expect(serialized).not.toContain('raw provider stack trace');
  });

  it('blocks token-like validation reason codes before report serialization', () => {
    const report = buildShadowReadinessReport({
      tenantId: 'tenant-1',
      generatedAt,
      requiredMigrationCaseIds: ['casual-conversation'],
      gateSummary: passedGateSummary(),
      diagnostics: [
        diagnostic({
          validationDetails: {
            scenarioId: 'planning-memory',
            migrationCaseIds: ['casual-conversation'],
            reasonCodes: ['bearer:sk-live-secret'],
          },
        }),
      ],
    });

    const serialized = JSON.stringify(report);
    expect(report.status).toBe('blocked');
    expect(report.quality.validationReasonCodes).toEqual([]);
    expect(report.blockers.map((blocker) => blocker.reasonCode)).toContain('redaction_rejected');
    expect(serialized).not.toContain('bearer:sk-live-secret');
  });

  it('blocks unrecognized stable-looking reason codes without echoing them as evidence', () => {
    const report = buildShadowReadinessReport({
      tenantId: 'tenant-1',
      generatedAt,
      requiredMigrationCaseIds: ['casual-conversation'],
      gateSummary: passedGateSummary(),
      diagnostics: [
        diagnostic({
          validationDetails: {
            scenarioId: 'planning-memory',
            migrationCaseIds: ['casual-conversation'],
            reasonCodes: ['employee_email_john_company'],
          },
        }),
      ],
    });

    const serialized = JSON.stringify(report);
    expect(report.status).toBe('blocked');
    expect(report.quality.validationReasonCodes).toEqual([]);
    expect(report.blockers.map((blocker) => blocker.reasonCode)).toContain('redaction_rejected');
    expect(serialized).not.toContain('employee_email_john_company');
  });

  it('sanitizes policy-regression scenario and migration case evidence before serialization', () => {
    const report = buildShadowReadinessReport({
      tenantId: 'tenant-1',
      generatedAt,
      requiredMigrationCaseIds: ['manager-privacy-request'],
      gateSummary: passedGateSummary({
        manualReview: {
          requiredScenarioIds: [],
          requiredCaseIds: [],
        },
      }),
      diagnostics: [
        diagnostic({
          id: 'diagnostic-raw-evidence',
          traceId: 'trace-raw-evidence',
          validationDetails: {
            scenarioId: 'raw manager text asking about a named employee',
            migrationCaseIds: ['raw gdpr export payload'],
            reasonCodes: ['manager_privacy_regression'],
          },
        }),
      ],
    });

    const decision = buildCanaryGateDecision({ report });
    const serialized = JSON.stringify(decision);

    expect(decision.canaryEnabled).toBe(false);
    expect(decision.blockers.map((blocker) => blocker.reasonCode)).toEqual(
      expect.arrayContaining([
        'manager_privacy_regression',
        'redaction_rejected',
        'diagnostic_payload_malformed',
      ]),
    );
    expect(decision.blockers).toContainEqual(
      expect.objectContaining({
        reasonCode: 'manager_privacy_regression',
        diagnosticId: 'diagnostic-raw-evidence',
        traceId: 'trace-raw-evidence',
        scenarioId: undefined,
        migrationCaseIds: [],
      }),
    );
    expect(report.metadata.scenarioIds).toEqual([]);
    expect(report.metadata.migrationCaseIds).toEqual([]);
    expect(serialized).not.toContain('raw manager text asking about a named employee');
    expect(serialized).not.toContain('raw gdpr export payload');
  });

  it('blocks invalid metric payloads instead of treating missing metric evidence as clean', () => {
    const report = buildShadowReadinessReport({
      tenantId: 'tenant-1',
      generatedAt,
      requiredMigrationCaseIds: ['casual-conversation'],
      gateSummary: passedGateSummary(),
      diagnostics: [
        diagnostic({
          validationDetails: {
            scenarioId: 'planning-memory',
            migrationCaseIds: ['casual-conversation'],
            reasonCodes: [],
          },
          latencyMs: Number.NaN,
        }),
      ],
    });
    const decision = buildCanaryGateDecision({ report });

    expect(report.status).toBe('blocked');
    expect(report.metrics.latencyMs.count).toBe(0);
    expect(decision.canaryEnabled).toBe(false);
    expect(decision.blockers.map((blocker) => blocker.reasonCode)).toEqual(
      expect.arrayContaining(['diagnostic_payload_malformed', 'insufficient_shadow_data']),
    );
  });

  it('does not let negative memory false-positive counts offset sensitive positives', () => {
    const report = buildShadowReadinessReport({
      tenantId: 'tenant-1',
      generatedAt,
      requiredMigrationCaseIds: ['crisis-self-harm'],
      gateSummary: passedGateSummary({
        manualReview: {
          requiredScenarioIds: [],
          requiredCaseIds: [],
        },
      }),
      diagnostics: [
        diagnostic({
          id: 'diagnostic-1',
          traceId: 'trace-1',
          memoryComparison: { status: 'different', falsePositiveCount: 1 },
          validationDetails: {
            scenarioId: 'crisis-self-harm',
            migrationCaseIds: ['crisis-self-harm'],
            reasonCodes: [],
          },
        }),
        diagnostic({
          id: 'diagnostic-2',
          traceId: 'trace-2',
          memoryComparison: { status: 'same', falsePositiveCount: -1 },
          validationDetails: {
            scenarioId: 'crisis-self-harm',
            migrationCaseIds: ['crisis-self-harm'],
            reasonCodes: [],
          },
        }),
      ],
    });
    const decision = buildCanaryGateDecision({ report });

    expect(report.memoryComparison.falsePositiveCount).toBe(1);
    expect(report.migrationCases[0]?.memoryFalsePositiveCount).toBe(1);
    expect(decision.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reasonCode: 'sensitive_memory_false_positive',
          migrationCaseIds: ['crisis-self-harm'],
          count: 1,
        }),
      ]),
    );
  });

  it('blocks readiness for safety, privacy, and consent policy regressions from stable reason codes', () => {
    const policyRegressionDiagnostics = [
      diagnostic({
        id: 'diagnostic-risk-suppression',
        traceId: 'trace-risk-suppression',
        validationDetails: {
          scenarioId: 'risk-survey-suppression',
          migrationCaseIds: ['burnout-severe-stress'],
          reasonCodes: ['risk_suppression_regression'],
        },
      }),
      diagnostic({
        id: 'diagnostic-escalation',
        traceId: 'trace-escalation',
        validationDetails: {
          scenarioId: 'critical-escalation',
          migrationCaseIds: ['crisis-self-harm'],
          reasonCodes: ['escalation_trigger_regression'],
        },
      }),
      diagnostic({
        id: 'diagnostic-manager-privacy',
        traceId: 'trace-manager-privacy',
        validationDetails: {
          scenarioId: 'manager-privacy',
          migrationCaseIds: ['manager-privacy-request'],
          reasonCodes: ['manager_privacy_regression'],
        },
      }),
      diagnostic({
        id: 'diagnostic-cohort-minimum',
        traceId: 'trace-cohort-minimum',
        validationDetails: {
          scenarioId: 'manager-analytics-cohort',
          migrationCaseIds: ['manager-privacy-request'],
          reasonCodes: ['cohort_minimum_regression'],
        },
      }),
      diagnostic({
        id: 'diagnostic-survey-consent',
        traceId: 'trace-survey-consent',
        validationDetails: {
          scenarioId: 'survey-consent',
          migrationCaseIds: ['assessment-preparation'],
          reasonCodes: ['survey_consent_regression'],
        },
      }),
      diagnostic({
        id: 'diagnostic-proactive-consent',
        traceId: 'trace-proactive-consent',
        validationDetails: {
          scenarioId: 'proactive-consent',
          migrationCaseIds: ['unwanted-proactivity'],
          reasonCodes: ['proactive_consent_regression'],
        },
      }),
      diagnostic({
        id: 'diagnostic-gdpr-ownership',
        traceId: 'trace-gdpr-ownership',
        validationDetails: {
          scenarioId: 'gdpr-deletion-export',
          migrationCaseIds: ['incorrect-memory-correction'],
          reasonCodes: ['gdpr_deletion_export_regression'],
        },
      }),
    ];
    const report = buildShadowReadinessReport({
      tenantId: 'tenant-1',
      generatedAt,
      requiredMigrationCaseIds: [
        'burnout-severe-stress',
        'crisis-self-harm',
        'manager-privacy-request',
        'assessment-preparation',
        'unwanted-proactivity',
        'incorrect-memory-correction',
      ],
      gateSummary: passedGateSummary({
        manualReview: {
          requiredScenarioIds: [],
          requiredCaseIds: [],
        },
      }),
      diagnostics: policyRegressionDiagnostics,
    });

    expect(report.status).toBe('blocked');
    expect(report.quality.validationReasonCodes).toEqual([
      'risk_suppression_regression',
      'escalation_trigger_regression',
      'manager_privacy_regression',
      'cohort_minimum_regression',
      'survey_consent_regression',
      'proactive_consent_regression',
      'gdpr_deletion_export_regression',
    ]);
    expect(report.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reasonCode: 'risk_suppression_regression',
          diagnosticId: 'diagnostic-risk-suppression',
          traceId: 'trace-risk-suppression',
          scenarioId: 'risk-survey-suppression',
          migrationCaseIds: ['burnout-severe-stress'],
        }),
        expect.objectContaining({
          reasonCode: 'escalation_trigger_regression',
          diagnosticId: 'diagnostic-escalation',
          traceId: 'trace-escalation',
          scenarioId: 'critical-escalation',
          migrationCaseIds: ['crisis-self-harm'],
        }),
        expect.objectContaining({ reasonCode: 'manager_privacy_regression' }),
        expect.objectContaining({ reasonCode: 'cohort_minimum_regression' }),
        expect.objectContaining({ reasonCode: 'survey_consent_regression' }),
        expect.objectContaining({ reasonCode: 'proactive_consent_regression' }),
        expect.objectContaining({ reasonCode: 'gdpr_deletion_export_regression' }),
      ]),
    );
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

describe('buildCanaryGateDecision', () => {
  it('enables canary only for a ready report with clean thresholds', () => {
    const report = buildShadowReadinessReport({
      tenantId: 'tenant-1',
      generatedAt,
      requiredMigrationCaseIds: ['casual-conversation'],
      gateSummary: passedGateSummary(),
      diagnostics: [
        diagnostic({
          validationDetails: {
            scenarioId: 'planning-memory',
            migrationCaseIds: ['casual-conversation'],
            reasonCodes: [],
          },
          latencyMs: 100,
          estimatedCost: '0.000100',
        }),
      ],
    });

    const decision = buildCanaryGateDecision({
      report,
      config: {
        maxLatencyMs: 250,
        maxEstimatedCost: 0.001,
      },
    });

    expect(decision).toMatchObject({
      schemaVersion: 1,
      status: 'ready',
      canaryEnabled: true,
      blockers: [],
    });
  });

  it.each([
    ['validation_failure', { validationStatus: 'invalid' }],
    ['comparison_failed', { validationStatus: 'comparison_failed' }],
    ['redaction_rejected', { redactionStatus: 'rejected' }],
    ['diagnostic_payload_malformed', { riskComparison: null }],
  ] as const)('keeps canary disabled for existing report blocker %s', (reasonCode, overrides) => {
    const report = buildShadowReadinessReport({
      tenantId: 'tenant-1',
      generatedAt,
      requiredMigrationCaseIds: ['casual-conversation'],
      gateSummary: passedGateSummary(),
      diagnostics: [
        diagnostic({
          validationDetails: {
            scenarioId: 'planning-memory',
            migrationCaseIds: ['casual-conversation'],
            reasonCodes: [],
          },
          ...overrides,
        }),
      ],
    });

    const decision = buildCanaryGateDecision({ report });

    expect(decision.canaryEnabled).toBe(false);
    expect(decision.status).toBe('blocked');
    expect(decision.blockers.map((blocker) => blocker.reasonCode)).toContain(reasonCode);
  });

  it('keeps manual review and insufficient data as non-enabled canary states', () => {
    const manualReviewReport = buildShadowReadinessReport({
      tenantId: 'tenant-1',
      generatedAt,
      requiredMigrationCaseIds: ['burnout-severe-stress'],
      gateSummary: passedGateSummary(),
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
    const insufficientDataReport = buildShadowReadinessReport({
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

    expect(buildCanaryGateDecision({ report: manualReviewReport })).toMatchObject({
      status: 'manual_review_required',
      canaryEnabled: false,
      blockers: [expect.objectContaining({ reasonCode: 'manual_review_required' })],
    });
    expect(buildCanaryGateDecision({ report: insufficientDataReport })).toMatchObject({
      status: 'insufficient_data',
      canaryEnabled: false,
      blockers: [expect.objectContaining({ reasonCode: 'insufficient_shadow_data' })],
    });
  });

  it('blocks canary when latency or cost thresholds are exceeded', () => {
    const report = buildShadowReadinessReport({
      tenantId: 'tenant-1',
      generatedAt,
      requiredMigrationCaseIds: ['casual-conversation'],
      gateSummary: passedGateSummary(),
      diagnostics: [
        diagnostic({
          validationDetails: {
            scenarioId: 'planning-memory',
            migrationCaseIds: ['casual-conversation'],
            reasonCodes: [],
          },
          latencyMs: 900,
          estimatedCost: '0.010000',
        }),
      ],
    });

    const decision = buildCanaryGateDecision({
      report,
      config: {
        maxLatencyMs: 250,
        maxEstimatedCost: 0.001,
      },
    });

    expect(decision.canaryEnabled).toBe(false);
    expect(decision.status).toBe('blocked');
    expect(decision.blockers.map((blocker) => blocker.reasonCode)).toEqual(
      expect.arrayContaining(['latency_threshold_exceeded', 'cost_threshold_exceeded']),
    );
  });

  it('uses max latency and cost for threshold gating even when p95 stays below limits', () => {
    const diagnostics = Array.from({ length: 20 }, (_, index) =>
      diagnostic({
        id: `diagnostic-${index + 1}`,
        traceId: `trace-${index + 1}`,
        validationDetails: {
          scenarioId: 'planning-memory',
          migrationCaseIds: ['casual-conversation'],
          reasonCodes: [],
        },
        latencyMs: index === 19 ? 900 : 100,
        estimatedCost: index === 19 ? '0.010000' : '0.000100',
      }),
    );
    const report = buildShadowReadinessReport({
      tenantId: 'tenant-1',
      generatedAt,
      requiredMigrationCaseIds: ['casual-conversation'],
      gateSummary: passedGateSummary(),
      diagnostics,
    });

    const decision = buildCanaryGateDecision({
      report,
      config: {
        maxLatencyMs: 250,
        maxEstimatedCost: 0.001,
      },
    });

    expect(report.metrics.latencyMs.p95).toBe(100);
    expect(report.metrics.estimatedCost.p95).toBe(0.0001);
    expect(decision.canaryEnabled).toBe(false);
    expect(decision.blockers.map((blocker) => blocker.reasonCode)).toEqual(
      expect.arrayContaining(['latency_threshold_exceeded', 'cost_threshold_exceeded']),
    );
  });

  it('blocks canary when shadow diagnostics are stale', () => {
    const report = buildShadowReadinessReport({
      tenantId: 'tenant-1',
      generatedAt,
      requiredMigrationCaseIds: ['casual-conversation'],
      gateSummary: passedGateSummary(),
      diagnostics: [
        diagnostic({
          validationDetails: {
            scenarioId: 'planning-memory',
            migrationCaseIds: ['casual-conversation'],
            reasonCodes: [],
          },
          createdAt: new Date('2026-08-05T19:45:00.000Z'),
        }),
      ],
    });

    const decision = buildCanaryGateDecision({
      report,
      config: {
        maxDiagnosticAgeMs: 60 * 60 * 1000,
      },
    });

    expect(decision.canaryEnabled).toBe(false);
    expect(decision.status).toBe('blocked');
    expect(decision.blockers.map((blocker) => blocker.reasonCode)).toContain(
      'stale_shadow_diagnostics',
    );
  });

  it.each([
    [
      'baseline gate failure',
      passedGateSummary({ status: 'failed' }),
      ['casual-conversation'],
      'baseline_gate_failed',
    ],
    ['missing gate summary', null, ['casual-conversation'], 'insufficient_shadow_data'],
    [
      'missing baseline coverage',
      passedGateSummary(),
      ['casual-conversation', 'terse-acknowledgement'],
      'insufficient_shadow_data',
    ],
    [
      'critical risk false negative',
      passedGateSummary(),
      ['crisis-self-harm'],
      'critical_risk_false_negative',
    ],
    [
      'duplicate action proposal',
      passedGateSummary(),
      ['casual-conversation'],
      'duplicate_action_proposal',
    ],
  ] as const)(
    'keeps canary disabled for %s',
    (_label, gateSummary, requiredMigrationCaseIds, expectedReasonCode) => {
      const isCriticalRiskCase = expectedReasonCode === 'critical_risk_false_negative';
      const isDuplicateActionCase = expectedReasonCode === 'duplicate_action_proposal';
      const report = buildShadowReadinessReport({
        tenantId: 'tenant-1',
        generatedAt,
        requiredMigrationCaseIds,
        gateSummary,
        diagnostics: [
          diagnostic({
            validationDetails: {
              scenarioId: isCriticalRiskCase ? 'crisis-self-harm' : 'planning-memory',
              migrationCaseIds: [isCriticalRiskCase ? 'crisis-self-harm' : 'casual-conversation'],
              reasonCodes: [],
            },
            ...(isCriticalRiskCase
              ? {
                  riskComparison: {
                    status: 'worse',
                    currentSeverity: 'critical',
                    candidateSeverity: 'none',
                    falseNegative: true,
                    criticalFalseNegative: true,
                  },
                }
              : {}),
            ...(isDuplicateActionCase
              ? {
                  actionComparison: { status: 'worse', duplicateProposalCount: 1 },
                }
              : {}),
          }),
        ],
      });

      const decision = buildCanaryGateDecision({ report });

      expect(decision.canaryEnabled).toBe(false);
      expect(decision.status).not.toBe('ready');
      expect(decision.blockers.map((blocker) => blocker.reasonCode)).toContain(
        expectedReasonCode,
      );
    },
  );

  it('keeps canary disabled for direct report blockers', () => {
    const report = buildShadowReadinessReport({
      tenantId: 'tenant-1',
      generatedAt,
      requiredMigrationCaseIds: ['casual-conversation'],
      gateSummary: passedGateSummary(),
      diagnostics: [
        diagnostic({
          validationDetails: {
            scenarioId: 'planning-memory',
            migrationCaseIds: ['casual-conversation'],
            reasonCodes: [],
          },
          riskComparison: {
            status: 'worse',
            currentSeverity: 'critical',
            candidateSeverity: 'none',
            falseNegative: true,
            criticalFalseNegative: true,
          },
          actionComparison: { status: 'worse', duplicateProposalCount: 1 },
        }),
      ],
    });
    const decision = buildCanaryGateDecision({ report });

    expect(decision.canaryEnabled).toBe(false);
    expect(decision.blockers.map((blocker) => blocker.reasonCode)).toEqual(
      expect.arrayContaining(['critical_risk_false_negative', 'duplicate_action_proposal']),
    );
  });

  it('blocks sensitive memory false positives without serializing memory content', () => {
    const report = buildShadowReadinessReport({
      tenantId: 'tenant-1',
      generatedAt,
      requiredMigrationCaseIds: ['crisis-self-harm'],
      gateSummary: passedGateSummary({
        manualReview: {
          requiredScenarioIds: [],
          requiredCaseIds: [],
        },
      }),
      diagnostics: [
        diagnostic({
          memoryComparison: {
            status: 'different',
            falsePositiveCount: 1,
            memoryContent: 'raw sensitive memory content',
          },
          validationDetails: {
            scenarioId: 'crisis-self-harm',
            migrationCaseIds: ['crisis-self-harm'],
            reasonCodes: [],
          },
        }),
      ],
    });

    const decision = buildCanaryGateDecision({ report });
    const serialized = JSON.stringify(decision);

    expect(decision.canaryEnabled).toBe(false);
    expect(decision.blockers.map((blocker) => blocker.reasonCode)).toContain(
      'sensitive_memory_false_positive',
    );
    expect(serialized).not.toContain('raw sensitive memory content');
  });

  it('keeps canary disabled and evidence privacy-safe for policy regressions', () => {
    const report = buildShadowReadinessReport({
      tenantId: 'tenant-1',
      generatedAt,
      requiredMigrationCaseIds: ['manager-privacy-request', 'assessment-preparation'],
      gateSummary: passedGateSummary({
        manualReview: {
          requiredScenarioIds: [],
          requiredCaseIds: [],
        },
      }),
      diagnostics: [
        diagnostic({
          id: 'diagnostic-policy-1',
          traceId: 'trace-policy-1',
          currentResult: { text: 'raw individual manager analytics text' },
          candidateResult: { reply: 'raw candidate reply with secret' },
          riskComparison: { status: 'same', evidence: 'raw risk evidence' },
          memoryComparison: { status: 'same', memoryContent: 'raw memory content' },
          actionComparison: { status: 'same', actionPayload: 'raw action payload' },
          validationDetails: {
            scenarioId: 'manager-privacy',
            migrationCaseIds: ['manager-privacy-request'],
            reasonCodes: ['manager_privacy_regression', 'bearer:sk-live-secret'],
            providerError: 'raw provider stack trace',
          },
        }),
        diagnostic({
          id: 'diagnostic-policy-2',
          traceId: 'trace-policy-2',
          validationDetails: {
            scenarioId: 'survey-consent',
            migrationCaseIds: ['assessment-preparation'],
            reasonCodes: ['survey_consent_regression'],
          },
        }),
      ],
    });

    const decision = buildCanaryGateDecision({ report });
    const serialized = JSON.stringify(decision);

    expect(decision.status).toBe('blocked');
    expect(decision.canaryEnabled).toBe(false);
    expect(decision.blockers.map((blocker) => blocker.reasonCode)).toEqual(
      expect.arrayContaining([
        'manager_privacy_regression',
        'survey_consent_regression',
        'redaction_rejected',
      ]),
    );
    expect(serialized).toContain('diagnostic-policy-1');
    expect(serialized).toContain('trace-policy-1');
    expect(serialized).toContain('manager_privacy_regression');
    expect(serialized).not.toContain('raw individual manager analytics text');
    expect(serialized).not.toContain('raw candidate reply with secret');
    expect(serialized).not.toContain('raw risk evidence');
    expect(serialized).not.toContain('raw memory content');
    expect(serialized).not.toContain('raw action payload');
    expect(serialized).not.toContain('raw provider stack trace');
    expect(serialized).not.toContain('bearer:sk-live-secret');
  });

  it('keeps canary gate serialization privacy-safe', () => {
    const report = buildShadowReadinessReport({
      tenantId: 'tenant-1',
      generatedAt,
      requiredMigrationCaseIds: ['casual-conversation'],
      gateSummary: passedGateSummary(),
      diagnostics: [
        diagnostic({
          currentResult: { text: 'raw current response text' },
          candidateResult: { reply: 'raw candidate response text' },
          riskComparison: { status: 'same', evidence: 'raw risk evidence' },
          memoryComparison: { status: 'same', memoryContent: 'raw memory content' },
          actionComparison: { status: 'same', actionPayload: 'raw action payload' },
          validationDetails: {
            scenarioId: 'planning-memory',
            migrationCaseIds: ['casual-conversation'],
            reasonCodes: [],
            providerError: 'raw provider stack trace with bearer token',
          },
        }),
      ],
    });

    const serialized = JSON.stringify(buildCanaryGateDecision({ report }));

    expect(serialized).not.toContain('raw current response text');
    expect(serialized).not.toContain('raw candidate response text');
    expect(serialized).not.toContain('raw risk evidence');
    expect(serialized).not.toContain('raw memory content');
    expect(serialized).not.toContain('raw action payload');
    expect(serialized).not.toContain('raw provider stack trace');
    expect(serialized).not.toContain('bearer token');
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

  it('does not introduce out-of-scope canary rollout, deployment mutation, or UI files', () => {
    const repoRoot = join(process.cwd(), '../..');

    expect(existsSync(join(repoRoot, 'apps/dashboard/src/canary-readiness-report.tsx'))).toBe(false);
    expect(existsSync(join(repoRoot, 'apps/dashboard/src/shadow-readiness-report.tsx'))).toBe(false);
    expect(existsSync(join(repoRoot, 'agent-service/src/agent_service/tools/command_tool.py'))).toBe(false);
    expect(existsSync(join(repoRoot, 'agent-service/src/agent_service/tools/write_tool.py'))).toBe(false);
    expect(existsSync(join(repoRoot, 'agent-service/deployment/canary-rollout.toml'))).toBe(false);
  });
});
