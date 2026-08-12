import type { ExternalProfilePort } from '../ports/external-profile.port';
import type { UserProfileRepositoryPort } from '../ports/user-profile.repository.port';

export interface ProfileHydrationInput {
  userId: string;
  tenantId: string;
  channelType: string;
}

export class ProfileHydrationUseCase {
  constructor(
    private readonly externalProfile: ExternalProfilePort,
    private readonly userProfileRepo: UserProfileRepositoryPort,
  ) {}

  async execute(input: ProfileHydrationInput): Promise<void> {
    const profile = await this.externalProfile.fetchProfile(
      input.userId,
      input.tenantId,
      input.channelType,
    );
    if (!profile) return;

    await this.userProfileRepo.updateProfile(input.userId, input.tenantId, {
      displayName: profile.displayName,
      timezone: profile.timezone,
    });
  }
}
