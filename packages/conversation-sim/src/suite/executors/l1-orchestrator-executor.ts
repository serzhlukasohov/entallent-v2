import type { AgentAdapter, ScriptStep } from '@langwatch/scenario';
import type { AiProviderPort } from '@entalent/application';
import {
  CoachHarness,
  SIM_CONVERSATION_ID,
  SIM_TENANT_ID,
  SIM_USER_ID,
  createSimConversation,
  type HarnessTurn,
} from '../../harness/coach-harness';
import { InlineOutbox } from '../../fakes/inline-outbox';
import { InMemoryQuestionConfirmationRepository } from '../../fakes/question-confirmation';
import {
  InMemoryConversationRepository,
  InMemoryGoalRepository,
  InMemoryMemoryRepository,
  InMemoryStyleProfileRepository,
} from '../../fakes/repositories';
import { InMemorySurveyRepository } from '../../fakes/survey-repository';
import { L1_FIXTURES } from '../fixtures';
import { pulseCycleGroupOf } from '../fixtures/pulse-cycle';
import { readL1Snapshot, type L1StateSources } from '../fixtures/state-queries';
import type { FixtureContext } from '../fixtures/types';
import type { RuleContext } from '../rules/registry';
import { REPLY_MESSAGE_SEPARATOR, type CaseRun, type ExecutionError, type FixtureName, type LoadedTest, type ObservationField, type StateSnapshot } from '../schema';
import { FixedClock } from './clock';
import { DEFAULT_L0_CLOCK_START } from './l0-deterministic-executor';
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
import { afterStepsNamed } from './state-queries-l0';
import { SuiteExecutionError, type ExecutorOptions, type SuiteExecutor } from './types';

type ScenarioModule = typeof import('@langwatch/scenario');
type ScenarioRun = ScenarioModule['run'];

let scenarioModule: Promise<ScenarioModule> | null = null;

/**
 * `@langwatch/scenario` is loaded lazily with a dynamic import: its CommonJS build cannot load
 * under plain Node with tsx (it reads `import.meta.url`), and the dynamic import resolves the
 * ES module build there and under Vitest alike.
 */
function loadScenario(): Promise<ScenarioModule> {
  scenarioModule ??= import('@langwatch/scenario');
  return scenarioModule;
}

/** Fields an L1 conversation test fills (AD-17): the reply text too, since the coach model is real. */
const CONVERSATION_FIELDS: ObservationField[] = [
  'reply.text',
  'reply.messages',
  'turn.mode',
  'turn.intent',
  'turn.outcome',
  'turn.bundleReply',
  'steps.gapMs',
  'state.questionProgress',
  'state.stagedBundleCount',
  'state.surveyEvidenceCount',
  'state.outboundCount',
  'events',
];
const OBSERVATION_FIELDS: ObservationField[] = [
  'window.outbound',
  'state.questionProgress',
  'state.stagedBundleCount',
  'state.surveyEvidenceCount',
  'state.outboundCount',
  'events',
];

export interface L1ExecutorOptions {
  /** Builds the coach provider; called once per test attempt (a fresh world each time). */
  createAiProvider: () => AiProviderPort;
  /** The coach model label, recorded as `models.coach` and on every AI event. */
  coachModel: string;
  /** Optional LangWatch sink (AD-16); the `CaseRun` is identical with or without a key. */
  langwatch?: { apiKey?: string; endpoint?: string };
  /** Replaces the L1 fixture registry (tests only). */
  fixtures?: FixtureRegistry;
  /** Scenario `run()`; a test seam only (defaults to `@langwatch/scenario` `run`). */
  runScenario?: ScenarioRun;
}

