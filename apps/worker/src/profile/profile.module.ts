import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ProfileHydrationUseCase } from '@entalent/application';
import { QUEUE_NAMES } from '../queue/queue.module';
import { DatabaseModule } from '../database/database.module';
import { WorkspaceConnectionRepository } from '../conversation/repositories/workspace-connection.repository';
import { SlackExternalProfileAdapter } from './slack-external-profile.adapter';
import { UserProfileRepository } from './user-profile.repository';
import { ProfileHydrationProcessor } from './profile-hydration.processor';

@Module({
  imports: [DatabaseModule, BullModule.registerQueue({ name: QUEUE_NAMES.PROFILE_HYDRATION })],
  providers: [
    WorkspaceConnectionRepository,
    SlackExternalProfileAdapter,
    UserProfileRepository,
    {
      provide: ProfileHydrationUseCase,
      useFactory: (ext: SlackExternalProfileAdapter, repo: UserProfileRepository) =>
        new ProfileHydrationUseCase(ext, repo),
      inject: [SlackExternalProfileAdapter, UserProfileRepository],
    },
    ProfileHydrationProcessor,
  ],
})
export class ProfileModule {}
