import type { z } from 'zod';
import type { CoachHarness } from '../../harness/coach-harness';
import type { InMemoryQuestionConfirmationRepository } from '../../fakes/question-confirmation';
import type { InMemorySurveyRepository } from '../../fakes/survey-repository';
import type {
  InMemoryConversationRepository,
  InMemoryGoalRepository,
  InMemoryMemoryRepository,
  InMemoryStyleProfileRepository,
} from '../../fakes/repositories';
import type { ControlledClock } from '../executors/clock';
import type { ProactiveWorld } from '../executors/proactive-l0';
import type { FixtureName, LoadedTest, PreconditionResult } from '../schema';

/**
 * What a fixture works against at L0 and L1: the per-test harness, its in-memory state and
 * the controlled clock. `ports` are the recorded proxies (writes through them become
 * `RunEvent`s at `stepIndex` 0); `state` are the raw fakes, read by `verify` so read-backs
 * add no events. Fixtures stay level-agnostic over this context.
 */
export interface FixtureContext {
  test: LoadedTest;
  /** Business time of the first step (atomic: the evaluated turn). Seeds lie before it. */
  start: Date;
  clock: ControlledClock;
  harness: CoachHarness;
  ports: {
    conversationRepo: InMemoryConversationRepository;
    questionConfirmationRepo: InMemoryQuestionConfirmationRepository;
  };
  state: {
    conversationRepo: InMemoryConversationRepository;
    questionConfirmationRepo: InMemoryQuestionConfirmationRepository;
    memoryRepo: InMemoryMemoryRepository;
    goalRepo: InMemoryGoalRepository;
    styleRepo: InMemoryStyleProfileRepository;
  };
  proactive: ProactiveWorld;
  /** The survey repository, recorded (`port`) and raw (`state`); present at L1, absent at L0. */
  survey?: { port: InMemorySurveyRepository; state: InMemorySurveyRepository };
}

export interface FixtureInstance {
  /** Writes the fixture's state; a throw ends the case `ERROR` `fixture-apply:<name>`. */
  apply(): Promise<void>;
  /** Reads the state back; `satisfied: false` makes every criterion `INVALID` `precondition:<name>`. */
  verify(): Promise<PreconditionResult>;
}

/** Harness construction inputs a fixture decides, read before the harness exists. */
export interface FixtureHarnessOptions {
  clockStart?: Date;
  timezone?: string;
}

/** A named fixture builder (architecture AD-4) with its own params schema. */
export interface FixtureModule<P = unknown> {
  name: FixtureName;
  params: z.ZodType<P, z.ZodTypeDef, unknown>;
  harnessOptions?(params: P): FixtureHarnessOptions;
  create(context: FixtureContext, params: P): FixtureInstance;
}

export function satisfied(name: string, ok: boolean, detail?: string): PreconditionResult {
  return { source: 'fixture', name, satisfied: ok, ...(detail !== undefined ? { detail } : {}) };
}
