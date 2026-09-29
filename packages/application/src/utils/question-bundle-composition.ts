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
    || requiredQuestionIds.length !== 3
    || new Set(requiredQuestionIds).size !== 3
    || draft['statements'].length !== 3) {
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
  if (new Set(statements.map((statement) => statement.surveyQuestionId)).size !== 3
    || new Set(statements.map((statement) => statement.statement)).size !== 3
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
