import {
  fieldObserved,
  parseEvaluatedAt,
  type CaseRun,
  type Criterion,
  type ObservationField,
} from '../schema';

export type RuleStatus = 'PASS' | 'FAIL' | 'NOT_OBSERVABLE';

export interface RuleOutcome {
  status: RuleStatus;
  /** `turn <n> — <detail>` lines for FAIL, or why the rule could not observe its input. */
  evidence?: string;
}

/** The reply texts a reply-text rule inspects, numbered by 1-based step index. */
export interface SelectedReply {
  turn: number;
  text: string;
}

export type ReplySelection =
  | { kind: 'replies'; replies: SelectedReply[]; transcript: string[] }
  | { kind: 'outcome'; outcome: RuleOutcome };

export function formatEvidence(turn: number, detail: string): string {
  return `turn ${turn} — ${detail}`;
}

export function missingField(
  requires: readonly ObservationField[],
  run: Pick<CaseRun, 'observed'>,
): ObservationField | undefined {
  return requires.find((field) => !fieldObserved(field, run.observed));
}

/**
 * Shared selection semantics for the wrapped legacy reply-text rules:
 * - a required field the run did not declare, or a `state` / `observation-window`
 *   criterion, is NOT_OBSERVABLE;
 * - `reply:<n>` and `after-step:<n>` select the reply of step n; a null reply there
 *   is FAIL `no-reply (turn n)`;
 * - `conversation` selects every reply; observed silence has no text to inspect, and a
 *   run with no reply at all is NOT_OBSERVABLE `no-replies`.
 * `transcript` holds every reply text up to the last selected turn (silence as ''),
 * for rules that compare a reply with earlier ones.
 */
export function selectReplies(
  run: CaseRun,
  criterion: Pick<Criterion, 'evaluatedAt'>,
  requires: readonly ObservationField[],
): ReplySelection {
  const missing = missingField(requires, run);
  if (missing) return notObservable(`unobservable:${missing}@${run.level}`);

  const at = parseEvaluatedAt(criterion.evaluatedAt);
  if (at.kind === 'state' || at.kind === 'observation-window') {
    return notObservable(`not-a-reply-criterion:${criterion.evaluatedAt}`);
  }

  const texts = run.steps.map((step) => step.reply?.text ?? '');

  if (at.kind === 'conversation') {
    const replies = run.steps.flatMap((step) =>
      step.reply ? [{ turn: step.index, text: step.reply.text }] : [],
    );
    // No reply to inspect would otherwise be a vacuous PASS.
    if (replies.length === 0) return notObservable('no-replies');
    return { kind: 'replies', replies, transcript: texts };
  }

  const step = run.steps[at.step - 1];
  if (!step) return notObservable(`step-not-reached:${at.step}`);
  if (!step.reply) {
    return { kind: 'outcome', outcome: { status: 'FAIL', evidence: `no-reply (turn ${at.step})` } };
  }
  return {
    kind: 'replies',
    replies: [{ turn: at.step, text: step.reply.text }],
    transcript: texts.slice(0, at.step),
  };
}

function notObservable(evidence: string): ReplySelection {
  return { kind: 'outcome', outcome: { status: 'NOT_OBSERVABLE', evidence } };
}

/** FAIL with the joined evidence lines, or PASS when there are none. */
export function outcomeFrom(evidence: string[]): RuleOutcome {
  return evidence.length > 0 ? { status: 'FAIL', evidence: evidence.join('\n') } : { status: 'PASS' };
}
