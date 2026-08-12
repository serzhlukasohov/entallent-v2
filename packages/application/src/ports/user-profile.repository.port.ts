export type ProfileHydrationOutcomeStatus = 'success' | 'missing_profile' | 'failed';

export interface ProfileHydrationOutcome {
  status: ProfileHydrationOutcomeStatus;
  reason?: string;
  error?: string;
  occurredAt: Date;
}

export interface UserProfileRepositoryPort {
  updateTimezone(userId: string, tenantId: string, timezone: string): Promise<void>;
  updateProfile(
    userId: string,
    tenantId: string,
    profile: { externalUserId?: string; displayName?: string; timezone?: string },
  ): Promise<void>;
  recordProfileHydrationOutcome(
    userId: string,
    tenantId: string,
    channelType: string,
    outcome: ProfileHydrationOutcome,
  ): Promise<void>;
}
