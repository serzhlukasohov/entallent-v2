import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '../queue/queue.module';
import { CompanyCalendarService, ONBOARDING_REMINDER_RECALCULATOR } from './company-calendar.service';
import { BullOnboardingReminderRecalculator } from './onboarding-reminder-recalculator';
import { OnboardingRestartService } from './onboarding-restart.service';

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.ONBOARDING_REMINDER })],
  providers: [
    CompanyCalendarService,
    OnboardingRestartService,
    { provide: ONBOARDING_REMINDER_RECALCULATOR, useClass: BullOnboardingReminderRecalculator },
  ],
  exports: [CompanyCalendarService, OnboardingRestartService],
})
export class OnboardingModule {}
