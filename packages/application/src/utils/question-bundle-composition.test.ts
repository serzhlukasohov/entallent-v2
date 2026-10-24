import { describe, expect, it } from 'vitest';
import {
  BundleCompositionInvalidError, BundleReplyInvalidError, composeBundleReplyText, isBundleCompositionInvalidError,
  isBundleShownIn, validateBundleReply, validateQuestionBundleComposition,
} from './question-bundle-composition';

function reasonOf(run: () => unknown): string | undefined {
  try {
    run();
    return undefined;
  } catch (error) {
    return error instanceof BundleReplyInvalidError ? error.reason : `not_bundle_reply_error:${String(error)}`;
  }
}

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
  it('accepts a single later topic supplement with one exact displayed statement', () => {
    const draft = { text: 'You have more room to decide now. Is that fair?',
      statements: [{ surveyQuestionId: ids[0]!, statement: 'You have more room to decide now.' }] };
    expect(validateQuestionBundleComposition(draft, [ids[0]!])).toEqual(draft);
  });
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

describe('validateBundleReply (GC round 3 CAP-4)', () => {
  const bundleText = valid.text;
  const replyText = 'Start tomorrow with the retro notes; the checklist can wait until after standup.';

  it('accepts a question-free reply followed by the byte-exact bundle', () => {
    expect(validateBundleReply({ replyText, bundleText, text: `${replyText}\n\n${bundleText}` }, bundleText))
      .toEqual({ replyText, bundleText });
  });

  it('rejects a bundle text that differs from the composed text by one byte', () => {
    expect(() => validateBundleReply({ replyText, bundleText: bundleText.replace('fair', 'right') }, bundleText))
      .toThrow('v2_bundle_reply_invalid');
    expect(() => validateBundleReply({ replyText, bundleText: ` ${bundleText}` }, bundleText))
      .toThrow('v2_bundle_reply_invalid');
    expect(() => validateBundleReply({ replyText }, bundleText)).toThrow('v2_bundle_reply_invalid');
  });

  it('rejects a reply that asks a question in any script', () => {
    for (const reply of ['Retro notes first?', 'Начать с ретро？', 'Which one matters more to you;']) {
      expect(() => validateBundleReply({ replyText: reply, bundleText }, bundleText)).toThrow('v2_bundle_reply_invalid');
    }
  });

  it('rejects an empty reply or one that repeats the bundle or a statement', () => {
    expect(() => validateBundleReply({ replyText: '  ', bundleText }, bundleText)).toThrow('v2_bundle_reply_invalid');
    expect(() => validateBundleReply({ replyText: `Sure. ${bundleText}`, bundleText }, bundleText))
      .toThrow('v2_bundle_reply_invalid');
    expect(() => validateBundleReply(
      { replyText: `Noted: ${statements[1]!.statement}`, bundleText },
      bundleText,
      { statements: statements.map((item) => item.statement) },
    )).toThrow('v2_bundle_reply_invalid');
  });

  it('matches a restated statement even when the composed statement carries edge whitespace', () => {
    expect(() => validateBundleReply(
      { replyText: 'You can set priorities. Start with the retro.', bundleText },
      bundleText,
      { statements: [' You can set priorities.'] },
    )).toThrow('v2_bundle_reply_invalid');
  });

  it('matches a restated statement regardless of casing', () => {
    expect(() => validateBundleReply(
      { replyText: 'you can set priorities. Start with the retro.', bundleText },
      bundleText,
      { statements: ['You can set priorities.'] },
    )).toThrow('v2_bundle_reply_invalid');
  });

  it('names the failed rule so the fallback is diagnosable', () => {
    expect(reasonOf(() => validateBundleReply({ replyText, bundleText: 'x' }, bundleText))).toBe('bundle_mismatch');
    expect(reasonOf(() => validateBundleReply({ text: 'only text', bundleText }, bundleText))).toBe('reply_missing');
    expect(reasonOf(() => validateBundleReply({ replyText: ' ', bundleText }, bundleText))).toBe('reply_empty');
    expect(reasonOf(() => validateBundleReply({ replyText: 'Why?', bundleText }, bundleText))).toBe('reply_question');
    expect(reasonOf(() => validateBundleReply({ replyText: 'x'.repeat(5), bundleText }, bundleText, { maxReplyChars: 4 })))
      .toBe('reply_too_long');
    expect(reasonOf(() => validateBundleReply({ replyText: `Sure. ${bundleText}`, bundleText }, bundleText)))
      .toBe('reply_restates_bundle');
    expect(reasonOf(() => validateBundleReply(
      { replyText: `Noted: ${statements[1]!.statement}`, bundleText }, bundleText,
      { statements: statements.map((item) => item.statement) },
    ))).toBe('reply_restates_statement');
  });

  it('rejects a reply over the length budget and trims surrounding whitespace', () => {
    expect(() => validateBundleReply({ replyText: 'x'.repeat(41), bundleText }, bundleText, { maxReplyChars: 40 }))
      .toThrow('v2_bundle_reply_invalid');
    expect(validateBundleReply({ replyText: `  ${replyText}\n`, bundleText }, bundleText).replyText).toBe(replyText);
  });
});

