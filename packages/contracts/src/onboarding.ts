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
