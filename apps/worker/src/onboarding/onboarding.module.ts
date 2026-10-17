import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { DatabaseModule } from '../database/database.module';
import { QUEUE_NAMES } from '../queue/queue.module';
import { WorkspaceConnectionRepository } from '../conversation/repositories/workspace-connection.repository';
import { OnboardingActionProcessor } from './onboarding-action.processor';
import { OnboardingIntroService } from './onboarding-intro.service';
import { OnboardingDevIntroService } from './onboarding-dev-intro.service';
import { OnboardingEffectsService } from './onboarding-effects.service';
import { OnboardingReminderProcessor } from './onboarding-reminder.processor';
import { OnboardingReminderRepository } from './onboarding-reminder.repository';
import { OnboardingReminderSweepService } from './onboarding-reminder-sweep.service';
import { OnboardingRoleReconcileService } from './onboarding-role-reconcile.service';
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
    OnboardingIntroService,
    OnboardingDevIntroService,
    OnboardingActionProcessor,
    OnboardingReminderRepository,
    OnboardingReminderProcessor,
    OnboardingReminderSweepService,
    OnboardingRoleReconcileService,
  ],
  exports: [OnboardingService, OnboardingIntroService, OnboardingStateRepository, OnboardingReminderSweepService, OnboardingRoleReconcileService],
})
export class OnboardingModule {}
