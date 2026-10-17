import { describe, expect, it } from 'vitest';
import { devJobsEnabled } from './dev-jobs';

// Mirrors the API's shouldMountDevModule: dev-only jobs run exactly where the dev endpoints are mounted.
describe('devJobsEnabled', () => {
  it('is off in production, with or without ENABLE_DEV_ENDPOINTS', () => {
    expect(devJobsEnabled({ NODE_ENV: 'production' })).toBe(false);
    expect(devJobsEnabled({ NODE_ENV: 'production', ENABLE_DEV_ENDPOINTS: 'true' })).toBe(false);
  });

  it('is on outside production, defaulting an unset NODE_ENV to development', () => {
    expect(devJobsEnabled({ NODE_ENV: 'development' })).toBe(true);
    expect(devJobsEnabled({ NODE_ENV: 'test' })).toBe(true);
    expect(devJobsEnabled({})).toBe(true);
  });
});
