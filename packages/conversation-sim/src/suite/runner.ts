import { isTransportFailureMessage } from '../gate/failure-kind';
import { evaluate } from './evaluate';
import type { CallBudget, ExecutorOptions, SuiteExecutor } from './executors/types';
import { SuiteExecutionError } from './executors/types';
import { emptyJudgeUsage, type CriterionJudge } from './judge/criterion-judge';
import { decideJudgeTrust, type JudgeTrustInputs } from './judge/trust';
import { buildSuiteReport, collectJudgeErrors, collectQaReview, judgeUsageTotals } from './report';
import { RULES, type RuleRegistry } from './rules/registry';
import {
  CaseRunSchema,
  type AgreementFile,
  type BudgetKind,
  type CaseRun,
  type CriterionResult,
  type ExecutionError,
  type JudgeTrust,
  type Level,
  type LoadedSuite,
  type LoadedTest,
  type ModelUsageRow,
  type QaReviewEntry,
  type RunBudgetReport,
  type SuiteConfig,
  type SuiteRunReport,
} from './schema';
import { score, testCriterionKey } from './score';

/**
 * Suite runner (architecture AD-3, AD-8, AD-15, AD-18): load -> executor per test per sample
 * (with the infrastructure retry) -> `JudgeTrust` -> `evaluate` -> `score` -> report. One
 * `RunBudget` bounds coach and judge calls; once one is spent, remaining cases are ERROR
 * `budget-exceeded` without executing and the run is provisional. Pure apart from the
 * executor; writes no files (the CLI does).
 */

export type FailureKind = 'none' | 'product' | 'infrastructure';

const BUDGET_KINDS: readonly BudgetKind[] = ['coach', 'judge'];

/**
 * The call budget of one `runSuite` invocation (AD-15): absolute over every sample and
 * retry, never scaled by `--runs`. Coach calls are reserved through `forExecutor` before
 * each call (so the count is authoritative and includes discarded retry attempts); judge
 * calls are counted by `guardJudge` from each outcome's usage (one invocation may overshoot
 * by its single transport retry).
 */
