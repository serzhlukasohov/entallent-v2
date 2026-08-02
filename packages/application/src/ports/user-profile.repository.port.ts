export interface UserProfileRepositoryPort {
  updateTimezone(userId: string, tenantId: string, timezone: string): Promise<void>;
}
