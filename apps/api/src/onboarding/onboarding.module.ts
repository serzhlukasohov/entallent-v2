import { Module } from '@nestjs/common';
import { CompanyCalendarService } from './company-calendar.service';

@Module({
  providers: [CompanyCalendarService],
  exports: [CompanyCalendarService],
})
export class OnboardingModule {}
