import { describe, expect, it } from 'vitest';
import { resolveLanguagePolicy } from './language-policy';
describe('independent personal language', () => {
  it('uses English only when no valid personal authority exists', () => {
    expect(resolveLanguagePolicy()).toEqual({ responseLanguage: 'en', source: 'product_default' });
    expect(resolveLanguagePolicy({ userLocale: 'uk' }).responseLanguage).toBe('uk');
  });
  it('preserves explicit preference over inference and allows an explicit switch', () => {
    const saved = { locale: 'uk', kind: 'explicit' as const };
    expect(resolveLanguagePolicy({ saved, proposal: { locale: 'de', kind: 'inferred' }, userLocale: 'fr' }).responseLanguage).toBe('uk');
    expect(resolveLanguagePolicy({ saved, proposal: { locale: 'ja', kind: 'explicit' } }).responseLanguage).toBe('ja');
  });
  it('prefers current substantive inference over saved inferred and profile', () => {
    expect(resolveLanguagePolicy({ saved: { locale: 'de', kind: 'inferred' }, proposal: { locale: 'uk', kind: 'inferred' }, userLocale: 'fr' }).responseLanguage).toBe('uk');
  });
});
