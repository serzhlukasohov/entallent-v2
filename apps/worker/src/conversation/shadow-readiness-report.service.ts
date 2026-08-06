import { Injectable } from '@nestjs/common';
import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { runtimeShadowDiagnostics } from '@entalent/database';
import {
  REQUIRED_MIGRATION_BASELINE_CASE_IDS,
  SENSITIVE_MIGRATION_BASELINE_CASE_IDS,
  type MigrationBaselineCaseId,
} from '@entalent/contracts';
import { DatabaseService } from '../database/database.service';

export const REQUIRED_SHADOW_READINESS_MIGRATION_CASE_IDS = REQUIRED_MIGRATION_BASELINE_CASE_IDS;

export type ShadowReadinessMigrationCaseId = MigrationBaselineCaseId;

export type ShadowReadinessStatus =
  | 'ready'
  | 'blocked'
  | 'manual_review_required'
  | 'insufficient_data';

export type ShadowReadinessReasonCode =
  | 'baseline_gate_failed'
  | 'critical_risk_false_negative'
  | 'duplicate_action_proposal'
  | 'validation_failure'
  | 'comparison_failed'
  | 'redaction_rejected'
  | 'missing_baseline_coverage'
  | 'missing_baseline_gate_summary'
  | 'diagnostic_payload_malformed'
  | 'memory_difference'
  | 'action_difference'
  | 'risk_difference';

export interface ShadowReadinessGateSummary {
  status?: string;
  manualReview?: {
    requiredScenarioIds?: string[];
    requiredCaseIds?: string[];
  };
}

export interface ShadowDiagnosticReportRow {
  id: string;
  tenantId: string;
  messageId: string;
  runtimeAttemptId: string;
  runtimeMode: string;
  traceId: string;
  runtimeVersion: string;
  validationStatus: string;
  redactionStatus: string;
  riskComparison: unknown;
  memoryComparison: unknown;
  actionComparison: unknown;
  validationDetails: unknown;
  latencyMs: number;
  modelCallCount: number;
  toolCallCount: number;
  retryCount: number;
  estimatedCost: string | number;
  createdAt: Date;
  updatedAt: Date;
}

export interface BuildShadowReadinessReportParams {
  tenantId: string;
  diagnostics: ShadowDiagnosticReportRow[];
  gateSummary?: ShadowReadinessGateSummary | null;
  requiredMigrationCaseIds?: readonly string[];
  generatedAt?: Date;
  from?: Date;
  to?: Date;
}

export interface GenerateShadowReadinessReportParams {
  tenantId: string;
  gateSummary?: ShadowReadinessGateSummary | null;
  requiredMigrationCaseIds?: readonly string[];
  generatedAt?: Date;
  from?: Date;
  to?: Date;
}

export interface ShadowReadinessReport {
  schemaVersion: 1;
  status: ShadowReadinessStatus;
  generatedAt: string;
  metadata: {
    tenantId: string;
    from: string | null;
    to: string | null;
    diagnosticCount: number;
    runtimeVersions: string[];
    scenarioIds: string[];
    migrationCaseIds: string[];
    traceIds: string[];
  };
  quality: {
    validationFailures: number;
    comparisonFailures: number;
    redactionRejected: number;
    validationReasonCodes: string[];
  };
  riskParity: {
    falseNegativeCount: number;
    criticalFalseNegativeCount: number;
    differences: number;
  };
  memoryComparison: {
    differences: number;
    falsePositiveCount: number;
  };
  actionComparison: {
    differences: number;
    duplicateProposalCount: number;
  };
  metrics: {
    latencyMs: MetricSummary;
    modelCallCount: MetricSummary;
    toolCallCount: MetricSummary;
    retryCount: MetricSummary;
    estimatedCost: MetricSummary;
  };
  migrationCases: MigrationCaseSummary[];
  blockers: ShadowReadinessReason[];
  warnings: ShadowReadinessReason[];
  manualReview: {
    requiredScenarioIds: string[];
    requiredCaseIds: string[];
  };
  insufficientDataReasons: Array<{
    reasonCode: 'missing_baseline_coverage' | 'missing_baseline_gate_summary';
    migrationCaseIds: string[];
  }>;
}

export interface MetricSummary {
  count: number;
  mean: number;
  max: number;
  p95: number | null;
}

export interface ShadowReadinessReason {
  reasonCode: ShadowReadinessReasonCode;
  diagnosticId?: string;
  traceId?: string;
  migrationCaseIds?: string[];
  scenarioId?: string;
  count?: number;
}

