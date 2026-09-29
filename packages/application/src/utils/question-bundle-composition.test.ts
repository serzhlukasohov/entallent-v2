import { describe, expect, it } from 'vitest';
import { validateQuestionBundleComposition } from './question-bundle-composition';

const ids = ['question-a', 'question-b', 'question-c'];
const statements = ids.map((surveyQuestionId, index) => ({
  surveyQuestionId,
  statement: [`You can choose your methods.`, `You can set priorities.`, `You can challenge decisions.`][index],
}));
const valid = {
  text: `I hear that ${statements.map((item) => item.statement).join(' ')} Is that fair?`,
  statements,
};

describe('validateQuestionBundleComposition', () => {
  it('accepts one natural message with an exact statement-to-question mapping', () => {
    expect(validateQuestionBundleComposition(valid, ids)).toEqual(valid);
  });

  it('maps a case-only model mismatch to the exact displayed span', () => {
    const text = 'You can choose your methods. You can set priorities. You can challenge decisions. Is that fair?';
    const draft = {
      text,
      statements: [{ ...statements[0], statement: 'you can choose your methods.' }, ...statements.slice(1)],
    };
    expect(validateQuestionBundleComposition(draft, ids).statements[0]?.statement)
      .toBe('You can choose your methods.');
  });

  it('rejects an ambiguous case-only mapping', () => {
    const text = 'You can choose your methods. you can choose your methods. You can set priorities. You can challenge decisions. Is that fair?';
    expect(() => validateQuestionBundleComposition({
      text,
      statements: [{ ...statements[0], statement: 'YOU can choose your methods.' }, ...statements.slice(1)],
    }, ids)).toThrow('v2_confirmation_composition_invalid');
  });

  it('rejects a substituted question or a statement absent from the displayed text', () => {
    expect(() => validateQuestionBundleComposition({
      ...valid, statements: [{ ...statements[0], surveyQuestionId: 'other' }, ...statements.slice(1)],
    }, ids)).toThrow('v2_confirmation_composition_invalid');
    expect(() => validateQuestionBundleComposition({
      ...valid, statements: [{ ...statements[0], statement: 'Something different.' }, ...statements.slice(1)],
    }, ids)).toThrow('v2_confirmation_composition_invalid');
  });

  it('rejects questionnaire labels and multiple questions', () => {
    expect(() => validateQuestionBundleComposition({ ...valid, text: `Survey question 1: ${valid.text}` }, ids))
      .toThrow('v2_confirmation_composition_invalid');
    expect(() => validateQuestionBundleComposition({ ...valid, text: `${valid.text} Any concerns?` }, ids))
      .toThrow('v2_confirmation_composition_invalid');
  });

  it.each(['Ankieta:', 'Pytanie 1:', 'Kwestionariusz:', 'Запитання 1:', 'Опитування:', 'Q1:', 'Index:'])
  ('rejects localized questionnaire labels: %s', (label) => {
    expect(() => validateQuestionBundleComposition({ ...valid, text: `${label} ${valid.text}` }, ids))
      .toThrow('v2_confirmation_composition_invalid');
  });

  it('accepts a natural Polish confirmation without questionnaire labels', () => {
    const text = 'Słyszę, że możesz sam wybierać metody pracy. Ustalasz własne priorytety. Możesz kwestionować decyzje. Czy dobrze rozumiem?';
    const draft = {
      text,
      statements: ids.map((surveyQuestionId, index) => ({
        surveyQuestionId,
        statement: [
          'możesz sam wybierać metody pracy.',
          'Ustalasz własne priorytety.',
          'Możesz kwestionować decyzje.',
        ][index]!,
      })),
    };
    expect(validateQuestionBundleComposition(draft, ids)).toEqual(draft);
  });

  it('allows a normal reference to a calendar quarter', () => {
    const draft = { ...valid, text: `Your Q1 work suggests ${valid.text}` };
    expect(validateQuestionBundleComposition(draft, ids)).toEqual(draft);
  });
});
