export const FEATURE_FLAGS = {
  PROACTIVE_MESSAGING: 'proactive_messaging',
  CONVERSATIONAL_SURVEY: 'conversational_survey',
  RISK_DETECTION: 'risk_detection',
  HUMAN_ESCALATION: 'human_escalation',
  MEMORY_EXTRACTION: 'memory_extraction',
  MANAGER_ANALYTICS: 'manager_analytics',
  VECTOR_RETRIEVAL: 'vector_retrieval',
  MAF_RUNTIME_DISABLED: 'maf_runtime_disabled',
  MAF_RUNTIME_SHADOW: 'maf_runtime_shadow',
  MAF_RUNTIME_CANARY: 'maf_runtime_canary',
  MAF_RUNTIME_PRIMARY: 'maf_runtime_primary',
  MAF_RUNTIME_USER_DENYLIST: 'maf_runtime_user_denylist',
} as const;

export const RUNTIME_CONTROL_FLAGS = {
  MAF_RUNTIME_DISABLED: FEATURE_FLAGS.MAF_RUNTIME_DISABLED,
  MAF_RUNTIME_SHADOW: FEATURE_FLAGS.MAF_RUNTIME_SHADOW,
  MAF_RUNTIME_PRIMARY: FEATURE_FLAGS.MAF_RUNTIME_PRIMARY,
  MAF_RUNTIME_CANARY: FEATURE_FLAGS.MAF_RUNTIME_CANARY,
  MAF_RUNTIME_USER_DENYLIST: FEATURE_FLAGS.MAF_RUNTIME_USER_DENYLIST,
} as const;

export type FeatureFlagKey = (typeof FEATURE_FLAGS)[keyof typeof FEATURE_FLAGS];
export type RuntimeControlFlagKey = (typeof RUNTIME_CONTROL_FLAGS)[keyof typeof RUNTIME_CONTROL_FLAGS];

export interface FeatureFlagContext {
  tenantId: string;
  userId?: string;
  externalWorkspaceId?: string;
}

export interface FeatureFlagPort {
  isEnabled(key: string, context: FeatureFlagContext): Promise<boolean>;
}