export interface MigrationCaseSummary {
  migrationCaseId: string;
  diagnosticCount: number;
  scenarioIds: string[];
  traceIds: string[];
  validationFailures: number;
  comparisonFailures: number;
  criticalRiskFalseNegatives: number;
  duplicateActionProposals: number;
  metrics: {
    latencyMs: MetricSummary;
    modelCallCount: MetricSummary;
    toolCallCount: MetricSummary;
    retryCount: MetricSummary;
    estimatedCost: MetricSummary;
  };
}

@Injectable()
export class ShadowReadinessReportService {
  constructor(private readonly db: Pick<DatabaseService, 'client'>) {}

  async generateReport(params: GenerateShadowReadinessReportParams): Promise<ShadowReadinessReport> {
    const conditions = [eq(runtimeShadowDiagnostics.tenantId, params.tenantId)];
    if (params.from) {
      conditions.push(gte(runtimeShadowDiagnostics.createdAt, params.from));
    }
    if (params.to) {
      conditions.push(lte(runtimeShadowDiagnostics.createdAt, params.to));
    }

    const diagnostics = await this.db.client
      .select({
        id: runtimeShadowDiagnostics.id,
        tenantId: runtimeShadowDiagnostics.tenantId,
        messageId: runtimeShadowDiagnostics.messageId,
        runtimeAttemptId: runtimeShadowDiagnostics.runtimeAttemptId,
        runtimeMode: runtimeShadowDiagnostics.runtimeMode,
        traceId: runtimeShadowDiagnostics.traceId,
        runtimeVersion: runtimeShadowDiagnostics.runtimeVersion,
        validationStatus: runtimeShadowDiagnostics.validationStatus,
        redactionStatus: runtimeShadowDiagnostics.redactionStatus,
        riskComparison: runtimeShadowDiagnostics.riskComparison,
        memoryComparison: runtimeShadowDiagnostics.memoryComparison,
        actionComparison: runtimeShadowDiagnostics.actionComparison,
        validationDetails: runtimeShadowDiagnostics.validationDetails,
        latencyMs: runtimeShadowDiagnostics.latencyMs,
        modelCallCount: runtimeShadowDiagnostics.modelCallCount,
        toolCallCount: runtimeShadowDiagnostics.toolCallCount,
        retryCount: runtimeShadowDiagnostics.retryCount,
        estimatedCost: runtimeShadowDiagnostics.estimatedCost,
        createdAt: runtimeShadowDiagnostics.createdAt,
        updatedAt: runtimeShadowDiagnostics.updatedAt,
      })
      .from(runtimeShadowDiagnostics)
      .where(and(...conditions))
      .orderBy(desc(runtimeShadowDiagnostics.createdAt));

    return buildShadowReadinessReport({
      tenantId: params.tenantId,
      diagnostics: diagnostics.map(toReportRow),
      gateSummary: params.gateSummary,
      requiredMigrationCaseIds: params.requiredMigrationCaseIds,
      generatedAt: params.generatedAt,
      from: params.from,
      to: params.to,
    });
  }
}

