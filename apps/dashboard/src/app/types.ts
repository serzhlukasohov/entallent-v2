export interface EngagementPoint {
  date: string;
  activeUsers: number;
  inboundMessages: number;
}

export interface SignalPoint {
  date: string;
  total: number;
  positive: number;
  negative: number;
  mixed: number;
  neutral: number;
}

export interface QuestionSentiment {
  stableKey: string;
  title: string;
  dimension: string;
  positive: number;
  negative: number;
  mixed: number;
  neutral: number;
  total: number;
  net: number | null;
}

export interface QuestionInsight {
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

export interface UserInsightsResponse {
  userId: string;
  windowId: string | null;
  periodEnd: string | null;
  questions: QuestionInsight[];
}

export interface TrendsResult {
  rangeStart: string;
  rangeEnd: string;
  engagement: EngagementPoint[];
  signalCapture: SignalPoint[];
  coverageFunnel: Record<string, number>;
  questionSentiment: QuestionSentiment[];
}
