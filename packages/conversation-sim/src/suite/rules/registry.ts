import { z } from 'zod';
import type { CaseRun, Criterion, ObservationField, SeedTurn } from '../schema';
import { answerThenBundle } from './answer-then-bundle';
import { bundleStaged } from './bundle-staged';
import { causeQuestionPresent } from './cause-question-present';
import { noGreetingRestart } from './no-greeting-restart';
import { noInternalTerms } from './no-internal-terms';
import { noTwoRepliesWithoutCauseQuestion } from './no-two-replies-without-cause-question';
import { reflectiveOpener } from './reflective-opener';
import { repeatedQuestion } from './repeated-question';
import type { RuleOutcome } from './reply-selection';
import { replyPresent } from './reply-present';
import { singleQuestion } from './single-question';
import { tooManyQuestions } from './too-many-questions';

export type { RuleOutcome, RuleStatus } from './reply-selection';

/**
 * What `evaluate` knows about the test beyond the run: the seeded history the turn was
 * played against (atomic tests), so rules can compare a reply with seeded coach turns.
 */
export interface RuleContext {
  seedHistory: readonly SeedTurn[];
}

/**
 * One rule check (architecture AD-6). `evaluate` (12.2) checks `requires` against
 * `CaseRun.observed` before calling `run`; rules never branch on level. Every entry
 * ships synthetic `pass` and `fail` runs that are independent of any executor.
 * `params` validates `RuleCheck.params` at load; a rule without it takes no params.
 * An absent `context` means an empty `seedHistory`.
 */
export interface RuleEntry {
  requires: readonly ObservationField[];
  params?: z.ZodType;
  run(
    run: CaseRun,
    criterion: Pick<Criterion, 'id' | 'evaluatedAt'>,
    params?: Record<string, unknown>,
    context?: RuleContext,
  ): RuleOutcome;
  fixtures: { pass: CaseRun; fail: CaseRun };
}

export type RuleRegistry = Readonly<Record<string, RuleEntry>>;

export const RULES = Object.freeze({
  'too-many-questions': tooManyQuestions,
  'repeated-question': repeatedQuestion,
  'reflective-opener': reflectiveOpener,
  'single-question': singleQuestion,
  'no-internal-terms': noInternalTerms,
  'no-greeting-restart': noGreetingRestart,
  'cause-question-present': causeQuestionPresent,
  'no-two-replies-without-cause-question': noTwoRepliesWithoutCauseQuestion,
  'reply-present': replyPresent,
  'bundle-staged': bundleStaged,
  'answer-then-bundle': answerThenBundle,
} satisfies RuleRegistry);

export type RuleName = keyof typeof RULES;
export const RULE_NAMES = Object.keys(RULES) as [RuleName, ...RuleName[]];
export const RuleNameSchema = z.enum(RULE_NAMES);
