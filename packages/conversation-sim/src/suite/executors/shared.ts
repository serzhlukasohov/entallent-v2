import type { MessageRecord, OrchestrateResult } from '@entalent/application';
import type { InMemoryConversationRepository } from '../../fakes/repositories';
import type { FixtureContext, FixtureHarnessOptions, FixtureInstance, FixtureModule } from '../fixtures/types';
import { RULES, type RuleContext } from '../rules/registry';
import { missingField } from '../rules/reply-selection';
import {
  REPLY_MESSAGE_SEPARATOR,
  type CaseRun,
  type ExecutionError,
  type FixtureName,
  type FixtureRef,
  type Level,
  type LoadedTest,
  type PreconditionResult,
  type ReplyMessage,
  type RuleCheck,
  type StepObservation,
  type TurnClassification,
  type TurnRisk,
  type TurnTrace,
} from '../schema';
import type { ControlledClock } from './clock';
import { SuiteExecutionError } from './types';

/**
 * The step, fixture and observation code path shared by the in-process executors (L0, L1):
 * fixture support, parsing, apply and verify; rule preconditions and stop checkpoints;
 * gap realization; reply attribution by traceId; error mapping. Pure over its inputs apart
 * from the fixture instances it runs.
 */

export type FixtureRegistry = Readonly<Partial<Record<FixtureName, FixtureModule<unknown>>>>;

export interface ParsedFixture {
  ref: FixtureRef;
  module: FixtureModule<unknown>;
  params: unknown;
}

/** `setup` in order, with `seededHistory` first when the test carries a seed but does not list it. */
export function fixtureRefs(test: LoadedTest): FixtureRef[] {
  const listed = test.setup.some((ref) => ref.name === 'seededHistory');
  return test.seed && !listed ? [{ name: 'seededHistory' }, ...test.setup] : [...test.setup];
}

/** An unsupported fixture is a build defect: nothing is sent (AD-4). */
export function unsupportedFixtureError(test: LoadedTest, supports: (name: FixtureName) => boolean, level: Level): ExecutionError | null {
  const unsupported = test.setup.find((ref) => !supports(ref.name));
  if (unsupported) {
    return {
      kind: 'infrastructure',
      step: 0,
      reason: `unsupported-fixture:${unsupported.name}`,
      message: `fixture ${unsupported.name} is not supported at ${level}`,
    };
  }
  if (fixtureRefs(test).some((ref) => !supports(ref.name))) {
    return { kind: 'infrastructure', step: 0, reason: 'unsupported-fixture:seededHistory', message: 'seededHistory is not supported' };
  }
  return null;
}

