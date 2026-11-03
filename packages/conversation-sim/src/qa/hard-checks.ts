import { countQuestions } from '../harness/assertions';
import type { CoachHarness, TurnEffects } from '../harness/coach-harness';
import type { HardCheck } from './schema';

/** What the hard checks read from a finished run. Index i is the bot side of reply i + 1. */
export interface QaRunView {
  /** Employee messages sent, including one whose turn threw. */
  sent: number;
  replies: string[];
  effects: TurnEffects[];
  /** Active memory after the run, seeded items included. */
  memory: string[];
}

export interface HardCheckResult {
  check: HardCheck['check'];
  /** What the check expects, in plain language. */
  label: string;
  met: boolean;
  /** What the run actually did. */
  actual: string;
}

export function runViewOf(harness: CoachHarness): QaRunView {
  return {
    sent: harness.userMessages.length,
    replies: harness.replies,
    effects: harness.turnEffects,
    memory: harness.memoryItems.map((item) => item.content),
  };
}

/** Deterministic checks over the run data; no model is involved. */
export function evaluateHardChecks(checks: HardCheck[], run: QaRunView): HardCheckResult[] {
  return checks.map((check) => evaluate(check, run));
}

function evaluate(check: HardCheck, run: QaRunView): HardCheckResult {
  switch (check.check) {
    case 'no-question':
      return perReply(check, run, `no question in ${where(check.turn)}`, (reply) => {
        const questions = countQuestions(reply);
        return questions ? `${questions} question(s): «${short(reply)}»` : null;
      });
    case 'no-pulse-question':
      return perReply(check, run, `no pulse question in ${where(check.turn)}`, (_reply, index) => {
        const meta = run.effects[index]?.outboundMetadata ?? {};
        const topic = meta['topicQuestion'];
        if (topic) {
          // The orchestrator stores `{ questionGroup, focus, policyVersion }`, not the question text.
          const group = typeof topic === 'object' ? (topic as { questionGroup?: unknown }).questionGroup : topic;
          return `topic question on ${String(group)}${meta['surveyProbeQuestionId'] ? ` (${String(meta['surveyProbeQuestionId'])})` : ''}`;
        }
        if (meta['containsSurveyProbe'] === true) {
          return `pulse probe${meta['surveyProbeQuestionId'] ? ` ${String(meta['surveyProbeQuestionId'])}` : ''}`;
        }
        return null;
      });
    case 'reply-under':
      return perReply(check, run, `${where(check.turn)} under ${check.chars} characters`, (reply) => {
        // Code points, so an emoji counts as one character.
        const length = [...reply].length;
        return length >= check.chars ? `${length} characters` : null;
      });
    case 'memory-contains': {
      const needle = check.text.toLowerCase();
      const hit = run.memory.find((item) => item.toLowerCase().includes(needle));
      return {
        check: check.check,
        label: `memory contains «${check.text}»`,
        met: hit !== undefined,
        actual: hit !== undefined ? `found: «${short(hit)}»` : `not found in ${run.memory.length} memory item(s)`,
      };
    }
    case 'escalation': {
      const raised = run.effects.flatMap((effects, index) => effects.escalations.map((e) => `turn ${index + 1}: ${e.type} · ${e.severity}`));
      return {
        check: check.check,
        label: check.raised ? 'an escalation is raised' : 'no escalation is raised',
        met: check.raised ? raised.length > 0 : raised.length === 0,
        actual: raised.length ? raised.join('; ') : 'no escalation',
      };
    }
  }
}

function where(turn: number | undefined): string {
  return turn ? `reply ${turn}` : 'every reply';
}

/** Applies `problem` to the targeted reply or every reply; a reply that never came fails the check. */
function perReply(
  check: HardCheck & { turn?: number },
  run: QaRunView,
  label: string,
  problem: (reply: string, index: number) => string | null,
): HardCheckResult {
  const indexes = check.turn ? [check.turn - 1] : Array.from({ length: Math.max(run.sent, run.replies.length) }, (_, i) => i);
  const problems: string[] = [];
  for (const index of indexes) {
    const reply = run.replies[index];
    if (reply === undefined) {
      problems.push(`reply ${index + 1}: no reply (the turn failed or did not run)`);
      continue;
    }
    const found = problem(reply, index);
    if (found) problems.push(`reply ${index + 1}: ${found}`);
  }
  return {
    check: check.check,
    label,
    met: problems.length === 0 && indexes.length > 0,
    actual: problems.length ? problems.join('; ') : indexes.length ? 'as expected' : 'no reply to check',
  };
}

function short(text: string, max = 160): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
