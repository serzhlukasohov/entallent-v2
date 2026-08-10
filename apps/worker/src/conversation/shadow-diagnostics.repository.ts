import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { runtimeAttempts, runtimeShadowDiagnostics } from '@entalent/database';
import type { DbRuntimeShadowDiagnostic } from '@entalent/database';
import { DatabaseService } from '../database/database.service';

export type ShadowDiagnosticsValidationStatus = 'valid' | 'invalid' | 'comparison_failed';
export type ShadowDiagnosticsRedactionStatus = 'redacted' | 'not_required' | 'rejected';
export type ShadowDiagnosticsRuntimeMode = 'typescript' | 'maf_shadow' | 'maf_canary' | 'maf_disabled';

export type ShadowDiagnosticsJsonValue =
  | null
  | string
  | number
  | boolean
  | ShadowDiagnosticsJsonValue[]
  | { [key: string]: ShadowDiagnosticsJsonValue };

export interface RecordShadowDiagnosticsParams {
  tenantId: string;
  messageId: string;
  runtimeAttemptId: string;
  runtimeMode: ShadowDiagnosticsRuntimeMode;
  traceId: string;
  runtimeVersion: string;
  validationStatus: ShadowDiagnosticsValidationStatus;
  currentResult: ShadowDiagnosticsJsonValue;
  candidateResult: ShadowDiagnosticsJsonValue;
  riskComparison: ShadowDiagnosticsJsonValue;
  memoryComparison: ShadowDiagnosticsJsonValue;
  actionComparison: ShadowDiagnosticsJsonValue;
  validationDetails: ShadowDiagnosticsJsonValue;
  latencyMs: number;
  modelCallCount: number;
  toolCallCount: number;
  retryCount: number;
  estimatedCost: number;
}

interface RedactedDiagnosticsFields {
  currentResult: ShadowDiagnosticsJsonValue;
  candidateResult: ShadowDiagnosticsJsonValue;
  riskComparison: ShadowDiagnosticsJsonValue;
  memoryComparison: ShadowDiagnosticsJsonValue;
  actionComparison: ShadowDiagnosticsJsonValue;
  validationDetails: ShadowDiagnosticsJsonValue;
  redactionStatus: ShadowDiagnosticsRedactionStatus;
  redactionDetails: {
    reasonCodes: string[];
  };
}

@Injectable()
export class ShadowDiagnosticsRepository {
  constructor(private readonly db: DatabaseService) {}

  async recordShadowDiagnostics(
    params: RecordShadowDiagnosticsParams,
  ): Promise<DbRuntimeShadowDiagnostic> {
    assertDiagnosticsParams(params);
    const redacted = redactShadowDiagnosticsFields(params);
    const now = new Date();

    return this.db.client.transaction(async (tx) => {
      const [attempt] = await tx
        .select()
        .from(runtimeAttempts)
        .where(
          and(
            eq(runtimeAttempts.id, params.runtimeAttemptId),
            eq(runtimeAttempts.tenantId, params.tenantId),
            eq(runtimeAttempts.messageId, params.messageId),
          ),
        )
        .limit(1);

      if (!attempt) {
        throw new Error('shadow_diagnostics_runtime_attempt_not_found');
      }

      if (attempt.runtimeMode !== params.runtimeMode || attempt.traceId !== params.traceId) {
        throw new Error('shadow_diagnostics_runtime_attempt_mismatch');
      }

      const values = {
        tenantId: params.tenantId,
        messageId: params.messageId,
        runtimeAttemptId: params.runtimeAttemptId,
        runtimeMode: params.runtimeMode,
        traceId: params.traceId,
        runtimeVersion: params.runtimeVersion,
        validationStatus: params.validationStatus,
        redactionStatus: redacted.redactionStatus,
        currentResult: redacted.currentResult,
        candidateResult: redacted.candidateResult,
        riskComparison: redacted.riskComparison,
        memoryComparison: redacted.memoryComparison,
        actionComparison: redacted.actionComparison,
        validationDetails: redacted.validationDetails,
        redactionDetails: redacted.redactionDetails,
        latencyMs: params.latencyMs,
        modelCallCount: params.modelCallCount,
        toolCallCount: params.toolCallCount,
        retryCount: params.retryCount,
        estimatedCost: params.estimatedCost.toFixed(6),
        updatedAt: now,
      };

      const [diagnostic] = await tx
        .insert(runtimeShadowDiagnostics)
        .values(values)
        .onConflictDoUpdate({
          target: [
            runtimeShadowDiagnostics.runtimeAttemptId,
            runtimeShadowDiagnostics.runtimeVersion,
          ],
          set: values,
        })
        .returning();

      if (!diagnostic) {
        throw new Error('shadow_diagnostics_record_failed');
      }

      return diagnostic;
    });
  }
}

