import type { RuntimeResult } from '@entalent/contracts';
import {
  isRuntimeBoundaryProcessMessageRequest,
  runtimeBoundaryProcessMessageRequestInvalidFields,
} from '../ports/agent-runtime.port';
import type { AgentRuntimePort, ProcessMessageRequest, ProcessMessageResult } from '../ports/agent-runtime.port';
import type {
  MafAgentRuntimeCandidateProvider,
  MafAgentRuntimeDiagnostic,
  MafAgentRuntimeDiagnosticProvider,
} from './maf-agent-runtime-client';
import type { TypeScriptAgentRuntime } from './typescript-agent-runtime';

export type AgentRuntimeMode = 'typescript' | 'maf_shadow' | 'maf_canary' | 'maf_primary' | 'maf_disabled';

export type AgentRuntimeDecisionSource =
  | 'typescript_default'
  | 'global_kill_switch'
  | 'tenant_user_denylist'
  | 'shadow_flag'
  | 'canary_flag'
  | 'primary_flag'
  | 'evaluation_failure';

export interface AgentRuntimeDecision {
  mode: AgentRuntimeMode;
  decisionSource: AgentRuntimeDecisionSource;
  fallbackReason?: string;
}

export type AgentRuntimeModeEvaluationResult = AgentRuntimeMode | AgentRuntimeDecision;

export type AgentRuntimeModeEvaluator = (
  request: ProcessMessageRequest,
) => AgentRuntimeModeEvaluationResult | Promise<AgentRuntimeModeEvaluationResult>;

export interface AgentRuntimeRouterLogger {
  info?(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
}

export type AgentRuntimeDecisionRecorder = (
  request: ProcessMessageRequest,
  decision: AgentRuntimeDecision,
) => AgentRuntimeDecisionRecord | void | Promise<AgentRuntimeDecisionRecord | void>;

export interface AgentRuntimeDecisionRecord {
  runtimeAttemptId?: string;
}

export type AgentRuntimeFailureRecorder = (
  request: ProcessMessageRequest,
  decision: AgentRuntimeDecision,
  error: unknown,
) => void | Promise<void>;

export type AgentRuntimeConfigurationDiagnostic = MafAgentRuntimeDiagnostic & {
  mode: 'maf_shadow' | 'maf_canary' | 'maf_primary';
  decisionSource: AgentRuntimeDecisionSource;
};

export type AgentRuntimeConfigurationDiagnosticRecorder = (
  diagnostic: AgentRuntimeConfigurationDiagnostic,
) => void | Promise<void>;

export type AgentRuntimeFallbackExecutor = <T>(
  request: ProcessMessageRequest,
  fallback: () => Promise<T> | T,
) => Promise<T>;

export type AgentRuntimeShadowCandidateRecorder = (
  record: AgentRuntimeShadowCandidateRecord,
) => void | Promise<void>;

export type AgentRuntimePrimaryFailureRecorder = (
  record: AgentRuntimePrimaryFailureRecord,
) => void | Promise<void>;

export type AgentRuntimePrimarySuccessRecorder = (
  record: AgentRuntimePrimarySuccessRecord,
) => void | Promise<void>;

export type AgentRuntimeShadowCandidateRecord = {
  request: ProcessMessageRequest;
  decision: AgentRuntimeDecision;
  runtimeAttemptId?: string;
  currentResult: ProcessMessageResult;
  validationStatus: 'valid' | 'invalid';
  candidateResult?: RuntimeResult;
  diagnostic?: MafAgentRuntimeDiagnostic;
};

export type AgentRuntimePrimaryFailureRecord = {
  request: ProcessMessageRequest;
  decision: AgentRuntimeDecision;
  diagnostic: MafAgentRuntimeDiagnostic;
  runtimeAttemptId?: string;
};

export type AgentRuntimePrimarySuccessRecord = {
  request: ProcessMessageRequest;
  decision: AgentRuntimeDecision;
  runtimeAttemptId?: string;
};

export interface AgentRuntimeRouterOptions {
  evaluateMode?: AgentRuntimeModeEvaluator;
  recordDecision?: AgentRuntimeDecisionRecorder;
  recordFailure?: AgentRuntimeFailureRecorder;
  recordConfigurationDiagnostic?: AgentRuntimeConfigurationDiagnosticRecorder;
  recordPrimaryFailure?: AgentRuntimePrimaryFailureRecorder;
  recordPrimarySuccess?: AgentRuntimePrimarySuccessRecorder;
  recordShadowCandidate?: AgentRuntimeShadowCandidateRecorder;
  executeFallback?: AgentRuntimeFallbackExecutor;
  mafRuntime?: MafAgentRuntimeDiagnosticProvider | MafAgentRuntimeCandidateProvider;
  mafPrimaryRuntime?: AgentRuntimePort;
  logger?: AgentRuntimeRouterLogger;
}

export class AgentRuntimeRouter implements AgentRuntimePort {
  private readonly evaluateMode: AgentRuntimeModeEvaluator;
  private readonly recordDecision?: AgentRuntimeDecisionRecorder;
  private readonly recordFailure?: AgentRuntimeFailureRecorder;
  private readonly recordConfigurationDiagnostic?: AgentRuntimeConfigurationDiagnosticRecorder;
  private readonly recordPrimaryFailure?: AgentRuntimePrimaryFailureRecorder;
  private readonly recordPrimarySuccess?: AgentRuntimePrimarySuccessRecorder;
  private readonly recordShadowCandidate?: AgentRuntimeShadowCandidateRecorder;
  private readonly executeFallback?: AgentRuntimeFallbackExecutor;
  private readonly mafRuntime?: MafAgentRuntimeDiagnosticProvider | MafAgentRuntimeCandidateProvider;
  private readonly mafPrimaryRuntime?: AgentRuntimePort;
  private readonly logger?: AgentRuntimeRouterLogger;

