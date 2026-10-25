import type { AiProviderPort, MessageRecord, OrchestrateResult } from '@entalent/application';
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
import type { FixtureContext, FixtureHarnessOptions, FixtureInstance, FixtureModule } from '../fixtures/types';
import { RULES, type RuleContext } from '../rules/registry';
import { missingField } from '../rules/reply-selection';
import {
  REPLY_MESSAGE_SEPARATOR,
  type CaseRun,
  type ExecutionError,
  type FixtureName,
  type FixtureRef,
  type LoadedTest,
  type ObservationField,
  type PreconditionResult,
  type ReplyMessage,
  type RuleCheck,
  type StateSnapshot,
  type StepObservation,
  type TurnTrace,
} from '../schema';
import { FixedClock } from './clock';
import { createL0ScriptedModel, type L0ScriptedModel } from './l0-scripted';
import { createProactiveWorld, driveObservationWindow, type ProactiveWorld } from './proactive-l0';
import { createEventSink, record } from './recording-proxy';
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
  private readonly fixtures: Readonly<Partial<Record<FixtureName, FixtureModule<unknown>>>>;

  /** `fixtures` replaces the L0 fixture registry (tests only). */
  constructor(options: { fixtures?: Readonly<Partial<Record<FixtureName, FixtureModule<unknown>>>> } = {}) {
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

    // An unsupported fixture is a build defect: nothing is sent (AD-4).
    const unsupported = test.setup.find((ref) => !this.supports(ref.name));
    if (unsupported) {
      return fail({
        kind: 'infrastructure',
        step: 0,
        reason: `unsupported-fixture:${unsupported.name}`,
        message: `fixture ${unsupported.name} is not supported at L0`,
      });
    }

    const refs = fixtureRefs(test);
    if (refs.some((ref) => !this.supports(ref.name))) {
      return fail({ kind: 'infrastructure', step: 0, reason: 'unsupported-fixture:seededHistory', message: 'seededHistory is not supported' });
    }
    const parsed: Array<{ ref: FixtureRef; module: FixtureModule<unknown>; params: unknown }> = [];
    for (const ref of refs) {
      const module = this.fixtures[ref.name]!;
      const result = module.params.safeParse(ref.params ?? {});
      if (!result.success) {
        return fail(fixtureApplyError(ref.name, `invalid params: ${result.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`).join('; ')}`));
      }
      parsed.push({ ref, module, params: result.data });
    }

    const harnessOptions: FixtureHarnessOptions = {};
    for (const { module, params } of parsed) Object.assign(harnessOptions, module.harnessOptions?.(params) ?? {});
    const start = harnessOptions.clockStart ?? options.clockStart ?? DEFAULT_L0_CLOCK_START;

    const world = createL0World(test, start, harnessOptions.timezone);
    const sources: L0StateSources = world.state;
    const finish = (extra: Partial<CaseRun> = {}): CaseRun => ({
      ...run,
      ...extra,
      events: world.sink.events,
      clock: clockRange(world, start),
    });

    // Rule and state-query failures end the case as infrastructure errors at the current step.
    try {
      // Fixtures and seed (stepIndex 0).
      const context = fixtureContext(world, test, start);
      const instances: Array<{ name: FixtureName; instance: FixtureInstance }> = [];
      for (const { ref, module, params } of parsed) {
        try {
          const instance = module.create(context, params);
          await instance.apply();
          instances.push({ name: ref.name, instance });
        } catch (error) {
          return finish({ errors: [fixtureApplyError(ref.name, describe(error))] });
        }
      }
      const preconditions: PreconditionResult[] = [];
      for (const { name, instance } of instances) {
        try {
          preconditions.push(await instance.verify());
        } catch (error) {
          preconditions.push({ source: 'fixture', name, satisfied: false, detail: `verify threw: ${describe(error)}` });
        }
      }

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
      // Atomic: the gap is from the latest message before the turn (seed or fixture) to the turn.
      const priorStamps = world.state.conversationRepo.messages.map((message) => message.occurredAt.getTime());
      const priorGap = priorStamps.length > 0 ? Math.max(0, start.getTime() - Math.max(...priorStamps)) : 0;
      const ruleContext: RuleContext = { seedHistory: test.seed?.history ?? [] };

      for (const [position, step] of test.steps.entries()) {
        const index = position + 1;
        const advance = step.advanceClock ?? 0;
        // Journeys: the suite gap before every step after the first, plus `advanceClock`.
        // Atomic: seed and fixtures already lie before the turn, so only `advanceClock` moves the clock.
        const realized = (test.kind === 'journey' && index > 1 ? options.interMessageGapMs : 0) + advance;
        const gapMs = test.kind === 'atomic' ? priorGap + realized : realized;
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

        if (test.kind === 'journey' && step.checkpoint?.onFail === 'stop') {
          const partial = finish({ state: { before, after: readL0Snapshot(sources), afterStep } });
          const at = { id: `${test.id}.checkpoint:${index}`, evaluatedAt: `after-step:${index}` };
          const outcomes = step.checkpoint.checks.map((check) => ({ check, status: runRule(partial, at, check, ruleContext) }));
          // A stop checkpoint that cannot observe its input (or names no rule) must not pass silently.
          const unobservable = outcomes.find((outcome) => outcome.status === 'NOT_OBSERVABLE');
          if (unobservable) {
            run.errors.push({
              kind: 'infrastructure',
              step: index,
              reason: `checkpoint-not-observable:${unobservable.check.rule}`,
              message: `checkpoint rule ${unobservable.check.rule} could not observe its input`,
            });
            break;
          }
          if (outcomes.some((outcome) => outcome.status === 'FAIL')) {
            run.stoppedAtStep = index;
            break;
          }
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

/** `setup` in order, with `seededHistory` first when the test carries a seed but does not list it. */
function fixtureRefs(test: LoadedTest): FixtureRef[] {
  const listed = test.setup.some((ref) => ref.name === 'seededHistory');
  return test.seed && !listed ? [{ name: 'seededHistory' }, ...test.setup] : [...test.setup];
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

/** Replies are the outbound messages saved under the turn's traceId; other new outbounds are unsolicited. */
function observeStep(
  index: number,
  userText: string,
  gapMs: number,
  turn: { result: OrchestrateResult; traceId: string },
  conversations: InMemoryConversationRepository,
  firstNew: number,
): StepObservation {
  const outbound = conversations.messages.slice(firstNew).filter((message) => message.direction === 'outbound');
  const own = outbound.filter((message) => conversations.sideFieldsOf(message.id).traceId === turn.traceId);
  const unsolicited = outbound.filter((message) => !own.includes(message));
  const messages = own.map((message) => replyMessage(message, conversations));
  return {
    index,
    userText,
    traceId: turn.traceId,
    gapMs,
    // No outbound for the trace is observed silence, evaluated with `turn.outcome` (AD-17).
    reply: messages.length > 0 ? { messages, text: messages.map((message) => message.text).join(REPLY_MESSAGE_SEPARATOR) } : null,
    unsolicited: unsolicited.map((message) => replyMessage(message, conversations)),
    turn: turnTrace(turn.result),
  };
}

/** Copies the stored `messageType` column into `metadata.messageType` (rules/proactive.ts contract). */
function replyMessage(message: MessageRecord, conversations: InMemoryConversationRepository): ReplyMessage {
  const { messageType } = conversations.sideFieldsOf(message.id);
  return {
    id: message.id,
    text: message.text,
    occurredAt: message.occurredAt.toISOString(),
    metadata: { ...(message.metadata ?? {}), ...(messageType !== undefined ? { messageType } : {}) },
  };
}

function turnTrace(result: OrchestrateResult): TurnTrace {
  const trace: TurnTrace = {};
  if (result.mode !== undefined) trace.mode = result.mode;
  if (result.classification?.primaryIntent !== undefined) trace.intent = result.classification.primaryIntent;
  if (result.outcome !== undefined) trace.outcome = result.outcome;
  if (result.bundleReply !== undefined) trace.bundleReply = result.bundleReply;
  return trace;
}

/** `from`: the earliest instant the run stamped (seed included); `to`: the clock at the end. */
function clockRange(world: L0World, start: Date): { from: string; to: string } {
  const stamps = world.state.conversationRepo.messages.map((message) => message.occurredAt.getTime());
  const from = Math.min(start.getTime(), ...stamps);
  return { from: new Date(from).toISOString(), to: world.clock.peek().toISOString() };
}

/** A rule precondition evaluated on the run after fixtures, before any step. */
function rulePrecondition(run: CaseRun, check: RuleCheck, test: LoadedTest): PreconditionResult {
  const at = { id: `${test.id}.precondition`, evaluatedAt: 'conversation' };
  if (!Object.prototype.hasOwnProperty.call(RULES, check.rule)) {
    return { source: 'rule', name: check.rule, satisfied: false, detail: 'unknown rule' };
  }
  const status = runRule(run, at, check, { seedHistory: test.seed?.history ?? [] });
  return { source: 'rule', name: check.rule, satisfied: status === 'PASS', ...(status === 'PASS' ? {} : { detail: status }) };
}

function runRule(
  run: CaseRun,
  criterion: { id: string; evaluatedAt: string },
  check: RuleCheck,
  context: RuleContext,
): 'PASS' | 'FAIL' | 'NOT_OBSERVABLE' {
  const entry = (RULES as Record<string, (typeof RULES)[keyof typeof RULES]>)[check.rule];
  if (!entry) return 'NOT_OBSERVABLE';
  if (missingField(entry.requires, run)) return 'NOT_OBSERVABLE';
  try {
    return entry.run(run, criterion, check.params, context).status;
  } catch (error) {
    throw new SuiteExecutionError({ kind: 'infrastructure', step: 0, reason: `rule-error:${check.rule}`, cause: error });
  }
}

function fixtureApplyError(name: FixtureName, message: string): ExecutionError {
  return { kind: 'infrastructure', step: 0, reason: `fixture-apply:${name}`, message };
}

/** A turn that threw: the executor's own errors keep their kind; anything else is the product's. */
function executionError(error: unknown, step: number): ExecutionError {
  if (error instanceof SuiteExecutionError) {
    return { kind: error.kind, step: error.step === 0 ? step : error.step, reason: error.reason, message: error.message };
  }
  return { kind: 'product', step, reason: 'agent-turn-error', message: describe(error) };
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
