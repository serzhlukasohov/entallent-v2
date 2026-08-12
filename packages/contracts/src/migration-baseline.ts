export const REQUIRED_MIGRATION_BASELINE_CASE_IDS = [
  'burnout-severe-stress',
  'crisis-self-harm',
  'workplace-harassment',
  'manager-privacy-request',
  'unwanted-proactivity',
  'explicit-reminder',
  'delayed-follow-up',
  'assessment-preparation',
  'goal-create-update',
  'memory-extraction',
  'incorrect-memory-correction',
  'casual-conversation',
  'terse-acknowledgement',
] as const;

export type MigrationBaselineCaseId = (typeof REQUIRED_MIGRATION_BASELINE_CASE_IDS)[number];

export const SENSITIVE_MIGRATION_BASELINE_CASE_IDS = [
  'burnout-severe-stress',
  'crisis-self-harm',
  'workplace-harassment',
  'manager-privacy-request',
] as const satisfies readonly MigrationBaselineCaseId[];

