export interface AdminQuestionInsight {
  questionId: string;
  stableKey: string;
  title: string;
  canonicalMeaning: string;
  group: string;
  displayOrder: number;
  assessmentStatus: string | null;
  score: number | null;
  assessmentConfidence: number | null;
  currentState: string | null;
  assessedAt: string | null;
  polarity: string | null;
  evidenceStrength: number | null;
  rootCause: string | null;
  evidenceUpdatedAt: string | null;
}

export interface AdminUserInsightsResponse {
  userId: string;
  windowId: string | null;
  periodEnd: string | null;
  questions: AdminQuestionInsight[];
}
