import type { ExternalProfilePort } from '../ports/external-profile.port';
import type {
  CommittedProfileHydrationRepositoryPort,
  UserProfileRepositoryPort,
} from '../ports/user-profile.repository.port';

export interface ProfileHydrationInput {
  userId: string;
  tenantId: string;
  channelType: string;
  externalWorkspaceId?: string;
  inboundMessageId?: string;
}

export class ProfileHydrationUseCase {
  constructor(
    private readonly externalProfile: ExternalProfilePort,
    private readonly userProfileRepo: UserProfileRepositoryPort,
  ) {}

  async execute(input: ProfileHydrationInput): Promise<void> {
    const committedRepo = input.inboundMessageId
      ? this.committedRepository() : null;
    if (committedRepo && await committedRepo.isCommittedHydrationComplete({
      ...input, inboundMessageId: input.inboundMessageId!,
    })) return;
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
        error: 'external_profile_fetch_failed',
        occurredAt,
      });
      throw err;
    }

    if (!profile) {
      if (committedRepo) {
        await committedRepo.completeCommittedHydration({
          ...input, inboundMessageId: input.inboundMessageId!,
        }, null, occurredAt);
        return;
      }
      await this.recordOutcomeBestEffort(input, {
        status: 'missing_profile',
        reason: 'external_profile_unavailable',
        occurredAt,
      });
      return;
    }

    if (committedRepo) {
      await committedRepo.completeCommittedHydration({
        ...input, inboundMessageId: input.inboundMessageId!,
      }, profile, occurredAt);
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
        error: 'profile_update_failed',
        occurredAt,
      });
      throw err;
    }

    await this.recordOutcomeBestEffort(input, { status: 'success', occurredAt });
  }

  private committedRepository(): CommittedProfileHydrationRepositoryPort {
    const repo = this.userProfileRepo as Partial<CommittedProfileHydrationRepositoryPort>;
    if (typeof repo.isCommittedHydrationComplete !== 'function'
      || typeof repo.completeCommittedHydration !== 'function') {
      throw new Error('committed_profile_hydration_repository_missing');
    }
    return repo as CommittedProfileHydrationRepositoryPort;
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
