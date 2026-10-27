import type { CaseRun, FixtureName, Level, LoadedTest, ObservationField } from '../schema';

/**
 * The runner's coach-call budget for one invocation (AD-15). `tryCoachCall()` reserves one
 * coach model call and returns true, or returns false when the budget is spent: the call
 * must then not be made.
 */
export interface CallBudget {
  tryCoachCall(): boolean;
}

/** Options the runner passes to `SuiteExecutor.run` (architecture AD-4, AD-18). */
export interface ExecutorOptions {
  /** 1-based; the runner increments it when it retries an infrastructure error. */
  attempt: number;
  /** `suite.config.json.interMessageGapMs`, realized before every journey step after the first. */
  interMessageGapMs: number;
  /** Business-time start of the run; a `clock` fixture `start` overrides it. */
  clockStart?: Date;
  /** The suite being run (the runner passes `suite.id`); L1 names its Scenario set after it. */
  suiteId?: string;
  /** Asked before every coach model call (the runner passes it on every attempt; L0 ignores it). */
  budget?: CallBudget;
  /** Per coach model call timeout (`budgets.coachCallTimeoutMs`; L0 ignores it). */
  coachCallTimeoutMs?: number;
  /** The runner's run id; L2 names each attempt's persona after it (required there). */
  runId?: string;
  /** 1-based sample of the run (`--runs`); L2 names each attempt's persona after it. */
  sample?: number;
}

/** One executor adapter per level behind one port; it returns observations, never statuses. */
export interface SuiteExecutor {
  readonly level: Level;
  /** The coach model label the executor talks to (`models.coach`); absent or null when none (L0). */
  readonly coachModel?: string | null;
  supports(fixture: FixtureName): boolean;
  observes(): ObservationField[];
  run(test: LoadedTest, options: ExecutorOptions): Promise<CaseRun>;
}

export type SuiteExecutionErrorKind = 'product' | 'infrastructure';

/**
 * An error that ends a case. `product` errors never retry; `infrastructure` errors make
 * the runner discard the run and re-run the case once (AD-18). `step` 0 covers fixtures
 * and seed. `reason` is the stable `ExecutionError.reason` (`fixture-apply:<name>`,
 * `scripted-output-missing:<step>`, ...).
 */
export class SuiteExecutionError extends Error {
  readonly kind: SuiteExecutionErrorKind;
  readonly step: number;
  readonly reason: string;
  override readonly cause: unknown;

  constructor(input: { kind: SuiteExecutionErrorKind; step: number; reason: string; cause?: unknown; message?: string }) {
    super(input.message ?? (input.cause instanceof Error ? input.cause.message : input.reason));
    this.name = 'SuiteExecutionError';
    this.kind = input.kind;
    this.step = input.step;
    this.reason = input.reason;
    this.cause = input.cause;
  }
}
