import { describe, expect, it } from 'vitest';
import { CircuitBreaker } from './circuit-breaker';

const retryable = (error: unknown) => {
  const status = typeof error === 'object' && error !== null && 'status' in error
    ? error.status : undefined;
  return typeof status !== 'number' || status === 429 || status >= 500;
};

describe('CircuitBreaker failure classification', () => {
  it('does not open on permanent 400 but still opens on retryable provider faults', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 2, isFailure: retryable });
    for (let i = 0; i < 4; i++) {
      await expect(breaker.call(async () => { throw { status: 400 }; })).rejects.toMatchObject({ status: 400 });
    }
    expect(breaker.getState()).toBe('CLOSED');
    await expect(breaker.call(async () => { throw { status: 429 }; })).rejects.toMatchObject({ status: 429 });
    await expect(breaker.call(async () => { throw { status: 503 }; })).rejects.toMatchObject({ status: 503 });
    expect(breaker.getState()).toBe('OPEN');
  });
});
