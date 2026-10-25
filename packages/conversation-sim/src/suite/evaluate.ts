import { emptyJudgeUsage, type CriterionJudge } from './judge/criterion-judge';
import { decideMeaning } from './judge/decide-meaning';
import { buildJudgeInput } from './judge/judge-input';
import { RULES, type RuleContext, type RuleOutcome, type RuleRegistry } from './rules/registry';
import { missingField } from './rules/reply-selection';
import {
  fieldObserved,
  parseEvaluatedAt,
  stateAtStep,
  type CaseRun,
  type CriterionResult,
  type JudgeTrust,
  type LoadedCriterion,
  type LoadedTest,
  type RuleCheck,
} from './schema';

/**
 * Pure evaluation of one test run (architecture AD-3, AD-9, AD-18): the only producer of
 * `CriterionResult`. One result per test criterion, in test order.
 *
 * Precedence for in-scope criteria (Framework v2.1.1 section 5), first match wins:
 * 1. INVALID: a failed precondition (`precondition:<name>`), a failed checkpoint before the
 *    criterion (`checkpoint:<k>`), or a `change` state criterion already satisfied on
 *    `state.before` (`precondition:already-satisfied`);
 * 2. ERROR: an executor error at or before the criterion's step;
 * 3. NOT_RUN: an unsupported fixture, the step not reached, an undeclared required field
 *    (`unobservable:<field>@<level>`) or a rule that could not observe its input;
 * 4. FAIL if any rule check FAILs (with `meaningSkipped: true` when the criterion has a
 *    meaning check, AD-10); otherwise the meaning checks decide when a judge is given,
 *    or PASS.
 *
 * `judge: null` (L0) is synchronous: a meaning-only criterion is NOT_RUN
 * `no-judge-at-level` and out of scope; a rule-plus-meaning criterion is decided by its
 * rules with `meaningSkipped: true`.
 *
 * With a judge (AD-7) the result is a promise: meaning-only criteria are in scope, and a
 * criterion that reached the meaning step costs one judge call per criterion (plus at
 * most one re-ask; a `conversation` criterion covers every reply in that one call), made
 * sequentially in criterion order. A null reply is FAIL
 * `no-reply` without a call; a PASS whose evidence is not a verbatim fragment of the
 * evaluated reply is re-asked once, then ERROR `judge-invalid-output`; a rejecting judge
 * is ERROR `judge-transport`. Every meaning-decided result is `advisory: !trust.trusted`
 * and carries `judgeUsage`. `state` and `observation-window` criteria are NOT_RUN
 * `judge-unsupported:<kind>`.
 */
export function evaluate(test: LoadedTest, run: CaseRun, judge: null, trust: JudgeTrust, rules?: RuleRegistry): CriterionResult[];
export function evaluate(
  test: LoadedTest,
  run: CaseRun,
  judge: CriterionJudge,
  trust: JudgeTrust,
  rules?: RuleRegistry,
): Promise<CriterionResult[]>;
export function evaluate(
  test: LoadedTest,
  run: CaseRun,
  judge: CriterionJudge | null,
  trust: JudgeTrust,
  rules: RuleRegistry = RULES,
): CriterionResult[] | Promise<CriterionResult[]> {
  if (judge === null) {
    return rulePhase(test, run, false, trust, rules).map((slot) => {
      if ('pending' in slot) throw new Error(`[suite] evaluate: ${test.id}/${slot.criterion.id} needs a judge`);
      return slot;
    });
  }
  return evaluateWithJudge(test, run, judge, trust, rules);
}

async function evaluateWithJudge(
  test: LoadedTest,
  run: CaseRun,
  judge: CriterionJudge,
  trust: JudgeTrust,
  rules: RuleRegistry,
): Promise<CriterionResult[]> {
  if (test.expectedBehavior === undefined) {
    throw new Error(`[suite] evaluate: ${test.id} has no expectedBehavior; a judge needs the source case's expected behavior`);
  }
  const slots = rulePhase(test, run, true, trust, rules);
  const results: CriterionResult[] = [];
  // Sequential, in criterion order, so judge calls are deterministic.
  for (const slot of slots) {
    results.push('pending' in slot ? await meaningPhase(test, run, slot, judge, trust) : slot);
  }
  return results;
}

