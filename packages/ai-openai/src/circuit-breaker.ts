type State = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  /** How many failures in the window before opening. Default: 5 */
  failureThreshold?: number;
  /** Rolling window for failure counting in ms. Default: 60_000 */
  windowMs?: number;
  /** How long to stay OPEN before probing again in ms. Default: 30_000 */
  cooldownMs?: number;
}

export class CircuitBreaker {
  private state: State = 'CLOSED';
  private readonly failureTimes: number[] = [];
  private nextProbeAt = 0;

  private get threshold(): number { return this.options.failureThreshold ?? 5; }
  private get window(): number { return this.options.windowMs ?? 60_000; }
  private get cooldown(): number { return this.options.cooldownMs ?? 30_000; }

  constructor(private readonly options: CircuitBreakerOptions = {}) {}

  async call<T>(fn: () => Promise<T>): Promise<T> {
    this.evict();

    if (this.state === 'OPEN') {
      if (Date.now() < this.nextProbeAt) {
        throw new Error('Circuit OPEN — provider temporarily unavailable');
      }
      this.state = 'HALF_OPEN';
    }

    try {
      const result = await fn();
      if (this.state === 'HALF_OPEN') {
        this.state = 'CLOSED';
        this.failureTimes.length = 0;
      }
      return result;
    } catch (err) {
      this.recordFailure();
      throw err;
    }
  }

  getState(): State { return this.state; }

  private evict(): void {
    const cutoff = Date.now() - this.window;
    let i = 0;
    while (i < this.failureTimes.length && this.failureTimes[i] <= cutoff) i++;
    this.failureTimes.splice(0, i);
  }

  private recordFailure(): void {
    this.failureTimes.push(Date.now());
    if (this.failureTimes.length >= this.threshold) {
      this.state = 'OPEN';
      this.nextProbeAt = Date.now() + this.cooldown;
    }
  }
}