/** The world one L1 test runs in: a fresh harness over recorded in-memory ports and the raw fakes behind them. */
export interface L1World {
  clock: FixedClock;
  sink: ReturnType<typeof createEventSink>;
  harness: CoachHarness;
  state: FixtureContext['state'] & { surveyRepo: InMemorySurveyRepository };
  ports: FixtureContext['ports'] & {
    memoryRepo: InMemoryMemoryRepository;
    outbox: InlineOutbox;
    aiProvider: AiProviderPort;
    surveyRepo: InMemorySurveyRepository;
  };
  proactive: ProactiveWorld;
}

/**
 * L1 orchestrator executor (architecture AD-4, AD-10, AD-14, AD-16, AD-17, AD-18): runs each
 * test through the real orchestrator and prompts with the injected coach provider, on a fresh
 * `CoachHarness` per test over in-memory repositories (survey repository and inline survey
 * evidence included), a `FixedClock` and every port wrapped by a recording proxy (AI events
 * carry the model request and response). Conversation steps are driven by Scenario `run()`
 * with `user()` / `agent()` steps ending in `succeed()`, without a judge agent or user
 * simulator (a passive User-role adapter only carries the scripted user texts). The `CaseRun` is built from the harness, sink and clock only, never from the
 * Scenario result. It reads no environment variables; the live provider is wired only by
 * `suite/run-live.ts`.
 */
export class L1OrchestratorExecutor implements SuiteExecutor {
  readonly level = 'L1' as const;
  readonly coachModel: string;
  private readonly createAiProvider: () => AiProviderPort;
  private readonly langwatch: { apiKey?: string; endpoint?: string } | undefined;
  private readonly fixtures: FixtureRegistry;
  private readonly runScenario: ScenarioRun | undefined;

