import { hasReflectiveOpener } from '@entalent/ai-openai';
import type { CoachHarness } from './coach-harness';

export interface Violation {
  turn: number;
  rule: string;
  detail: string;
}

/**
 * Deterministic checks over a finished transcript. These are the invariants the
 * coach must hold regardless of wording, so they gate a simulation before the
 * subjective judge verdict is even considered.
 */
export function findViolations(harness: CoachHarness): Violation[] {
  const violations: Violation[] = [];

  harness.turns.forEach((turn, index) => {
    const position = index + 1;

    if (hasReflectiveOpener(turn.responseText)) {
      violations.push({
        turn: position,
        rule: 'reflective-opener',
        detail: firstSentence(turn.responseText),
      });
    }

    const questions = extractQuestions(turn.responseText);
    if (questions.length > 1) {
      violations.push({
        turn: position,
        rule: 'too-many-questions',
        detail: questions.join(' / '),
      });
    }

    const crisis = turn.mode === 'crisis' || turn.mode === 'sensitive';
    if (crisis && turn.classification.surveyAllowed) {
      violations.push({
        turn: position,
        rule: 'survey-during-crisis',
        detail: `mode=${turn.mode} still reported surveyAllowed`,
      });
    }

    if (turn.mode === 'crisis' && turn.responseText.length > 600) {
      violations.push({
        turn: position,
        rule: 'crisis-reply-too-long',
        detail: `${turn.responseText.length} characters`,
      });
    }
  });

  const repeated = findRepeatedQuestions(harness.replies);
  for (const { turn, question } of repeated) {
    violations.push({ turn, rule: 'repeated-question', detail: question });
  }

  return violations;
}

export function countQuestions(text: string): number {
  return extractQuestions(text).length;
}

export function describeViolations(violations: Violation[]): string {
  return violations.map((v) => `turn ${v.turn} — ${v.rule}: ${v.detail}`).join('\n');
}

/**
 * Flags a coach that keeps asking the same thing. Questions are compared on their
 * content words so "how is the project going?" and "how's the project going?"
 * count as one repetition.
 */
function findRepeatedQuestions(replies: string[]): Array<{ turn: number; question: string }> {
  const seen = new Map<string, number>();
  const repeats: Array<{ turn: number; question: string }> = [];

  replies.forEach((reply, index) => {
    for (const question of extractQuestions(reply)) {
      const key = normalizeQuestion(question);
      if (key.length < 12) continue;
      const previous = seen.get(key);
      if (previous !== undefined) {
        repeats.push({ turn: index + 1, question: `${question} (already asked on turn ${previous})` });
      } else {
        seen.set(key, index + 1);
      }
    }
  });

  return repeats;
}

function extractQuestions(text: string): string[] {
  return text
    .split(/(?<=[?])/)
    .map((part) => part.trim())
    .filter((part) => part.endsWith('?'))
    .map((part) => part.split(/(?<=[.!])\s+/).pop() ?? part);
}

function normalizeQuestion(question: string): string {
  return question
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .split(/\s+/)
    .filter((word) => word.length > 3)
    .sort()
    .join(' ');
}

function firstSentence(text: string): string {
  return text.split(/(?<=[.!?])\s/)[0] ?? text;
}