export function redactShadowDiagnosticsFields(
  params: Pick<
    RecordShadowDiagnosticsParams,
    | 'currentResult'
    | 'candidateResult'
    | 'riskComparison'
    | 'memoryComparison'
    | 'actionComparison'
    | 'validationDetails'
  >,
): RedactedDiagnosticsFields {
  const reasonCodes = new Set<string>();
  const redact = (value: ShadowDiagnosticsJsonValue, keyPath: string[] = []): ShadowDiagnosticsJsonValue => {
    const reasonCode = redactionReasonForKey(keyPath[keyPath.length - 1]);
    if (reasonCode) {
      reasonCodes.add(reasonCode);
      return { redacted: true, reasonCode };
    }

    if (Array.isArray(value)) {
      return value.map((item) => redact(item, keyPath));
    }

    if (isPlainObject(value)) {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, redact(item, [...keyPath, key])]),
      );
    }

    if (typeof value === 'string' && !isAllowedDiagnosticStringKey(keyPath[keyPath.length - 1])) {
      reasonCodes.add('raw_text_redacted');
      return { redacted: true, reasonCode: 'raw_text_redacted' };
    }

    return value;
  };

  return {
    currentResult: redact(params.currentResult),
    candidateResult: redact(params.candidateResult),
    riskComparison: redact(params.riskComparison),
    memoryComparison: redact(params.memoryComparison),
    actionComparison: redact(params.actionComparison),
    validationDetails: redact(params.validationDetails),
    redactionStatus: reasonCodes.size > 0 ? 'redacted' : 'not_required',
    redactionDetails: {
      reasonCodes: [...reasonCodes].sort(),
    },
  };
}

function assertDiagnosticsParams(params: RecordShadowDiagnosticsParams): void {
  for (const [field, value] of Object.entries({
    tenantId: params.tenantId,
    messageId: params.messageId,
    runtimeAttemptId: params.runtimeAttemptId,
    traceId: params.traceId,
    runtimeVersion: params.runtimeVersion,
  })) {
    if (typeof value !== 'string' || value === '') {
      throw new Error(`shadow_diagnostics_${field}_invalid`);
    }
  }

  if (!isRuntimeMode(params.runtimeMode)) {
    throw new Error('shadow_diagnostics_runtime_mode_invalid');
  }
  if (!isValidationStatus(params.validationStatus)) {
    throw new Error('shadow_diagnostics_validation_status_invalid');
  }

  assertNonNegativeInteger('latency_ms', params.latencyMs);
  assertNonNegativeInteger('model_call_count', params.modelCallCount);
  assertNonNegativeInteger('tool_call_count', params.toolCallCount);
  assertNonNegativeInteger('retry_count', params.retryCount);

  if (!Number.isFinite(params.estimatedCost) || params.estimatedCost < 0) {
    throw new Error('shadow_diagnostics_estimated_cost_invalid');
  }

  for (const value of [
    params.currentResult,
    params.candidateResult,
    params.riskComparison,
    params.memoryComparison,
    params.actionComparison,
    params.validationDetails,
  ]) {
    assertJsonValue(value, 0);
  }
}

function assertNonNegativeInteger(field: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`shadow_diagnostics_${field}_invalid`);
  }
}

function assertJsonValue(value: unknown, depth: number): asserts value is ShadowDiagnosticsJsonValue {
  if (depth > 64) {
    throw new Error('shadow_diagnostics_json_invalid');
  }

  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      assertJsonValue(item, depth + 1);
    }
    return;
  }

  if (isPlainObject(value)) {
    for (const item of Object.values(value)) {
      assertJsonValue(item, depth + 1);
    }
    return;
  }

  throw new Error('shadow_diagnostics_json_invalid');
}

function redactionReasonForKey(key: string | undefined): string | null {
  if (!key) return null;
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (['text', 'rawtext', 'messagetext', 'replytext', 'candidatetext', 'reply'].includes(normalized)) {
    return 'raw_text_redacted';
  }
  if (['prompt', 'modelprompt', 'rawprompt', 'providerresponse', 'modelresponse'].includes(normalized)) {
    return 'model_prompt_redacted';
  }
  if (['riskevidence', 'evidence'].includes(normalized)) {
    return 'risk_evidence_redacted';
  }
  if (['memorycontent', 'content'].includes(normalized)) {
    return 'memory_content_redacted';
  }
  if (['actionpayload', 'payload', 'arguments'].includes(normalized)) {
    return 'action_payload_redacted';
  }
  if (['providererror', 'rawprovidererror', 'rawerror', 'error', 'stack', 'stacktrace'].includes(normalized)) {
    return 'provider_error_redacted';
  }
  if (['tenantname', 'workspacename', 'username', 'preferredname', 'displayname'].includes(normalized)) {
    return 'identity_text_redacted';
  }
  return null;
}

function isAllowedDiagnosticStringKey(key: string | undefined): boolean {
  if (!key) return false;
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return (
    normalized === 'status' ||
    normalized === 'outcome' ||
    normalized === 'reasoncode' ||
    normalized === 'reasoncodes' ||
    normalized === 'riskseverity' ||
    normalized === 'severity' ||
    normalized === 'comparison' ||
    normalized === 'replydigest' ||
    normalized === 'digest' ||
    normalized === 'hash' ||
    normalized === 'traceid' ||
    normalized === 'runtimeversion' ||
    normalized === 'requestid' ||
    normalized === 'eventid' ||
    normalized === 'migrationcaseid' ||
    normalized === 'migrationcaseids' ||
    normalized.endsWith('id') ||
    normalized.endsWith('ids') ||
    normalized.endsWith('digest') ||
    normalized.endsWith('hash')
  );
}

function isRuntimeMode(value: string): value is ShadowDiagnosticsRuntimeMode {
  return (
    value === 'typescript' ||
    value === 'maf_shadow' ||
    value === 'maf_canary' ||
    value === 'maf_disabled'
  );
}

function isValidationStatus(value: string): value is ShadowDiagnosticsValidationStatus {
  return value === 'valid' || value === 'invalid' || value === 'comparison_failed';
}

function isPlainObject(value: unknown): value is Record<string, ShadowDiagnosticsJsonValue> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
