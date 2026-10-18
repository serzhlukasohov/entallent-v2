import { describe, expect, it } from 'vitest';
import { Job } from 'bullmq';
import { reminderJobId, reminderSweepJobId, startJobId, trustJobId } from './job-ids';
import { stableId } from './stable-id';

// BullMQ throws "Custom Id cannot contain :" unless an id with ':' has exactly three segments.
// BullMQ's own check (Job#validateOptions), run without a Redis connection.
const validate = (jobId: string) => (Job.prototype as unknown as { validateOptions(d: unknown): void })
  .validateOptions.call({ opts: { jobId }, name: 'n' }, { data: '{}' });

describe('onboarding BullMQ job ids', () => {
  const personId = '3f2b8c1e-0000-4000-8000-000000000001';
  it.each([
    ['reminder', reminderJobId(personId, 1_791_000_000_000)],
    ['reminder sweep', reminderSweepJobId(personId, 1_791_000_000_000, 497_500)],
    ['start (dedupeKey is personId:version)', startJobId(`${personId}:3`)],
    ['trust', trustJobId(stableId('onb-intro', personId, '2', 'trust'))],
  ])('%s id passes BullMQ validation', (_name, id) => {
    expect(() => validate(id)).not.toThrow();
  });

  it('the old sweep id shape is rejected (guard against regressing the check itself)', () => {
    expect(() => validate(`onb-rem:${personId}:1:sweep:2`)).toThrow('Custom Id cannot contain :');
  });
});
