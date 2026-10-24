import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { AuditModule } from '../audit/audit.module';
import { QUEUE_NAMES } from '../queue/queue.module';
import { CompanyCalendarService, ONBOARDING_REMINDER_RECALCULATOR } from './company-calendar.service';
import { BullOnboardingReminderRecalculator } from './onboarding-reminder-recalculator';
import { OnboardingRestartController } from './onboarding-restart.controller';
import { OnboardingRestartService } from './onboarding-restart.service';

@Module({
  imports: [AuditModule, BullModule.registerQueue({ name: QUEUE_NAMES.ONBOARDING_REMINDER })],
  controllers: [OnboardingRestartController],
  providers: [
    ApiKeyGuard,
    CompanyCalendarService,
    OnboardingRestartService,
    { provide: ONBOARDING_REMINDER_RECALCULATOR, useClass: BullOnboardingReminderRecalculator },
  ],
  exports: [CompanyCalendarService, OnboardingRestartService],
})
export class OnboardingModule {}
