export type TenantStatus = 'active' | 'suspended' | 'offboarded';

export interface RetentionPolicy {
  messagesRetentionDays: number;
  memoryRetentionDays: number;
  riskSignalRetentionDays: number;
  auditLogRetentionDays: number;
}

export interface SafetyPolicy {
  escalationEnabled: boolean;
  escalationWebhookUrl?: string;
  humanReviewEnabled: boolean;
}

export interface ProactiveMessagingPolicy {
  enabled: boolean;
  maxDailyMessages: number;
  maxWeeklyMessages: number;
  defaultQuietHoursStart: string;
  defaultQuietHoursEnd: string;
}

export interface SurveyConfiguration {
  enabled: boolean;
  surveyDefinitionId?: string;
}

export interface Tenant {
  readonly id: string;
  readonly name: string;
  readonly status: TenantStatus;
  readonly timezone: string;
  readonly locale: string;
  readonly retentionPolicy: RetentionPolicy;
  readonly safetyPolicy: SafetyPolicy;
  readonly proactiveMessagingPolicy: ProactiveMessagingPolicy;
  readonly surveyConfiguration: SurveyConfiguration;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export const DEFAULT_RETENTION_POLICY: RetentionPolicy = {
  messagesRetentionDays: 365,
  memoryRetentionDays: 730,
  riskSignalRetentionDays: 90,
  auditLogRetentionDays: 2555, // 7 years
};

export const DEFAULT_PROACTIVE_MESSAGING_POLICY: ProactiveMessagingPolicy = {
  enabled: true,
  maxDailyMessages: 2,
  maxWeeklyMessages: 5,
  defaultQuietHoursStart: '22:00',
  defaultQuietHoursEnd: '09:00',
};

export function assertTenantActive(tenant: Tenant): void {
  if (tenant.status !== 'active') {
    throw new Error(`Tenant ${tenant.id} is not active (status: ${tenant.status})`);
  }
}
