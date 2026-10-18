import { describe, expect, it } from 'vitest';
import {
  TopicQuestionReplyInvalidError,
  composeTopicQuestionReplyText,
  isTopicQuestionReplyInvalidError,
  validateTopicQuestionReply,
} from './topic-question-reply';

const QUESTION = 'How much say do you have over the way you plan your week?';

function reason(fn: () => unknown): string | undefined {
  try { fn(); } catch (error) { return error instanceof TopicQuestionReplyInvalidError ? error.reason : 'other'; }
  return undefined;
}

describe('validateTopicQuestionReply (GC round 3 CAP-1, ADR-013 D8)', () => {
  it('accepts an answer without a question plus exactly one topic question', () => {
    expect(validateTopicQuestionReply({ replyText: ' That release sounds tight. ', topicQuestion: ` ${QUESTION} ` }))
      .toEqual({ replyText: 'That release sounds tight.', topicQuestion: QUESTION });
  });

  it.each(['What drives that?!', 'What drives that? 🙂', 'What drives that?)'])('accepts a closing "%s"', (question) => {
    expect(validateTopicQuestionReply({ replyText: 'ok.', topicQuestion: question }).topicQuestion).toBe(question);
  });

  it('accepts an empty answer when the employee only asked for the questions', () => {
    expect(validateTopicQuestionReply({ replyText: '', topicQuestion: QUESTION }).replyText).toBe('');
  });

  it.each([
    ['question_missing', { replyText: 'ok.' }],
    ['question_missing', { replyText: 'ok.', topicQuestion: '   ' }],
    ['question_not_a_question', { replyText: 'ok.', topicQuestion: 'Tell me about your week.' }],
    ['question_count', { replyText: 'ok.', topicQuestion: 'What helps? And what gets in the way?' }],
    ['question_not_last', { replyText: 'ok.', topicQuestion: 'What helps? Take your time.' }],
    ['reply_question', { replyText: 'Did the release go out?', topicQuestion: QUESTION }],
    ['reply_missing', { topicQuestion: QUESTION }],
    ['reply_missing', null],
  ] as const)('rejects %s', (expected, value) => {
    expect(reason(() => validateTopicQuestionReply(value))).toBe(expected);
  });

  it('rejects a reply over the length budget', () => {
    expect(reason(() => validateTopicQuestionReply(
      { replyText: 'x'.repeat(300), topicQuestion: QUESTION }, { maxReplyChars: 200 },
    ))).toBe('too_long');
  });

  it('composes one message with the question last', () => {
    expect(composeTopicQuestionReplyText({ replyText: 'That release sounds tight.', topicQuestion: QUESTION }))
      .toBe(`That release sounds tight. ${QUESTION}`);
    expect(composeTopicQuestionReplyText({ replyText: '', topicQuestion: QUESTION })).toBe(QUESTION);
  });

  it('recognizes the typed error by message across package copies', () => {
    expect(isTopicQuestionReplyInvalidError(new TopicQuestionReplyInvalidError('too_long'))).toBe(true);
    expect(isTopicQuestionReplyInvalidError(new Error('nope'))).toBe(false);
  });
});