export class RunBudget {
  readonly maxCoachCalls: number;
  readonly maxJudgeCalls: number;
  private readonly coach = new Map<string, number>();
  private readonly judge = { calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  private readonly exceededKinds = new Set<BudgetKind>();

  constructor(budgets: Pick<SuiteConfig['budgets'], 'maxCoachCallsPerRun' | 'maxJudgeCallsPerRun'>) {
    this.maxCoachCalls = budgets.maxCoachCallsPerRun;
    this.maxJudgeCalls = budgets.maxJudgeCallsPerRun;
  }

  get coachCalls(): number {
    let total = 0;
    for (const calls of this.coach.values()) total += calls;
    return total;
  }

  get judgeCalls(): number {
    return this.judge.calls;
  }

  /** Reserves one coach call for `model`; false (and `coach` exceeded) once the budget is spent. */
  tryCoachCall(model: string): boolean {
    if (this.coachCalls >= this.maxCoachCalls) {
      this.exceededKinds.add('coach');
      return false;
    }
    this.coach.set(model, (this.coach.get(model) ?? 0) + 1);
    return true;
  }

  /** The hook an executor asks before every coach model call. */
  forExecutor(model: string): CallBudget {
    return { tryCoachCall: () => this.tryCoachCall(model) };
  }

  /** Budgets already spent, in `coach`, `judge` order. */
  spent(): BudgetKind[] {
    return BUDGET_KINDS.filter((kind) => (kind === 'coach' ? this.coachCalls >= this.maxCoachCalls : this.judge.calls >= this.maxJudgeCalls));
  }

  markExceeded(kind: BudgetKind): void {
    this.exceededKinds.add(kind);
  }

  max(kind: BudgetKind): number {
    return kind === 'coach' ? this.maxCoachCalls : this.maxJudgeCalls;
  }

  /** Every budget a call or case was refused for, in `coach`, `judge` order. */
  exceeded(): BudgetKind[] {
    return BUDGET_KINDS.filter((kind) => this.exceededKinds.has(kind));
  }

  /**
   * Refuses (ERROR `budget-exceeded`, no call) once the judge budget is spent; otherwise
   * calls `judge` and counts its calls and tokens. A rejecting judge counts one call.
   */
  guardJudge(judge: CriterionJudge): CriterionJudge {
    return async (input, options) => {
      if (this.judge.calls >= this.maxJudgeCalls) {
        this.exceededKinds.add('judge');
        return { status: 'ERROR', reason: 'budget-exceeded', message: `judge call budget ${this.maxJudgeCalls} spent`, usage: emptyJudgeUsage() };
      }
      let outcome: Awaited<ReturnType<CriterionJudge>>;
      try {
        outcome = await judge(input, options);
      } catch (error) {
        this.judge.calls += 1;
        throw error;
      }
      this.judge.calls += outcome.usage.calls;
      this.judge.inputTokens += outcome.usage.inputTokens;
      this.judge.outputTokens += outcome.usage.outputTokens;
      this.judge.totalTokens += outcome.usage.totalTokens;
      return outcome;
    };
  }

  report(): RunBudgetReport {
    return {
      maxCoachCalls: this.maxCoachCalls,
      maxJudgeCalls: this.maxJudgeCalls,
      coachCalls: this.coachCalls,
      judgeCalls: this.judge.calls,
      exceeded: this.exceeded(),
    };
  }

  /** One coach row per coach model label (tokens not observable), one judge row when a judge is configured. */
  modelUsage(models: { coach: string | null; judge: string | null }): ModelUsageRow[] {
    const labels = [...new Set([...(models.coach !== null ? [models.coach] : []), ...this.coach.keys()])];
    const rows: ModelUsageRow[] = labels.map((model) => ({
      role: 'coach',
      model,
      calls: this.coach.get(model) ?? 0,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
    }));
    if (models.judge !== null) rows.push({ role: 'judge', model: models.judge, ...this.judge });
    return rows;
  }
}

/**
 * Computed once per run (AD-8). L0 has no judge; L1/L2 need the trust inputs and delegate
 * to `judge/trust.ts`, the single trust decision.
 */
export function computeJudgeTrust(level: Level, inputs?: JudgeTrustInputs): JudgeTrust {
  if (level === 'L0') return { trusted: false, reason: 'no-judge-at-level', pin: null, agreement: null };
  if (inputs === undefined) throw new Error(`[suite] judge trust for ${level} needs the judge config, suite, agreement and labels hash`);
  return decideJudgeTrust(inputs);
}

/**
 * The kind of one `CaseRun` error after reclassification: infrastructure when the executor
 * said so (except a deterministic `unsupported-fixture:*`), or when a product
 * `agent-turn-error` is itself a transport failure; otherwise product.
 */
export function executionErrorKind(error: ExecutionError): 'product' | 'infrastructure' {
  if (error.kind === 'infrastructure') return error.reason.startsWith('unsupported-fixture:') ? 'product' : 'infrastructure';
  if (error.reason === 'agent-turn-error' && isTransportFailureMessage(error.message)) return 'infrastructure';
  return 'product';
}

/** `infrastructure` only when the run has errors and every one is infrastructure (the retry rule). */
export function caseRunFailureKind(run: Pick<CaseRun, 'errors'>): FailureKind {
  if (run.errors.length === 0) return 'none';
  return run.errors.every((error) => executionErrorKind(error) === 'infrastructure') ? 'infrastructure' : 'product';
}

export interface RunSuiteInput {
  suite: LoadedSuite;
  level: Level;
  /** Samples per test. */
  n: number;
  executor: SuiteExecutor;
  config: SuiteConfig;
  runId: string;
  git: { sha: string | null; dirty: boolean };
  /** `--case`: a test id or a source case id. */
  caseFilter?: string;
  rules?: RuleRegistry;
  /** One `[suite]` line per case per sample; never transcript text. */
  log?: (line: string) => void;
  /** Required at L1/L2, rejected at L0: the judge to call and the trust inputs (AD-8). */
  judging?: RunJudging;
}

export interface RunJudging {
  judge: CriterionJudge;
  /** The judge model actually called (recorded as `models.judge`). */
  model: string;
  /** True when `model` differs from the pin (`--allow-unpinned-judge`). */
  unpinned: boolean;
  agreement: AgreementFile | null;
  /** `labelsSha256` of the suite's current labels. */
  labelsSha256: string;
}

export interface CaseRunRecord {
  sample: number;
  run: CaseRun;
}

export interface RunSuiteOutput {
  report: SuiteRunReport;
  /** The kept run per test per sample (retried attempts are discarded). */
  caseRuns: CaseRunRecord[];
}

export class SuiteRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SuiteRunError';
  }
}

