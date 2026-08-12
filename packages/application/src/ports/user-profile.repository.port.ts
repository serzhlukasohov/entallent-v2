export type ProfileHydrationOutcomeStatus = 'success' | 'missing_profile' | 'failed';

export interface ProfileHydrationOutcome {
  status: ProfileHydrationOutcomeStatus;
  reason?: string;
  error?: string;
  occurredAt: Date;
}

export interface ProfileHydrationAccountScope {
  externalWorkspaceId?: string;
  externalUserId?: string;
}

export interface UserProfileRepositoryPort {
  updateTimezone(userId: string, tenantId: string, timezone: string): Promise<void>;
  updateProfile(
    userId: string,
    tenantId: string,
    profile: {
      channelType?: string;
      externalWorkspaceId?: string;
      externalUserId?: string;
      displayName?: string;
      timezone?: string;
    },
  ): Promise<void>;
  recordProfileHydrationOutcome(
    userId: string,
    tenantId: string,
    channelType: string,
    outcome: ProfileHydrationOutcome,
    scope?: ProfileHydrationAccountScope,
  ): Promise<void>;
}
