import type { InMemoryQuestionConfirmationRepository } from '../../fakes/question-confirmation';
import type { InMemoryConversationRepository } from '../../fakes/repositories';
import type { InMemorySurveyRepository } from '../../fakes/survey-repository';
import { SuiteExecutionError } from '../executors/types';
import { STATE_QUERY_VALUE_SCHEMAS, StateQueryNameSchema, type StateQueryName, type StateSnapshot } from '../schema';

/** The raw L1 fakes the state queries read; reads never go through recording proxies. */
export interface L1StateSources {
  conversationRepo: InMemoryConversationRepository;
  questionConfirmationRepo: InMemoryQuestionConfirmationRepository;
  surveyRepo: InMemorySurveyRepository;
}

export interface StateQueryArgs {
  /** `questionProgress` group: the `pulseCycle` fixture's first uncovered topic, null for the whole window. */
  group: string | null;
}

/**
 * The state-query table (architecture AD-10): one row per `StateQueryName`, the L1 accessor
 * over the in-memory repositories. Values are substitutes for the dashboard reads, so L1
 * state criteria carry `method: 'substituted'`. The `l2` column (dev API routes) is added
 * in Epic 14; the L0 accessors stay in `executors/state-queries-l0.ts`.
 */
export const L1_STATE_QUERIES: Readonly<Record<StateQueryName, { l1: (sources: L1StateSources, args: StateQueryArgs) => unknown }>> =
  Object.freeze({
    questionProgress: {
      l1: (sources: L1StateSources, args: StateQueryArgs) => sources.questionConfirmationRepo.questionProgress(args.group ?? undefined),
    },
    stagedBundleCount: { l1: (sources: L1StateSources) => sources.questionConfirmationRepo.stagedBundleCount() },
    surveyEvidenceCount: { l1: (sources: L1StateSources) => sources.surveyRepo.evidenceCount() },
    outboundCount: {
      l1: (sources: L1StateSources) => sources.conversationRepo.messages.filter((message) => message.direction === 'outbound').length,
    },
  });

/**
 * Reads every L1 query and validates each value with its shared schema; an invalid value
 * throws `SuiteExecutionError` (`infrastructure`, `state-query:<name>`, step set by the caller).
 */
export function readL1Snapshot(sources: L1StateSources, args: StateQueryArgs): StateSnapshot {
  const snapshot: Record<string, unknown> = {};
  for (const name of StateQueryNameSchema.options) {
    const parsed = STATE_QUERY_VALUE_SCHEMAS[name].safeParse(L1_STATE_QUERIES[name].l1(sources, args));
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
