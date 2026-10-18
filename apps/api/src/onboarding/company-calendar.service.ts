import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { WorkCalendarSchema, type WorkCalendar } from '@entalent/contracts';
import { auditLogs, tenantWorkCalendars } from '@entalent/database';
import { DatabaseService } from '../database/database.service';

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
  ) {}

  async get(tenantId: string): Promise<WorkCalendar | null> {
    const [row] = await this.db.client.select().from(tenantWorkCalendars)
      .where(eq(tenantWorkCalendars.tenantId, tenantId));
    return row
      ? { timezone: row.timezone, workingDays: row.workingDays, workStart: row.workStart, workEnd: row.workEnd }
      : null;
  }

  async configure(
    tenantId: string, input: unknown, operator: string,
  ): Promise<{ calendar: WorkCalendar; recalculation: RecalculationStatus }> {
    if (!operator.trim()) throw new CompanyCalendarError('operator_required');
    const parsed = WorkCalendarSchema.safeParse(input);
    if (!parsed.success) throw new CompanyCalendarError('invalid_calendar');
    const after = parsed.data;
    await this.db.client.transaction(async (tx) => {
      const [before] = await tx.select().from(tenantWorkCalendars)
        .where(eq(tenantWorkCalendars.tenantId, tenantId)).for('update');
      await tx.insert(tenantWorkCalendars).values({ tenantId, ...after, updatedBy: operator })
        .onConflictDoUpdate({ target: tenantWorkCalendars.tenantId, set: { ...after, updatedBy: operator, updatedAt: new Date() } });
      await tx.insert(auditLogs).values({
        tenantId, actorType: 'internal_operator', actorId: operator,
        action: 'org.work_calendar.configure', resourceType: 'tenant', resourceId: tenantId,
        metadata: { before: before ?? null, after },
      });
    });
    if (!this.recalculator) return { calendar: after, recalculation: 'skipped' };
    // The calendar is already committed; a queue failure must not report the whole change as failed.
    try {
      await this.recalculator.recalculateScheduledReminders(tenantId);
      return { calendar: after, recalculation: 'queued' };
    } catch (error) {
      this.logger.warn(`Reminder recalculation not queued tenant=${tenantId}: ${(error as Error).message}`);
      return { calendar: after, recalculation: 'failed' };
    }
  }
}