/** A criterion whose rule checks all PASSed and whose meaning checks await the judge. */
interface PendingMeaning {
  pending: true;
  criterion: LoadedCriterion;
  partial: CriterionResult;
}

function rulePhase(
  test: LoadedTest,
  run: CaseRun,
  withJudge: boolean,
  trust: JudgeTrust,
  rules: RuleRegistry,
): Array<CriterionResult | PendingMeaning> {
  assertRun(test, run);
  assertRules(test, run, rules);
  const context: RuleContext = { seedHistory: test.seed?.history ?? [] };
  const checkpoint = failedCheckpoint(test, run, rules, context);
  return test.criteria.map((criterion) => evaluateCriterion(test, run, criterion, withJudge, trust, rules, context, checkpoint));
}

async function meaningPhase(
  test: LoadedTest,
  run: CaseRun,
  slot: PendingMeaning,
  judge: CriterionJudge,
  trust: JudgeTrust,
): Promise<CriterionResult> {
  const { input, replyTexts } = buildJudgeInput(test, run, slot.criterion);
  const meaning = { ...slot.partial, advisory: !trust.trusted };
  if (replyTexts.length === 0) {
    return { ...meaning, status: 'FAIL', evidence: 'no-reply', judgeUsage: emptyJudgeUsage() };
  }

  const decision = await decideMeaning(judge, input, replyTexts);
  if (decision.status === 'ERROR') {
    return { ...meaning, status: 'ERROR', reason: decision.reason, evidence: decision.message, judgeUsage: decision.usage };
  }
  return {
    ...meaning,
    status: decision.status,
    reason: decision.reason,
    ...(decision.evidence !== null ? { evidence: decision.evidence } : {}),
    judgeUsage: decision.usage,
  };
}

const EFFECT_COUNT = 'effect-count';

function assertRun(test: LoadedTest, run: CaseRun): void {
  if (run.testId !== test.id) throw new Error(`[suite] evaluate: run is for ${run.testId}, test is ${test.id}`);
  run.steps.forEach((step, position) => {
    if (step.index !== position + 1) {
      throw new Error(`[suite] evaluate: ${test.id} step at position ${position} has index ${step.index}, expected ${position + 1}`);
    }
  });
}

function assertRules(test: LoadedTest, run: CaseRun, rules: RuleRegistry): void {
  const names = new Set<string>();
  test.steps.forEach((step) => step.checkpoint?.checks.forEach((check) => names.add(check.rule)));
  test.criteria.forEach((criterion) => ruleChecks(criterion, run).forEach((check) => names.add(check.rule)));
  for (const name of names) {
    if (!Object.prototype.hasOwnProperty.call(rules, name)) {
      throw new Error(`[suite] evaluate: ${test.id} references rule ${name}, which is not in the registry`);
    }
  }
}

/** The step a criterion is evaluated at; 0 for observation tests. */
export function criterionStep(test: Pick<LoadedTest, 'steps'>, criterion: Pick<LoadedCriterion, 'evaluatedAt' | 'stateQuery'>): number {
  const at = parseEvaluatedAt(criterion.evaluatedAt);
  if (at.kind === 'reply' || at.kind === 'after-step') return at.step;
  if (at.kind === 'state' && criterion.stateQuery) {
    return stateAtStep(criterion.stateQuery.at) ?? test.steps.length;
  }
  return test.steps.length;
}

/** `observed` for state criteria at L2, `substituted` at L1, else `n/a` (AD-10). */
function stateMethod(criterion: Pick<LoadedCriterion, 'evaluatedAt'>, level: CaseRun['level']): 'observed' | 'substituted' | 'n/a' {
  if (criterion.evaluatedAt !== 'state') return 'n/a';
  return level === 'L2' ? 'observed' : level === 'L1' ? 'substituted' : 'n/a';
}

