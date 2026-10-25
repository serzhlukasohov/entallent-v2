import { z } from 'zod';
import { satisfied, type FixtureModule } from './types';

const params = z
  .object({
    /** Business time of the first step (ISO-8601); defaults to the executor's `clockStart`. */
    start: z.string().datetime({ offset: true }).optional(),
  })
  .strict()
  .default({});

type ClockParams = z.infer<typeof params>;

/**
 * Controlled business time (AD-5). The executor builds its `FixedClock` from `start`
 * before the harness exists and advances it for gaps; `verify` checks that nothing moved
 * the clock while fixtures were applied.
 */
export const clockFixture: FixtureModule<ClockParams> = {
  name: 'clock',
  params,
  harnessOptions: (value) => (value.start ? { clockStart: new Date(value.start) } : {}),
  create(context) {
    return {
      async apply() {},
      async verify() {
        const now = context.clock.peek().getTime();
        return satisfied('clock', now === context.start.getTime(), `clock ${new Date(now).toISOString()}`);
      },
    };
  },
};
