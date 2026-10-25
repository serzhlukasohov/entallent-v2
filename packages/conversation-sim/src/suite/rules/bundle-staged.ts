import type { CaseRun } from '../schema';
import type { RuleEntry } from './registry';
import { formatEvidence, selectReplies } from './reply-selection';
import { syntheticRun } from './synthetic-run';

const FIELD = 'v2ConfirmationBundle';
const requires = [`reply.messages[].metadata.${FIELD}`] as const;

/**
 * The orchestrator staged a confirmation bundle: a message of the selected reply carries
 * `metadata.v2ConfirmationBundle: true`. In `conversation` scope any reply may carry it.
 */
export const bundleStaged: RuleEntry = {
  requires,
  run(run, criterion) {
    const selection = selectReplies(run, criterion, requires);
    if (selection.kind === 'outcome') return selection.outcome;
    const staged = selection.replies.some(({ turn }) =>
      (run.steps[turn - 1]?.reply?.messages ?? []).some((message) => message.metadata[FIELD] === true),
    );
    if (staged) return { status: 'PASS' };
    return {
      status: 'FAIL',
      evidence: selection.replies.map(({ turn }) => formatEvidence(turn, `no message with ${FIELD}: true`)).join('\n'),
    };
  },
  fixtures: {
    pass: withBundleFlag(
      syntheticRun('RULE-bundle-staged-pass', ['Here is what I noted. Does this look right?'], ['reply.messages']),
    ),
    fail: syntheticRun('RULE-bundle-staged-fail', ['Thanks, that helps. What else is going on?'], ['reply.messages']),
  },
};

function withBundleFlag(run: CaseRun): CaseRun {
  return {
    ...run,
    steps: run.steps.map((step) =>
      step.reply
        ? {
            ...step,
            reply: {
              ...step.reply,
              messages: step.reply.messages.map((message) => ({ ...message, metadata: { ...message.metadata, [FIELD]: true } })),
            },
          }
        : step,
    ),
  };
}
