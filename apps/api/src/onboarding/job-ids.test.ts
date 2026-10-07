import { describe, expect, it } from 'vitest';
import { Job } from 'bullmq';
import { actionJobId, recalculateJobId, systemJobId } from './job-ids';

// BullMQ's own check (Job#validateOptions), run without a Redis connection.
const validate = (jobId: string) => (Job.prototype as unknown as { validateOptions(d: unknown): void })
  .validateOptions.call({ opts: { jobId }, name: 'n' }, { data: '{}' });

describe('onboarding BullMQ job ids (api)', () => {
  it.each([
    ['button action', actionJobId('U123ABC', '1788430500.000100')],
    ['recalculate', recalculateJobId('tenant-1', 1_791_000_000_000)],
    ['system event', systemJobId('3f2b8c1e-0000-4000-8000-000000000001', '3f2b8c1e-0000-4000-8000-000000000002')],
  ])('%s id passes BullMQ validation', (_name, id) => {
    expect(() => validate(id)).not.toThrow();
  });
});
