export const FEATURE_FLAGS = {
  PROACTIVE_MESSAGING: 'proactive_messaging',
  CONVERSATIONAL_SURVEY: 'conversational_survey',
  RISK_DETECTION: 'risk_detection',
  HUMAN_ESCALATION: 'human_escalation',
  MEMORY_EXTRACTION: 'memory_extraction',
  MANAGER_ANALYTICS: 'manager_analytics',
  VECTOR_RETRIEVAL: 'vector_retrieval',
} as const;

export type FeatureFlagKey = (typeof FEATURE_FLAGS)[keyof typeof FEATURE_FLAGS];

export interface FeatureFlagContext {
  tenantId: string;
  userId?: string;
}

export interface FeatureFlagPort {
  isEnabled(key: string, context: FeatureFlagContext): Promise<boolean>;
}
