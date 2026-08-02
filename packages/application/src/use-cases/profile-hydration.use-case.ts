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
    const tz = await this.externalProfile.fetchTimezone(input.userId, input.tenantId, input.channelType);
    if (!tz) return;
    await this.userProfileRepo.updateTimezone(input.userId, input.tenantId, tz);
  }
}
