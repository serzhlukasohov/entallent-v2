import type { QuestionClarificationVerdict } from '../ports/question-confirmation.port';

const QUESTIONNAIRE_LABELS = /\b(question(?:naire)?|survey|form|index|score|rubric)\b|вопрос|опрос|анкет|оценк|индекс/i;

export function validateQuestionClarificationPrompt(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 800
    || /[\r\n]|(?:^|\s)[1-3][.)]\s|[•●]/.test(value)
    || QUESTIONNAIRE_LABELS.test(value)
    || (value.match(/[?？]/g)?.length ?? 0) !== 1) {
    throw new Error('v2_clarification_prompt_invalid');
  }
  return value;
}

export function validateQuestionClarificationVerdict(value: unknown): QuestionClarificationVerdict {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('v2_clarification_verdict_invalid');
  }
  const draft = value as Record<string, unknown>;
  if (draft['kind'] === 'declined' || draft['kind'] === 'unrelated') return { kind: draft['kind'] };
  if (draft['kind'] !== 'clarified'
    || typeof draft['correctedSummary'] !== 'string'
    || !draft['correctedSummary'].trim()
    || draft['correctedSummary'].length > 4000) {
    throw new Error('v2_clarification_verdict_invalid');
  }
  return { kind: 'clarified', correctedSummary: draft['correctedSummary'].trim() };
}
