export const ADMIN_MANAGER_TEAM_KNOWN_POLARITIES = [
  'positive',
  'negative',
  'neutral',
  'mixed',
] as const;

export type AdminManagerTeamKnownPolarity = (typeof ADMIN_MANAGER_TEAM_KNOWN_POLARITIES)[number];

export interface AdminManagerTeamQuestionSignal {
  stableKey: string;
  title: string;
  dimension: string;
  assessmentStatus: string;
  polarity: string | null;
  strength: number | null;
  confidence: number | null;
  evidenceSummary: string | null;
}

export interface AdminManagerTeamEmployee {
  userId: string;
  displayName: string;
  lastActiveAt: string | null;
  hasActiveRisk: boolean;
  surveyWindowId: string | null;
  scoredCount: number;
  totalQuestions: number;
  coveragePct: number;
  signals: AdminManagerTeamQuestionSignal[];
}

export interface AdminManagerTeamResponse {
  tenantId: string;
  teamSize: number;
  employees: AdminManagerTeamEmployee[];
  generatedAt: string;
}
