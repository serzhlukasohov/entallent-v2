import { z } from 'zod';
import { WorkCalendarSchema } from './onboarding';
export function isGregorianDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
export const ReportLocalDateSchema = z
  .string()
  .refine(isGregorianDate, 'real Gregorian date required');
const hour = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const ReportDateOverrideSchema = z
  .discriminatedUnion('kind', [
    z.object({ date: ReportLocalDateSchema, kind: z.literal('closed') }).strict(),
    z
      .object({
        date: ReportLocalDateSchema,
        kind: z.literal('working'),
        workStart: hour,
        workEnd: hour,
      })
      .strict(),
  ])
  .refine((v) => v.kind === 'closed' || v.workStart < v.workEnd, 'workStart must precede workEnd');
export const ReportCalendarMutationSchema = z
  .object({
    timezone: z.string(),
    workingDays: z.array(z.number()),
    workStart: hour,
    workEnd: hour,
    holidays: z.array(ReportLocalDateSchema).optional(),
    dateOverrides: z.array(ReportDateOverrideSchema).optional(),
  })
  .superRefine((v, ctx) => {
    const base = WorkCalendarSchema.safeParse(v);
    if (new Set(v.workingDays).size !== v.workingDays.length)
      ctx.addIssue({ code: 'custom', message: 'duplicate working day' });
    if (!base.success) ctx.addIssue({ code: 'custom', message: 'invalid base calendar' });
    const dates = [...(v.holidays ?? []), ...(v.dateOverrides ?? []).map((o) => o.date)];
    if (new Set(dates).size !== dates.length)
      ctx.addIssue({ code: 'custom', message: 'duplicate or conflicting local date' });
  })
  .transform((v) => ({ ...v, workingDays: [...new Set(v.workingDays)].sort((a, b) => a - b) }));
export const ReportCalendarSchema = ReportCalendarMutationSchema.transform((v) => ({
  ...v,
  holidays: (v.holidays ?? []).sort(),
  dateOverrides: (v.dateOverrides ?? []).sort((a, b) => a.date.localeCompare(b.date)),
}));
export type ReportCalendar = z.infer<typeof ReportCalendarSchema>;
export function canonicalCompanyLocale(value: unknown): string | null {
  if (value === undefined || value === null) return 'en';
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const [tag] = Intl.getCanonicalLocales(value);
    return tag && Intl.DateTimeFormat.supportedLocalesOf([tag]).length === 1 ? tag : null;
  } catch {
    return null;
  }
}
export const REPORT_CALENDAR_ALGORITHM = 'company-working-close-v1' as const;
export type ReportConfigurationUnavailable =
  'missing_calendar' | 'invalid_calendar' | 'invalid_locale' | 'source_out_of_sync';
export type ReportScheduleUnavailable =
  | ReportConfigurationUnavailable
  | 'invalid_cycle'
  | 'no_working_close_in_cycle'
  | 'nonexistent_work_end'
  | 'ambiguous_work_end';
export type PulseReportScheduleResolution =
  | {
      status: 'scheduled';
      algorithmVersion: typeof REPORT_CALENDAR_ALGORITHM;
      timezone: string;
      localDate: string;
      localWorkEnd: string;
      finalDueAt: string;
    }
  | {
      status: 'blocked';
      reason: ReportScheduleUnavailable;
      localDate?: string;
      localWorkEnd?: string;
      timezone?: string;
    };

export interface ReportConfigurationRevision {
  tenantId: string;
  revision: number;
  locale: string | null;
  calendar: ReportCalendar | null;
  unavailableReason: ReportConfigurationUnavailable | null;
  sourceFingerprint: string;
  capturedAt: string;
}
export interface PulseReportFinalTiming {
  tenantId: string;
  cycleScoringPolicyId: string;
  configRevision: number;
  locale: string | null;
  algorithmVersion: typeof REPORT_CALENDAR_ALGORITHM;
  status: 'blocked' | 'scheduled' | 'started';
  blockedReason: ReportScheduleUnavailable | null;
  timezone: string | null;
  localDate: string | null;
  localWorkEnd: string | null;
  finalDueAt: string | null;
  formationStartedAt: string | null;
  reportDataCutoff: string | null;
  observedDelayMs: number | null;
}
export type BeginPulseReportFinalFormationResult =
  | { status: 'started'; context: PulseReportFinalTiming }
  | { status: 'not_due' | 'stale_plan' | 'missing_native_cycle' }
  | { status: 'blocked'; reason: ReportScheduleUnavailable };
