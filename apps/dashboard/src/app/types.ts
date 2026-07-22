export interface QuestionSignal {
  stableKey: string;
  title: string;
  dimension: string;
  assessmentStatus: string;
  polarity: 'positive' | 'negative' | 'neutral' | 'mixed' | null;
  strength: number | null;
  confidence: number | null;
  evidenceSummary: string | null;
}

export interface EmployeeRow {
  userId: string;
  displayName: string;
  lastActiveAt: string | null;
  hasActiveRisk: boolean;
  surveyWindowId: string | null;
  scoredCount: number;
  totalQuestions: number;
  coveragePct: number;
  signals: QuestionSignal[];
}

export interface TeamOverviewResponse {
  tenantId: string;
  teamSize: number;
  employees: EmployeeRow[];
  generatedAt: string;
}

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

export interface PulseQuestionRow {
  stableKey: string;
  title: string;
  assessmentStatus: string | null;
}

export interface PulseGroupRow {
  questionGroup: string;
  status: string | null;
  employeeScore: number | null;
  confirmedAt: string | null;
  questions: PulseQuestionRow[];
}

export interface PulseEmployeeRow {
  userId: string;
  displayName: string | null;
  groups: PulseGroupRow[];
  backlog: {
    doneCount: number;
    pendingCount: number;
    totalIgnoreCount: number;
    nextQuestion: { stableKey: string; group: string } | null;
  };
}

export interface PulseOverviewResponse {
  tenantId: string;
  generatedAt: string;
  allGroups: string[];
  employees: PulseEmployeeRow[];
}

export interface TrendsResult {
  rangeStart: string;
  rangeEnd: string;
  engagement: EngagementPoint[];
  signalCapture: SignalPoint[];
  coverageFunnel: Record<string, number>;
  questionSentiment: QuestionSentiment[];
}
