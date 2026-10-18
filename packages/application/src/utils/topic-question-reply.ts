import { QUESTION_PUNCTUATION } from './question-bundle-composition';

/**
 * GC round 3 CAP-1 (ADR-013 D8): when the topic policy says a topic question is due, the reply
 * schema carries it as a required, separate field. Model output is untrusted, so the parts are
 * checked structurally here: an answer with no question, and exactly one question that ends the
 * topic part. Whether the question is about the given topic is the prompt contract and the eval.
 */
const TOPIC_QUESTION_REPLY_INVALID = 'topic_question_reply_invalid';

export type TopicQuestionReplyInvalidReason =
  | 'draft_unparseable'
  | 'reply_missing'
  | 'reply_question'
  | 'question_missing'
  | 'question_not_a_question'
  | 'question_count'
  | 'question_not_last'
  | 'too_long';

export class TopicQuestionReplyInvalidError extends Error {
  constructor(readonly reason: TopicQuestionReplyInvalidReason) {
    super(TOPIC_QUESTION_REPLY_INVALID);
    this.name = 'TopicQuestionReplyInvalidError';
  }
}

export function isTopicQuestionReplyInvalidError(error: unknown): error is TopicQuestionReplyInvalidError {
  return error instanceof TopicQuestionReplyInvalidError
    || (error instanceof Error && error.message === TOPIC_QUESTION_REPLY_INVALID);
}

export interface TopicQuestionReplyParts {
  replyText: string;
  topicQuestion: string;
}

const QUESTION_GROUPS = new RegExp(`${QUESTION_PUNCTUATION.source}+`, 'gu');
/** Closing quotes, brackets, an exclamation mark, or emoji may follow the question mark. */
const TRAILING_CLOSERS = /^(?:[\s"'”’»)\]!]|\p{Extended_Pictographic}|\u200d|\ufe0f)*$/u;

export function validateTopicQuestionReply(
  value: unknown,
  options: { maxReplyChars?: number } = {},
): TopicQuestionReplyParts {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TopicQuestionReplyInvalidError('reply_missing');
  }
  const draft = value as Record<string, unknown>;
  if (typeof draft['topicQuestion'] !== 'string' || !draft['topicQuestion'].trim()) {
    throw new TopicQuestionReplyInvalidError(draft['replyText'] === undefined && draft['topicQuestion'] === undefined
      ? 'reply_missing' : 'question_missing');
  }
  if (typeof draft['replyText'] !== 'string') throw new TopicQuestionReplyInvalidError('reply_missing');
  const replyText = draft['replyText'].trim();
  const topicQuestion = draft['topicQuestion'].trim();
  const groups = [...topicQuestion.matchAll(QUESTION_GROUPS)];
  if (groups.length === 0) throw new TopicQuestionReplyInvalidError('question_not_a_question');
  if (groups.length > 1) throw new TopicQuestionReplyInvalidError('question_count');
  const last = groups[0]!;
  if (!TRAILING_CLOSERS.test(topicQuestion.slice(last.index! + last[0].length))) {
    throw new TopicQuestionReplyInvalidError('question_not_last');
  }
  if (QUESTION_PUNCTUATION.test(replyText)) throw new TopicQuestionReplyInvalidError('reply_question');
  if (options.maxReplyChars !== undefined
    && composeTopicQuestionReplyText({ replyText, topicQuestion }).length > options.maxReplyChars) {
    throw new TopicQuestionReplyInvalidError('too_long');
  }
  return { replyText, topicQuestion };
}

/** One delivered message: the answer, then the topic question last. */
export function composeTopicQuestionReplyText(parts: TopicQuestionReplyParts): string {
  return parts.replyText ? `${parts.replyText} ${parts.topicQuestion}` : parts.topicQuestion;
}