/**
 * The criterion's own rule checks plus, for a `change` state criterion with a manifest
 * `stateEffect`, the synthesized `effect-count` check (AD-10) when the run declares
 * `events` and the level is not L2.
 */
function ruleChecks(criterion: LoadedCriterion, run: CaseRun, step?: number): RuleCheck[] {
  const own = criterion.checks.filter((check): check is RuleCheck => check.type === 'rule');
  const effect = criterion.stateEffect;
  if (
    criterion.stateQuery?.kind !== 'change' ||
    !effect ||
    !fieldObserved('events', run.observed) ||
    run.level === 'L2'
  ) {
    return own;
  }
  return [...own, { type: 'rule', rule: EFFECT_COUNT, params: { ...effect, step: step ?? 0 } }];
}

function runCheck(
  run: CaseRun,
  criterion: Pick<LoadedCriterion, 'id' | 'evaluatedAt'>,
  check: RuleCheck,
  rules: RuleRegistry,
  context: RuleContext,
): RuleOutcome {
  const entry = rules[check.rule]!;
  const missing = missingField(entry.requires, run);
  if (missing) return { status: 'NOT_OBSERVABLE', evidence: `unobservable:${missing}@${run.level}` };
  return entry.run(run, criterion, check.params, context);
}

/** The earliest journey checkpoint whose rule checks FAIL (only FAIL fails it). */
function failedCheckpoint(test: LoadedTest, run: CaseRun, rules: RuleRegistry, context: RuleContext): number | null {
  for (const [position, step] of test.steps.entries()) {
    const k = position + 1;
    if (!step.checkpoint || k > run.steps.length || (run.stoppedAtStep !== undefined && k > run.stoppedAtStep)) continue;
    const at = { id: `${test.id}.checkpoint:${k}`, evaluatedAt: `after-step:${k}` };
    if (step.checkpoint.checks.some((check) => runCheck(run, at, check, rules, context).status === 'FAIL')) return k;
  }
  return null;
}

