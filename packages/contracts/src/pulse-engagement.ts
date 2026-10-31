import { z } from 'zod';

export const REPORT_ENGAGEMENT_DEFINITION_VERSION = 'v2-report-engagement-1.0.0';
export const ENGAGEMENT_ANSWER_CONTRACT = 'engagement-1-10-v1';
export const ENGAGEMENT_RESPONSE_TYPE = 'numeric_1_10_integer';
export const ENGAGEMENT_STABLE_KEYS = ['engagement_nps', 'engagement_motivation', 'engagement_current'] as const;
export const engagementStableKeySchema = z.enum(ENGAGEMENT_STABLE_KEYS);
export const engagementAnswerSchema = z.number().int().min(1).max(10);
export const engagementProbeSchema = z.object({
  contractVersion: z.literal(ENGAGEMENT_ANSWER_CONTRACT),
  surveyDefinitionId: z.string().uuid(),
  surveyWindowId: z.string().uuid(),
  questionId: z.string().uuid(),
  questionVersion: z.literal(ENGAGEMENT_ANSWER_CONTRACT),
  stableKey: engagementStableKeySchema,
  displayedFormHash: z.string().regex(/^[a-f0-9]{64}$/),
  locale: z.string().optional(),
  resourceVersion: z.string().optional(),
  resourceSourceHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  formTextHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict().refine(p => [p.locale, p.resourceVersion, p.resourceSourceHash, p.formTextHash].every(v => v === undefined) || [p.locale, p.resourceVersion, p.resourceSourceHash, p.formTextHash].every(v => v !== undefined));
export type EngagementProbe = z.infer<typeof engagementProbeSchema>;

export const ENGAGEMENT_QUESTIONS = [
  { stableKey: 'engagement_nps', title: 'On a scale from 1 to 10, where 1 means not at all likely and 10 means extremely likely, how likely are you to recommend this company as a place to work? Please reply with one whole number.', canonicalMeaning: 'Likelihood of recommending this company as a place to work.' },
  { stableKey: 'engagement_motivation', title: 'On a scale from 1 to 10, where 1 means never and 10 means always, how often do you feel motivated to give your best effort at work? Please reply with one whole number.', canonicalMeaning: 'Frequency of motivation to give best effort at work.' },
  { stableKey: 'engagement_current', title: 'On a scale from 1 to 10, where 1 means not at all engaged and 10 means fully engaged, how engaged do you feel with your work right now? Please reply with one whole number.', canonicalMeaning: 'Current engagement with work.' },
] as const;
