import type { InMemoryQuestionConfirmationRepository } from '../../fakes/question-confirmation';
import type { InMemoryConversationRepository } from '../../fakes/repositories';
import type { InMemorySurveyRepository } from '../../fakes/survey-repository';
import type { DevCount, DevMessageRow, DevQuestionConfirmation } from '../executors/dev-api-client';
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

/** The dev API routes the L2 state queries read (architecture AD-10); one read per route per snapshot. */
export const L2_STATE_PATHS = Object.freeze({
  questionConfirmation: '/dev/user/:userId/question-confirmation?tenantId=&group=',
  surveyState: '/dev/user/:userId/survey-state',
  messages: '/dev/conversation/:conversationId/messages',
} as const);
export type L2StatePath = (typeof L2_STATE_PATHS)[keyof typeof L2_STATE_PATHS];

/** The response bodies the L2 `select` functions read, by route (validated by the dev API client). */
export interface L2StateBodies {
  [L2_STATE_PATHS.questionConfirmation]: Pick<DevQuestionConfirmation, 'progress' | 'stagedBundleCount'>;
  [L2_STATE_PATHS.surveyState]: Pick<DevCount, 'count'>;
  [L2_STATE_PATHS.messages]: ReadonlyArray<Pick<DevMessageRow, 'direction'>>;
}

/** An L2 row: the dev read (pure description, no network) and how the value is taken from its body. */
export interface L2StateRoute<P extends L2StatePath = L2StatePath> {
  method: 'GET';
  path: P;
  select: (body: L2StateBodies[P]) => unknown;
}

export interface StateQueryRow {
  l1: (sources: L1StateSources, args: StateQueryArgs) => unknown;
  l2: { [P in L2StatePath]: L2StateRoute<P> }[L2StatePath];
}

/**
 * The state-query table (architecture AD-10): one row per `StateQueryName`, the L1 accessor
 * over the in-memory repositories and the L2 dev API route. L1 values are substitutes for
 * the dashboard reads (`method: 'substituted'`); L2 values are read from the running stack
 * (`method: 'observed'`). `questionProgress` reads the `group` of the test's `pulseCycle`
 * fixture at both levels. The L0 accessors stay in `executors/state-queries-l0.ts`.
 */
export const STATE_QUERIES: Readonly<Record<StateQueryName, StateQueryRow>> = Object.freeze({
  questionProgress: {
    l1: (sources: L1StateSources, args: StateQueryArgs) => sources.questionConfirmationRepo.questionProgress(args.group ?? undefined),
    l2: { method: 'GET', path: L2_STATE_PATHS.questionConfirmation, select: (body) => ({ answered: body.progress.answered, total: body.progress.total }) },
  },
  stagedBundleCount: {
    l1: (sources: L1StateSources) => sources.questionConfirmationRepo.stagedBundleCount(),
    l2: { method: 'GET', path: L2_STATE_PATHS.questionConfirmation, select: (body) => body.stagedBundleCount },
  },
  surveyEvidenceCount: {
    l1: (sources: L1StateSources) => sources.surveyRepo.evidenceCount(),
    l2: { method: 'GET', path: L2_STATE_PATHS.surveyState, select: (body) => body.count },
  },
  outboundCount: {
    l1: (sources: L1StateSources) => sources.conversationRepo.messages.filter((message) => message.direction === 'outbound').length,
    l2: { method: 'GET', path: L2_STATE_PATHS.messages, select: (body) => body.filter((row) => row.direction === 'outbound').length },
  },
});

/** The same table under its Epic 13 name (L1 importers). */
export const L1_STATE_QUERIES: Readonly<Record<StateQueryName, StateQueryRow>> = STATE_QUERIES;

/**
 * Reads every L1 query and validates each value with its shared schema; an invalid value
 * throws `SuiteExecutionError` (`infrastructure`, `state-query:<name>`, step set by the caller).
 */
export function readL1Snapshot(sources: L1StateSources, args: StateQueryArgs): StateSnapshot {
  const snapshot: Record<string, unknown> = {};
  for (const name of StateQueryNameSchema.options) {
    const parsed = STATE_QUERY_VALUE_SCHEMAS[name].safeParse(STATE_QUERIES[name].l1(sources, args));
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
