import type { AiProviderPort, OrchestrateResult } from '@entalent/application';
import {
  CoachHarness,
  SIM_CONVERSATION_ID,
  SIM_TENANT_ID,
  SIM_USER_ID,
  createSimConversation,
} from '../../harness/coach-harness';
import { InlineOutbox } from '../../fakes/inline-outbox';
import { InMemoryQuestionConfirmationRepository } from '../../fakes/question-confirmation';
import {
  InMemoryConversationRepository,
  InMemoryGoalRepository,
  InMemoryMemoryRepository,
  InMemoryStyleProfileRepository,
} from '../../fakes/repositories';
import { ScriptedAiProvider } from '../../fakes/scripted-ai';
import { L0_FIXTURES } from '../fixtures';
import type { FixtureContext } from '../fixtures/types';
import type { RuleContext } from '../rules/registry';
import type { CaseRun, ExecutionError, FixtureName, LoadedTest, ObservationField, StateSnapshot } from '../schema';
import { FixedClock } from './clock';
import { createL0ScriptedModel, type L0ScriptedModel } from './l0-scripted';
import { createProactiveWorld, driveObservationWindow, type ProactiveWorld } from './proactive-l0';
import { createEventSink, record } from './recording-proxy';
import {
  applyFixtures,
  atomicPriorGap,
  clockRange,
  executionError,
  harnessOptionsOf,
  observeStep,
  parseFixtures,
  replyMessage,
  rulePrecondition,
  stepGap,
  stopCheckpoint,
  unsupportedFixtureError,
  verifyFixtures,
  type FixtureRegistry,
} from './shared';
import { afterStepsNamed, readL0Snapshot, type L0StateSources } from './state-queries-l0';
import { SuiteExecutionError, type ExecutorOptions, type SuiteExecutor } from './types';

/** Monday 2026-01-05 08:00 UTC, the default business-time start (spec 12.7 Design Notes). */
export const DEFAULT_L0_CLOCK_START = new Date('2026-01-05T08:00:00.000Z');

/**
 * Fields an L0 run fills (AD-14, AD-17). Never `reply.text` (L0 does not evaluate reply
 * text the test scripted), `turn.replyPlan` (not on `OrchestrateResult`) or
 * `state.surveyEvidenceCount` (the inline outbox records no survey evidence).
 */
const CONVERSATION_FIELDS: ObservationField[] = [
  'reply.messages',
  'turn.mode',
  'turn.intent',
  'turn.outcome',
  'turn.bundleReply',
  'steps.gapMs',
  'state.outboundCount',
  'state.stagedBundleCount',
  'state.questionProgress',
  'events',
];
const OBSERVATION_FIELDS: ObservationField[] = [
  'window.outbound',
  'state.outboundCount',
  'state.stagedBundleCount',
  'state.questionProgress',
  'events',
];

/** The world one L0 test runs in: a fresh harness, recorded ports and the raw fakes behind them. */
export interface L0World {
  clock: FixedClock;
  sink: ReturnType<typeof createEventSink>;
  harness: CoachHarness;
  scripted: L0ScriptedModel | null;
  state: FixtureContext['state'];
  ports: FixtureContext['ports'] & {
    memoryRepo: InMemoryMemoryRepository;
    outbox: InlineOutbox;
    aiProvider: AiProviderPort;
  };
  proactive: ProactiveWorld;
}

/**
 * L0 deterministic executor (architecture AD-4, AD-14, AD-17, AD-18): runs atomic, journey
 * and observation tests offline on a fresh `CoachHarness` per test, with the test's scripted
 * model outputs, a `FixedClock` and every port wrapped by a recording proxy. It returns
 * observations only; `evaluate` decides every status.
 */
export class L0DeterministicExecutor implements SuiteExecutor {
  readonly level = 'L0' as const;
  private readonly fixtures: FixtureRegistry;

  /** `fixtures` replaces the L0 fixture registry (tests only). */
  constructor(options: { fixtures?: FixtureRegistry } = {}) {
    this.fixtures = options.fixtures ?? L0_FIXTURES;
  }