  constructor(options: L1ExecutorOptions) {
    this.createAiProvider = options.createAiProvider;
    this.coachModel = options.coachModel;
    this.langwatch = options.langwatch;
    this.fixtures = options.fixtures ?? L1_FIXTURES;
    this.runScenario = options.runScenario;
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
        externalUserId: `l1-${test.id}`,
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

    const world = createL1World(start, this.createAiProvider(), this.coachModel, harnessOptions.timezone);
    const sources: L1StateSources = world.state;
    const group = pulseCycleGroupOf(test);
    const snapshot = (): StateSnapshot => readL1Snapshot(sources, { group });
    const finish = (extra: Partial<CaseRun> = {}): CaseRun => ({
      ...run,
      ...extra,
      events: world.sink.events,
      clock: clockRange(world.state.conversationRepo, world.clock, start),
    });

    // Rule and state-query failures end the case as infrastructure errors at the current step.
    try {
      // Fixtures and seed (stepIndex 0).
      const applied = await applyFixtures(parsing.parsed, l1FixtureContext(world, test, start));
      if ('error' in applied) return finish({ errors: [applied.error] });
      const preconditions = await verifyFixtures(applied.instances);

      const before = snapshot();
      const snapshotRun = finish({ preconditions, state: { before, after: before, afterStep: {} } });
      preconditions.push(...test.preconditions.map((check) => rulePrecondition(snapshotRun, check, test)));
      run.preconditions = preconditions;
      run.state = { before, after: before, afterStep: {} };

      if (observation) {
        if (!test.observationWindow) {
          return finish({ errors: [{ kind: 'infrastructure', step: 0, reason: 'observation-window-missing', message: '' }] });
        }
        if (world.proactive.users.length === 0) {
          return finish({
            errors: [{ kind: 'infrastructure', step: 0, reason: 'proactive-users-missing', message: 'no proactiveUsers user to observe' }],
          });
        }
        try {
          // P-06 at L1: check-in generation runs on the injected coach provider over the fixture clock.
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
        return finish({ state: { before, after: snapshot(), afterStep: {} } });
      }

      const afterStep = await this.driveConversation(test, options, world, start, run, before, snapshot, finish);
      return finish({ state: { before, after: snapshot(), afterStep } });
    } catch (error) {
      if (!(error instanceof SuiteExecutionError)) throw error;
      run.errors.push(executionError(error, world.sink.stepIndex));
      return finish();
    }
  }

  /**
   * One Scenario `run()` per conversation test: per step a custom step (gap, step index), then
   * `user(text)`, `agent()` and a custom step that records the observation and runs the stop
   * checkpoint; `succeed()` ends the script. A turn error or a stop ends it early.
   */
  private async driveConversation(
    test: LoadedTest,
    options: ExecutorOptions,
    world: L1World,
    start: Date,
    run: CaseRun,
    before: StateSnapshot,
    snapshot: () => StateSnapshot,
    finish: (extra?: Partial<CaseRun>) => CaseRun,
  ): Promise<Record<string, StateSnapshot>> {
    const { AgentRole, agent: agentStep, run: scenarioRun, succeed, user } = await loadScenario();
    const runScenario = this.runScenario ?? scenarioRun;
    const afterSteps = afterStepsNamed(test);
    const afterStep: Record<string, StateSnapshot> = {};
    const priorGap = atomicPriorGap(world.state.conversationRepo, start);
    const ruleContext: RuleContext = { seedHistory: test.seed?.history ?? [] };

    let pending: { index: number; text: string; gapMs: number; firstNew: number } | null = null;
    let turn: HarnessTurn | null = null;
    let turnError: unknown = null;
    // An executor failure inside a script step (state query, rule error), rethrown after the run.
    let fatal: unknown = null;

    const coachAgent: AgentAdapter = {
      role: AgentRole.AGENT,
      call: async () => {
        if (!pending) return [];
        try {
          turn = await world.harness.sendTurn(pending.text);
        } catch (error) {
          turnError = error;
          return [];
        }
        const own = world.state.conversationRepo.messages
          .slice(pending.firstNew)
          .filter((message) => message.direction === 'outbound' && world.state.conversationRepo.sideFieldsOf(message.id).traceId === turn!.traceId);
        return own.length > 0 ? own.map((message) => message.text).join(REPLY_MESSAGE_SEPARATOR) : [];
      },
    };

    // Scenario 0.4.15 adds even a fixed `user(text)` message through a User-role adapter, so a
    // passive one stands in; it is never called (every user step carries its text) and is not a
    // user simulator: no model, no generated text.
    const scriptedUser: AgentAdapter = {
      role: AgentRole.USER,
      call: async () => {
        throw new Error('[suite] L1 scripts every user message; the user adapter is never asked to generate one');
      },
    };

    const script: ScriptStep[] = [];
    for (const [position, step] of test.steps.entries()) {
      const index = position + 1;
      script.push(() => {
        const { realized, gapMs } = stepGap(test, index, options.interMessageGapMs, priorGap);
        if (realized > 0) world.clock.advance(realized);
        world.sink.stepIndex = index;
        pending = { index, text: step.text, gapMs, firstNew: world.state.conversationRepo.messages.length };
        turn = null;
        turnError = null;
      });
      script.push(user(step.text));
      script.push(agentStep());
      script.push(async (_state, executor) => {
        const current = pending!;
        try {
          if (turnError !== null || turn === null) {
            run.errors.push(executionError(turnError ?? new Error('the coach agent was not called'), index));
            await executor.succeed('turn error');
            return;
          }
          run.steps.push(observeStep(index, current.text, current.gapMs, turn, world.state.conversationRepo, current.firstNew));
          if (afterSteps.has(index)) afterStep[String(index)] = snapshot();
          const checkpoint = stopCheckpoint(test, index, () => finish({ state: { before, after: snapshot(), afterStep } }), ruleContext);
          if (checkpoint.outcome === 'error') {
            run.errors.push(checkpoint.error);
            await executor.succeed('checkpoint not observable');
          } else if (checkpoint.outcome === 'stop') {
            run.stoppedAtStep = index;
            await executor.succeed('stop checkpoint');
          }
        } catch (error) {
          fatal = error;
          await executor.succeed('executor error');
        }
      });
    }
    script.push(succeed());

    const langwatch = {
      apiKey: this.langwatch?.apiKey ?? '',
      ...(this.langwatch?.endpoint !== undefined ? { endpoint: this.langwatch.endpoint } : {}),
    };
    try {
      await runScenario({
        name: test.id,
        description: `${test.sourceCase} ${test.kind} test ${test.id} at L1`,
        setId: `entalent-suite-${options.suiteId ?? 'unknown'}`,
        agents: [scriptedUser, coachAgent],
        script,
        maxTurns: test.steps.length + 1,
        langwatch,
      });
    } catch (error) {
      // The driver itself failed (not a turn): the executor cannot say what the product did.
      fatal ??= new SuiteExecutionError({ kind: 'infrastructure', step: world.sink.stepIndex, reason: 'scenario-driver-error', cause: error });
    }
    if (fatal !== null) throw fatal;
    // Scenario ended the script early on its own (for example at maxTurns) without throwing.
    if (run.steps.length < test.steps.length && run.stoppedAtStep === undefined && run.errors.length === 0) {
      const step = run.steps.length + 1;
      run.errors.push({
        kind: 'infrastructure',
        step,
        reason: 'scenario-incomplete',
        message: `the Scenario run ended before step ${step} was recorded`,
      });
    }
    return afterStep;
  }
}

/** The context fixtures apply against at L1; exported for fixture tests. */
export function l1FixtureContext(world: L1World, test: LoadedTest, start: Date): FixtureContext {
  return {
    test,
    start,
    clock: world.clock,
    harness: world.harness,
    ports: { conversationRepo: world.ports.conversationRepo, questionConfirmationRepo: world.ports.questionConfirmationRepo },
    state: world.state,
    proactive: world.proactive,
    survey: { port: world.ports.surveyRepo, state: world.state.surveyRepo },
  };
}

/** A fresh L1 world for one test attempt; exported for fixture and state-query tests. */
export function createL1World(start: Date, provider: AiProviderPort, coachModel: string, timezone?: string): L1World {
  const clock = new FixedClock(start);
  const sink = createEventSink(() => clock.peek());

  const conversationState = new InMemoryConversationRepository(createSimConversation({ timezone, clock }), clock);
  const memoryState = new InMemoryMemoryRepository(clock);
  const goalState = new InMemoryGoalRepository(clock);
  const styleState = new InMemoryStyleProfileRepository();
  const questionState = new InMemoryQuestionConfirmationRepository();
  const surveyState = new InMemorySurveyRepository(clock);

  const aiProvider = record<AiProviderPort>(provider, 'aiProvider', sink, { name: coachModel, settings: {} });
  const conversationRepo = record(conversationState, 'conversationRepo', sink);
  const memoryRepo = record(memoryState, 'memoryRepo', sink);
  const goalRepo = record(goalState, 'goalRepo', sink);
  const styleRepo = record(styleState, 'styleRepo', sink);
  const questionConfirmationRepo = record(questionState, 'questionConfirmationRepo', sink);
  const surveyRepo = record(surveyState, 'surveyRepo', sink);
  const pulseBacklogService = record(surveyState.pulseBacklog(), 'pulseBacklogService', sink);
  const outbox = record(
    new InlineOutbox(aiProvider, conversationRepo, memoryRepo, goalRepo, styleRepo, { clock, surveyEvidence: { surveyRepo } }),
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
    surveyRepo,
    pulseBacklogService,
    fallbackReport: false,
  });

  return {
    clock,
    sink,
    harness,
    state: {
      conversationRepo: conversationState,
      questionConfirmationRepo: questionState,
      memoryRepo: memoryState,
      goalRepo: goalState,
      styleRepo: styleState,
      surveyRepo: surveyState,
    },
    ports: { conversationRepo, questionConfirmationRepo, memoryRepo, outbox, aiProvider, surveyRepo },
    proactive: createProactiveWorld(),
  };
}
