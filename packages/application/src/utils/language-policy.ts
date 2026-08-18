import type { ConversationTurn, LanguagePolicy } from '../ports/ai-provider.port';

type LanguageCode = LanguagePolicy['responseLanguage'];
const LANGUAGE_NAMES = new Intl.DisplayNames(['en'], { type: 'language' });

export function resolveLanguagePolicy(turns: ConversationTurn[], userLocale?: string): LanguagePolicy {
  const userTurns = turns.filter((turn) => turn.role === 'user' && turn.content !== '__init__');
  const current = userTurns[userTurns.length - 1];
  const normalizedLocale = normalizeLocale(userLocale);
  const currentLanguage = current ? inferLanguage(current.content, normalizedLocale) : null;

  if (currentLanguage) {
    return {
      responseLanguage: currentLanguage,
      source: 'current_turn',
      confidence: 0.95,
      shouldUpdateUserLocale: normalizedLocale !== currentLanguage,
    };
  }

  for (const turn of userTurns.slice(0, -1).reverse()) {
    const recentLanguage = inferLanguage(turn.content, normalizedLocale);
    if (recentLanguage) {
      return {
        responseLanguage: recentLanguage,
        source: 'recent_turns',
        confidence: 0.8,
        shouldUpdateUserLocale: normalizedLocale !== recentLanguage,
      };
    }
  }

  if (normalizedLocale) {
    return {
      responseLanguage: normalizedLocale,
      source: 'user_profile',
      confidence: 0.6,
      shouldUpdateUserLocale: false,
    };
  }

  return {
    responseLanguage: 'en',
    source: 'tenant_default',
    confidence: 0.4,
    shouldUpdateUserLocale: false,
  };
}

function inferLanguage(text: string, profileLanguage?: LanguageCode | null): LanguageCode | null {
  const userText = stripSlackConnectorAttribution(text);
  const cyrillic = (userText.match(/\p{Script=Cyrillic}/gu) ?? []).length;
  const latin = (userText.match(/\p{Script=Latin}/gu) ?? []).length;
  if (cyrillic === 0 && latin === 0) return null;
  if (cyrillic > 0) {
    if (isLikelyUkrainian(userText) || profileLanguage === 'uk') return 'uk';
    return 'ru';
  }
  if (latin <= 2 || /^[\p{Script=Latin}\d._-]{1,20}$/u.test(userText.trim())) return null;
  return 'en';
}

function stripSlackConnectorAttribution(text: string): string {
  return text.replace(/\*Sent using\*\s*<@[A-Z0-9]+(?:\|[^>]+)?>/gu, '').trim();
}

function normalizeLocale(locale?: string): LanguageCode | null {
  const normalized = locale?.trim().toLowerCase().split(/[-_]/)[0];
  if (!normalized) return null;
  try {
    return LANGUAGE_NAMES.of(normalized) ? normalized : null;
  } catch {
    return null;
  }
}

function isLikelyUkrainian(text: string): boolean {
  return /[іїєґІЇЄҐ]|\bщо\b/iu.test(text);
}