export async function runSuite(input: RunSuiteInput): Promise<RunSuiteOutput> {
  const { suite, level, n, executor, config } = input;
  const rules = input.rules ?? RULES;
  const log = input.log ?? (() => undefined);
  if (!Number.isInteger(n) || n < 1) throw new SuiteRunError(`[suite] runs must be a positive integer, got ${n}`);
  if (executor.level !== level) {
    throw new SuiteRunError(`[suite] executor is ${executor.level}, run level is ${level}`);
  }
  const judging = input.judging;
  if (level === 'L0' && judging !== undefined) throw new SuiteRunError('[suite] L0 runs have no judge; judging must not be given');
  if (level !== 'L0' && judging === undefined) throw new SuiteRunError(`[suite] ${level} run needs judging (a judge and its trust inputs)`);

  const selected = selectTests(suite, input.caseFilter);
  const scoredSuite: LoadedSuite =
    input.caseFilter === undefined
      ? suite
      : {
          id: suite.id,
          sources: suite.sources.filter((source) => selected.some((test) => test.sourceCase === source.id)),
          tests: selected,
        };
  if (suite.tests.length === 0) log(`[suite] ${suite.id} has no tests`);

  // Trust is decided once, before the first sample (AD-8); evaluate/score/report copy it.
  const trust =
    judging === undefined
      ? computeJudgeTrust(level)
      : computeJudgeTrust(level, {
          judge: config.judge,
          suite,
          agreement: judging.agreement,
          labelsSha256: judging.labelsSha256,
          unpinned: judging.unpinned,
        });
  const budget = new RunBudget(config.budgets);
  const coachLabel = executor.coachModel ?? 'unknown';
  const judge = judging === undefined ? null : budget.guardJudge(judging.judge);
  /** One case attempt, or a synthetic `budget-exceeded` run (never executed, never retried) once a budget is spent. */
  const attemptCase = async (test: LoadedTest, attempt: number, sample: number): Promise<{ run: CaseRun; executed: boolean }> => {
    const spent = budget.spent();
    if (spent.length > 0) {
      for (const kind of spent) budget.markExceeded(kind);
      const first = spent[0]!;
      const message = `${first} call budget ${budget.max(first)} spent`;
      return { run: syntheticRun(test, level, attempt, [{ kind: 'product', step: 0, reason: 'budget-exceeded', message }]), executed: false };
    }
    const options: ExecutorOptions = {
      attempt,
      interMessageGapMs: config.interMessageGapMs,
      suiteId: suite.id,
      budget: budget.forExecutor(coachLabel),
      coachCallTimeoutMs: config.budgets.coachCallTimeoutMs,
      runId: input.runId,
      sample,
    };
    return { run: await execute(executor, test, level, options), executed: true };
  };
  const results: CriterionResult[] = [];
  const qaReview: QaReviewEntry[] = [];
  const caseRuns: CaseRunRecord[] = [];
  let caseAttempts = 0;
  let infrastructureRetries = 0;

  for (let sample = 1; sample <= n; sample += 1) {
    for (const test of selected) {
      let run: CaseRun;
      if (!test.levels.includes(level)) {
        // Nothing to execute: every criterion is emitted out of scope (`level-not-declared`);
        // the run is not recorded in caseRuns.
        run = syntheticRun(test, level, 1, []);
        log(`[suite] ${level} sample ${sample}/${n} ${test.id}: skipped (level not declared)`);
      } else {
        let attempt = 1;
        let outcome = await attemptCase(test, attempt, sample);
        if (outcome.executed) caseAttempts += 1;
        run = outcome.run;
        let retriesLeft = config.retries.infrastructure;
        while (retriesLeft > 0 && caseRunFailureKind(run) === 'infrastructure') {
          log(`[suite] ${level} sample ${sample}/${n} ${test.id} attempt ${attempt}: infrastructure (${reasons(run)}), retrying`);
          retriesLeft -= 1;
          attempt += 1;
          outcome = await attemptCase(test, attempt, sample);
          if (outcome.executed) {
            caseAttempts += 1;
            infrastructureRetries += 1;
          }
          run = outcome.run;
        }
        caseRuns.push({ sample, run });
      }

      const evaluated = judge === null ? evaluate(test, run, null, trust, rules) : await evaluate(test, run, judge, trust, rules);
      assertOneResultPerCriterion(test, evaluated);
      results.push(...evaluated);
      qaReview.push(...collectQaReview(test, run, sample, evaluated));
      if (test.levels.includes(level)) log(statusLine(level, sample, n, test, run, evaluated));
    }
  }

  assertComplete(selected, results, n);
  const scored = score({ suite: scoredSuite, level, n, results });
  const empty = suite.tests.length === 0;
  const exceeded = budget.exceeded();
  const extraReasons = [
    ...(empty ? [`suite ${suite.id} has no tests`] : []),
    ...(exceeded.length > 0 ? [`budget exceeded: ${exceeded.join(', ')}`] : []),
  ];
  const models = { coach: executor.coachModel ?? null, judge: judging?.model ?? null };
  const report = buildSuiteReport(
    extraReasons.length > 0
      ? {
          ...scored,
          provisional: true,
          provisionalReason: [scored.provisionalReason, ...extraReasons].filter(Boolean).join('; '),
        }
      : scored,
    {
      runId: input.runId,
      suiteId: suite.id,
      level,
      n,
      git: input.git,
      models,
      judgeTrust: trust,
      judgeErrors: collectJudgeErrors(results),
      qaReview,
      usage: { coachModelCalls: budget.coachCalls, ...judgeUsageTotals(results), caseAttempts, infrastructureRetries },
      budget: budget.report(),
      modelUsage: budget.modelUsage(models),
      ...(input.caseFilter !== undefined ? { selection: { case: input.caseFilter } } : {}),
    },
  );
  return { report, caseRuns };
}

