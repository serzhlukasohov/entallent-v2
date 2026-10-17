import type { QuestionBundleComposition } from '../ports/ai-provider.port';

const QUESTIONNAIRE_LABELS = /(?<![\p{L}\p{N}])(?:questions?|questionnaires?|surveys?|forms?|index(?:es)?|scores?|rubrics?|q[1-3]\s*[:.)-]|вопрос\p{L}*|опрос\p{L}*|анкет\p{L}*|оценк\p{L}*|индекс\p{L}*|питанн\p{L}*|запитанн\p{L}*|опитуванн\p{L}*|оцінк\p{L}*|індекс\p{L}*|pytani\p{L}*|pytań|ankiet\p{L}*|kwestionariusz\p{L}*|formularz\p{L}*|indeks\p{L}*|punktacj\p{L}*)(?![\p{L}\p{N}])/iu;

/** Model output is untrusted; keep the displayed statement-to-question map exact. */
export function validateQuestionBundleComposition(
  value: unknown,
  requiredQuestionIds: readonly string[],
): QuestionBundleComposition {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('v2_confirmation_composition_invalid');
  }
  const draft = value as Record<string, unknown>;
  if (typeof draft['text'] !== 'string' || !draft['text'].trim()
    || /[\r\n]|(?:^|\s)[1-3][.)]\s|[•●]/.test(draft['text'])
    || QUESTIONNAIRE_LABELS.test(draft['text'])
    || (draft['text'].match(/[?？]/g)?.length ?? 0) !== 1
    || !Array.isArray(draft['statements'])
    || requiredQuestionIds.length < 1 || requiredQuestionIds.length > 3
    || new Set(requiredQuestionIds).size !== requiredQuestionIds.length
    || draft['statements'].length !== requiredQuestionIds.length) {
    throw new Error('v2_confirmation_composition_invalid');
  }
  const text = draft['text'] as string;
  const statements: QuestionBundleComposition['statements'] = [];
  for (const raw of draft['statements']) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('v2_confirmation_composition_invalid');
    }
    const entry = raw as Record<string, unknown>;
    if (typeof entry['surveyQuestionId'] !== 'string'
      || typeof entry['statement'] !== 'string' || !entry['statement'].trim()
      || /[?？]/.test(entry['statement'])) {
      throw new Error('v2_confirmation_composition_invalid');
    }
    const displayed = exactDisplayedStatement(text, entry['statement']);
    if (!displayed || text.split(displayed).length !== 2) {
      throw new Error('v2_confirmation_composition_invalid');
    }
    statements.push({ surveyQuestionId: entry['surveyQuestionId'], statement: displayed });
  }
  if (new Set(statements.map((statement) => statement.surveyQuestionId)).size !== statements.length
    || new Set(statements.map((statement) => statement.statement)).size !== statements.length
    || requiredQuestionIds.some((id) => !statements.some((statement) => statement.surveyQuestionId === id))) {
    throw new Error('v2_confirmation_composition_invalid');
  }
  const spans = statements.map((statement) => ({
    start: text.indexOf(statement.statement),
    end: text.indexOf(statement.statement) + statement.statement.length,
  })).sort((a, b) => a.start - b.start);
  if (spans.some((span, index) => index > 0 && span.start < spans[index - 1].end)) {
    throw new Error('v2_confirmation_composition_invalid');
  }
  return { text, statements };
}

function exactDisplayedStatement(text: string, statement: string): string | null {
  if (text.includes(statement)) return statement;
  const folded = statement.toLowerCase();
  let match: string | null = null;
  for (let start = 0; start <= text.length - statement.length; start += 1) {
    const candidate = text.slice(start, start + statement.length);
    if (candidate.toLowerCase() !== folded) continue;
    if (match !== null) return null;
    match = candidate;
  }
  return match;
}

// Question punctuation across scripts; the second entry is U+037E (Greek question mark), not ';'.
const QUESTION_PUNCTUATION = /[?\u037E\u055E\u061F\u1367\u1945\u2047\u2048\u2049\u2E2E\uFE56\uFF1F\u2753\u2754]/u;
export const BUNDLE_REPLY_INVALID = 'v2_bundle_reply_invalid';

