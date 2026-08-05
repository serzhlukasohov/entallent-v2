import type { AgentRuntimePort, ProcessMessageRequest, ProcessMessageResult } from '../ports/agent-runtime.port';
import type { TypeScriptAgentRuntime } from './typescript-agent-runtime';

export type AgentRuntimeMode = 'typescript' | 'maf_shadow' | 'maf_canary' | 'maf_disabled';

export type AgentRuntimeModeEvaluator = (request: ProcessMessageRequest) => AgentRuntimeMode | Promise<AgentRuntimeMode>;

export interface AgentRuntimeRouterLogger {
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
      await this.evaluateMode(request);
    } catch (error) {
      this.logger?.warn('Agent runtime mode evaluation failed; falling back to TypeScript runtime', {
        traceId: request.traceId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return this.typeScriptRuntime.processMessage(request);
  }
}
