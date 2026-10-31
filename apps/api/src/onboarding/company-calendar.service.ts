import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { type WorkCalendar } from '@entalent/contracts';
import { tenantWorkCalendars } from '@entalent/database';
import { DatabaseService } from '../database/database.service';
import { ReportConfigurationService } from '../report-configuration/report-configuration.service';

export class CompanyCalendarError extends Error {
  constructor(readonly code: 'invalid_calendar' | 'operator_required') {
    super(code);
    this.name = 'CompanyCalendarError';
  }
}

export const ONBOARDING_REMINDER_RECALCULATOR = Symbol('ONBOARDING_REMINDER_RECALCULATOR');
export interface OnboardingReminderRecalculator {
  recalculateScheduledReminders(tenantId: string): Promise<void>;
}

export type RecalculationStatus = 'queued' | 'skipped' | 'failed';

@Injectable()
export class CompanyCalendarService {
  private readonly logger = new Logger(CompanyCalendarService.name);

  constructor(
    private readonly db: DatabaseService,
    @Optional() @Inject(ONBOARDING_REMINDER_RECALCULATOR) private readonly recalculator?: OnboardingReminderRecalculator,
    @Optional() private readonly configuration?: ReportConfigurationService,
  ) {}

  async currentRevision(tenantId:string):Promise<number> { return (await (this.configuration ?? new ReportConfigurationService(this.db)).current(tenantId)).revision; }

  async get(tenantId: string): Promise<WorkCalendar | null> {
    const [row] = await this.db.client.select().from(tenantWorkCalendars)
      .where(eq(tenantWorkCalendars.tenantId, tenantId));
    return row
      ? { timezone: row.timezone, workingDays: row.workingDays, workStart: row.workStart, workEnd: row.workEnd }
      : null;
  }

  async configure(
    tenantId: string, input: unknown, operator: string, expectedConfigRevision: number,
  ): Promise<{ calendar: WorkCalendar; configRevision:number; recalculation: RecalculationStatus }> {
    if (!operator.trim()) throw new CompanyCalendarError('operator_required');
    const result = await (this.configuration ?? new ReportConfigurationService(this.db)).saveCalendar(tenantId,input,operator,expectedConfigRevision);
    const after = result.calendar as WorkCalendar;
    if (!this.recalculator) return { calendar: after, configRevision:result.configuration.revision, recalculation: 'skipped' };
    // The calendar is already committed; a queue failure must not report the whole change as failed.
    try {
      await this.recalculator.recalculateScheduledReminders(tenantId);
      return { calendar: after, configRevision:result.configuration.revision, recalculation: 'queued' };
    } catch (error) {
      this.logger.warn(`Reminder recalculation not queued tenant=${tenantId}: ${(error as Error).message}`);
      return { calendar: after, configRevision:result.configuration.revision, recalculation: 'failed' };
    }
  }
}
