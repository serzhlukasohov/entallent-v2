import type { RiskAssessment, RiskDetection } from '@entalent/contracts';
import type {
  AgentRuntimePort,
  ProcessMessageRequest,
  ProcessMessageResult,
} from '../ports/agent-runtime.port';
import type { ConversationOrchestrator } from './conversation-orchestrator';

/**
 * Adapter for the archived AgentRuntimePort (MAF router/shadow only; the worker calls the
 * orchestrator directly). The archived contract cannot express unassessed risk, so it is mapped
 * with confidence 0 and an explicit `unassessed:` summary at this edge only.
 */
export class TypeScriptAgentRuntime implements AgentRuntimePort {
  constructor(private readonly orchestrator: ConversationOrchestrator) {}

  async processMessage(request: ProcessMessageRequest): Promise<ProcessMessageResult> {
    const result = await this.orchestrator.orchestrate(request);
    return { ...result, risk: toArchivedRiskDetection(result.risk) };
  }
}

function toArchivedRiskDetection(risk: RiskAssessment): RiskDetection {
  if (risk.assessed) {
    return {
      riskType: risk.riskType,
      severity: risk.severity,
      confidence: risk.confidence,
      evidence: risk.evidence,
      immediateResponseRequired: risk.immediateResponseRequired,
      escalationRecommended: risk.escalationRecommended,
      surveyMustBeBlocked: risk.surveyMustBeBlocked,
      proactiveMessagesMustBePaused: risk.proactiveMessagesMustBePaused,
      reasoningSummary: risk.reasoningSummary,
    };
  }
  const severity = risk.severity === 'unknown' ? 'none' : risk.severity;
  return {
    riskType: risk.riskType,
    severity,
    confidence: 0,
    evidence: [],
    immediateResponseRequired: risk.immediateResponseRequired,
    escalationRecommended: severity === 'high' || severity === 'critical',
    surveyMustBeBlocked: true,
    proactiveMessagesMustBePaused: severity === 'critical',
    reasoningSummary: `unassessed:${risk.reason}`,
  };
}
