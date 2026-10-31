import { ReportConfigurationConflict } from '@entalent/database';
import type { DatabaseService } from '../src/database/database.service';
import { CompanyCalendarService } from '../src/onboarding/company-calendar.service';

const DEV_WORK_CALENDAR = {
  timezone: 'Europe/Kyiv',
  workingDays: [1, 2, 3, 4, 5],
  workStart: '09:00',
  workEnd: '18:00',
};

/** Calendar bootstrap only. No Slack, reset, queue or other onboarding side effects. */
export async function ensureDevCompanyCalendar(
  db: DatabaseService,
  tenantId: string,
): Promise<void> {
  const calendars = new CompanyCalendarService(db);
  for (let attempt = 0; attempt < 4; attempt++) {
    const expectedRevision = await calendars.currentRevision(tenantId);
    if (await calendars.get(tenantId)) return;
    try {
      await calendars.configure(tenantId, DEV_WORK_CALENDAR, 'dev-slack-onboard', expectedRevision);
      return;
    } catch (error) {
      if (!(error instanceof ReportConfigurationConflict) || attempt === 3) throw error;
    }
  }
}
