import type { AgentRuntimePort, ProcessMessageRequest, ProcessMessageResult } from '../ports/agent-runtime.port';
import type { TypeScriptAgentRuntime } from './typescript-agent-runtime';

export type AgentRuntimeMode = 'typescript' | 'maf_shadow' | 'maf_canary' | 'maf_disabled';

export type AgentRuntimeDecisionSource =
  | 'typescript_default'
  | 'global_kill_switch'
  | 'tenant_user_denylist'
  | 'shadow_flag'
  | 'canary_flag'
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

export interface AgentRuntimeRouterOptions {
  evaluateMode?: AgentRuntimeModeEvaluator;
  logger?: AgentRuntimeRouterLogger;
}

export class AgentRuntimeRouter implements AgentRuntimePort {
  private readonly evaluateMode: AgentRuntimeModeEvaluator;
  private readonly logger?: AgentRuntimeRouterLogger;

  constructor(
    private readonly typeScriptRuntime: TypeScriptAgentRuntime,
    options: AgentRuntimeRouterOptions = {},
  ) {
    this.evaluateMode = options.evaluateMode ?? (() => 'typescript');
    this.logger = options.logger;
  }

  async processMessage(request: ProcessMessageRequest): Promise<ProcessMessageResult> {
    try {
      const decision = normalizeRuntimeDecision(await this.evaluateMode(request));
      this.logRuntimeDecision(request, decision);
    } catch {
      this.warnEvaluationFailure(request);
      this.logRuntimeDecision(request, {
        mode: 'typescript',
        decisionSource: 'evaluation_failure',
        fallbackReason: RUNTIME_MODE_EVALUATION_FAILED_REASON,
      });
    }

    return this.typeScriptRuntime.processMessage(request);
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
  'evaluation_failure',
]);

const RUNTIME_MODE_EVALUATION_FAILED_REASON = 'runtime_mode_evaluation_failed';
