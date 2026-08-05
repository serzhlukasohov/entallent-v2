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

export interface MigrationBaselineCase {
  id: MigrationBaselineCaseId;
  name: string;
  scenarioIds: string[];
  sensitive: boolean;
  manualReviewRequired: boolean;
  reviewReason: string | null;
}

export const MIGRATION_BASELINE_CASES: MigrationBaselineCase[] = [
  sensitiveCase(
    'burnout-severe-stress',
    'Burnout or severe stress',
    ['burnout'],
    'Severe stress can affect safety, outreach, and survey eligibility.',
  ),
  sensitiveCase(
    'crisis-self-harm',
    'Potential crisis or self-harm',
    ['crisis-self-harm'],
    'Self-harm handling cannot be approved by a judge verdict alone.',
  ),
  sensitiveCase(
    'workplace-harassment',
    'Workplace harassment',
    ['harassment'],
    'Harassment handling requires human review for support, privacy, and escalation tone.',
  ),
  sensitiveCase(
    'manager-privacy-request',
    'Manager or privacy request',
    ['privacy-manager-request'],
    'Manager/privacy requests can expose individual conversation content.',
  ),
  ordinaryCase('unwanted-proactivity', 'Unwanted proactivity', ['proactivity-reminders']),
  ordinaryCase('explicit-reminder', 'Explicit reminder request', ['proactivity-reminders']),
  ordinaryCase('delayed-follow-up', 'Delayed follow-up', ['proactivity-reminders']),
  ordinaryCase('assessment-preparation', 'Assessment preparation', ['planning-memory']),
  ordinaryCase('goal-create-update', 'Goal creation and update', ['planning-memory']),
  ordinaryCase('memory-extraction', 'Memory extraction', ['memory-recall', 'planning-memory']),
  ordinaryCase('incorrect-memory-correction', 'Incorrect memory correction', ['planning-memory']),
  ordinaryCase('casual-conversation', 'Casual conversation', ['planning-memory']),
  ordinaryCase('terse-acknowledgement', 'Terse acknowledgement with no new substance', ['terse-user']),
];

export function casesForScenario(scenarioId: string): MigrationBaselineCase[] {
  return MIGRATION_BASELINE_CASES.filter((entry) => entry.scenarioIds.includes(scenarioId));
}

export function manualReviewRequiredForScenario(scenarioId: string): boolean {
  return casesForScenario(scenarioId).some((entry) => entry.manualReviewRequired);
}

function sensitiveCase(
  id: MigrationBaselineCaseId,
  name: string,
  scenarioIds: string[],
  reviewReason: string,
): MigrationBaselineCase {
  return { id, name, scenarioIds, sensitive: true, manualReviewRequired: true, reviewReason };
}

function ordinaryCase(
  id: MigrationBaselineCaseId,
  name: string,
  scenarioIds: string[],
): MigrationBaselineCase {
  return { id, name, scenarioIds, sensitive: false, manualReviewRequired: false, reviewReason: null };
}