  constructor(
    private readonly typeScriptRuntime: TypeScriptAgentRuntime,
    options: AgentRuntimeRouterOptions = {},
  ) {
    this.evaluateMode = options.evaluateMode ?? (() => 'typescript');
    this.recordDecision = options.recordDecision;
    this.recordFailure = options.recordFailure;
    this.recordConfigurationDiagnostic = options.recordConfigurationDiagnostic;
    this.recordPrimaryFailure = options.recordPrimaryFailure;
    this.recordPrimarySuccess = options.recordPrimarySuccess;
    this.recordShadowCandidate = options.recordShadowCandidate;
    this.executeFallback = options.executeFallback;
    this.mafRuntime = options.mafRuntime;
    this.mafPrimaryRuntime = options.mafPrimaryRuntime;
    this.logger = options.logger;
  }

  async processMessage(request: ProcessMessageRequest): Promise<ProcessMessageResult> {
    let decision: AgentRuntimeDecision;
    try {
      decision = normalizeRuntimeDecision(await this.evaluateMode(request));
      this.logRuntimeDecision(request, decision);
    } catch {
      if (request.requestPurpose === 'proactive_check_in') {
        throw new Error('maf_proactive_runtime_mode_evaluation_failed');
      }
      this.warnEvaluationFailure(request);
      decision = {
        mode: 'typescript',
        decisionSource: 'evaluation_failure',
        fallbackReason: RUNTIME_MODE_EVALUATION_FAILED_REASON,
      };
      this.logRuntimeDecision(request, decision);
    }

    const decisionRecord = await this.recordDecision?.(request, decision);
    const configurationDiagnostic = await this.recordMafConfigurationDiagnosticIfNeeded(request, decision);

    try {
      if (decision.mode === 'maf_primary' || decision.mode === 'maf_canary') {
        return await this.processMafPrimary(request, decision, configurationDiagnostic, decisionRecord);
      }

      const currentResult = await this.typeScriptRuntime.processMessage(request);
      await this.recordMafShadowCandidateIfNeeded(request, decision, currentResult, decisionRecord, configurationDiagnostic);
      return currentResult;
    } catch (error) {
      await this.recordRuntimeFailure(request, decision, error);
      throw error;
    }
  }

