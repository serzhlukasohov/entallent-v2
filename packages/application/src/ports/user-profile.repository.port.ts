export interface UserProfileRepositoryPort {
  updateTimezone(userId: string, tenantId: string, timezone: string): Promise<void>;
  updateProfile(
    userId: string,
    tenantId: string,
    profile: { displayName?: string; timezone?: string },
  ): Promise<void>;
}
