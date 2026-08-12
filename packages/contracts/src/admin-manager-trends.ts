export interface AdminEngagementPoint {
  date: string;
  activeUsers: number;
  inboundMessages: number;
}

export interface AdminSignalPoint {
  date: string;
  total: number;
  positive: number;
  negative: number;
  mixed: number;
  neutral: number;
}

export interface AdminQuestionSentiment {
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

export interface AdminManagerTrendsResponse {
  rangeStart: string;
  rangeEnd: string;
  engagement: AdminEngagementPoint[];
  signalCapture: AdminSignalPoint[];
  coverageFunnel: Record<string, number>;
  questionSentiment: AdminQuestionSentiment[];
}