export type BundleReplyInvalidReason =
  | 'draft_unparseable'
  | 'bundle_mismatch'
  | 'reply_missing'
  | 'reply_empty'
  | 'reply_question'
  | 'reply_too_long'
  | 'reply_restates_bundle'
  | 'reply_restates_statement';

/** The two-part reply broke its contract; `reason` names the rule so the fallback stays diagnosable. */
export class BundleReplyInvalidError extends Error {
  constructor(readonly reason: BundleReplyInvalidReason) {
    super(BUNDLE_REPLY_INVALID);
    this.name = 'BundleReplyInvalidError';
  }
}

export interface BundleReplyParts {
  replyText: string;
  bundleText: string;
}

export interface BundleReplyOptions {
  maxReplyChars?: number;
  statements?: readonly string[];
}

/**
 * GC round 3 CAP-4: a bundle or clarification turn answers the employee's latest message first.
 * Model output is untrusted; the reply part is checked structurally (non-empty, no question, within
 * budget, no restated bundle text or statement) and the bundle part byte-for-byte against the
 * composed text. Whether the reply addresses the latest message is a prompt contract.
 */
export function validateBundleReply(
  value: unknown,
  bundleText: string,
  options: BundleReplyOptions = {},
): BundleReplyParts {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BundleReplyInvalidError('reply_missing');
  }
  const draft = value as Record<string, unknown>;
  // A provider that ignores the two-part contract returns neither part: that is a missing reply,
  // not a mismatched bundle. Then the most specific rule wins, so the reason stays diagnosable.
  if (typeof draft['replyText'] !== 'string' && draft['bundleText'] === undefined) {
    throw new BundleReplyInvalidError('reply_missing');
  }
  if (!bundleText || draft['bundleText'] !== bundleText) throw new BundleReplyInvalidError('bundle_mismatch');
  if (typeof draft['replyText'] !== 'string') throw new BundleReplyInvalidError('reply_missing');
  const replyText = draft['replyText'].trim();
  if (!replyText) throw new BundleReplyInvalidError('reply_empty');
  const folded = replyText.toLowerCase();
  if (folded.includes(bundleText.toLowerCase())) throw new BundleReplyInvalidError('reply_restates_bundle');
  if ((options.statements ?? []).some((statement) => {
    const needle = statement.trim().toLowerCase();
    return needle.length > 0 && folded.includes(needle);
  })) {
    throw new BundleReplyInvalidError('reply_restates_statement');
  }
  if (QUESTION_PUNCTUATION.test(replyText)) throw new BundleReplyInvalidError('reply_question');
  if (options.maxReplyChars !== undefined && replyText.length > options.maxReplyChars) {
    throw new BundleReplyInvalidError('reply_too_long');
  }
  return { replyText, bundleText };
}

/** The one delivered message: the answer, one blank line, the fixed text. */
export function composeBundleReplyText(parts: BundleReplyParts): string {
  return `${parts.replyText}\n\n${parts.bundleText}`;
}

/**
 * The delivered message shows the bundle alone, or exactly once at the end after one blank line
 * with a prefix that satisfies the reply contract (no question, no restated statement). Used at
 * the persistence boundary so the invariant does not depend on which provider produced the reply.
 */
export function isBundleShownIn(messageText: string, bundleText: string, options: BundleReplyOptions = {}): boolean {
  if (!bundleText) return false;
  if (messageText === bundleText) return true;
  const separator = `\n\n${bundleText}`;
  if (!messageText.endsWith(separator) || messageText.split(bundleText).length !== 2) return false;
  try {
    validateBundleReply({ replyText: messageText.slice(0, -separator.length), bundleText }, bundleText, options);
    return true;
  } catch {
    return false;
  }
}

export function isBundleReplyInvalidError(error: unknown): error is BundleReplyInvalidError {
  return error instanceof BundleReplyInvalidError
    || (error instanceof Error && error.message === BUNDLE_REPLY_INVALID);
}
