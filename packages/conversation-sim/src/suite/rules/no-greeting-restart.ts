import { firstSentence } from '../../harness/assertions';
import { REPLY_MESSAGE_SEPARATOR } from '../schema';
import type { RuleEntry } from './registry';
import { findPhrases } from './phrase-match';
import { formatEvidence, outcomeFrom, selectReplies } from './reply-selection';
import { syntheticRun } from './synthetic-run';
import { GREETING_PHRASES } from './terms/greeting-phrases';

const requires = ['reply.text'] as const;

/**
 * A reply does not restart the conversation: the first sentence of its first message has no
 * greeting or self-introduction.
 */
export const noGreetingRestart: RuleEntry = {
  requires,
  run(run, criterion) {
    const selection = selectReplies(run, criterion, requires);
    if (selection.kind === 'outcome') return selection.outcome;
    const evidence = selection.replies.flatMap(({ turn, text }) => {
      const firstMessage = text.split(REPLY_MESSAGE_SEPARATOR)[0] ?? text;
      const opening = firstSentence(firstMessage.trim());
      const found = findPhrases(opening, GREETING_PHRASES);
      return found.length > 0 ? [formatEvidence(turn, `${opening} (${found.join(', ')})`)] : [];
    });
    return outcomeFrom(evidence);
  },
  fixtures: {
    pass: syntheticRun('RULE-no-greeting-restart-pass', ['Thanks. Hi again to the release plan: which part moves first?']),
    fail: syntheticRun('RULE-no-greeting-restart-fail', ["Hi! I'm your coach. Which part of the release moves first?"]),
  },
};
