import { describe, expect, it } from 'vitest';
import { shouldMountDevModule } from './dev-endpoints';

describe('shouldMountDevModule', () => {
  it('fails closed when production tries to enable dev endpoints', () => {
    expect(() =>
      shouldMountDevModule({ NODE_ENV: 'production', ENABLE_DEV_ENDPOINTS: 'true' }),
    ).toThrow(/ENABLE_DEV_ENDPOINTS.*production/i);
  });

  it('does not mount dev endpoints in production when the flag is absent or false', () => {
    expect(shouldMountDevModule({ NODE_ENV: 'production' })).toBe(false);
    expect(shouldMountDevModule({ NODE_ENV: 'production', ENABLE_DEV_ENDPOINTS: 'false' })).toBe(false);
  });

  it('preserves non-production dev module mounting', () => {
    expect(shouldMountDevModule({ NODE_ENV: 'development' })).toBe(true);
    expect(shouldMountDevModule({ NODE_ENV: 'test' })).toBe(true);
  });
});