  private async processMafPrimary(
    request: ProcessMessageRequest,
    decision: AgentRuntimeDecision,
    configurationDiagnostic: MafAgentRuntimeDiagnostic | null,
    decisionRecord: AgentRuntimeDecisionRecord | void,
  ): Promise<ProcessMessageResult> {
    if (configurationDiagnostic) {
      if (decision.mode === 'maf_primary') {
        await this.recordPrimaryFailureDiagnostic(request, decision, configurationDiagnostic, decisionRecord);
        throw mafPrimaryUnavailableError(configurationDiagnostic);
      }
      this.assertProactivePrimaryFallbackAllowed(request);
      return this.executeTypeScriptFallback(request, () => this.typeScriptRuntime.processMessage(request));
    }

    if (!this.mafPrimaryRuntime) {
      const diagnostic: MafAgentRuntimeDiagnostic = {
        reasonCode: 'maf_runtime_boundary_request_invalid',
        missingCanonicalFields: ['runtime_primary_provider'],
      };
      await this.recordPrimaryFailureDiagnostic(request, decision, diagnostic, decisionRecord);
      if (decision.mode === 'maf_primary') {
        throw mafPrimaryUnavailableError(diagnostic);
      }
      this.assertProactivePrimaryFallbackAllowed(request);
      return this.executeTypeScriptFallback(request, () => this.typeScriptRuntime.processMessage(request));
    }

    try {
      const result = await this.mafPrimaryRuntime.processMessage(request);
      await this.recordPrimarySuccessCommit(request, decision, decisionRecord);
      return result;
    } catch (error) {
      if (!hasSafeMafRuntimeDiagnostic(error)) {
        throw error;
      }

      const diagnostic = safeMafRuntimeDiagnostic(error);
      await this.recordPrimaryFailureDiagnostic(request, decision, diagnostic, decisionRecord);
      if (decision.mode === 'maf_primary') {
        throw error;
      }
      this.assertProactivePrimaryFallbackAllowed(request);
      return this.executeTypeScriptFallback(request, () => this.typeScriptRuntime.processMessage(request));
    }
  }

  private async recordRuntimeFailure(
    request: ProcessMessageRequest,
    decision: AgentRuntimeDecision,
    error: unknown,
  ): Promise<void> {
    try {
      await this.recordFailure?.(request, decision, error);
    } catch {
      // Preserve the runtime error; observability must not mask fail-closed behavior.
    }
  }

  private assertProactivePrimaryFallbackAllowed(request: ProcessMessageRequest): void {
    if (request.requestPurpose === 'proactive_check_in') {
      throw new Error('maf_proactive_primary_runtime_unavailable');
    }
  }

  async executeTypeScriptFallback<T>(request: ProcessMessageRequest, fallback: () => Promise<T> | T): Promise<T> {
    if (this.executeFallback) {
      return this.executeFallback(request, fallback);
    }

    return fallback();
  }

  private logRuntimeDecision(request: ProcessMessageRequest, decision: AgentRuntimeDecision): void {
    try {
      this.logger?.info?.('Agent runtime decision resolved', {
        traceId: request.traceId,
        tenantId: request.tenantId,
        userId: request.userId,
        mode: decision.mode,
        decisionSource: decision.decisionSource,
        ...(decision.fallbackReason !== undefined ? { fallbackReason: decision.fallbackReason } : {}),
      });
    } catch {
      // Runtime execution must not depend on observability working.
    }
  }

