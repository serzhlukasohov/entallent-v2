/**
 * Deterministic fidelity checks for GC round 3 CAP-8 (T9 re-asked questions, T13 sentiment
 * amplification). They run next to the judge in the eval gate; they are not runtime rails and
 * must never be ported into the reply path (ADR-013: no lexical heuristics in production code).
 */

export interface AnsweredDetail {
  /** What the employee stated explicitly; used in the violation detail. */
  detail: string;
  /** Matches a question that would ask for that detail again, in any wording the fixture anticipates. */
  pattern: RegExp;
}

export interface ReaskedQuestion {
  turn: number;
  question: string;
  detail: string;
}

/**
 * Finds mentor questions that ask for a detail the employee already supplied. Only question
 * sentences are inspected, so a statement that reflects the detail back is not a re-ask.
 */
export function findReaskedQuestions(
  replies: readonly string[],
  answered: readonly AnsweredDetail[],
  options: { fromTurn?: number } = {},
): ReaskedQuestion[] {
  const fromTurn = options.fromTurn ?? 1;
  const found: ReaskedQuestion[] = [];
  replies.forEach((reply, index) => {
    const turn = index + 1;
    if (turn < fromTurn) return;
    for (const question of extractQuestions(reply)) {
      const hit = answered.find((item) => item.pattern.test(question));
      if (hit) found.push({ turn, question, detail: hit.detail });
    }
  });
  return found;
}

export interface UnstatedEmotionWord {
  turn: number;
  word: string;
}

/**
 * Emotional-weight vocabulary a mentor adds when it amplifies a neutral report. Stems match any
 * word starting with them; phrases match asserted feelings ("that must be hard"). An entry the
 * employee used in their own messages is allowed back in the reply.
 */
const EMOTIONAL_WEIGHT_STEMS = [
  'unfair',
  'unjust',
  'frustrat',
  'painful',
  'hurt',
  'disappoint',
  'demoraliz',
  'demoralis',
  'discourag',
  'upset',
  'devastat',
  'crush',
  'sting',
  'humiliat',
  'insult',
  'exhaust',
  'infuriat',
  'annoy',
  'anger',
  'angry',
  'sad',
  'deflat',
  'gutted',
  'harsh',
  'awful',
  'terrible',
  'brutal',
  'letdown',
  'dismissive',
] as const;

const EMOTIONAL_WEIGHT_PHRASES = [
  /\blet down\b/i,
  /\bhard pill\b/i,
  /\bhard to (?:hear|take|swallow)\b/i,
  /\b(?:that(?:'s| is| must be| sounds| feels| was)|sounds|feels|must (?:be|feel)|it(?:'s| is| was))\s+(?:really |pretty |quite |so |very |a bit |particularly )?(?:tough|hard|rough|a blow|a setback|discouraging)\b/i,
] as const;

export function findUnstatedEmotionWords(
  replies: readonly string[],
  employeeTurns: readonly string[],
): UnstatedEmotionWord[] {
  const employeeText = employeeTurns.join('\n');
  const stems = EMOTIONAL_WEIGHT_STEMS.filter((stem) => !stemPattern(stem).test(employeeText));
  const phrases = EMOTIONAL_WEIGHT_PHRASES.filter((phrase) => !phrase.test(employeeText));

  const found: UnstatedEmotionWord[] = [];
  replies.forEach((reply, index) => {
    const turn = index + 1;
    const matches: Array<{ offset: number; word: string }> = [];
    for (const stem of stems) {
      const match = stemPattern(stem).exec(reply);
      if (match) matches.push({ offset: match.index, word: match[0] });
    }
    for (const phrase of phrases) {
      const match = phrase.exec(reply);
      if (match) matches.push({ offset: match.index, word: match[0] });
    }
    // Overlapping phrase and stem hits ("that is hard to hear") count once.
    let coveredUntil = -1;
    for (const { offset, word } of matches.sort((a, b) => a.offset - b.offset)) {
      if (offset < coveredUntil) continue;
      coveredUntil = offset + word.length;
      found.push({ turn, word });
    }
  });
  return found;
}

function stemPattern(stem: string): RegExp {
  return new RegExp(`\\b${stem}\\w*`, 'i');
}

function extractQuestions(text: string): string[] {
  return text
    .split(/(?<=[?])/)
    .map((part) => part.trim())
    .filter((part) => part.endsWith('?'))
    .map((part) => part.split(/(?<=[.!])\s+/).pop() ?? part);
}
