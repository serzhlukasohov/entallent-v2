import type { RuntimeResult } from '@entalent/contracts';
import type { ProcessMessageRequest, ProcessMessageResult } from '../ports/agent-runtime.port';
import { AgentRuntimeRouter } from './agent-runtime-router';
import type {
  AgentRuntimeRouterLogger,
  AgentRuntimeShadowCandidateRecord,
} from './agent-runtime-router';
import type { MafAgentRuntimeCandidateProvider, MafAgentRuntimeDiagnostic } from './maf-agent-runtime-client';
import type { TypeScriptAgentRuntime } from './typescript-agent-runtime';

export type MafShadowLocalValidationStatus = 'valid' | 'invalid';

export interface MafShadowLocalValidationOptions {
  request: ProcessMessageRequest;
  currentRuntime: TypeScriptAgentRuntime;
  mafRuntime?: MafAgentRuntimeCandidateProvider;
  runtimeAttemptId?: string;
  logger?: AgentRuntimeRouterLogger;
}

export interface MafShadowLocalValidationEvidence {
  validationStatus: MafShadowLocalValidationStatus;
  traceId: string;
  runtimeAttempt?: number;
  runtimeAttemptId?: string;
  userFacing: {
    mode: ProcessMessageResult['mode'];
    primaryIntent: string;
    riskSeverity: string;
  };
  shadow: {
    mode: 'maf_shadow';
    decisionSource: 'shadow_flag';
    runtimeVersion?: string;
    modelCalls?: number;
    replyRenderer?: string;
    toolCalls?: number;
    retryCount?: number;
    riskSeverity?: string;
    actionCount?: number;
    memoryCandidateCount?: number;
    diagnostic?: RedactedMafShadowDiagnosticEvidence;
  };
}

export interface RedactedMafShadowDiagnosticEvidence {
  reasonCode: string;
  invalidFields?: string[];
  missingConfigKeys?: string[];
  invalidConfigKeys?: string[];
  missingCanonicalFields?: string[];
}

const REDACTED_VALUE = 'redacted';
const SAFE_EVIDENCE_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;
const SAFE_RUNTIME_VERSION_PATTERN = /^[A-Za-z0-9_.-]{1,64}\/[A-Za-z0-9_.-]{1,64}$/;
const SAFE_ENUM_VALUE_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;
const SAFE_JSON_SCHEMA_PATH_PATTERN = /^\$(?:\.[A-Za-z_][A-Za-z0-9_]*|\[[0-9]+\]){0,16}$/;
const SAFE_HTTP_STATUS_PATTERN = /^http_status:[1-5][0-9]{2}$/;
const SECRET_LIKE_PATTERN = /(api[_-]?key|bearer|password|secret|token|xox[abprs]-|sk-[A-Za-z0-9_-]+)/i;
const SAFE_REASON_CODES = new Set([
  'maf_runtime_configuration_missing',
  'maf_runtime_configuration_invalid',
  'maf_runtime_url_invalid',
  'maf_runtime_boundary_request_invalid',
  'maf_runtime_response_invalid',
  'maf_runtime_http_failed',
  'maf_runtime_fetch_failed',
]);
const SAFE_CONFIG_KEYS = new Set([
  'AGENT_SERVICE_INTERNAL_URL',
  'AGENT_SERVICE_URL',
  'AGENT_SERVICE_TIMEOUT_MS',
]);
const SAFE_DIAGNOSTIC_FIELDS = new Set([
  'context',
  'conversation.sessionKey',
  'eventId',
  'idempotencyKey',
  'message.createdAt',
  'message.text',
  'requestId',
  'runtimeAttempt',
  'runtime_candidate_provider',
  'runtime_request_builder',
  'traceId',
]);
const MAX_DIAGNOSTIC_EVIDENCE_ITEMS = 20;

export async function runMafShadowLocalValidation(
  options: MafShadowLocalValidationOptions,
): Promise<MafShadowLocalValidationEvidence> {
  let shadowRecord: AgentRuntimeShadowCandidateRecord | undefined;
  const runtimeAttemptId = normalizeOptionalEvidenceValue(options.runtimeAttemptId);
  const router = new AgentRuntimeRouter(options.currentRuntime, {
    evaluateMode: () => ({ mode: 'maf_shadow', decisionSource: 'shadow_flag' }),
    mafRuntime: options.mafRuntime,
    recordDecision: async () => (runtimeAttemptId ? { runtimeAttemptId } : undefined),
    recordShadowCandidate: async (record) => {
      shadowRecord = record;
    },
    logger: options.logger,
  });

  const currentResult = await router.processMessage(options.request);

  return buildEvidence({
    request: options.request,
    currentResult,
    shadowRecord,
    runtimeAttemptId,
  });
}