  supports(fixture: FixtureName): boolean {
    return this.fixtures[fixture] !== undefined;
  }

  observes(): ObservationField[] {
    return [...new Set([...CONVERSATION_FIELDS, ...OBSERVATION_FIELDS])];
  }

  async run(test: LoadedTest, options: ExecutorOptions): Promise<CaseRun> {
    const observation = test.kind === 'observation';
    const run: CaseRun = {
      testId: test.id,
      level: this.level,
      attempt: options.attempt,
      subject: {
        externalUserId: `l0-${test.id}`,
        userId: SIM_USER_ID,
        conversationId: SIM_CONVERSATION_ID,
        tenantId: SIM_TENANT_ID,
      },
      observed: observation ? [...OBSERVATION_FIELDS] : [...CONVERSATION_FIELDS],
      preconditions: [],
      steps: [],
      state: { before: {}, after: {}, afterStep: {} },
      errors: [],
      events: [],
    };
    const fail = (error: ExecutionError): CaseRun => ({ ...run, errors: [...run.errors, error] });

    const unsupported = unsupportedFixtureError(test, (name) => this.supports(name), this.level);
    if (unsupported) return fail(unsupported);
    const parsing = parseFixtures(test, this.fixtures);
    if ('error' in parsing) return fail(parsing.error);

    const harnessOptions = harnessOptionsOf(parsing.parsed);
    const start = harnessOptions.clockStart ?? options.clockStart ?? DEFAULT_L0_CLOCK_START;

    const world = createL0World(test, start, harnessOptions.timezone);
    const sources: L0StateSources = world.state;
    const finish = (extra: Partial<CaseRun> = {}): CaseRun => ({
      ...run,
      ...extra,
      events: world.sink.events,
      clock: clockRange(world.state.conversationRepo, world.clock, start),
    });

    // Rule and state-query failures end the case as infrastructure errors at the current step.
    try {
      // Fixtures and seed (stepIndex 0).
      const applied = await applyFixtures(parsing.parsed, fixtureContext(world, test, start));
      if ('error' in applied) return finish({ errors: [applied.error] });
      const preconditions = await verifyFixtures(applied.instances);

      const before = readL0Snapshot(sources);
      const snapshotRun = finish({ preconditions, state: { before, after: before, afterStep: {} } });
      preconditions.push(...test.preconditions.map((check) => rulePrecondition(snapshotRun, check, test)));
      run.preconditions = preconditions;
      run.state = { before, after: before, afterStep: {} };

      if (observation) {
        if (!test.observationWindow) {
          return finish({ errors: [{ kind: 'infrastructure', step: 0, reason: 'observation-window-missing', message: '' }] });
        }
        if (world.proactive.users.length === 0) {
          // An empty window would be observed silence nobody set up, not a product decision.
          return finish({
            errors: [{ kind: 'infrastructure', step: 0, reason: 'proactive-users-missing', message: 'no proactiveUsers user to observe' }],
          });
        }
        try {
          const window = await driveObservationWindow({
            window: test.observationWindow,
            clock: world.clock,
            sink: world.sink,
            world: world.proactive,
            ports: {
              conversationRepo: world.ports.conversationRepo,
              memoryRepo: world.ports.memoryRepo,
              outbox: world.ports.outbox,
              aiProvider: world.ports.aiProvider,
              conversationState: world.state.conversationRepo,
            },
          });
          run.window = {
            from: window.from.toISOString(),
            to: window.to.toISOString(),
            outbound: window.outbound.map((message) => replyMessage(message, world.state.conversationRepo)),
          };
        } catch (error) {
          run.errors.push(executionError(error, 0));
        }
        return finish({ state: { before, after: readL0Snapshot(sources), afterStep: {} } });
      }

      const afterSteps = afterStepsNamed(test);
      const afterStep: Record<string, StateSnapshot> = {};
      const priorGap = atomicPriorGap(world.state.conversationRepo, start);
      const ruleContext: RuleContext = { seedHistory: test.seed?.history ?? [] };

      for (const [position, step] of test.steps.entries()) {
        const index = position + 1;
        const { realized, gapMs } = stepGap(test, index, options.interMessageGapMs, priorGap);
        if (realized > 0) world.clock.advance(realized);

        world.sink.stepIndex = index;
        world.scripted?.setStep(index);
        const firstNew = world.state.conversationRepo.messages.length;

        let turn: { result: OrchestrateResult; traceId: string };
        try {
          turn = await world.harness.sendTurn(step.text);
        } catch (error) {
          run.errors.push(world.scripted?.missing() ? executionError(world.scripted.missing(), index) : executionError(error, index));
          break;
        }
        const missing = world.scripted?.missing();
        if (missing) {
          run.errors.push(executionError(missing, index));
          break;
        }

        run.steps.push(observeStep(index, step.text, gapMs, turn, world.state.conversationRepo, firstNew));
        if (afterSteps.has(index)) afterStep[String(index)] = readL0Snapshot(sources);

        const checkpoint = stopCheckpoint(
          test,
          index,
          () => finish({ state: { before, after: readL0Snapshot(sources), afterStep } }),
          ruleContext,
        );
        if (checkpoint.outcome === 'error') {
          run.errors.push(checkpoint.error);
          break;
        }
        if (checkpoint.outcome === 'stop') {
          run.stoppedAtStep = index;
          break;
        }
      }

      return finish({ state: { before, after: readL0Snapshot(sources), afterStep } });
    } catch (error) {
      if (!(error instanceof SuiteExecutionError)) throw error;
      run.errors.push(executionError(error, world.sink.stepIndex));
      return finish();
    }
  }
}

