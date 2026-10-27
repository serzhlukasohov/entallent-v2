import { z } from 'zod';
import type { RuleEntry } from './registry';
import { PROACTIVE_REQUIRES, initiations } from './proactive';
import { outbound, windowRun } from './synthetic-run';

/**
 * Default window, the suite text literally: 09:00-18:00 local, any day, start inclusive,
 * end exclusive. Weekends are Confluence open item 2. P-06 passes `startHour: 8, endHour: 20`
 * (Illia, 2026-10-26, the only allowed deviation from the Confluence v3 snapshot). The product
 * sends until its 22:00 quiet-hours start, so a 20:00-22:00 send is a known red recorded as
 * FAIL; the product rule is deliberately not imported or mirrored here.
 */
const DEFAULT_START_HOUR = 9;
const DEFAULT_END_HOUR = 18;

/** `UTC`, `Etc/UTC` or an `Area/Location` name; fixed offsets and abbreviations ignore DST. */
const IANA_NAME = /^(?:UTC|Etc\/UTC|[A-Za-z][A-Za-z_]*(?:\/[A-Za-z0-9_+-]+)+)$/;

function validTimeZone(timeZone: string): boolean {
  if (!IANA_NAME.test(timeZone)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

const hour = z.number().int().min(0).max(24);

const params = z
  .object({
    timezone: z.string().min(1).refine(validTimeZone, { message: 'unknown IANA time zone' }),
    /** First local hour of the window, inclusive (default 9). */
    startHour: hour.default(DEFAULT_START_HOUR),
    /** Local hour the window ends, exclusive (default 18); 24 is midnight. */
    endHour: hour.default(DEFAULT_END_HOUR),
  })
  .strict()
  .refine((value) => value.startHour < value.endHour, { message: 'startHour must be before endHour', path: ['endHour'] });

/** Local `HH:MM` of an instant in `timeZone`; throws if the formatter omits a part. */
export function localTime(occurredAt: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(Date.parse(occurredAt)));
  const part = (type: string): string => {
    const value = parts.find((entry) => entry.type === type)?.value;
    if (value === undefined) throw new Error(`Intl.DateTimeFormat returned no ${type} for ${occurredAt} in ${timeZone}`);
    return value;
  };
  return `${part('hour')}:${part('minute')}`;
}

/** P-06 working hours: every bot-initiated message lands within `startHour`-`endHour` local (default 09:00-18:00). */
export const proactiveWorkingHours: RuleEntry = {
  requires: PROACTIVE_REQUIRES,
  params,
  run(run, _criterion, raw) {
    const { timezone, startHour, endHour } = params.parse(raw ?? {});
    const startMinute = startHour * 60;
    const endMinute = endHour * 60;
    const selected = initiations(run);
    if (selected.kind === 'outcome') return selected.outcome;
    if (selected.messages.length === 0) return { status: 'NOT_OBSERVABLE', evidence: 'no-initiations' };
    const evidence = selected.messages.flatMap((message) => {
      const local = localTime(message.occurredAt, timezone);
      const [hour, minute] = local.split(':').map(Number) as [number, number];
      const minuteOfDay = hour * 60 + minute;
      return minuteOfDay >= startMinute && minuteOfDay < endMinute
        ? []
        : [`${message.occurredAt} (local ${local} ${timezone})`];
    });
    return evidence.length > 0 ? { status: 'FAIL', evidence: evidence.join('\n') } : { status: 'PASS' };
  },
  fixtures: {
    params: { timezone: 'UTC' },
    pass: windowRun('RULE-proactive-working-hours-pass', [outbound('m1', '2026-01-06T10:00:00.000Z')]),
    fail: windowRun('RULE-proactive-working-hours-fail', [outbound('m1', '2026-01-06T18:00:00.000Z')]),
  },
};