function evaluateCriterion(
  test: LoadedTest,
  run: CaseRun,
  criterion: LoadedCriterion,
  withJudge: boolean,
  trust: JudgeTrust,
  rules: RuleRegistry,
  context: RuleContext,
  checkpoint: number | null,
): CriterionResult | PendingMeaning {
  const step = criterionStep(test, criterion);
  const base = {
    testId: test.id,
    criterionId: criterion.id,
    sourceCase: test.sourceCase,
    level: run.level,
    layer: criterion.layer,
    testKind: test.kind,
    step,
    // L1 answers state criteria from in-memory repositories, a substitute for the dashboard;
    // L2 reads them from the running stack's dev endpoints (AD-10).
    method: stateMethod(criterion, run.level),
  };
  const decided = (status: CriterionResult['status'], extra: Partial<CriterionResult> = {}): CriterionResult => ({
    ...base,
    inScope: true,
    status,
    advisory: false,
    ...extra,
  });

  // Scope (AD-9).
  const levelDeclared =
    test.levels.includes(run.level) && (criterion.levels === undefined || criterion.levels.includes(run.level));
  if (!levelDeclared) {
    return { ...base, inScope: false, status: 'NOT_RUN', advisory: false, reason: 'level-not-declared' };
  }
  const hasRules = criterion.checks.some((check) => check.type === 'rule');
  const hasMeaning = criterion.checks.some((check) => check.type === 'meaning');
  if (!hasRules && !withJudge) {
    // Meaning-derived: advisory until the judge is trusted (AD-8).
    return { ...base, inScope: false, status: 'NOT_RUN', advisory: !trust.trusted, reason: 'no-judge-at-level' };
  }

  // INVALID.
  const precondition = run.preconditions.find((result) => !result.satisfied);
  if (precondition) return decided('INVALID', { reason: `precondition:${precondition.name}` });
  if (checkpoint !== null && invalidatedByCheckpoint(criterion, step, checkpoint)) {
    return decided('INVALID', { reason: `checkpoint:${checkpoint}` });
  }
  if (alreadySatisfied(run, criterion, rules, context)) {
    return decided('INVALID', { reason: 'precondition:already-satisfied' });
  }

  // ERROR.
  const error = run.errors.find((entry) => !isUnsupportedFixture(entry.reason) && entry.step <= step);
  if (error) return decided('ERROR', { reason: error.reason, evidence: error.message || undefined });

  // NOT_RUN.
  const unsupported = run.errors.find((entry) => isUnsupportedFixture(entry.reason));
  if (unsupported) return decided('NOT_RUN', { reason: unsupported.reason });
  if (step > run.steps.length || (run.stoppedAtStep !== undefined && step > run.stoppedAtStep)) {
    return decided('NOT_RUN', { reason: `step-not-reached:${step}` });
  }

  // Rule checks; NOT_RUN outranks a FAIL from another check of the same criterion.
  const meaningSkipped = hasMeaning && !withJudge ? { meaningSkipped: true } : {};
  const outcomes = ruleChecks(criterion, run, step).map((check) => ({
    check,
    outcome: runCheck(run, criterion, check, rules, context),
  }));
  const notObservable = outcomes.find(({ outcome }) => outcome.status === 'NOT_OBSERVABLE');
  if (notObservable) {
    return decided('NOT_RUN', {
      reason: notObservable.outcome.evidence ?? `not-observable:${notObservable.check.rule}`,
      ...meaningSkipped,
    });
  }
  const failed = outcomes.filter(({ outcome }) => outcome.status === 'FAIL');
  if (failed.length > 0) {
    const evidence = failed.map(({ check, outcome }) => outcome.evidence ?? `${check.rule}: FAIL`).join('\n');
    // AD-10: a rule FAIL is never overridden; meaning is not applied (and no judge call).
    return decided('FAIL', { evidence, ...(hasMeaning ? { meaningSkipped: true } : {}) });
  }
  if (hasMeaning && withJudge) {
    const at = parseEvaluatedAt(criterion.evaluatedAt);
    if (at.kind === 'state' || at.kind === 'observation-window') {
      return decided('NOT_RUN', { reason: `judge-unsupported:${at.kind}` });
    }
    return { pending: true, criterion, partial: decided('PASS') };
  }
  return decided('PASS', meaningSkipped);
}

function isUnsupportedFixture(reason: string): boolean {
  return reason.startsWith('unsupported-fixture:');
}

/** AD-18: criteria after step k, and dependent `conversation`/`state` criteria. */
function invalidatedByCheckpoint(criterion: LoadedCriterion, step: number, k: number): boolean {
  const at = parseEvaluatedAt(criterion.evaluatedAt);
  if (at.kind === 'conversation' || at.kind === 'state') return criterion.independentOfCheckpoints !== true;
  return step > k;
}

/**
 * A `change` state criterion whose own rule checks (not the synthesized `effect-count`)
 * all PASS when the queried snapshot is replaced by `state.before` measured nothing.
 */
function alreadySatisfied(run: CaseRun, criterion: LoadedCriterion, rules: RuleRegistry, context: RuleContext): boolean {
  const query = criterion.stateQuery;
  if (!query || query.kind !== 'change') return false;
  const own = criterion.checks.filter((check): check is RuleCheck => check.type === 'rule');
  if (own.length === 0) return false;
  const queriedStep = stateAtStep(query.at);
  const state =
    query.at === 'after'
      ? { ...run.state, after: run.state.before }
      : queriedStep !== null
        ? { ...run.state, afterStep: { ...run.state.afterStep, [String(queriedStep)]: run.state.before } }
        : run.state;
  const substituted: CaseRun = { ...run, state };
  return own.every((check) => runCheck(substituted, criterion, check, rules, context).status === 'PASS');
}
