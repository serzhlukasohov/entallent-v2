import type { ConversationTurn, ResponseContext } from '@entalent/application';
import type { ReplyStrategy } from '@entalent/contracts';
import type { ContextDigest } from '../schema';

/** Context keys summarised elsewhere in the digest, so they are not listed as sections. */
const DIGESTED_KEYS = new Set(['userName', 'languagePolicy', 'memoryContext', 'localTime', 'isSessionStart']);

/**
 * The digest of one `generateResponse(turns, strategy, context)` call; `undefined` for any
 * other method or an argument shape it does not recognise.
 */
export function contextDigest(method: string, args: readonly unknown[]): ContextDigest | undefined {
  if (method !== 'generateResponse') return undefined;
  const [turns, strategy, context] = args as [ConversationTurn[] | undefined, ReplyStrategy | undefined, ResponseContext | undefined];
  if (!Array.isArray(turns) || context === undefined || context === null || typeof context !== 'object') return undefined;
  const user = turns.filter((turn) => turn.role === 'user').length;
  const memory = context.memoryContext;
  // Outside a V2 window the optional probe hint; inside it the topic policy's question.
  const surveyQuestionId = context.surveyProbeQuestion?.id ?? context.topicQuestion?.questionId;
  const sections = Object.entries(context)
    .filter(([key, value]) => !DIGESTED_KEYS.has(key) && value !== undefined && value !== null && value !== false)
    .map(([key]) => key)
    .sort();
  return {
    history: {
      turns: turns.length,
      user,
      assistant: turns.length - user,
      lastRole: turns.at(-1)?.role ?? null,
    },
    memory: {
      items: memory?.items.length ?? 0,
      categories: [...new Set(memory?.items.map((item) => item.category) ?? [])].sort(),
      goals: memory?.goals.length ?? 0,
    },
    ...(strategy?.mode !== undefined ? { mode: strategy.mode } : {}),
    ...(context.isSessionStart !== undefined ? { sessionStart: context.isSessionStart } : {}),
    ...(context.localTime !== undefined ? { localTime: context.localTime } : {}),
    ...(context.languagePolicy?.responseLanguage !== undefined ? { responseLanguage: context.languagePolicy.responseLanguage } : {}),
    ...(surveyQuestionId !== undefined ? { surveyQuestionId } : {}),
    sections,
  };
}
