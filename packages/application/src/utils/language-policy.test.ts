import { describe, expect, it } from 'vitest';
import { resolveLanguagePolicy } from './language-policy';

// Product decision 2026-10-13: customers are English-speaking teams, so the mentor
// always replies in English. Language is never inferred from message text.
describe('resolveLanguagePolicy', () => {
  it('always replies in English as the product default', () => {
    expect(resolveLanguagePolicy()).toEqual({ responseLanguage: 'en', source: 'product_default' });
  });
});
