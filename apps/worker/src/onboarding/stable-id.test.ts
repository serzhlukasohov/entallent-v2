import { describe, expect, it } from 'vitest';
import { stableId } from './stable-id';

describe('stableId', () => {
  it('is deterministic, input-sensitive and uuid-shaped', () => {
    expect(stableId('a', 'b')).toBe(stableId('a', 'b'));
    expect(stableId('a', 'b')).not.toBe(stableId('a', 'c'));
    expect(stableId('ab', 'c')).not.toBe(stableId('a', 'bc'));
    expect(stableId('onb-ack', 'x')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