function buildEvidence(input: {
  request: ProcessMessageRequest;
  currentResult: ProcessMessageResult;
  shadowRecord: AgentRuntimeShadowCandidateRecord | undefined;
  runtimeAttemptId: string | undefined;
}): MafShadowLocalValidationEvidence {
  const candidateResult = input.shadowRecord?.candidateResult;
  const diagnostic = input.shadowRecord?.diagnostic ?? missingShadowRecordDiagnostic(input.shadowRecord);
  const validationStatus = input.shadowRecord?.validationStatus ?? 'invalid';

  return {
    validationStatus,
    traceId: safeEvidenceId(input.request.traceId),
    ...(typeof input.request.runtimeAttempt === 'number' ? { runtimeAttempt: input.request.runtimeAttempt } : {}),
    ...(input.runtimeAttemptId ? { runtimeAttemptId: input.runtimeAttemptId } : {}),
    userFacing: {
      mode: input.currentResult.mode,
      primaryIntent: safeEnumEvidenceValue(input.currentResult.classification.primaryIntent),
      riskSeverity: safeEnumEvidenceValue(input.currentResult.risk.severity),
    },
    shadow: {
      mode: 'maf_shadow',
      decisionSource: 'shadow_flag',
      ...redactedCandidateEvidence(candidateResult),
      ...(diagnostic ? { diagnostic: redactedDiagnosticEvidence(diagnostic) } : {}),
    },
  };
}

function redactedCandidateEvidence(
  candidateResult: RuntimeResult | undefined,
): Partial<MafShadowLocalValidationEvidence['shadow']> {
  if (!candidateResult) {
    return {};
  }

  return {
    runtimeVersion: safeRuntimeVersion(candidateResult.diagnostics.runtimeVersion),
    modelCalls: candidateResult.diagnostics.modelCalls,
    ...(candidateResult.diagnostics.replyRenderer
      ? { replyRenderer: safeEnumEvidenceValue(candidateResult.diagnostics.replyRenderer) }
      : {}),
    toolCalls: candidateResult.diagnostics.toolCalls,
    retryCount: candidateResult.diagnostics.retryCount,
    ...(candidateResult.riskAssessment?.severity
      ? { riskSeverity: safeEnumEvidenceValue(candidateResult.riskAssessment.severity) }
      : {}),
    actionCount: candidateResult.proposedActions.length,
    memoryCandidateCount: candidateResult.memoryCandidates.length,
  };
}

function redactedDiagnosticEvidence(diagnostic: MafAgentRuntimeDiagnostic): RedactedMafShadowDiagnosticEvidence {
  return {
    reasonCode: safeReasonCode(diagnostic.reasonCode),
    ...optionalEvidenceArray('invalidFields', diagnostic.invalidFields, safeDiagnosticField),
    ...optionalEvidenceArray('missingConfigKeys', diagnostic.missingConfigKeys, safeConfigKey),
    ...optionalEvidenceArray('invalidConfigKeys', diagnostic.invalidConfigKeys, safeConfigKey),
    ...optionalEvidenceArray('missingCanonicalFields', diagnostic.missingCanonicalFields, safeDiagnosticField),
  };
}

function optionalEvidenceArray(
  key: keyof Omit<RedactedMafShadowDiagnosticEvidence, 'reasonCode'>,
  values: unknown,
  sanitizer: (value: string) => string,
): Partial<RedactedMafShadowDiagnosticEvidence> {
  if (!Array.isArray(values) || values.length === 0) {
    return {};
  }

  const safeValues = values
    .filter((value): value is string => typeof value === 'string')
    .slice(0, MAX_DIAGNOSTIC_EVIDENCE_ITEMS)
    .map(sanitizer);
  if (safeValues.length === 0) {
    return {};
  }

  return {
    [key]: safeValues,
  };
}

function missingShadowRecordDiagnostic(
  shadowRecord: AgentRuntimeShadowCandidateRecord | undefined,
): MafAgentRuntimeDiagnostic | undefined {
  return shadowRecord
    ? undefined
    : {
        reasonCode: 'maf_runtime_configuration_missing',
        missingConfigKeys: ['AGENT_SERVICE_INTERNAL_URL'],
      };
}

function normalizeOptionalEvidenceValue(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim();
  return normalized ? safeEvidenceId(normalized) : undefined;
}

function safeEvidenceId(value: string): string {
  return !isSecretLike(value) && SAFE_EVIDENCE_ID_PATTERN.test(value) ? value : REDACTED_VALUE;
}

function safeRuntimeVersion(value: string): string {
  return !isSecretLike(value)
    && (SAFE_EVIDENCE_ID_PATTERN.test(value) || SAFE_RUNTIME_VERSION_PATTERN.test(value))
    ? value
    : REDACTED_VALUE;
}

function safeEnumEvidenceValue(value: string): string {
  return !isSecretLike(value) && SAFE_ENUM_VALUE_PATTERN.test(value) ? value : REDACTED_VALUE;
}

function safeReasonCode(value: string): string {
  return SAFE_REASON_CODES.has(value) ? value : REDACTED_VALUE;
}

function safeConfigKey(value: string): string {
  return SAFE_CONFIG_KEYS.has(value) ? value : REDACTED_VALUE;
}

function safeDiagnosticField(value: string): string {
  if (isSecretLike(value)) {
    return REDACTED_VALUE;
  }

  if (SAFE_HTTP_STATUS_PATTERN.test(value) || SAFE_JSON_SCHEMA_PATH_PATTERN.test(value)) {
    return value;
  }

  return SAFE_DIAGNOSTIC_FIELDS.has(value) ? value : REDACTED_VALUE;
}

function isSecretLike(value: string): boolean {
  return SECRET_LIKE_PATTERN.test(value);
}
