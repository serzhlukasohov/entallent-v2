import type {
  AgentRuntimePort,
  ProcessMessageRequest,
  ProcessMessageResult,
} from '../ports/agent-runtime.port';
import type { ConversationOrchestrator } from './conversation-orchestrator';

export class TypeScriptAgentRuntime implements AgentRuntimePort {
  constructor(private readonly orchestrator: ConversationOrchestrator) {}

  processMessage(request: ProcessMessageRequest): Promise<ProcessMessageResult> {
    return this.orchestrator.orchestrate(request);
  }
}
