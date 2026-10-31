import {
  canonicalCompanyLocale,
  ReportCalendarSchema,
  REPORT_CALENDAR_ALGORITHM,
  type ReportCalendar,
  type PulseReportScheduleResolution,
} from '@entalent/contracts';
export function reportTimestampMicros(value: string | Date): bigint | null {
  if (typeof value === 'string' && /\.\d{7,}/.test(value)) return null;
  const millis = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(millis)) return null;
  const fraction =
    typeof value === 'string'
      ? value.match(/\.(\d{1,6})(?:Z|[+-]\d{2}(?::?\d{2})?)$/)?.[1]
      : undefined;
  return BigInt(millis) * 1000n + BigInt(fraction?.padEnd(6, '0').slice(3) ?? '0');
}
function wallParts(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    era: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const p = (type: string) => parts.find((v) => v.type === type)!.value;
  // Intl renders year 1 BCE as year 1 plus its era; ISO uses astronomical year 0000.
  const year = p('era') === 'BC' ? 1 - Number(p('year')) : Number(p('year'));
  const isoYear =
    year >= 0 && year <= 9999
      ? String(year).padStart(4, '0')
      : `${year < 0 ? '-' : '+'}${String(Math.abs(year)).padStart(6, '0')}`;
  return `${isoYear}-${p('month')}-${p('day')}T${p('hour')}:${p('minute')}:${p('second')}`;
}
function possibleInstants(wall: string, timezone: string): Date[] {
  const utc = Date.parse(`${wall}:00Z`);
  const offsets = new Set<number>();
  for (let h = -36; h <= 36; h += 6) {
    const sample = new Date(utc + h * 3600000);
    const offset = Date.parse(`${wallParts(sample, timezone)}Z`) - sample.getTime();
    if (Number.isFinite(offset)) offsets.add(offset);
  }
  return [...offsets]
    .map((offset) => new Date(utc - offset))
    .filter((date) => wallParts(date, timezone) === `${wall}:00`)
    .sort((a, b) => a.getTime() - b.getTime());
}
export function resolvePulseReportFinalSchedule(input: {
  periodStart: string | Date;
  periodEnd: string | Date;
  calendar: ReportCalendar;
}): PulseReportScheduleResolution {
  const start = reportTimestampMicros(input.periodStart),
    end = reportTimestampMicros(input.periodEnd);
  if (start === null || end === null || end <= start)
    return { status: 'blocked', reason: 'invalid_cycle' };
  const calendar = input.calendar;
  const timezone = calendar.timezone;
  const localStart = wallParts(
    new Date(
      typeof input.periodStart === 'string' ? input.periodStart : input.periodStart.getTime(),
    ),
    timezone,
  );
  const localEnd = wallParts(
    new Date(typeof input.periodEnd === 'string' ? input.periodEnd : input.periodEnd.getTime()),
    timezone,
  );
  const localStartInstant = Date.parse(`${localStart}Z`);
  const localEndInstant = Date.parse(`${localEnd}Z`);
  // UTC bounds can cross into company-local year 0000 or 10000. Only enumerate
  // supported calendar dates; retain the actual wall boundaries for gap checks.
  const first = Math.max(
    Date.parse(`${localStart.split('T')[0]}T00:00:00Z`),
    Date.parse('0001-01-01T00:00:00Z'),
  );
  const last = Math.min(
    Date.parse(`${localEnd.split('T')[0]}T00:00:00Z`),
    Date.parse('9999-12-31T00:00:00Z'),
  );
  const date = new Date(last);
  while (date.getTime() >= first) {
    const localDate = date.toISOString().slice(0, 10),
      override = calendar.dateOverrides.find((v) => v.date === localDate);
    const working = override
      ? override.kind === 'working'
      : !calendar.holidays.includes(localDate) &&
        calendar.workingDays.includes(date.getUTCDay() || 7);
    if (working) {
      const localWorkEnd = override?.kind === 'working' ? override.workEnd : calendar.workEnd;
      const wall = `${localDate}T${localWorkEnd}`,
        instants = possibleInstants(wall, timezone);
      const eligible = instants.filter(
        (v) => BigInt(v.getTime()) * 1000n > start && BigInt(v.getTime()) * 1000n <= end,
      );
      if (eligible.length) {
        if (instants.length !== 1)
          return {
            status: 'blocked',
            reason: 'ambiguous_work_end',
            timezone,
            localDate,
            localWorkEnd,
          };
        return {
          status: 'scheduled',
          algorithmVersion: REPORT_CALENDAR_ALGORITHM,
          timezone,
          localDate,
          localWorkEnd,
          finalDueAt: eligible[0]!.toISOString(),
        };
      }
      if (
        instants.length === 0 &&
        Date.parse(`${wall}:00Z`) > localStartInstant &&
        Date.parse(`${wall}:00Z`) <= localEndInstant
      )
        return {
          status: 'blocked',
          reason: 'nonexistent_work_end',
          timezone,
          localDate,
          localWorkEnd,
        };
    }
    date.setUTCDate(date.getUTCDate() - 1);
  }
  return { status: 'blocked', reason: 'no_working_close_in_cycle' };
}

/** Validate the retained counterpart independently, so repairing one field remains possible. */
export function assessPulseReportConfiguration(source: { locale: unknown; calendar: unknown }) {
  const locale = canonicalCompanyLocale(source.locale);
  const parsed = ReportCalendarSchema.safeParse(source.calendar);
  return {
    locale,
    calendar: parsed.success ? parsed.data : null,
    unavailableReason: !locale
      ? 'invalid_locale'
      : source.calendar === null
        ? 'missing_calendar'
        : !parsed.success
          ? 'invalid_calendar'
          : null,
  } as const;
}
