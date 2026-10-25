import { z } from 'zod';
import { SIM_CONVERSATION_ID, SIM_TENANT_ID } from '../../harness/coach-harness';
import { satisfied, type FixtureModule } from './types';

const hour = z.number().int().min(0).max(23);

const userSchema = z
  .object({
    timezone: z.string().min(1).refine(
      (timeZone) => {
        try {
          new Intl.DateTimeFormat('en-US', { timeZone });
          return true;
        } catch {
          return false;
        }
      },
      { message: 'unknown IANA time zone' },
    ),
    // Enabled quiet hours name both hours: the product would otherwise fall back to its default 22-08.
    quietHours: z
      .object({ enabled: z.boolean(), startHour: hour.optional(), endHour: hour.optional() })
      .strict()
      .refine((value) => !value.enabled || (value.startHour !== undefined && value.endHour !== undefined), {
        message: 'enabled quiet hours require startHour and endHour',
      }),
    scan: z
      .object({
        minSilenceDays: z.number().nonnegative(),
        minCheckInGapDays: z.number().nonnegative(),
        quietHoursEnabled: z.boolean(),
      })
      .strict(),
  })
  .strict();

/**
 * Every outcome-affecting input of the observed user; nothing has a default (the case
 * author sets them with QA). Exactly one user in Story 12.7; multi-user is deferred.
 */
const params = userSchema;

/**
 * Registers the harness user for the P-06 observation window: its timezone becomes the
 * conversation timezone and its quiet hours and scan config drive the scheduler.
 */
export const proactiveUsersFixture: FixtureModule<z.infer<typeof params>> = {
  name: 'proactiveUsers',
  params,
  harnessOptions: (value) => ({ timezone: value.timezone }),
  create(context, value) {
    return {
      async apply() {
        context.proactive.users.push({
          timezone: value.timezone,
          quietHours: { ...value.quietHours },
          scan: { ...value.scan },
        });
      },
      async verify() {
        const conversation = await context.state.conversationRepo.findById(SIM_CONVERSATION_ID, SIM_TENANT_ID);
        const ok = context.proactive.users.length === 1 && conversation?.userTimezone === value.timezone;
        return satisfied('proactiveUsers', ok, ok ? undefined : 'expected exactly one user in the conversation timezone');
      },
    };
  },
};
