import type { WorkCalendar } from '@entalent/contracts';

interface LocalParts { year: number; month: number; day: number; hour: number; minute: number; isoWeekday: number }

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', weekday: 'short',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

const WEEKDAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

function localParts(at: Date, timeZone: string): LocalParts {
  const parts = Object.fromEntries(formatter(timeZone).formatToParts(at).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    hour: Number(parts.hour), minute: Number(parts.minute), isoWeekday: WEEKDAY[parts.weekday!]!,
  };
}

/** UTC instant for a local wall-clock time; nonexistent DST times roll forward. */
function fromLocal(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  let guess = wallAsUtc;
  for (let i = 0; i < 2; i += 1) {
    const p = localParts(new Date(guess), timeZone);
    const shownAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    guess += wallAsUtc - shownAsUtc;
  }
  return new Date(guess);
}

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h! * 60 + m!;
}

function addLocalDays(p: LocalParts, days: number): { year: number; month: number; day: number; isoWeekday: number } {
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), isoWeekday: ((d.getUTCDay() + 6) % 7) + 1 };
}

export function nextWorkingTime(at: Date, calendar: WorkCalendar, timeZone: string): Date {
  const start = minutesOf(calendar.workStart);
  const end = minutesOf(calendar.workEnd);
  const p = localParts(at, timeZone);
  const minute = p.hour * 60 + p.minute;
  if (calendar.workingDays.includes(p.isoWeekday)) {
    if (minute >= start && minute < end) return at;
    if (minute < start) return fromLocal(p.year, p.month, p.day, Math.floor(start / 60), start % 60, timeZone);
  }
  for (let offset = 1; offset <= 7; offset += 1) {
    const d = addLocalDays(p, offset);
    if (calendar.workingDays.includes(d.isoWeekday)) {
      return fromLocal(d.year, d.month, d.day, Math.floor(start / 60), start % 60, timeZone);
    }
  }
  throw new Error('work calendar has no working days');
}

export function reminderDueAt(origin: Date, calendar: WorkCalendar, timeZone: string): Date {
  const p = localParts(origin, timeZone);
  let counted = 0;
  let offset = 0;
  let target = addLocalDays(p, 0);
  while (counted < 2) {
    offset += 1;
    target = addLocalDays(p, offset);
    if (calendar.workingDays.includes(target.isoWeekday)) counted += 1;
  }
  const candidate = fromLocal(target.year, target.month, target.day, p.hour, p.minute, timeZone);
  return nextWorkingTime(candidate, calendar, timeZone);
}