export function buildShadowReadinessReport(
  params: BuildShadowReadinessReportParams,
): ShadowReadinessReport {
  const generatedAt = params.generatedAt ?? new Date();
  const requiredMigrationCaseIds =
    params.requiredMigrationCaseIds ?? REQUIRED_SHADOW_READINESS_MIGRATION_CASE_IDS;

  const blockers: ShadowReadinessReason[] = [];
  const warnings: ShadowReadinessReason[] = [];
  const observedCaseIds = new Set<string>();
  const sensitiveScenarioIds = new Set<string>();
  const validationReasonCodes = new Set<string>();
  const caseSummaries = new Map<string, MutableMigrationCaseSummary>();

  let validationFailures = 0;
  let comparisonFailures = 0;
  let redactionRejected = 0;
  let falseNegativeCount = 0;
  let criticalFalseNegativeCount = 0;
  let riskDifferences = 0;
  let memoryDifferences = 0;
  let memoryFalsePositiveCount = 0;
  let actionDifferences = 0;
  let duplicateProposalCount = 0;

  for (const diagnostic of params.diagnostics) {
    const validationDetails = expectedObjectValue(diagnostic.validationDetails, 'validationDetails', diagnostic, blockers);
    const riskComparison = expectedObjectValue(diagnostic.riskComparison, 'riskComparison', diagnostic, blockers);
    const memoryComparison = expectedObjectValue(diagnostic.memoryComparison, 'memoryComparison', diagnostic, blockers);
    const actionComparison = expectedObjectValue(diagnostic.actionComparison, 'actionComparison', diagnostic, blockers);
    const scenarioId = stringValue(validationDetails['scenarioId']);
    const migrationCaseIds = stringArrayValue(validationDetails['migrationCaseIds']);

    for (const caseId of migrationCaseIds) {
      observedCaseIds.add(caseId);
      if (scenarioId && isSensitiveMigrationCaseId(caseId)) {
        sensitiveScenarioIds.add(scenarioId);
      }
    }
    for (const reasonCode of stringArrayValue(validationDetails['reasonCodes'])) {
      if (isStableReasonCode(reasonCode)) {
        validationReasonCodes.add(reasonCode);
      } else {
        blockers.push({
          reasonCode: 'redaction_rejected',
          diagnosticId: diagnostic.id,
          traceId: diagnostic.traceId,
          scenarioId,
          migrationCaseIds,
        });
      }
    }

    if (diagnostic.validationStatus === 'invalid') {
      validationFailures += 1;
      blockers.push({
        reasonCode: 'validation_failure',
        diagnosticId: diagnostic.id,
        traceId: diagnostic.traceId,
        scenarioId,
        migrationCaseIds,
      });
    }
    if (diagnostic.validationStatus === 'comparison_failed') {
      comparisonFailures += 1;
      blockers.push({
        reasonCode: 'comparison_failed',
        diagnosticId: diagnostic.id,
        traceId: diagnostic.traceId,
        scenarioId,
        migrationCaseIds,
      });
    }
    if (diagnostic.redactionStatus === 'rejected') {
      redactionRejected += 1;
      blockers.push({
        reasonCode: 'redaction_rejected',
        diagnosticId: diagnostic.id,
        traceId: diagnostic.traceId,
        scenarioId,
        migrationCaseIds,
      });
    }

    if (booleanValue(riskComparison['falseNegative']) || isCriticalSeverityRegression(riskComparison)) {
      falseNegativeCount += 1;
    }
    if (isDifferentStatus(riskComparison['status'])) {
      riskDifferences += 1;
      warnings.push({
        reasonCode: 'risk_difference',
        diagnosticId: diagnostic.id,
        traceId: diagnostic.traceId,
        scenarioId,
        migrationCaseIds,
      });
    }
    if (booleanValue(riskComparison['criticalFalseNegative']) || isCriticalSeverityRegression(riskComparison)) {
      criticalFalseNegativeCount += 1;
      blockers.push({
        reasonCode: 'critical_risk_false_negative',
        diagnosticId: diagnostic.id,
        traceId: diagnostic.traceId,
        scenarioId,
        migrationCaseIds,
      });
    }

    if (isDifferentStatus(memoryComparison['status'])) {
      memoryDifferences += 1;
      warnings.push({
        reasonCode: 'memory_difference',
        diagnosticId: diagnostic.id,
        traceId: diagnostic.traceId,
        scenarioId,
        migrationCaseIds,
      });
    }
    memoryFalsePositiveCount += numericValue(memoryComparison['falsePositiveCount']);

    if (isDifferentStatus(actionComparison['status'])) {
      actionDifferences += 1;
      warnings.push({
        reasonCode: 'action_difference',
        diagnosticId: diagnostic.id,
        traceId: diagnostic.traceId,
        scenarioId,
        migrationCaseIds,
      });
    }
    const duplicateCount = numericValue(actionComparison['duplicateProposalCount']);
    duplicateProposalCount += duplicateCount;
    if (duplicateCount > 0 || isDuplicateActionStatus(actionComparison['status'])) {
      blockers.push({
        reasonCode: 'duplicate_action_proposal',
        diagnosticId: diagnostic.id,
        traceId: diagnostic.traceId,
        scenarioId,
        migrationCaseIds,
        count: duplicateCount > 0 ? duplicateCount : undefined,
      });
    }

    for (const caseId of migrationCaseIds) {
      const summary = getMutableCaseSummary(caseSummaries, caseId);
      summary.diagnostics.push(diagnostic);
      if (scenarioId) summary.scenarioIds.add(scenarioId);
      summary.traceIds.add(diagnostic.traceId);
      if (diagnostic.validationStatus === 'invalid') summary.validationFailures += 1;
      if (diagnostic.validationStatus === 'comparison_failed') summary.comparisonFailures += 1;
      if (booleanValue(riskComparison['criticalFalseNegative']) || isCriticalSeverityRegression(riskComparison)) {
        summary.criticalRiskFalseNegatives += 1;
      }
      summary.duplicateActionProposals += duplicateCount > 0 ? duplicateCount : isDuplicateActionStatus(actionComparison['status']) ? 1 : 0;
    }
  }

  if (params.gateSummary?.status === 'failed') {
    blockers.push({ reasonCode: 'baseline_gate_failed' });
  }

  const missingCaseIds = requiredMigrationCaseIds.filter((caseId) => !observedCaseIds.has(caseId));
  const insufficientDataReasons =
    [
      ...(params.gateSummary
        ? []
        : [
            {
              reasonCode: 'missing_baseline_gate_summary' as const,
              migrationCaseIds: [...requiredMigrationCaseIds],
            },
          ]),
      ...(missingCaseIds.length > 0
        ? [{ reasonCode: 'missing_baseline_coverage' as const, migrationCaseIds: missingCaseIds }]
        : []),
    ];

  const manualReview = {
    requiredScenarioIds: uniqueStrings([
      ...(params.gateSummary?.manualReview?.requiredScenarioIds ?? []),
      ...sensitiveScenarioIds,
    ]),
    requiredCaseIds: uniqueStrings([
      ...(params.gateSummary?.manualReview?.requiredCaseIds ?? []),
      ...[...observedCaseIds].filter(isSensitiveMigrationCaseId),
    ]),
  };

  const status = resolveStatus({
    blockers,
    insufficientDataReasons,
    gateStatus: params.gateSummary?.status,
    manualReview,
  });

  return {
    schemaVersion: 1,
    status,
    generatedAt: generatedAt.toISOString(),
    metadata: {
      tenantId: params.tenantId,
      from: params.from?.toISOString() ?? null,
      to: params.to?.toISOString() ?? null,
      diagnosticCount: params.diagnostics.length,
      runtimeVersions: uniqueStrings(params.diagnostics.map((diagnostic) => diagnostic.runtimeVersion)),
      scenarioIds: uniqueStrings(
        params.diagnostics
          .map((diagnostic) => stringValue(objectValue(diagnostic.validationDetails)['scenarioId']))
          .filter(isNonEmptyString),
      ),
      migrationCaseIds: uniqueStrings([...observedCaseIds]),
      traceIds: uniqueStrings(params.diagnostics.map((diagnostic) => diagnostic.traceId)),
    },
    quality: {
      validationFailures,
      comparisonFailures,
      redactionRejected,
      validationReasonCodes: uniqueStrings([...validationReasonCodes]),
    },
    riskParity: {
      falseNegativeCount,
      criticalFalseNegativeCount,
      differences: riskDifferences,
    },
    memoryComparison: {
      differences: memoryDifferences,
      falsePositiveCount: memoryFalsePositiveCount,
    },
    actionComparison: {
      differences: actionDifferences,
      duplicateProposalCount,
    },
    metrics: {
      latencyMs: summarizeMetric(params.diagnostics.map((diagnostic) => diagnostic.latencyMs)),
      modelCallCount: summarizeMetric(params.diagnostics.map((diagnostic) => diagnostic.modelCallCount)),
      toolCallCount: summarizeMetric(params.diagnostics.map((diagnostic) => diagnostic.toolCallCount)),
      retryCount: summarizeMetric(params.diagnostics.map((diagnostic) => diagnostic.retryCount)),
      estimatedCost: summarizeMetric(
        params.diagnostics.map((diagnostic) => Number(diagnostic.estimatedCost)),
      ),
    },
    migrationCases: [...caseSummaries.values()].map(toMigrationCaseSummary),
    blockers,
    warnings,
    manualReview,
    insufficientDataReasons,
  };
}

