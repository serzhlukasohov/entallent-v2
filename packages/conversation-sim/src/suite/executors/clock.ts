import type { ClockPort } from '@entalent/application';

/** A business clock the suite controls; never Vitest fake timers (AD-5). */
export interface ControlledClock extends ClockPort {
  advance(ms: number): void;
  /** The current instant without side effects (an `AdvancingClock` does not tick). */
  peek(): Date;
}

function assertDuration(ms: number): void {
  if (!Number.isInteger(ms) || ms < 0) throw new Error(`clock advance must be a non-negative integer, got ${ms}`);
}

/** Stands still between explicit `advance` calls. */
export class FixedClock implements ControlledClock {
  private current: number;

  constructor(start: Date) {
    this.current = start.getTime();
  }

  now(): Date {
    return new Date(this.current);
  }

  peek(): Date {
    return new Date(this.current);
  }

  advance(ms: number): void {
    assertDuration(ms);
    this.current += ms;
  }
}

/**
 * Moves forward by `tickMs` after every `now()` read, so successive stamps are strictly
 * ordered while staying deterministic; `advance` jumps like `FixedClock`.
 */
export class AdvancingClock implements ControlledClock {
  private current: number;

  constructor(
    start: Date,
    private readonly tickMs = 1,
  ) {
    assertDuration(tickMs);
    this.current = start.getTime();
  }

  now(): Date {
    const at = new Date(this.current);
    this.current += this.tickMs;
    return at;
  }

  peek(): Date {
    return new Date(this.current);
  }

  advance(ms: number): void {
    assertDuration(ms);
    this.current += ms;
  }
}
