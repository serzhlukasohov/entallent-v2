import { describe, expect, it } from 'vitest';
import { toRuntimeFailureReason } from './conversation.module';

describe('toRuntimeFailureReason', () => {
  it.each([
    [new Error('raw user text: hello from message'), 'runtime_failed'],
    [new Error('fallback_closed_after_actions_committed'), 'fallback_closed_after_actions_committed'],
    [new Error('runtime_timeout'), 'runtime_timeout'],
    [new Error(''), 'runtime_failed'],
    ['runtime_unavailable', 'runtime_failed'],
  ])('maps %j to a stable ledger failure reason', (error, expected) => {
    expect(toRuntimeFailureReason(error)).toBe(expected);
  });
});
