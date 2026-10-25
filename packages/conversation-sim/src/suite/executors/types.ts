import type { CaseRun, FixtureName, Level, LoadedTest, ObservationField } from '../schema';

/** Options the runner passes to `SuiteExecutor.run` (architecture AD-4, AD-18). */
export interface ExecutorOptions {
  /** 1-based; the runner increments it when it retries an infrastructure error. */
  attempt: number;
  /** `suite.config.json.interMessageGapMs`, realized before every journey step after the first. */
  interMessageGapMs: number;
  /** Business-time start of the run; a `clock` fixture `start` overrides it. */
  clockStart?: Date;
}

/** One executor adapter per level behind one port; it returns observations, never statuses. */
export interface SuiteExecutor {
  readonly level: Level;
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
