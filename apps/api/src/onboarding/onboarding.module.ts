import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '../queue/queue.module';
import { CompanyCalendarService, ONBOARDING_REMINDER_RECALCULATOR } from './company-calendar.service';
import { BullOnboardingReminderRecalculator } from './onboarding-reminder-recalculator';

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.ONBOARDING_REMINDER })],
  providers: [
    CompanyCalendarService,
    { provide: ONBOARDING_REMINDER_RECALCULATOR, useClass: BullOnboardingReminderRecalculator },
  ],
  exports: [CompanyCalendarService],
})
export class OnboardingModule {}
