import { z } from 'zod';
import { PULSE_SOURCE_ADMIN } from './pulse-admin-copy';
import { canonicalCompanyLocale } from './pulse-report-calendar';
import { PULSE_SOURCE_OPERATIONAL, PULSE_SOURCE_DISCLOSURE } from './pulse-source-copy';
import { ENGAGEMENT_QUESTIONS } from './pulse-engagement';
import { PULSE_SOURCE_REPORTING_RIGHTS } from './reporting-rights';

export const PULSE_LANGUAGE_POLICY = 'pulse-language-v1';
export const PULSE_COPY_VERSION = 'pulse-copy-v1';
export const PulseLocaleSchema = z.string().refine((v) => canonicalCompanyLocale(v) === v, 'canonical supported BCP47 required');
export const LanguageProposalSchema = z.object({ locale: PulseLocaleSchema, kind: z.enum(['explicit', 'inferred']) }).strict();
export type LanguageProposal = z.infer<typeof LanguageProposalSchema>;
export const PulseResourceKindSchema = z.enum(['admin', 'operational', 'disclosure', 'safe_signal', 'definitions', 'engagement', 'reporting_rights']);
export type PulseResourceKind = z.infer<typeof PulseResourceKindSchema>;
export const PulseProseProvenanceSchema = z.object({
  locale: PulseLocaleSchema, configRevision: z.number().int().nonnegative(),
  modelId: z.string().min(1), promptVersion: z.string().min(1),
  languagePolicyVersion: z.literal(PULSE_LANGUAGE_POLICY), resourceVersion: z.string().min(1),
}).strict();
export type PulseProseProvenance = z.infer<typeof PulseProseProvenanceSchema>;
export const PulseResourceSchema = z.object({
  tenantId: z.string().uuid().optional(),
  kind: PulseResourceKindSchema, locale: PulseLocaleSchema, version: z.literal(PULSE_COPY_VERSION),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/), textHash: z.string().regex(/^[a-f0-9]{64}$/),
  texts: z.record(z.string().min(1).max(16000)),
  provenance: z.object({ generator: z.string().min(1), reviewer: z.string().min(1), promptVersion: z.string().min(1), semanticPass: z.literal(true) }).strict(),
  status: z.literal('accepted'),
}).strict();
export type PulseLanguageResource = z.infer<typeof PulseResourceSchema>;
export class PulseLanguageUnavailable extends Error {
  readonly code = 'language_unavailable';
  constructor(readonly locale: string, readonly kind: PulseResourceKind, readonly version = PULSE_COPY_VERSION) {
    super('language_unavailable'); this.name = 'PulseLanguageUnavailable';
  }
}
export function interpolationSlots(text: string): string[] {
  return [...text.matchAll(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g)].map((m) => m[1]!).sort();
}
export function validatePulseTexts(source: Readonly<Record<string, string>>, candidate: unknown): candidate is Record<string, string> {
  const parsed = z.record(z.string().min(1).max(16000)).safeParse(candidate);
  if (!parsed.success || Object.keys(source).sort().join('\0') !== Object.keys(parsed.data).sort().join('\0')) return false;
  return Object.entries(source).every(([key, original]) => {
    const text = parsed.data[key]!;
    return !/[<>]/.test(text) && ![...text].some(char => char.charCodeAt(0) < 32 && !['\n','\r','\t'].includes(char))
      && interpolationSlots(text).join('\0') === interpolationSlots(original).join('\0');
  });
}
export function interpolatePulseText(text: string, values: Readonly<Record<string, string | number>> = {}): string {
  return text.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (_, key: string) => {
    if (!(key in values)) throw new Error('language_interpolation_missing');
    return String(values[key]);
  });
}
export const PULSE_ENGLISH_RESOURCES: Readonly<Record<Exclude<PulseResourceKind, 'definitions'>, Readonly<Record<string, string>>>> = {
  admin: PULSE_SOURCE_ADMIN,
  operational: PULSE_SOURCE_OPERATIONAL,
  disclosure: PULSE_SOURCE_DISCLOSURE,
  safe_signal: { generalized: 'A generalized work experience signal was identified.' },
  engagement: Object.fromEntries(ENGAGEMENT_QUESTIONS.map((q) => [q.stableKey, q.title])),
  reporting_rights: PULSE_SOURCE_REPORTING_RIGHTS,
};
export interface PulseLanguageReadMetadata {
  locale: string; resourceVersion: typeof PULSE_COPY_VERSION;
  status: 'ready' | 'language_unavailable';
  resources: Partial<Record<PulseResourceKind, PulseLanguageResource>>;
}
export interface DefinitionDisplay { status: 'ready' | 'language_unavailable'; locale: string; text: string | null; sourceHash: string; }
export interface AnalyticalDisplay {
  status: 'ready' | 'translation_pending' | 'language_unavailable';
  text: string | null; locale: string; sourceLocale: string | null;
}
