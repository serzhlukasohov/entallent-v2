import type { CaseRun, ReplyMessage } from '../schema';
import type { RuleOutcome } from './reply-selection';
import { missingField } from './reply-selection';

/** The message type the check-in use case stamps on a bot-initiated message. */
export const PROACTIVE_MESSAGE_TYPE = 'proactive_check_in';

const requires = ['window.outbound'] as const;
export const PROACTIVE_REQUIRES = requires;

/**
 * Bot-initiated messages in the observation window, oldest first. A message is
 * bot-initiated only when `metadata.messageType === 'proactive_check_in'`; text is never
 * inspected, so a window whose messages lack the key holds no initiations.
 *
 * Contract for 12.7: the L0 executor (and later L1) copies the message column into
 * `ReplyMessage.metadata.messageType` for every message in `window.outbound`,
 * `steps[].reply.messages` and `unsolicited`.
 */
export function initiations(
  run: CaseRun,
): { kind: 'initiations'; messages: ReplyMessage[] } | { kind: 'outcome'; outcome: RuleOutcome } {
  const missing = missingField(requires, run);
  if (missing) return { kind: 'outcome', outcome: { status: 'NOT_OBSERVABLE', evidence: `unobservable:${missing}@${run.level}` } };
  if (!run.window) return { kind: 'outcome', outcome: { status: 'NOT_OBSERVABLE', evidence: 'no-window' } };
  const messages = run.window.outbound
    .filter((message) => message.metadata.messageType === PROACTIVE_MESSAGE_TYPE)
    .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
  return { kind: 'initiations', messages };
}
