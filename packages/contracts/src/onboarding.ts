import { z } from 'zod';

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const WorkCalendarSchema = z.object({
  timezone: z.string().refine((tz) => {
    try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
  }, 'invalid IANA timezone'),
  workingDays: z.array(z.number().int().min(1).max(7)).min(1)
    .transform((days) => [...new Set(days)].sort((a, b) => a - b)),
  workStart: HHMM,
  workEnd: HHMM,
}).refine((c) => c.workStart < c.workEnd, 'workStart must be before workEnd');
export type WorkCalendar = z.infer<typeof WorkCalendarSchema>;

export const OnboardingActionSchema = z.enum(['start', 'later', 'decline', 'got_it']);
export type OnboardingActionContract = z.infer<typeof OnboardingActionSchema>;

export interface OnboardingReminderJob {
  tenantId: string;
  personId: string;
  /** ISO timestamp the reminder was scheduled for. */
  dueAt: string;
  /** Times this job was pushed back (recent user activity or closed hours); the 6th pass sends anyway. */
  postponeCount?: number;
}

/** Queued by the API after the company work calendar changes; the worker recomputes scheduled reminders. */
export interface OnboardingReminderRecalculateJob {
  tenantId: string;
}

export const OnboardingRoleSchema = z.enum(['employee', 'team_lead', 'manager', 'hr', 'hrbp', 'leadership']);

export const OnboardingActionJobSchema = z.object({
  kind: z.literal('button').default('button'),
  tenantId: z.string(),
  personId: z.string(),
  action: OnboardingActionSchema,
  /** Slack action_ts (epoch seconds, fractional). */
  actionTs: z.string(),
  messageTs: z.string(),
  channelId: z.string(),
});
export type OnboardingActionJob = z.input<typeof OnboardingActionJobSchema>;

/** Queued by the API after a hierarchy mutation committed; the worker applies it as a state event. */
export const OnboardingSystemJobSchema = z.object({
  kind: z.literal('system'),
  tenantId: z.string(),
  personId: z.string(),
  event: z.discriminatedUnion('type', [
    z.object({ type: z.literal('role_changed'), from: OnboardingRoleSchema, to: OnboardingRoleSchema }),
    z.object({ type: z.literal('deactivated') }),
  ]),
});
export type OnboardingSystemJob = z.infer<typeof OnboardingSystemJobSchema>;

/** A job without `kind` predates the union and is a button job. */
export const OnboardingQueueJobSchema = z.preprocess(
  (v) => (v && typeof v === 'object' && !Array.isArray(v) && !('kind' in v) ? { ...v, kind: 'button' } : v),
  z.discriminatedUnion('kind', [OnboardingActionJobSchema, OnboardingSystemJobSchema]),
);
export type OnboardingQueueJob = z.output<typeof OnboardingQueueJobSchema>;
