import { z } from 'zod';
import type { CaseRun, Criterion, ObservationField, SeedTurn } from '../schema';
import type { RuleOutcome } from './reply-selection';
import { reflectiveOpener } from './reflective-opener';
import { repeatedQuestion } from './repeated-question';
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
 */
export interface RuleEntry {
  requires: readonly ObservationField[];
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
} satisfies RuleRegistry);

export type RuleName = keyof typeof RULES;
export const RULE_NAMES = Object.keys(RULES) as [RuleName, ...RuleName[]];
export const RuleNameSchema = z.enum(RULE_NAMES);
