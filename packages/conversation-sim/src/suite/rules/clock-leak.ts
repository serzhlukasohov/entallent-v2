import { z } from 'zod';
import type { CaseRun, ReplyMessage } from '../schema';
import type { RuleEntry } from './registry';
import { fieldObserved } from '../schema';
import { outbound, syntheticRun } from './synthetic-run';

const params = z.object({}).strict().default({});

/**
 * Every message the run recorded in a declared collection: step replies and unsolicited
 * messages when `reply.messages` is declared, the window when `window.outbound` is.
 */
function recordedMessages(run: CaseRun): ReplyMessage[] {
  const replies = fieldObserved('reply.messages', run.observed)
    ? run.steps.flatMap((step) => [...(step.reply?.messages ?? []), ...step.unsolicited])
    : [];
  const window = fieldObserved('window.outbound', run.observed) ? (run.window?.outbound ?? []) : [];
  return [...replies, ...window];
}

/**
 * L0 self-check (AD-5): no recorded message timestamp lies outside the executor clock's
 * range `run.clock` (inclusive), over the collections the run declared. A run without `clock` is NOT_OBSERVABLE `no-clock-range`;
 * a run that recorded no message is NOT_OBSERVABLE `no-messages`, never a vacuous PASS.
 */
export const clockLeak: RuleEntry = {
  // Either `reply.messages` or `window.outbound` suffices, so `requires` cannot name one.
  requires: [],
  params,
  run(run, _criterion, raw) {
    params.parse(raw ?? {});
    if (!fieldObserved('reply.messages', run.observed) && !fieldObserved('window.outbound', run.observed)) {
      return { status: 'NOT_OBSERVABLE', evidence: `unobservable:reply.messages@${run.level}` };
    }
    if (!run.clock) return { status: 'NOT_OBSERVABLE', evidence: 'no-clock-range' };
    const messages = recordedMessages(run);
    if (messages.length === 0) return { status: 'NOT_OBSERVABLE', evidence: 'no-messages' };
    const from = Date.parse(run.clock.from);
    const to = Date.parse(run.clock.to);
    const leaks = messages.filter((message) => {
      const at = Date.parse(message.occurredAt);
      return at < from || at > to;
    });
    if (leaks.length === 0) return { status: 'PASS' };
    const lines = leaks.map((message) => `${message.id} ${message.occurredAt}`);
    return { status: 'FAIL', evidence: [...lines, `clock ${run.clock.from} .. ${run.clock.to}`].join('\n') };
  },
  fixtures: {
    pass: {
      ...syntheticRun('RULE-clock-leak-pass', ['Fine.']),
      clock: { from: '2026-01-05T10:00:00.000Z', to: '2026-01-05T10:01:00.000Z' },
    },
    fail: {
      ...syntheticRun('RULE-clock-leak-fail', [], ['window.outbound']),
      window: {
        from: '2026-01-05T00:00:00.000Z',
        to: '2026-01-12T00:00:00.000Z',
        outbound: [outbound('m1', '2026-01-06T10:00:00.000Z'), outbound('m2', '2026-01-08T10:00:00.000Z')],
      },
      clock: { from: '2026-01-05T00:00:00.000Z', to: '2026-01-07T00:00:00.000Z' },
    },
  },
};