/** Parses every fixture's params; the first invalid one is a `fixture-apply:<name>` error. */
export function parseFixtures(test: LoadedTest, registry: FixtureRegistry): { parsed: ParsedFixture[] } | { error: ExecutionError } {
  const parsed: ParsedFixture[] = [];
  for (const ref of fixtureRefs(test)) {
    const module = registry[ref.name]!;
    const result = module.params.safeParse(ref.params ?? {});
    if (!result.success) {
      return {
        error: fixtureApplyError(ref.name, `invalid params: ${result.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`).join('; ')}`),
      };
    }
    parsed.push({ ref, module, params: result.data });
  }
  return { parsed };
}

/** Harness construction inputs the fixtures decide, merged in setup order. */
export function harnessOptionsOf(parsed: readonly ParsedFixture[]): FixtureHarnessOptions {
  const options: FixtureHarnessOptions = {};
  for (const { module, params } of parsed) Object.assign(options, module.harnessOptions?.(params) ?? {});
  return options;
}

/** Creates and applies every fixture in order; the first throw is a `fixture-apply:<name>` error. */
export async function applyFixtures(
  parsed: readonly ParsedFixture[],
  context: FixtureContext,
): Promise<{ instances: Array<{ name: FixtureName; instance: FixtureInstance }> } | { error: ExecutionError }> {
  const instances: Array<{ name: FixtureName; instance: FixtureInstance }> = [];
  for (const { ref, module, params } of parsed) {
    try {
      const instance = module.create(context, params);
      await instance.apply();
      instances.push({ name: ref.name, instance });
    } catch (error) {
      return { error: fixtureApplyError(ref.name, describeError(error)) };
    }
  }
  return { instances };
}

/** Every fixture's `verify()`; a throw is an unsatisfied precondition. */
export async function verifyFixtures(instances: ReadonlyArray<{ name: FixtureName; instance: FixtureInstance }>): Promise<PreconditionResult[]> {
  const preconditions: PreconditionResult[] = [];
  for (const { name, instance } of instances) {
    try {
      preconditions.push(await instance.verify());
    } catch (error) {
      preconditions.push({ source: 'fixture', name, satisfied: false, detail: `verify threw: ${describeError(error)}` });
    }
  }
  return preconditions;
}

/** Atomic: the gap from the latest message before the turn (seed or fixture) to the turn. */
export function atomicPriorGap(conversations: InMemoryConversationRepository, start: Date): number {
  const stamps = conversations.messages.map((message) => message.occurredAt.getTime());
  return stamps.length > 0 ? Math.max(0, start.getTime() - Math.max(...stamps)) : 0;
}

/**
 * The clock movement before step `index` and the gap it records (AD-18). Journeys: the
 * suite gap before every step after the first, plus `advanceClock`. Atomic: seed and
 * fixtures already lie before the turn, so only `advanceClock` moves the clock.
 */
export function stepGap(
  test: LoadedTest,
  index: number,
  interMessageGapMs: number,
  priorGap: number,
): { realized: number; gapMs: number } {
  const advance = test.steps[index - 1]?.advanceClock ?? 0;
  const realized = (test.kind === 'journey' && index > 1 ? interMessageGapMs : 0) + advance;
  return { realized, gapMs: test.kind === 'atomic' ? priorGap + realized : realized };
}

/**
 * Runs step `index`'s `stop` checkpoint inline on the partial run (built only when needed): `stop` when a rule
 * FAILs, an infrastructure error when a rule cannot observe its input (a stop checkpoint
 * must not pass silently), else `continue`. Non-stop checkpoints are the evaluator's.
 */
export function stopCheckpoint(
  test: LoadedTest,
  index: number,
  partial: () => CaseRun,
  context: RuleContext,
): { outcome: 'continue' } | { outcome: 'stop' } | { outcome: 'error'; error: ExecutionError } {
  const step = test.steps[index - 1];
  if (test.kind !== 'journey' || step?.checkpoint?.onFail !== 'stop') return { outcome: 'continue' };
  const at = { id: `${test.id}.checkpoint:${index}`, evaluatedAt: `after-step:${index}` };
  const run = partial();
  const outcomes = step.checkpoint.checks.map((check) => ({ check, status: runRule(run, at, check, context) }));
  const unobservable = outcomes.find((outcome) => outcome.status === 'NOT_OBSERVABLE');
  if (unobservable) {
    return {
      outcome: 'error',
      error: {
        kind: 'infrastructure',
        step: index,
        reason: `checkpoint-not-observable:${unobservable.check.rule}`,
        message: `checkpoint rule ${unobservable.check.rule} could not observe its input`,
      },
    };
  }
  return outcomes.some((outcome) => outcome.status === 'FAIL') ? { outcome: 'stop' } : { outcome: 'continue' };
}

/** Replies are the outbound messages saved under the turn's traceId; other new outbounds are unsolicited. */
export function observeStep(
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
export function replyMessage(message: MessageRecord, conversations: InMemoryConversationRepository): ReplyMessage {
  const { messageType } = conversations.sideFieldsOf(message.id);
  return {
    id: message.id,
    text: message.text,
    occurredAt: message.occurredAt.toISOString(),
    metadata: { ...(message.metadata ?? {}), ...(messageType !== undefined ? { messageType } : {}) },
  };
}

export function turnTrace(result: OrchestrateResult): TurnTrace {
  const trace: TurnTrace = {};
  if (result.mode !== undefined) trace.mode = result.mode;
  if (result.classification?.primaryIntent !== undefined) trace.intent = result.classification.primaryIntent;
  if (result.outcome !== undefined) trace.outcome = result.outcome;
  if (result.bundleReply !== undefined) trace.bundleReply = result.bundleReply;
  if (result.classification !== undefined) trace.classification = turnClassification(result.classification);
  if (result.risk !== undefined) trace.risk = turnRisk(result.risk);
  return trace;
}

function turnClassification(classification: OrchestrateResult['classification']): TurnClassification {
  return {
    primaryIntent: classification.primaryIntent,
    secondaryIntents: [...classification.secondaryIntents],
    urgency: classification.urgency,
    requiresSafetyCheck: classification.requiresSafetyCheck,
    surveyAllowed: classification.surveyAllowed,
    ...(classification.dialogueAct !== undefined ? { dialogueAct: classification.dialogueAct } : {}),
    ...(classification.cycleStatusQuestion !== undefined ? { cycleStatusQuestion: classification.cycleStatusQuestion } : {}),
    ...(classification.acceptsPriorOffer !== undefined ? { acceptsPriorOffer: classification.acceptsPriorOffer } : {}),
    ...(classification.formatRequest !== undefined ? { formatRequest: classification.formatRequest } : {}),
  };
}

function turnRisk(risk: OrchestrateResult['risk']): TurnRisk {
  const common = {
    assessed: risk.assessed,
    severity: risk.severity,
    riskType: risk.riskType,
    immediateResponseRequired: risk.immediateResponseRequired,
    tripwireRaised: risk.tripwireRaised,
  };
  if (!risk.assessed) return { ...common, unassessedReason: risk.reason };
  return {
    ...common,
    escalationRecommended: risk.escalationRecommended,
    surveyMustBeBlocked: risk.surveyMustBeBlocked,
    proactiveMessagesMustBePaused: risk.proactiveMessagesMustBePaused,
  };
}

/** `from`: the earliest instant the run stamped (seed included); `to`: the clock at the end. */
export function clockRange(conversations: InMemoryConversationRepository, clock: ControlledClock, start: Date): { from: string; to: string } {
  const stamps = conversations.messages.map((message) => message.occurredAt.getTime());
  const from = Math.min(start.getTime(), ...stamps);
  return { from: new Date(from).toISOString(), to: clock.peek().toISOString() };
}

/** A rule precondition evaluated on the run after fixtures, before any step. */
export function rulePrecondition(run: CaseRun, check: RuleCheck, test: LoadedTest): PreconditionResult {
  const at = { id: `${test.id}.precondition`, evaluatedAt: 'conversation' };
  if (!Object.prototype.hasOwnProperty.call(RULES, check.rule)) {
    return { source: 'rule', name: check.rule, satisfied: false, detail: 'unknown rule' };
  }
  const status = runRule(run, at, check, { seedHistory: test.seed?.history ?? [] });
  return { source: 'rule', name: check.rule, satisfied: status === 'PASS', ...(status === 'PASS' ? {} : { detail: status }) };
}

export function runRule(
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

export function fixtureApplyError(name: FixtureName, message: string): ExecutionError {
  return { kind: 'infrastructure', step: 0, reason: `fixture-apply:${name}`, message };
}

/** A turn that threw: the executor's own errors keep their kind; anything else is the product's. */
export function executionError(error: unknown, step: number): ExecutionError {
  if (error instanceof SuiteExecutionError) {
    return { kind: error.kind, step: error.step === 0 ? step : error.step, reason: error.reason, message: error.message };
  }
  return { kind: 'product', step, reason: 'agent-turn-error', message: describeError(error) };
}

export function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