  private warnEvaluationFailure(request: ProcessMessageRequest): void {
    try {
      this.logger?.warn('Agent runtime mode evaluation failed; falling back to TypeScript runtime', {
        traceId: request.traceId,
        fallbackReason: RUNTIME_MODE_EVALUATION_FAILED_REASON,
      });
    } catch {
      // Fallback to TypeScript must not depend on observability working.
    }
  }

  private async recordMafConfigurationDiagnosticIfNeeded(
    request: ProcessMessageRequest,
    decision: AgentRuntimeDecision,
  ): Promise<MafAgentRuntimeDiagnostic | null> {
    if (!isMafExecutionCandidateMode(decision.mode)) {
      return null;
    }

    const diagnostic = this.resolveMafConfigurationDiagnostic(request, decision);
    if (!diagnostic) {
      return null;
    }

    const routerDiagnostic: AgentRuntimeConfigurationDiagnostic = {
      ...diagnostic,
      mode: decision.mode,
      decisionSource: decision.decisionSource,
    };

    this.warnMafUnavailable(request, routerDiagnostic);
    try {
      await this.recordConfigurationDiagnostic?.(routerDiagnostic);
    } catch {
      // Runtime execution must not depend on diagnostics persistence.
    }

    return diagnostic;
  }

  private resolveMafConfigurationDiagnostic(
    request: ProcessMessageRequest,
    decision: AgentRuntimeDecision,
  ): MafAgentRuntimeDiagnostic | null {
    try {
      if (decision.mode === 'maf_primary' && this.mafPrimaryRuntime) {
        return null;
      }

      if (!this.mafRuntime) {
        return {
          reasonCode: 'maf_runtime_boundary_request_invalid',
          missingCanonicalFields: [
            decision.mode === 'maf_primary' ? 'runtime_primary_provider' : 'runtime_request_builder',
          ],
        };
      }

      return this.mafRuntime.getConfigurationDiagnostic(request);
    } catch {
      return {
        reasonCode: 'maf_runtime_configuration_invalid',
        invalidConfigKeys: ['AGENT_SERVICE_INTERNAL_URL'],
      };
    }
  }

  private async recordMafShadowCandidateIfNeeded(
    request: ProcessMessageRequest,
    decision: AgentRuntimeDecision,
    currentResult: ProcessMessageResult,
    decisionRecord: AgentRuntimeDecisionRecord | void,
    configurationDiagnostic: MafAgentRuntimeDiagnostic | null,
  ): Promise<void> {
    if (decision.mode !== 'maf_shadow') {
      return;
    }

    const runtimeAttemptId = decisionRecord?.runtimeAttemptId;
    if (configurationDiagnostic) {
      await this.persistShadowCandidate({
        request,
        decision,
        currentResult,
        ...optionalRuntimeAttemptId(runtimeAttemptId),
        validationStatus: 'invalid',
        diagnostic: configurationDiagnostic,
      });
      return;
    }

    if (!isMafAgentRuntimeCandidateProvider(this.mafRuntime)) {
      await this.persistShadowCandidate({
        request,
        decision,
        currentResult,
        ...optionalRuntimeAttemptId(runtimeAttemptId),
        validationStatus: 'invalid',
        diagnostic: {
          reasonCode: 'maf_runtime_boundary_request_invalid',
          missingCanonicalFields: ['runtime_candidate_provider'],
        },
      });
      return;
    }

    if (!isRuntimeBoundaryProcessMessageRequest(request)) {
      await this.persistShadowCandidate({
        request,
        decision,
        currentResult,
        ...optionalRuntimeAttemptId(runtimeAttemptId),
        validationStatus: 'invalid',
        diagnostic: {
          reasonCode: 'maf_runtime_boundary_request_invalid',
          invalidFields: runtimeBoundaryProcessMessageRequestInvalidFields(request),
        },
      });
      return;
    }

    try {
      const candidateResult = await this.mafRuntime.processCandidate(request);
      await this.persistShadowCandidate({
        request,
        decision,
        currentResult,
        ...optionalRuntimeAttemptId(runtimeAttemptId),
        validationStatus: 'valid',
        candidateResult,
      });
    } catch (error) {
      const diagnostic = safeMafRuntimeDiagnostic(error);
      this.warnMafShadowCandidateFailure(request, decision, diagnostic);
      await this.persistShadowCandidate({
        request,
        decision,
        currentResult,
        ...optionalRuntimeAttemptId(runtimeAttemptId),
        validationStatus: 'invalid',
        diagnostic,
      });
    }
  }