/** The context fixtures apply against; exported for fixture tests. */
export function fixtureContext(world: L0World, test: LoadedTest, start: Date): FixtureContext {
  return {
    test,
    start,
    clock: world.clock,
    harness: world.harness,
    ports: { conversationRepo: world.ports.conversationRepo, questionConfirmationRepo: world.ports.questionConfirmationRepo },
    state: world.state,
    proactive: world.proactive,
  };
}

/** A fresh harness world for one test; exported for fixture tests. */
export function createL0World(test: LoadedTest, start: Date, timezone?: string): L0World {
  const clock = new FixedClock(start);
  const sink = createEventSink(() => clock.peek());

  const conversationState = new InMemoryConversationRepository(createSimConversation({ timezone, clock }), clock);
  const memoryState = new InMemoryMemoryRepository(clock);
  const goalState = new InMemoryGoalRepository(clock);
  const styleState = new InMemoryStyleProfileRepository();
  const questionState = new InMemoryQuestionConfirmationRepository();

  // Observation tests drive the check-in generation with the scripted model's default text
  // (C4-C5 are L1); conversation tests must script every model output they need.
  const scripted = test.kind === 'observation' ? null : createL0ScriptedModel(test.scripted ?? []);
  const aiProvider = record<AiProviderPort>(scripted?.provider ?? new ScriptedAiProvider(), 'aiProvider', sink);
  const conversationRepo = record(conversationState, 'conversationRepo', sink);
  const memoryRepo = record(memoryState, 'memoryRepo', sink);
  const goalRepo = record(goalState, 'goalRepo', sink);
  const styleRepo = record(styleState, 'styleRepo', sink);
  const questionConfirmationRepo = record(questionState, 'questionConfirmationRepo', sink);
  const outbox = record(
    new InlineOutbox(aiProvider, conversationRepo, memoryRepo, goalRepo, styleRepo, { clock }),
    'outbox',
    sink,
  );

  const harness = new CoachHarness({
    aiProvider,
    clock,
    conversationRepo,
    memoryRepo,
    goalRepo,
    styleRepo,
    outbox,
    questionConfirmationRepo,
    fallbackReport: false,
  });

  return {
    clock,
    sink,
    harness,
    scripted,
    state: {
      conversationRepo: conversationState,
      questionConfirmationRepo: questionState,
      memoryRepo: memoryState,
      goalRepo: goalState,
      styleRepo: styleState,
    },
    ports: { conversationRepo, questionConfirmationRepo, memoryRepo, outbox, aiProvider },
    proactive: createProactiveWorld(),
  };
}
