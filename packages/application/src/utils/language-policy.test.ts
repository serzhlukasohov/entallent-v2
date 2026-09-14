import { describe, expect, it } from 'vitest';
import { resolveLanguagePolicy } from './language-policy';

const userTurn = (content: string) => ({
  role: 'user' as const,
  content,
  timestamp: new Date('2026-09-13T00:00:00.000Z'),
});

describe('resolveLanguagePolicy', () => {
  it('keeps an English correction in English after one quoted Ukrainian keyboard slip', () => {
    const policy = resolveLanguagePolicy([userTurn(`My only answer in ukrainian was the one where I forgo to switch to english my keyboard
this one *Annna S* [12:16 AM]
нуі`)], 'uk');

    expect(policy.responseLanguage).toBe('en');
  });

  it('keeps a genuinely Ukrainian message in Ukrainian', () => {
    const policy = resolveLanguagePolicy([
      userTurn('Мені сьогодні важко зосередитися на роботі.'),
    ], 'en');

    expect(policy.responseLanguage).toBe('uk');
  });

  it('keeps a genuinely Russian message in Russian', () => {
    const policy = resolveLanguagePolicy([
      userTurn('Мне сегодня сложно сосредоточиться на работе.'),
    ], 'en');

    expect(policy.responseLanguage).toBe('ru');
  });

  it('keeps a genuinely English message in English', () => {
    const policy = resolveLanguagePolicy([
      userTurn('I want to keep this conversation in English.'),
    ], 'uk');

    expect(policy.responseLanguage).toBe('en');
  });

  it('uses the profile language when Latin and Cyrillic evidence is tied', () => {
    const policy = resolveLanguagePolicy([userTurn('abc абв')], 'uk');

    expect(policy).toMatchObject({ responseLanguage: 'uk', source: 'user_profile' });
  });

  it('uses the profile language when the current message has no letters', () => {
    const policy = resolveLanguagePolicy([userTurn('1234 ?!')], 'uk');

    expect(policy).toMatchObject({ responseLanguage: 'uk', source: 'user_profile' });
  });

  it.each([
    ['Да, <@U123ABC>'],
    ['Нет, Atlas-9'],
    ['Да, https://x.co'],
    ['Да, me@example.com'],
    ['Да, Node.js'],
    ['Да, CI/CD'],
  ])('does not count a concrete Latin artifact in %s', (content) => {
    const policy = resolveLanguagePolicy([userTurn(content)], 'en');

    expect(policy.responseLanguage).toBe('ru');
  });

  it('uses the profile fallback when English and Cyrillic word evidence is tied', () => {
    const policy = resolveLanguagePolicy([userTurn('Hello, ні')], 'uk');

    expect(policy).toMatchObject({ responseLanguage: 'uk', source: 'user_profile' });
  });

  it('uses multiple English words after one Cyrillic slip', () => {
    const policy = resolveLanguagePolicy([userTurn('нуі Back To English')], 'uk');

    expect(policy.responseLanguage).toBe('en');
  });

  it.each([
    ['Так, Jira', 'uk'],
    ['Да, slack', 'en'],
    ['Да, e-mail', 'en'],
    ['Jira, працює', 'en'],
  ])('uses the profile fallback for ambiguous mixed-language input %s', (content, locale) => {
    const policy = resolveLanguagePolicy([userTurn(content)], locale);

    expect(policy).toMatchObject({ responseLanguage: locale, source: 'user_profile' });
  });

  it('counts a natural English hyphen compound as one word', () => {
    const policy = resolveLanguagePolicy([userTurn('нуі English-language correction')], 'uk');

    expect(policy.responseLanguage).toBe('en');
  });

  it.each([
    ["п'ять"],
    ['п’ять'],
    ['пʼять'],
  ])('counts the Cyrillic apostrophe word %s once against two English words', (word) => {
    const policy = resolveLanguagePolicy([userTurn(`'${word}' switch back`)], 'uk');

    expect(policy.responseLanguage).toBe('en');
  });

  it('counts a natural lowercase slash compound as one English word', () => {
    const policy = resolveLanguagePolicy([userTurn('нуі yes/no correction')], 'uk');

    expect(policy.responseLanguage).toBe('en');
  });
});
