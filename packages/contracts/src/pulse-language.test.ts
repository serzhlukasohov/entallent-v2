import { describe, expect, it } from 'vitest';
import { LanguageProposalSchema, PulseLocaleSchema, validatePulseTexts, interpolatePulseText } from './pulse-language';
describe('pulse language boundary', () => {
  it('accepts canonical ICU locales without a short allowlist', () => {
    for (const locale of ['en', 'de', 'uk', 'ja', 'pt-BR', 'ar', 'zh-Hant']) expect(PulseLocaleSchema.safeParse(locale).success).toBe(true);
    for (const locale of ['', 'not_a_locale', 'de-de']) expect(PulseLocaleSchema.safeParse(locale).success).toBe(false);
  });
  it('requires exact inventory, interpolation and plain bounded text', () => {
    const source = { hello: 'Hello {name}', count: '{count} people' };
    expect(validatePulseTexts(source, { hello: 'Hallo {name}', count: '{count} Personen' })).toBe(true);
    expect(validatePulseTexts(source, { hello: 'Hallo', count: '{count} Personen' })).toBe(false);
    expect(validatePulseTexts(source, { ...source, extra: 'x' })).toBe(false);
    expect(validatePulseTexts(source, { ...source, hello: '<script>{name}</script>' })).toBe(false);
    expect(() => interpolatePulseText(source.hello)).toThrow();
    expect(interpolatePulseText(source.hello, { name: '<untrusted>' })).toBe('Hello <untrusted>');
  });
  it('rejects classifier-owned clocks and unknown proposal kinds', () => {
    expect(LanguageProposalSchema.safeParse({ locale: 'uk', kind: 'explicit' }).success).toBe(true);
    expect(LanguageProposalSchema.safeParse({ locale: 'uk', kind: 'explicit', receivedAt: 'now' }).success).toBe(false);
  });
});
