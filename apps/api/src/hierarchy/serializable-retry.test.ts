import { describe, expect, it, vi } from 'vitest';
import { withSerializableRetry } from './serializable-retry';

describe('withSerializableRetry', () => {
  it('replays the whole transaction after PostgreSQL serialization failure', async () => {
    const run = vi.fn().mockRejectedValueOnce({ code: '40001' }).mockResolvedValue('committed');
    await expect(withSerializableRetry(run)).resolves.toBe('committed');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('does not retry domain errors or unbounded serialization failures', async () => {
    const domainError = new Error('invalid_hierarchy');
    const invalid = vi.fn().mockRejectedValue(domainError);
    await expect(withSerializableRetry(invalid)).rejects.toBe(domainError);
    expect(invalid).toHaveBeenCalledTimes(1);

    const serial = { code: '40001' };
    const exhausted = vi.fn().mockRejectedValue(serial);
    await expect(withSerializableRetry(exhausted)).rejects.toBe(serial);
    expect(exhausted).toHaveBeenCalledTimes(4);
  });
});