  private async persistShadowCandidate(record: AgentRuntimeShadowCandidateRecord): Promise<void> {
    try {
      await this.recordShadowCandidate?.(record);
    } catch {
      // User-facing TypeScript runtime must not depend on shadow diagnostics persistence.
    }
  }

  private warnMafShadowCandidateFailure(
    request: ProcessMessageRequest,
    decision: AgentRuntimeDecision,
    diagnostic: MafAgentRuntimeDiagnostic,
  ): void {
    try {
      this.logger?.warn('MAF shadow candidate failed; TypeScript result remains user-facing', {
        traceId: request.traceId,
        mode: decision.mode,
        decisionSource: decision.decisionSource,
        fallbackReason: diagnostic.reasonCode,
      });
    } catch {
      // Runtime execution must not depend on observability working.
    }
  }

  private warnMafUnavailable(
    request: ProcessMessageRequest,
    diagnostic: AgentRuntimeConfigurationDiagnostic,
  ): void {
    try {
      this.logger?.warn(
        diagnostic.mode === 'maf_primary'
          ? 'MAF primary unavailable; failing closed'
          : 'MAF runtime unavailable; falling back to TypeScript runtime',
        {
          traceId: request.traceId,
          mode: diagnostic.mode,
          decisionSource: diagnostic.decisionSource,
          fallbackReason: diagnostic.reasonCode,
        },
      );
    } catch {
      // Runtime execution must not depend on observability working.
    }
  }

  private async recordPrimaryFailureDiagnostic(
    request: ProcessMessageRequest,
    decision: AgentRuntimeDecision,
    diagnostic: MafAgentRuntimeDiagnostic,
    decisionRecord: AgentRuntimeDecisionRecord | void,
  ): Promise<void> {
    this.warnMafPrimaryFailure(request, decision, diagnostic);
    try {
      await this.recordPrimaryFailure?.({
        request,
        decision,
        diagnostic,
        ...optionalRuntimeAttemptId(decisionRecord?.runtimeAttemptId),
      });
    } catch {
      // Runtime execution must not depend on diagnostics persistence.
    }
  }

  private warnMafPrimaryFailure(
    request: ProcessMessageRequest,
    decision: AgentRuntimeDecision,
    diagnostic: MafAgentRuntimeDiagnostic,
  ): void {
    try {
      this.logger?.warn(
        decision.mode === 'maf_primary'
          ? 'MAF primary failed before commit; failing closed'
          : 'MAF primary failed before commit; falling back to TypeScript runtime',
        {
          traceId: request.traceId,
          mode: decision.mode,
          decisionSource: decision.decisionSource,
          fallbackReason: diagnostic.reasonCode,
        },
      );
    } catch {
      // Runtime execution must not depend on observability working.
    }
  }

