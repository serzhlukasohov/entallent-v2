import type { InMemoryQuestionConfirmationRepository } from '../../fakes/question-confirmation';
import type { InMemoryConversationRepository } from '../../fakes/repositories';
import {
  STATE_QUERY_VALUE_SCHEMAS,
  stateAtStep,
  type LoadedTest,
  type StateQueryName,
  type StateSnapshot,
} from '../schema';
import { SuiteExecutionError } from './types';

/** The raw fakes the L0 state queries read; reads never go through recording proxies. */
export interface L0StateSources {
  conversationRepo: InMemoryConversationRepository;
  questionConfirmationRepo: InMemoryQuestionConfirmationRepository;
}

/**
 * L0 accessors for `StateQueryName` (architecture AD-10). `surveyEvidenceCount` is not
 * observed at L0: the inline outbox records no survey evidence.
 */
export const L0_STATE_QUERIES: Readonly<Partial<Record<StateQueryName, (sources: L0StateSources) => unknown>>> =
  Object.freeze({
    outboundCount: (sources: L0StateSources) =>
      sources.conversationRepo.messages.filter((message) => message.direction === 'outbound').length,
    stagedBundleCount: (sources: L0StateSources) => sources.questionConfirmationRepo.stagedBundleCount(),
    questionProgress: (sources: L0StateSources) => sources.questionConfirmationRepo.questionProgress(),
  });

export const L0_STATE_QUERY_NAMES = Object.keys(L0_STATE_QUERIES) as StateQueryName[];

/**
 * Reads every L0 query and validates each value with its shared schema; an invalid value
 * throws `SuiteExecutionError` (`infrastructure`, `state-query:<name>`, step set by the caller).
 */
export function readL0Snapshot(sources: L0StateSources): StateSnapshot {
  const snapshot: Record<string, unknown> = {};
  for (const name of L0_STATE_QUERY_NAMES) {
    const parsed = STATE_QUERY_VALUE_SCHEMAS[name].safeParse(L0_STATE_QUERIES[name]!(sources));
    if (!parsed.success) {
      throw new SuiteExecutionError({
        kind: 'infrastructure',
        step: 0,
        reason: `state-query:${name}`,
        message: parsed.error.issues.map((issue) => issue.message).join('; '),
      });
    }
    snapshot[name] = parsed.data;
  }
  return snapshot as StateSnapshot;
}

/** Steps whose `afterStep` snapshot a `state` criterion of the test names. */
export function afterStepsNamed(test: Pick<LoadedTest, 'criteria'>): Set<number> {
  const steps = new Set<number>();
  for (const criterion of test.criteria) {
    const step = criterion.stateQuery ? stateAtStep(criterion.stateQuery.at) : null;
    if (step !== null) steps.add(step);
  }
  return steps;
}