function resolveStatus(args: {
  blockers: ShadowReadinessReason[];
  insufficientDataReasons: ShadowReadinessReport['insufficientDataReasons'];
  gateStatus: string | undefined;
  manualReview: ShadowReadinessReport['manualReview'];
}): ShadowReadinessStatus {
  if (args.blockers.length > 0) return 'blocked';
  if (
    args.gateStatus === 'manual_review_required' ||
    args.manualReview.requiredScenarioIds.length > 0 ||
    args.manualReview.requiredCaseIds.length > 0
  ) {
    return 'manual_review_required';
  }
  if (args.insufficientDataReasons.length > 0) return 'insufficient_data';
  return 'ready';
}

const MIN_P95_SAMPLE_COUNT = 20;

function summarizeMetric(values: number[]): MetricSummary {
  const finiteValues = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (finiteValues.length === 0) {
    return { count: 0, mean: 0, max: 0, p95: null };
  }

  const sum = finiteValues.reduce((total, value) => total + value, 0);
  const p95Index = Math.max(0, Math.ceil(finiteValues.length * 0.95) - 1);
  return {
    count: finiteValues.length,
    mean: roundMetric(sum / finiteValues.length),
    max: roundMetric(finiteValues[finiteValues.length - 1]!),
    p95: finiteValues.length >= MIN_P95_SAMPLE_COUNT ? roundMetric(finiteValues[p95Index]!) : null,
  };
}

