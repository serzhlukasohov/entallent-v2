import { z } from 'zod';
import type { RuleEntry } from './registry';
import { PROACTIVE_REQUIRES, initiations } from './proactive';
import { outbound, windowRun } from './synthetic-run';

const HOUR_MS = 3_600_000;

const params = z
  .object({ minGapMs: z.number().int().positive().default(48 * HOUR_MS) })
  .strict()
  .default({});

function hoursMinutes(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')} h`;
}

/**
 * P-06 spacing: consecutive bot-initiated messages are at least `minGapMs` (default
 * 48 h) apart; exactly 48:00 h passes. No initiation is NOT_OBSERVABLE, never a PASS.
 */
export const proactiveSpacing: RuleEntry = {
  requires: PROACTIVE_REQUIRES,
  params,
  run(run, _criterion, raw) {
    const { minGapMs } = params.parse(raw ?? {});
    const selected = initiations(run);
    if (selected.kind === 'outcome') return selected.outcome;
    const { messages } = selected;
    if (messages.length === 0) return { status: 'NOT_OBSERVABLE', evidence: 'no-initiations' };
    const evidence: string[] = [];
    messages.slice(1).forEach((message, position) => {
      const previous = messages[position]!;
      const gap = Date.parse(message.occurredAt) - Date.parse(previous.occurredAt);
      if (gap < minGapMs) {
        evidence.push(`${previous.occurredAt} -> ${message.occurredAt} (${hoursMinutes(gap)} < ${hoursMinutes(minGapMs)})`);
      }
    });
    return evidence.length > 0 ? { status: 'FAIL', evidence: evidence.join('\n') } : { status: 'PASS' };
  },
  fixtures: {
    pass: windowRun('RULE-proactive-spacing-pass', [
      outbound('m1', '2026-01-05T10:00:00.000Z'),
      outbound('m2', '2026-01-07T10:00:00.000Z'),
    ]),
    fail: windowRun('RULE-proactive-spacing-fail', [
      outbound('m1', '2026-01-05T10:00:00.000Z'),
      outbound('m2', '2026-01-07T09:59:00.000Z'),
    ]),
  },
};
