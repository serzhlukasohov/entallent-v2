import { TenantIsolationError, UserDeletedError } from '../errors';

export type UserStatus = 'active' | 'inactive' | 'deleted';
export type OnboardingStatus = 'pending' | 'in_progress' | 'completed';
export type ConsentState = {
  platformTermsAccepted: boolean;
  platformTermsAcceptedAt?: Date;
  aiProcessingConsented: boolean;
  aiProcessingConsentedAt?: Date;
  surveyParticipationConsented: boolean;
};

export interface QuietHours {
  enabled: boolean;
  startTime: string;
  endTime: string;
  timezone?: string;
}

export interface CommunicationPreferences {
  language: string;
  responseStyle: 'concise' | 'detailed' | 'default';
}

export interface User {
  readonly id: string;
  readonly tenantId: string;
  readonly status: UserStatus;
  readonly preferredName: string | null;
  readonly timezone: string | null;
  readonly locale: string;
  readonly communicationPreferences: CommunicationPreferences;
  readonly proactiveMessagingEnabled: boolean;
  readonly quietHours: QuietHours;
  readonly onboardingStatus: OnboardingStatus;
  readonly consentState: ConsentState;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletedAt: Date | null;
}

export function assertUserNotDeleted(user: User): void {
  if (user.status === 'deleted' || user.deletedAt !== null) {
    throw new UserDeletedError(user.id);
  }
}

export function assertUserBelongsToTenant(user: User, tenantId: string): void {
  if (user.tenantId !== tenantId) {
    throw new TenantIsolationError(user.tenantId, tenantId);
  }
}

export function canReceiveProactiveMessage(user: User, tenantProactiveEnabled: boolean): boolean {
  if (!tenantProactiveEnabled) return false;
  if (!user.proactiveMessagingEnabled) return false;
  if (user.status !== 'active') return false;
  return true;
}

export function isWithinQuietHours(user: User, nowUtc: Date): boolean {
  if (!user.quietHours.enabled) return false;

  const tz = user.quietHours.timezone ?? user.timezone ?? 'UTC';
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(nowUtc);
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
  const currentTime = `${hour}:${minute}`;

  const { startTime, endTime } = user.quietHours;

  if (startTime <= endTime) {
    return currentTime >= startTime && currentTime < endTime;
  }
  // Spans midnight
  return currentTime >= startTime || currentTime < endTime;
}