interface MutableMigrationCaseSummary {
  migrationCaseId: string;
  diagnostics: ShadowDiagnosticReportRow[];
  scenarioIds: Set<string>;
  traceIds: Set<string>;
  validationFailures: number;
  comparisonFailures: number;
  criticalRiskFalseNegatives: number;
  duplicateActionProposals: number;
}

function toReportRow(row: ShadowDiagnosticReportRow): ShadowDiagnosticReportRow {
  return row as unknown as ShadowDiagnosticReportRow;
}

function getMutableCaseSummary(
  summaries: Map<string, MutableMigrationCaseSummary>,
  migrationCaseId: string,
): MutableMigrationCaseSummary {
  const existing = summaries.get(migrationCaseId);
  if (existing) return existing;
  const created: MutableMigrationCaseSummary = {
    migrationCaseId,
    diagnostics: [],
    scenarioIds: new Set<string>(),
    traceIds: new Set<string>(),
    validationFailures: 0,
    comparisonFailures: 0,
    criticalRiskFalseNegatives: 0,
    duplicateActionProposals: 0,
  };
  summaries.set(migrationCaseId, created);
  return created;
}

function toMigrationCaseSummary(summary: MutableMigrationCaseSummary): MigrationCaseSummary {
  return {
    migrationCaseId: summary.migrationCaseId,
    diagnosticCount: summary.diagnostics.length,
    scenarioIds: uniqueStrings([...summary.scenarioIds]),
    traceIds: uniqueStrings([...summary.traceIds]),
    validationFailures: summary.validationFailures,
    comparisonFailures: summary.comparisonFailures,
    criticalRiskFalseNegatives: summary.criticalRiskFalseNegatives,
    duplicateActionProposals: summary.duplicateActionProposals,
    metrics: {
      latencyMs: summarizeMetric(summary.diagnostics.map((diagnostic) => diagnostic.latencyMs)),
      modelCallCount: summarizeMetric(summary.diagnostics.map((diagnostic) => diagnostic.modelCallCount)),
      toolCallCount: summarizeMetric(summary.diagnostics.map((diagnostic) => diagnostic.toolCallCount)),
      retryCount: summarizeMetric(summary.diagnostics.map((diagnostic) => diagnostic.retryCount)),
      estimatedCost: summarizeMetric(summary.diagnostics.map((diagnostic) => Number(diagnostic.estimatedCost))),
    },
  };
}

function expectedObjectValue(
  value: unknown,
  field: 'validationDetails' | 'riskComparison' | 'memoryComparison' | 'actionComparison',
  diagnostic: ShadowDiagnosticReportRow,
  blockers: ShadowReadinessReason[],
): Record<string, unknown> {
  const parsed = objectValue(value);
  const hasExpectedShape =
    field === 'validationDetails'
      ? parsed === value
      : parsed === value && typeof parsed['status'] === 'string';

  if (!hasExpectedShape) {
    blockers.push({
      reasonCode: 'diagnostic_payload_malformed',
      diagnosticId: diagnostic.id,
      traceId: diagnostic.traceId,
    });
  }

  return parsed;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(isNonEmptyString) : [];
}

function stringValue(value: unknown): string | undefined {
  return isNonEmptyString(value) ? value : undefined;
}

function numericValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function booleanValue(value: unknown): boolean {
  return value === true;
}

function isDifferentStatus(value: unknown): boolean {
  return typeof value === 'string' && !['same', 'equal', 'matched', 'none'].includes(value);
}

function isCriticalSeverityRegression(riskComparison: Record<string, unknown>): boolean {
  return (
    riskComparison['currentSeverity'] === 'critical' &&
    ['none', 'low'].includes(String(riskComparison['candidateSeverity'] ?? ''))
  );
}

function isDuplicateActionStatus(value: unknown): boolean {
  return typeof value === 'string' && /duplicate/i.test(value);
}

function isSensitiveMigrationCaseId(value: string): value is MigrationBaselineCaseId {
  return (SENSITIVE_MIGRATION_BASELINE_CASE_IDS as readonly string[]).includes(value);
}

function isStableReasonCode(value: string): boolean {
  return /^[a-z0-9][a-z0-9_:-]{0,79}$/.test(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter(isNonEmptyString))];
}

function roundMetric(value: number): number {
  return Number(value.toFixed(6));
}
