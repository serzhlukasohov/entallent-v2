import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { DevSimulateController } from './dev-simulate.controller';
import { DevOnboardingController } from './dev-onboarding.controller';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { ChannelModule } from '../channel/channel.module';
import { DatabaseModule } from '../database/database.module';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { QUEUE_NAMES } from '../queue/queue.module';
import { UserResetService } from '../admin/user-reset.service';

@Module({
  imports: [
    ChannelModule,
    DatabaseModule,
    OnboardingModule,
    BullModule.registerQueue(
      { name: QUEUE_NAMES.CONVERSATION },
      { name: QUEUE_NAMES.PROACTIVE_SCAN },
      { name: QUEUE_NAMES.ONBOARDING_REMINDER },
    ),
  ],
  controllers: [DevSimulateController, DevOnboardingController],
  providers: [ApiKeyGuard, UserResetService],
})
export class DevModule {}
