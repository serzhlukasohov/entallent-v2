import { canonicalCompanyLocale, LanguageProposalSchema, PULSE_LANGUAGE_POLICY, type LanguageProposal } from '@entalent/contracts';
import type { LanguagePolicy } from '../ports/ai-provider.port';
export interface SavedLanguagePreference { locale: string; kind: 'explicit' | 'inferred'; version?: string; }
export function resolveLanguagePolicy(input: { proposal?: LanguageProposal | null; saved?: SavedLanguagePreference | null; userLocale?: string | null } = {}): LanguagePolicy {
  const proposal = LanguageProposalSchema.safeParse(input.proposal);
  const saved = LanguageProposalSchema.safeParse(input.saved && { locale: input.saved.locale, kind: input.saved.kind });
  if (proposal.success && proposal.data.kind === 'explicit') return { responseLanguage: proposal.data.locale, source: 'explicit_current' };
  if (saved.success && saved.data.kind === 'explicit') return { responseLanguage: saved.data.locale, source: 'saved_explicit' };
  if (proposal.success) return { responseLanguage: proposal.data.locale, source: 'inferred_current' };
  if (saved.success) return { responseLanguage: saved.data.locale, source: 'saved_inferred' };
  const locale = input.userLocale ? canonicalCompanyLocale(input.userLocale) : null;
  return locale ? { responseLanguage: locale, source: 'user_locale' } : { responseLanguage: 'en', source: 'product_default' };
}
export { PULSE_LANGUAGE_POLICY };
