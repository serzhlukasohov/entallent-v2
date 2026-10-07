import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { DatabaseModule } from '../database/database.module';
import { QUEUE_NAMES } from '../queue/queue.module';
import { OnboardingEffectsService } from './onboarding-effects.service';
import { OnboardingStateRepository } from './onboarding-state.repository';
import { ONBOARDING_EFFECTS, OnboardingService } from './onboarding.service';

@Module({
  imports: [
    DatabaseModule,
    BullModule.registerQueue(
      { name: QUEUE_NAMES.CONVERSATION },
      { name: QUEUE_NAMES.MESSAGE_SEND },
      { name: QUEUE_NAMES.ONBOARDING_REMINDER },
    ),
  ],
  providers: [
    OnboardingStateRepository,
    OnboardingEffectsService,
    { provide: ONBOARDING_EFFECTS, useExisting: OnboardingEffectsService },
    OnboardingService,
  ],
  exports: [OnboardingService],
})
export class OnboardingModule {}
