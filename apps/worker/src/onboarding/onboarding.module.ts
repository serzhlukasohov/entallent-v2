import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { DatabaseModule } from '../database/database.module';
import { QUEUE_NAMES } from '../queue/queue.module';
import { WorkspaceConnectionRepository } from '../conversation/repositories/workspace-connection.repository';
import { OnboardingActionProcessor } from './onboarding-action.processor';
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
      { name: QUEUE_NAMES.ONBOARDING_ACTION },
    ),
  ],
  providers: [
    WorkspaceConnectionRepository,
    OnboardingStateRepository,
    OnboardingEffectsService,
    { provide: ONBOARDING_EFFECTS, useExisting: OnboardingEffectsService },
    OnboardingService,
    OnboardingActionProcessor,
  ],
  exports: [OnboardingService, OnboardingStateRepository],
})
export class OnboardingModule {}
