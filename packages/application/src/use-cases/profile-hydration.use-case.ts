import type { ExternalProfilePort } from '../ports/external-profile.port';
import type { UserProfileRepositoryPort } from '../ports/user-profile.repository.port';

export interface ProfileHydrationInput {
  userId: string;
  tenantId: string;
  channelType: string;
  externalWorkspaceId?: string;
}

export class ProfileHydrationUseCase {
  constructor(
    private readonly externalProfile: ExternalProfilePort,
    private readonly userProfileRepo: UserProfileRepositoryPort,
  ) {}

  async execute(input: ProfileHydrationInput): Promise<void> {
    const occurredAt = new Date();

    let profile: Awaited<ReturnType<ExternalProfilePort['fetchProfile']>>;
    try {
      profile = await this.externalProfile.fetchProfile(
        input.userId,
        input.tenantId,
        input.channelType,
        input.externalWorkspaceId,
      );
    } catch (err) {
      await this.recordOutcomeBestEffort(input, {
        status: 'failed',
        error: toErrorMessage(err),
        occurredAt,
      });
      throw err;
    }

    if (!profile) {
      await this.recordOutcomeBestEffort(input, {
        status: 'missing_profile',
        reason: 'external_profile_unavailable',
        occurredAt,
      });
      return;
    }

    try {
      await this.userProfileRepo.updateProfile(input.userId, input.tenantId, {
        channelType: input.channelType,
        externalWorkspaceId: input.externalWorkspaceId,
        externalUserId: profile.externalUserId,
        displayName: profile.displayName,
        timezone: profile.timezone,
      });
    } catch (err) {
      await this.recordOutcomeBestEffort(input, {
        status: 'failed',
        error: toErrorMessage(err),
        occurredAt,
      });
      throw err;
    }

    await this.recordOutcomeBestEffort(input, { status: 'success', occurredAt });
  }

  private async recordOutcomeBestEffort(
    input: ProfileHydrationInput,
    outcome: Parameters<UserProfileRepositoryPort['recordProfileHydrationOutcome']>[3],
  ): Promise<void> {
    try {
      const scope = input.externalWorkspaceId
        ? { externalWorkspaceId: input.externalWorkspaceId }
        : undefined;
      await this.userProfileRepo.recordProfileHydrationOutcome(
        input.userId,
        input.tenantId,
        input.channelType,
        outcome,
        scope,
      );
    } catch {
      // Hydration status is operational telemetry; it must not create duplicate profile writes.
    }
  }
}

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