function selectTests(suite: LoadedSuite, caseFilter: string | undefined): LoadedTest[] {
  if (caseFilter === undefined) return suite.tests;
  const selected = suite.tests.filter((test) => test.id === caseFilter || test.sourceCase === caseFilter);
  if (selected.length === 0) {
    const known = [...new Set(suite.tests.flatMap((test) => [test.sourceCase, test.id]))];
    throw new SuiteRunError(
      `[suite] ${suite.id}: unknown case ${caseFilter}; known: ${known.length > 0 ? known.join(', ') : 'none (the suite has no tests)'}`,
    );
  }
  return selected;
}

/** One executor attempt; a rejection becomes a synthesized run with an `executor-error`. */
async function execute(executor: SuiteExecutor, test: LoadedTest, level: Level, options: ExecutorOptions): Promise<CaseRun> {
  const { attempt } = options;
  let raw: unknown;
  try {
    raw = await executor.run(test, options);
  } catch (error) {
    if (error instanceof SuiteExecutionError) {
      return syntheticRun(test, level, attempt, [{ kind: error.kind, step: error.step, reason: error.reason, message: error.message }]);
    }
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    const kind = isTransportFailureMessage(message) ? 'infrastructure' : 'product';
    return syntheticRun(test, level, attempt, [{ kind, step: 0, reason: 'executor-error', message }]);
  }
  const parsed = CaseRunSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new SuiteRunError(
      `[suite] ${test.id} attempt ${attempt}: executor returned an invalid CaseRun at ${issue?.path.join('.') || '(root)'}: ${issue?.message ?? 'invalid'}`,
    );
  }
  const run = parsed.data;
  if (run.testId !== test.id || run.level !== level || run.attempt !== attempt) {
    throw new SuiteRunError(
      `[suite] ${test.id} attempt ${attempt}: executor returned a run for ${run.testId} ${run.level} attempt ${run.attempt}`,
    );
  }
  return run;
}

function syntheticRun(test: LoadedTest, level: Level, attempt: number, errors: ExecutionError[]): CaseRun {
  return CaseRunSchema.parse({
    testId: test.id,
    level,
    attempt,
    subject: { externalUserId: `${level.toLowerCase()}-${test.id}` },
    observed: [],
    preconditions: [],
    steps: [],
    state: { before: {}, after: {}, afterStep: {} },
    errors,
    events: [],
  });
}

function assertOneResultPerCriterion(test: LoadedTest, results: readonly CriterionResult[]): void {
  const ids = results.map((result) => result.criterionId);
  const expected = test.criteria.map((criterion) => criterion.id);
  if (ids.length !== expected.length || expected.some((id) => !ids.includes(id))) {
    throw new SuiteRunError(`[suite] ${test.id}: evaluate returned ${ids.join(', ') || 'nothing'}, expected ${expected.join(', ')}`);
  }
}

/** Every `<testId>/<criterionId>` of the selected tests has exactly n results before scoring. */
function assertComplete(tests: readonly LoadedTest[], results: readonly CriterionResult[], n: number): void {
  const counts = new Map<string, number>();
  for (const result of results) {
    const key = testCriterionKey(result.testId, result.criterionId);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const test of tests) {
    for (const criterion of test.criteria) {
      const key = testCriterionKey(test.id, criterion.id);
      if (counts.get(key) !== n) {
        throw new SuiteRunError(`[suite] ${key} has ${counts.get(key) ?? 0} results, expected ${n}`);
      }
    }
  }
}

function reasons(run: CaseRun): string {
  return [...new Set(run.errors.map((error) => error.reason))].join(', ');
}

/** Statuses and error reasons only; never transcript or event text. */
function statusLine(level: Level, sample: number, n: number, test: LoadedTest, run: CaseRun, results: readonly CriterionResult[]): string {
  const counts = new Map<string, number>();
  for (const result of results) {
    const label = result.inScope ? result.status : 'out-of-scope';
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const summary = [...counts.entries()].map(([status, count]) => `${status} ${count}`).join(', ');
  const errors = run.errors.length > 0 ? ` errors: ${reasons(run)}` : '';
  return `[suite] ${level} sample ${sample}/${n} ${test.id} attempt ${run.attempt}: ${summary}${errors}`;
}
