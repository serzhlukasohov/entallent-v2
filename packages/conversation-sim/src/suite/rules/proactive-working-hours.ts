import { z } from 'zod';
import type { RuleEntry } from './registry';
import { PROACTIVE_REQUIRES, initiations } from './proactive';
import { outbound, windowRun } from './synthetic-run';

/**
 * Suite text, literally: 09:00-18:00 local, any day, start inclusive, end exclusive.
 * Weekends are Confluence open item 2. This is a known red against the product's
 * 22-08 quiet hours and is recorded as FAIL; the product rule is deliberately not
 * imported or mirrored here.
 */
const START_MINUTE = 9 * 60;
const END_MINUTE = 18 * 60;

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

const params = z
  .object({ timezone: z.string().min(1).refine(validTimeZone, { message: 'unknown IANA time zone' }) })
  .strict();

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

/** P-06 working hours: every bot-initiated message lands within 09:00-18:00 local. */
export const proactiveWorkingHours: RuleEntry = {
  requires: PROACTIVE_REQUIRES,
  params,
  run(run, _criterion, raw) {
    const { timezone } = params.parse(raw ?? {});
    const selected = initiations(run);
    if (selected.kind === 'outcome') return selected.outcome;
    if (selected.messages.length === 0) return { status: 'NOT_OBSERVABLE', evidence: 'no-initiations' };
    const evidence = selected.messages.flatMap((message) => {
      const local = localTime(message.occurredAt, timezone);
      const [hour, minute] = local.split(':').map(Number) as [number, number];
      const minuteOfDay = hour * 60 + minute;
      return minuteOfDay >= START_MINUTE && minuteOfDay < END_MINUTE
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
