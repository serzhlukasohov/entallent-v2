export const QUEUE_NAMES = {
  CONVERSATION: 'conversation',
  MEMORY_EXTRACTION: 'memory-extraction',
  SURVEY_EVIDENCE: 'survey-evidence',
  RISK_ANALYSIS: 'risk-analysis',
  FOLLOWUP_PLANNING: 'followup-planning',
  FOLLOWUP_EXECUTION: 'followup-execution',
  MESSAGE_SEND: 'message-send',
  PROACTIVE_SCAN: 'proactive-scan',
  GROUP_REPORT: 'group-report',
  STYLE_ANALYSIS: 'style-analysis',
  PROFILE_HYDRATION: 'profile-hydration',
} as const;

export type QueueNameKey = keyof typeof QUEUE_NAMES;
export type QueueName = (typeof QUEUE_NAMES)[QueueNameKey];

export const ALL_QUEUE_NAMES = Object.values(QUEUE_NAMES) as QueueName[];

export type AdminQueueCounts = Record<string, number>;

export interface AdminQueueSnapshot {
  name: QueueName;
  counts: AdminQueueCounts;
}

export interface AdminQueuesResponse {
  queues: AdminQueueSnapshot[];
  timestamp: string;
}