describe('composeBundleReplyText and isBundleShownIn', () => {
  const bundleText = valid.text;
  const replyText = 'Retro notes first.';

  it('joins the reply and the bundle with one blank line', () => {
    expect(composeBundleReplyText({ replyText, bundleText })).toBe(`${replyText}\n\n${bundleText}`);
  });

  it('accepts the bundle alone or a reply followed by the bundle, and nothing else', () => {
    expect(isBundleShownIn(bundleText, bundleText)).toBe(true);
    expect(isBundleShownIn(`${replyText}\n\n${bundleText}`, bundleText)).toBe(true);
    expect(isBundleShownIn(`${replyText} ${bundleText}`, bundleText)).toBe(false);
    expect(isBundleShownIn(`${bundleText}\n\n${replyText}`, bundleText)).toBe(false);
    expect(isBundleShownIn(`${bundleText}\n\n${bundleText}`, bundleText)).toBe(false);
    expect(isBundleShownIn('different text', bundleText)).toBe(false);
  });

  it('holds the reply contract at the persistence boundary too', () => {
    expect(isBundleShownIn(`Retro notes first?\n\n${bundleText}`, bundleText)).toBe(false);
    expect(isBundleShownIn(`Noted: ${statements[1]!.statement}\n\n${bundleText}`, bundleText,
      { statements: statements.map((item) => item.statement) })).toBe(false);
    expect(isBundleShownIn(`${replyText}\n\n${bundleText}`, bundleText,
      { statements: statements.map((item) => item.statement) })).toBe(true);
  });
});

describe('BundleCompositionInvalidError', () => {
  const compositionReasonOf = (value: unknown, requiredIds: readonly string[] = ids): string | undefined => {
    try {
      validateQuestionBundleComposition(value, requiredIds);
      return undefined;
    } catch (error) {
      return error instanceof BundleCompositionInvalidError ? error.reason : `not_composition_error:${String(error)}`;
    }
  };

  it('keeps the stable message and name so existing matching and worker failure codes still work', () => {
    const error = new BundleCompositionInvalidError('question_count');
    expect(error.message).toBe('v2_confirmation_composition_invalid');
    expect(error.name).toBe('BundleCompositionInvalidError');
    expect(isBundleCompositionInvalidError(error)).toBe(true);
    expect(isBundleCompositionInvalidError(new Error('v2_confirmation_composition_invalid'))).toBe(true);
    expect(isBundleCompositionInvalidError(new Error('fetch failed'))).toBe(false);
  });

  it('names the failed rule for every composition check', () => {
    expect(compositionReasonOf(null)).toBe('draft_unparseable');
    expect(compositionReasonOf([valid])).toBe('draft_unparseable');
    expect(compositionReasonOf({ ...valid, text: '  ' })).toBe('text_missing');
    expect(compositionReasonOf({ ...valid, text: `${valid.text.slice(0, -13)}\nIs that fair?` })).toBe('text_list_markers');
    expect(compositionReasonOf({ ...valid, text: `1) ${valid.text}` })).toBe('text_list_markers');
    expect(compositionReasonOf({ ...valid, text: valid.text.replace('I hear that', 'From the survey,') })).toBe('questionnaire_label');
    expect(compositionReasonOf({ ...valid, text: valid.text.replace('Is that fair?', 'Is that fair? Really?') })).toBe('question_count');
    expect(compositionReasonOf({ ...valid, text: valid.text.replace('?', '.') })).toBe('question_count');
    expect(compositionReasonOf({ text: valid.text, statements: 'none' })).toBe('statements_missing');
    expect(compositionReasonOf(valid, [])).toBe('question_ids_invalid');
    expect(compositionReasonOf(valid, [ids[0]!, ids[0]!, ids[2]!])).toBe('question_ids_invalid');
    expect(compositionReasonOf({ ...valid, statements: statements.slice(0, 2) })).toBe('statement_count');
    expect(compositionReasonOf({ ...valid, statements: [null, statements[1], statements[2]] })).toBe('statement_malformed');
    expect(compositionReasonOf({ ...valid, statements: [{ surveyQuestionId: 1, statement: statements[0]!.statement }, statements[1], statements[2]] }))
      .toBe('statement_malformed');
    expect(compositionReasonOf({ ...valid, statements: [{ surveyQuestionId: ids[0], statement: 'Why not?' }, statements[1], statements[2]] }))
      .toBe('statement_question');
    expect(compositionReasonOf({ ...valid, statements: [{ surveyQuestionId: ids[0], statement: 'Nothing like this.' }, statements[1], statements[2]] }))
      .toBe('statement_not_in_text');
    expect(compositionReasonOf({ ...valid, statements: [{ ...statements[0]!, surveyQuestionId: ids[1] }, statements[1], statements[2]] }))
      .toBe('question_mapping_invalid');
    const overlapping = {
      text: 'I hear that You can choose your methods. You can set priorities. Is that fair?',
      statements: [
        { surveyQuestionId: ids[0], statement: 'You can choose your methods.' },
        { surveyQuestionId: ids[1], statement: 'choose your methods.' },
        { surveyQuestionId: ids[2], statement: 'You can set priorities.' },
      ],
    };
    expect(compositionReasonOf(overlapping)).toBe('statements_overlap');
  });
});
