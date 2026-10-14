import type { LanguagePolicy } from '../ports/ai-provider.port';

/**
 * Product decision 2026-10-13: customers are English-speaking teams, so the mentor
 * replies in English regardless of the employee's language. Change it here if that
 * decision changes; a model-based policy is parked on `codex/parked-model-language`.
 */
const PRODUCT_RESPONSE_LANGUAGE = 'en';

export function resolveLanguagePolicy(): LanguagePolicy {
  return { responseLanguage: PRODUCT_RESPONSE_LANGUAGE, source: 'product_default' };
}
