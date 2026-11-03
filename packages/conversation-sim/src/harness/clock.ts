/**
 * Test-process clock for preconditions with a start time. Production code takes no clock
 * parameter, so `Date` itself is shifted: it starts at the given instant and keeps running.
 */
const RealDate = Date;

/** Wall-clock time, unaffected by `shiftClockTo`; for report timestamps that select runs by real time. */
export function realNow(): number {
  return RealDate.now();
}

/** Shifts `Date` in this process to `start` and lets it keep running from there. */
export function shiftClockTo(start: Date): void {
  const offset = start.getTime() - RealDate.now();
  const now = () => RealDate.now() + offset;
  globalThis.Date = new Proxy(RealDate, {
    construct: (target, args: unknown[], newTarget) => Reflect.construct(target, args.length ? args : [now()], newTarget) as object,
    apply: () => new RealDate(now()).toString(),
    get: (target, property, receiver) => (property === 'now' ? now : Reflect.get(target, property, receiver)),
  });
}

/** Puts the real clock back; safe to call when it was never shifted. */
export function restoreClock(): void {
  globalThis.Date = RealDate;
}
