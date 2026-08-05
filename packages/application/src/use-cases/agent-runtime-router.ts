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
    } catch (error) {
      this.warnEvaluationFailure(request, error);
      this.logRuntimeDecision(request, {
        mode: 'typescript',
        decisionSource: 'evaluation_failure',
        fallbackReason: error instanceof Error ? error.message : String(error),
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
        ...(decision.fallbackReason ? { fallbackReason: decision.fallbackReason } : {}),
      });
    } catch {
      // Runtime execution must not depend on observability working.
    }
  }

  private warnEvaluationFailure(request: ProcessMessageRequest, error: unknown): void {
    try {
      this.logger?.warn('Agent runtime mode evaluation failed; falling back to TypeScript runtime', {
        traceId: request.traceId,
        error: error instanceof Error ? error.message : String(error),
      });
    } catch {
      // Fallback to TypeScript must not depend on observability working.
    }
  }
}

function normalizeRuntimeDecision(result: AgentRuntimeModeEvaluationResult): AgentRuntimeDecision {
  if (typeof result !== 'string') {
    return result;
  }

  return {
    mode: result,
    decisionSource: legacyDecisionSourceByMode[result],
  };
}

const legacyDecisionSourceByMode: Record<AgentRuntimeMode, AgentRuntimeDecisionSource> = {
  typescript: 'typescript_default',
  maf_disabled: 'global_kill_switch',
  maf_shadow: 'shadow_flag',
  maf_canary: 'canary_flag',
};
