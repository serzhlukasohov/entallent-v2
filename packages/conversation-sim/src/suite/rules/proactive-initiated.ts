import { z } from 'zod';
import type { RuleEntry } from './registry';
import { PROACTIVE_REQUIRES, initiations } from './proactive';
import { outbound, windowRun } from './synthetic-run';

const params = z.object({ min: z.number().int().min(1).default(1) }).strict().default({});

/**
 * P-06 initiation: the observation window holds at least `min` (default 1)
 * bot-initiated messages.
 */
export const proactiveInitiated: RuleEntry = {
  requires: PROACTIVE_REQUIRES,
  params,
  run(run, _criterion, raw) {
    const { min } = params.parse(raw ?? {});
    const selected = initiations(run);
    if (selected.kind === 'outcome') return selected.outcome;
    const count = selected.messages.length;
    if (count >= min) return { status: 'PASS' };
    return {
      status: 'FAIL',
      evidence: `initiations: ${count} (expected at least ${min}; ${run.window!.outbound.length} outbound in window)`,
    };
  },
  fixtures: {
    pass: windowRun('RULE-proactive-initiated-pass', [outbound('m1', '2026-01-06T10:00:00.000Z')]),
    fail: windowRun('RULE-proactive-initiated-fail', [outbound('m1', '2026-01-06T10:00:00.000Z', null)]),
  },
};
