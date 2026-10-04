import { z } from 'zod';

export const CompanyOnboardingSettingsSchema = z.object({
  timezone: z.string().refine((value) => {
    try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; }
  }, 'Valid IANA timezone required'),
  defaultLanguage: z.enum(['en', 'ru', 'uk']).default('en'),
  workingDays: z.array(z.number().int().min(1).max(7)).min(1).max(7)
    .refine((days) => new Set(days).size === days.length, 'Duplicate working days'),
  workdayStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  workdayEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
}).refine((value) => value.workdayStart < value.workdayEnd, 'Workday must end after it starts');
export type CompanyOnboardingSettings = z.infer<typeof CompanyOnboardingSettingsSchema>;
export const OnboardingActionSchema = z.enum(['start', 'later', 'decline', 'got_it']);
export type OnboardingAction = z.infer<typeof OnboardingActionSchema>;
export type OnboardingButton = { action: OnboardingAction; label: string };