  private async recordPrimarySuccessCommit(
    request: ProcessMessageRequest,
    decision: AgentRuntimeDecision,
    decisionRecord: AgentRuntimeDecisionRecord | void,
  ): Promise<void> {
    try {
      await this.recordPrimarySuccess?.({
        request,
        decision,
        ...optionalRuntimeAttemptId(decisionRecord?.runtimeAttemptId),
      });
    } catch {
      // User-facing primary success must not depend on ledger phase persistence.
    }
  }
}

function isMafExecutionCandidateMode(mode: AgentRuntimeMode): mode is 'maf_shadow' | 'maf_canary' | 'maf_primary' {
  return mode === 'maf_shadow' || mode === 'maf_canary' || mode === 'maf_primary';
}

function isMafAgentRuntimeCandidateProvider(
  value: MafAgentRuntimeDiagnosticProvider | MafAgentRuntimeCandidateProvider | undefined,
): value is MafAgentRuntimeCandidateProvider {
  return Boolean(value && 'processCandidate' in value && typeof value.processCandidate === 'function');
}

function safeMafRuntimeDiagnostic(error: unknown): MafAgentRuntimeDiagnostic {
  if (hasSafeMafRuntimeDiagnostic(error)) {
    return (error as { safeDiagnostic: MafAgentRuntimeDiagnostic }).safeDiagnostic;
  }

  return {
    reasonCode: 'maf_runtime_fetch_failed',
  };
}

function hasSafeMafRuntimeDiagnostic(error: unknown): error is { safeDiagnostic: MafAgentRuntimeDiagnostic } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'safeDiagnostic' in error &&
    isMafRuntimeDiagnostic((error as { safeDiagnostic?: unknown }).safeDiagnostic)
  );
}

function mafPrimaryUnavailableError(diagnostic: MafAgentRuntimeDiagnostic): Error & {
  safeDiagnostic: MafAgentRuntimeDiagnostic;
} {
  const error = new Error(diagnostic.reasonCode) as Error & {
    safeDiagnostic: MafAgentRuntimeDiagnostic;
  };
  error.safeDiagnostic = diagnostic;
  return error;
}

function optionalRuntimeAttemptId(
  runtimeAttemptId: string | undefined,
): Pick<AgentRuntimeShadowCandidateRecord, 'runtimeAttemptId'> | Record<string, never> {
  return typeof runtimeAttemptId === 'string' && runtimeAttemptId.trim()
    ? { runtimeAttemptId }
    : {};
}

function isMafRuntimeDiagnostic(value: unknown): value is MafAgentRuntimeDiagnostic {
  return (
    typeof value === 'object' &&
    value !== null &&
    'reasonCode' in value &&
    typeof (value as { reasonCode?: unknown }).reasonCode === 'string'
  );
}

function normalizeRuntimeDecision(result: unknown): AgentRuntimeDecision {
  if (isAgentRuntimeMode(result)) {
    return {
      mode: result,
      decisionSource: legacyDecisionSourceByMode[result],
    };
  }

  if (isAgentRuntimeDecision(result)) {
    return result;
  }

  throw new Error('invalid_runtime_decision');
}

const legacyDecisionSourceByMode: Record<AgentRuntimeMode, AgentRuntimeDecisionSource> = {
  typescript: 'typescript_default',
  maf_disabled: 'global_kill_switch',
  maf_shadow: 'shadow_flag',
  maf_canary: 'canary_flag',
  maf_primary: 'primary_flag',
};

const runtimeModes = new Set<unknown>(Object.keys(legacyDecisionSourceByMode));

function isAgentRuntimeMode(value: unknown): value is AgentRuntimeMode {
  return runtimeModes.has(value);
}

function isAgentRuntimeDecision(value: unknown): value is AgentRuntimeDecision {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<AgentRuntimeDecision>;
  return isAgentRuntimeMode(candidate.mode) && isAgentRuntimeDecisionSource(candidate.decisionSource);
}

function isAgentRuntimeDecisionSource(value: unknown): value is AgentRuntimeDecisionSource {
  return runtimeDecisionSources.has(value);
}

const runtimeDecisionSources = new Set<unknown>([
  'typescript_default',
  'global_kill_switch',
  'tenant_user_denylist',
  'shadow_flag',
  'canary_flag',
  'primary_flag',
  'evaluation_failure',
]);

const RUNTIME_MODE_EVALUATION_FAILED_REASON = 'runtime_mode_evaluation_failed';
