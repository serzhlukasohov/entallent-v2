import type { z } from 'zod';
import { disclosureDeliveredFixture } from '../fixtures/disclosure-delivered';
import { freshPersonaFixture } from '../fixtures/fresh-persona';
import { pulseCycleFixture, pulseCycleGroupOf } from '../fixtures/pulse-cycle';
import { L2_STATE_PATHS, STATE_QUERIES, type L2StateBodies, type L2StatePath } from '../fixtures/state-queries';
import { satisfied } from '../fixtures/types';
import type { RuleContext } from '../rules/registry';
import {
  REPLY_MESSAGE_SEPARATOR,
  STATE_QUERY_VALUE_SCHEMAS,
  StateQueryNameSchema,
  type CaseRun,
  type ExecutionError,
  type FixtureName,
  type FixtureRef,
  type LoadedTest,
  type ObservationField,
  type PreconditionResult,
  type ReplyMessage,
  type StateSnapshot,
  type StepObservation,
} from '../schema';
import { DevApiError, type DevApiClient, type DevMessageRow } from './dev-api-client';
import { describeError, fixtureApplyError, fixtureRefs, rulePrecondition, stepGap, stopCheckpoint, unsupportedFixtureError } from './shared';
import { afterStepsNamed } from './state-queries-l0';
import { SuiteExecutionError, type ExecutorOptions, type SuiteExecutor } from './types';

/** What an L2 journey fills (AD-17): never `events`, `turn.*` or `window.outbound`; no clock. */
const L2_FIELDS: ObservationField[] = [
  'reply.text',
  'reply.messages',
  'steps.gapMs',
  'state.questionProgress',
  'state.stagedBundleCount',
  'state.surveyEvidenceCount',
  'state.outboundCount',
];

export const DEFAULT_POLL_INTERVAL_MS = 500;
export const DEFAULT_REPLY_TIMEOUT_MS = 60_000;

const CLOSED = new Set(['confirmed', 'declined']);

/** The subject one L2 attempt runs as: a fresh persona on the local stack. */
export interface L2Subject {
  externalUserId: string;
  userId: string;
  conversationId: string;
  tenantId: string;
}

/** What an L2 fixture works against: the dev API client and the attempt's subject. */
export interface L2FixtureContext {
  test: LoadedTest;
  client: DevApiClient;
  subject: L2Subject;
}

export interface L2FixtureInstance {
  /** Writes nothing at L2: AD-12 authorizes no dev write path and L2 never mutates the database. */
  apply(): Promise<void>;
  /** Reads the dev endpoints; unmet state is `satisfied: false` (criteria INVALID), never seeded green. */
  verify(): Promise<PreconditionResult>;
}

export interface L2FixtureModule<P = unknown> {
  name: FixtureName;
  params: z.ZodType<P, z.ZodTypeDef, unknown>;
  create(context: L2FixtureContext, params: P): L2FixtureInstance;
}

export type L2FixtureRegistry = Readonly<Partial<Record<FixtureName, L2FixtureModule<unknown>>>>;

const verifyOnly = (verify: () => Promise<PreconditionResult>): L2FixtureInstance => ({ async apply() {}, verify });

/** No seeded memory or survey (question-confirmation) state, read from the dev endpoints. */
export const l2FreshPersonaFixture: L2FixtureModule<z.infer<typeof freshPersonaFixture.params>> = {
  name: 'freshPersona',
  params: freshPersonaFixture.params,
  create: ({ client, subject }) =>
    verifyOnly(async () => {
      const found: string[] = [];
      const memory = await client.memory(subject.userId);
      if (memory.count > 0) found.push(`memory:${memory.count}`);
      const survey = await client.surveyState(subject.userId);
      if (survey.count > 0) found.push(`survey-evidence:${survey.count}`);
      const confirmation = await client.questionConfirmation(subject.userId, null);
      if (confirmation.surveyWindowId !== null) found.push('question-window');
      if (confirmation.stagedBundleCount > 0) found.push('staged-bundles');
      if (confirmation.pendingClarification !== null) found.push('pending-clarification');
      const unchecked = 'style and goals not checked (no dev read)';
      return satisfied('freshPersona', found.length === 0, found.length > 0 ? `${found.join(', ')}; ${unchecked}` : unchecked);
    }),
};

/**
 * An open pulse cycle established by the stack: an active window whose questions hold, for
 * every declared uncovered topic, a question of that group that is not confirmed or declined.
 * The params' window and question ids are not compared (the stack assigns its own).
 */
export const l2PulseCycleFixture: L2FixtureModule<z.infer<typeof pulseCycleFixture.params>> = {
  name: 'pulseCycle',
  params: pulseCycleFixture.params,
  create: ({ client, subject }, value) =>
    verifyOnly(async () => {
      const confirmation = await client.questionConfirmation(subject.userId, null);
      if (confirmation.surveyWindowId === null) return satisfied('pulseCycle', false, 'no active survey window');
      const missing = value.uncoveredTopics
        .map((uncovered) => uncovered.topic)
        .filter((topic) => !confirmation.questions.some((question) => question.questionGroup === topic && !CLOSED.has(question.status)));
      return satisfied('pulseCycle', missing.length === 0, missing.length === 0 ? 'every declared topic is open' : `not open: ${missing.join(', ')}`);
    }),
};

/** A delivered outbound (`sentAt` set) carrying `metadata.reportingDisclosureVersion === version`. */
export const l2DisclosureDeliveredFixture: L2FixtureModule<z.infer<typeof disclosureDeliveredFixture.params>> = {
  name: 'disclosureDelivered',
  params: disclosureDeliveredFixture.params,
  create: ({ client, subject }, value) =>
    verifyOnly(async () => {
      const rows = await client.messages(subject.conversationId);
      const delivered = rows.some(
        (row) => row.direction === 'outbound' && row.sentAt !== null && metadataOf(row).reportingDisclosureVersion === value.version,
      );
      return satisfied('disclosureDelivered', delivered, delivered ? undefined : 'no delivered disclosure');
    }),
};

/** Verify-only L2 fixtures; `seededHistory`, `confirmationState`, `clock`, `pendingBotQuestion`, `proactiveUsers` and `memoryItems` are unsupported. */
export const L2_FIXTURES: L2FixtureRegistry = Object.freeze({
  freshPersona: l2FreshPersonaFixture,
  pulseCycle: l2PulseCycleFixture,
  disclosureDelivered: l2DisclosureDeliveredFixture,
});

export interface L2ExecutorOptions {
  client: DevApiClient;
  /**
   * `suite.config.json` `l2.workerEnv` (Story 14.3): the env the stack's worker was started
   * with, which switches proactive scheduling off (`PROACTIVE_SCAN_ENABLED=false`) so no
   * check-in lands in a case. Required and non-empty; the executor refuses to start without it.
   */
  workerEnv: Readonly<Record<string, string>>;
  /** Real waits (step gaps, poll interval); injected in tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Epoch milliseconds; injected in tests. */
  now?: () => number;
  pollIntervalMs?: number;
  replyTimeoutMs?: number;
  /** Replaces the L2 fixture registry (tests only). */
  fixtures?: L2FixtureRegistry;
}

/**
 * L2 application executor (architecture AD-4, AD-10, AD-17, AD-18; Epic 14): drives journey
 * tests through the running local API, queue, worker and Postgres over the `/api/v1/dev`
 * endpoints. Per attempt it creates and deep-resets a fresh persona, verifies the fixtures
 * against the dev reads (it writes nothing), sends each step with `simulate-message`, waits
 * the suite gap for real before every step after the first, and attributes replies by
 * `traceId` from bounded polling; other outbounds are `unsolicited`. State queries are read
 * from the dev endpoints (`method: 'observed'`). Coach calls happen inside the app worker,
 * so no `CallBudget` is reserved and `coachModel` is null. Reachable only from `run-live.ts`.
 */
export class L2ApplicationExecutor implements SuiteExecutor {
  readonly level = 'L2' as const;
  readonly coachModel = null;
  private readonly client: DevApiClient;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly pollIntervalMs: number;
  private readonly replyTimeoutMs: number;
  private readonly fixtures: L2FixtureRegistry;
  /** The worker env this run relies on (`suite.config.json` `l2.workerEnv`). */
  readonly workerEnv: Readonly<Record<string, string>>;

  constructor(options: L2ExecutorOptions) {
    // Untyped callers (and a config without `l2`) must not get a run whose worker may schedule check-ins.
    const workerEnv = (options as Partial<L2ExecutorOptions>).workerEnv;
    if (workerEnv === undefined || workerEnv === null || Object.keys(workerEnv).length === 0) {
      throw new Error('[suite] L2ApplicationExecutor refuses: workerEnv (suite.config.json l2.workerEnv) is missing or empty');
    }
    this.workerEnv = Object.freeze({ ...workerEnv });
    this.client = options.client;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = options.now ?? (() => Date.now());
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.replyTimeoutMs = options.replyTimeoutMs ?? DEFAULT_REPLY_TIMEOUT_MS;
    this.fixtures = options.fixtures ?? L2_FIXTURES;
  }

  supports(fixture: FixtureName): boolean {
    return this.fixtures[fixture] !== undefined;
  }

  observes(): ObservationField[] {
    return [...L2_FIELDS];
  }

  async run(test: LoadedTest, options: ExecutorOptions): Promise<CaseRun> {
    const sample = options.sample ?? 1;
    const suffix = sample > 1 || options.attempt > 1 ? `-s${sample}-a${options.attempt}` : '';
    const externalUserId = `suite-${options.runId ?? 'missing'}-${test.id}${suffix}`;
    const run: CaseRun = {
      testId: test.id,
      level: this.level,
      attempt: options.attempt,
      subject: { externalUserId },
      observed: [...L2_FIELDS],
      preconditions: [],
      steps: [],
      state: { before: {}, after: {}, afterStep: {} },
      errors: [],
      events: [],
    };
    const fail = (error: ExecutionError): CaseRun => ({ ...run, errors: [...run.errors, error] });

    if (test.kind !== 'journey') {
      return fail({ kind: 'product', step: 0, reason: 'l2-journeys-only', message: `L2 runs journey tests only, got ${test.kind}` });
    }
    if (options.runId === undefined || options.runId === '') {
      return fail({ kind: 'infrastructure', step: 0, reason: 'run-id-missing', message: 'L2 needs the runner run id to name the persona' });
    }
    const unsupported = unsupportedFixtureError(test, (name) => this.supports(name), this.level);
    if (unsupported) return fail(unsupported);
    const parsing = this.parseFixtures(test);
    if ('error' in parsing) return fail(parsing.error);

    let step = 0;
    try {
      const subject = await this.isolate(externalUserId, (ids) => {
        run.subject = ids;
      });

      const context: L2FixtureContext = { test, client: this.client, subject };
      const instances: Array<{ name: FixtureName; instance: L2FixtureInstance }> = [];
      for (const { ref, module, params } of parsing.parsed) {
        try {
          const instance = module.create(context, params);
          await instance.apply();
          instances.push({ name: ref.name, instance });
        } catch (error) {
          if (error instanceof DevApiError) throw error;
          return fail(fixtureApplyError(ref.name, describeError(error)));
        }
      }
      const preconditions: PreconditionResult[] = [];
      for (const { name, instance } of instances) {
        try {
          preconditions.push(await instance.verify());
        } catch (error) {
          // A failed read is infrastructure, not unmet state.
          if (error instanceof DevApiError) throw error;
          preconditions.push({ source: 'fixture', name, satisfied: false, detail: `verify threw: ${describeError(error)}` });
        }
      }

      const group = pulseCycleGroupOf(test);
      const snapshot = (): Promise<StateSnapshot> => this.readSnapshot(subject, group);
      const before = await snapshot();
      const snapshotRun: CaseRun = { ...run, preconditions, state: { before, after: before, afterStep: {} } };
      preconditions.push(...test.preconditions.map((check) => rulePrecondition(snapshotRun, check, test)));
      run.preconditions = preconditions;
      // `afterStep` is shared with run.state, so an error after a step keeps the snapshots collected so far.
      const afterStep: Record<string, StateSnapshot> = {};
      run.state = { before, after: before, afterStep };

      const afterSteps = afterStepsNamed(test);
      const ruleContext: RuleContext = { seedHistory: [] };
      for (const [position, definition] of test.steps.entries()) {
        const index = position + 1;
        step = index;
        const { realized, gapMs } = stepGap(test, index, options.interMessageGapMs, 0);
        if (realized > 0) await this.sleep(realized);
        const sentAt = this.now();
        const sent = await this.client.simulateMessage(subject.externalUserId, definition.text);
        if (sent.conversationId !== subject.conversationId) {
          throw new SuiteExecutionError({
            kind: 'infrastructure',
            step: index,
            reason: 'conversation-mismatch',
            message: 'simulate-message answered a conversation other than the isolated subject',
          });
        }
        run.steps.push(await this.observeStep(index, definition.text, gapMs, sent, subject.conversationId, sentAt));
        if (afterSteps.has(index)) afterStep[String(index)] = await snapshot();
        // A stop checkpoint reads the partial run; `after` stands at the current state (read only when needed).
        const stops = definition.checkpoint?.onFail === 'stop';
        const current = stops ? (afterStep[String(index)] ?? (await snapshot())) : before;
        const checkpoint = stopCheckpoint(test, index, () => ({ ...run, state: { before, after: current, afterStep: { ...afterStep } } }), ruleContext);
        if (checkpoint.outcome === 'error') {
          run.errors.push(checkpoint.error);
          break;
        }
        if (checkpoint.outcome === 'stop') {
          run.stoppedAtStep = index;
          break;
        }
      }
      return { ...run, state: { before, after: await snapshot(), afterStep } };
    } catch (error) {
      return fail(this.executionError(error, step));
    }
  }

  /** find-conversation -> deep reset -> find-conversation (a new conversation) -> it must be empty. */
  private async isolate(externalUserId: string, record: (subject: L2Subject) => void): Promise<L2Subject> {
    const userName = `Suite ${externalUserId}`;
    const first = await this.client.findConversation(externalUserId, userName);
    try {
      await this.client.resetUser(first.userId);
    } catch (error) {
      // reset-user deep-resets in its own statement, then restarts onboarding, which answers 404
      // for a dev-only user without a `people` row (always the case for a find-conversation
      // persona). The persona was just created, so a missing user is impossible: 404 is a
      // completed reset. The find-conversation and empty check below stay the isolation guard.
      if (!(error instanceof DevApiError && error.status === 404)) throw error;
    }
    const fresh = await this.client.findConversation(externalUserId, userName);
    const subject: L2Subject = { externalUserId, userId: fresh.userId, conversationId: fresh.conversationId, tenantId: this.client.tenantId };
    // Recorded before the empty check, so an errored run still names its persona.
    record(subject);
    const rows = await this.client.messages(fresh.conversationId);
    if (rows.length > 0) {
      throw new SuiteExecutionError({
        kind: 'infrastructure',
        step: 0,
        reason: 'isolation-not-empty',
        message: `the reset conversation holds ${rows.length} message(s); nothing was sent`,
      });
    }
    return subject;
  }

  private parseFixtures(
    test: LoadedTest,
  ): { parsed: Array<{ ref: FixtureRef; module: L2FixtureModule<unknown>; params: unknown }> } | { error: ExecutionError } {
    const parsed: Array<{ ref: FixtureRef; module: L2FixtureModule<unknown>; params: unknown }> = [];
    for (const ref of fixtureRefs(test)) {
      const module = this.fixtures[ref.name]!;
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

  /**
   * Polls `messages?after=<inbound>` every `pollIntervalMs` until `replyTimeoutMs` from the
   * send. Outbounds under the step's traceId are the reply, others unsolicited; a foreign
   * outbound before any own one ends the case. Polling ends on the first poll after one with
   * own outbounds that adds none. On timeout without a reply the inbound's job status decides.
   */
  private async observeStep(
    index: number,
    userText: string,
    gapMs: number,
    sent: { traceId: string; messageId: string },
    conversationId: string,
    sentAt: number,
  ): Promise<StepObservation> {
    const deadline = sentAt + this.replyTimeoutMs;
    const own = new Map<string, DevMessageRow>();
    const foreign = new Map<string, DevMessageRow>();

    /** One poll; returns how many new own outbounds it added. */
    const poll = async (): Promise<number> => {
      const rows = await this.messagesAfter(conversationId, sent.messageId, index);
      if (rows.some((row) => row.id === sent.messageId || row.direction === 'inbound')) {
        throw new SuiteExecutionError({
          kind: 'infrastructure',
          step: index,
          reason: 'after-not-honored',
          message: 'messages?after= returned the step inbound or another inbound row',
        });
      }
      const outbound = rows.filter((row) => row.direction === 'outbound');
      const newOwn = outbound.filter((row) => row.traceId === sent.traceId && !own.has(row.id));
      const newForeign = outbound.filter((row) => row.traceId !== sent.traceId && !foreign.has(row.id));
      const firstOwn = newOwn.length > 0 ? Math.min(...newOwn.map((row) => Date.parse(row.occurredAt))) : Infinity;
      // Before the reply: no own outbound yet, or a foreign one earlier than the first own in the same poll.
      if (own.size === 0 && newForeign.some((row) => Date.parse(row.occurredAt) < firstOwn)) {
        throw new SuiteExecutionError({
          kind: 'infrastructure',
          step: index,
          reason: 'unsolicited-outbound',
          message: `an outbound with another traceId arrived before the step reply (${newForeign.length} message(s))`,
        });
      }
      for (const row of newForeign) foreign.set(row.id, row);
      for (const row of newOwn) own.set(row.id, row);
      return newOwn.length;
    };

    let sawOwn = false;
    for (;;) {
      const added = await poll();
      if (sawOwn && added === 0) break;
      sawOwn = own.size > 0;
      if (this.now() >= deadline) {
        if (own.size > 0) {
          // The reply arrived on the poll that crossed the deadline: one more poll collects its tail.
          if (added > 0) await poll();
          break;
        }
        await this.timedOut(conversationId, sent.messageId, index, poll);
        break;
      }
      await this.sleep(this.pollIntervalMs);
    }

    const messages = sortRows([...own.values()]).map(replyMessage);
    return {
      index,
      userText,
      traceId: sent.traceId,
      gapMs,
      // No outbound for the trace after a completed job is observed product silence.
      reply: messages.length > 0 ? { messages, text: messages.map((message) => message.text).join(REPLY_MESSAGE_SEPARATOR) } : null,
      unsolicited: sortRows([...foreign.values()]).map(replyMessage),
    };
  }

  /** Timeout without own outbound: `completed` re-polls once (late reply race); `failed` is product; else infrastructure. */
  private async timedOut(conversationId: string, inboundId: string, index: number, poll: () => Promise<number>): Promise<void> {
    const rows = await this.client.messages(conversationId);
    const status = rows.find((row) => row.id === inboundId)?.jobStatus ?? null;
    if (status === 'completed') {
      await poll();
      return;
    }
    if (status === 'failed') {
      throw new SuiteExecutionError({ kind: 'product', step: index, reason: 'job-failed', message: 'the worker job for the step failed' });
    }
    throw new SuiteExecutionError({
      kind: 'infrastructure',
      step: index,
      reason: `reply-timeout:${status ?? 'none'}`,
      message: `no reply within ${this.replyTimeoutMs} ms; job status ${status ?? 'none'}`,
    });
  }

  private async messagesAfter(conversationId: string, after: string, index: number): Promise<DevMessageRow[]> {
    try {
      return await this.client.messages(conversationId, after);
    } catch (error) {
      if (error instanceof DevApiError && error.status === 400) {
        throw new SuiteExecutionError({
          kind: 'infrastructure',
          step: index,
          reason: 'messages-after-rejected',
          message: 'messages?after= answered 400 (unknown after id)',
          cause: error,
        });
      }
      throw error;
    }
  }

  /** Every state query from its dev route (one read per route), validated by its shared schema. */
  private async readSnapshot(subject: L2Subject, group: string | null): Promise<StateSnapshot> {
    const readers: { [P in L2StatePath]: () => Promise<L2StateBodies[P]> } = {
      [L2_STATE_PATHS.questionConfirmation]: () => this.client.questionConfirmation(subject.userId, group),
      [L2_STATE_PATHS.surveyState]: () => this.client.surveyState(subject.userId),
      [L2_STATE_PATHS.messages]: () => this.client.messages(subject.conversationId),
    };
    const bodies = new Map<L2StatePath, unknown>();
    const snapshot: Record<string, unknown> = {};
    for (const name of StateQueryNameSchema.options) {
      const route = STATE_QUERIES[name].l2;
      if (!bodies.has(route.path)) bodies.set(route.path, await readers[route.path]());
      const select = route.select as (body: unknown) => unknown;
      const parsed = STATE_QUERY_VALUE_SCHEMAS[name].safeParse(select(bodies.get(route.path)));
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

  private executionError(error: unknown, step: number): ExecutionError {
    if (error instanceof SuiteExecutionError) {
      return { kind: error.kind, step: error.step === 0 ? step : error.step, reason: error.reason, message: error.message };
    }
    if (error instanceof DevApiError) {
      return { kind: 'infrastructure', step, reason: `dev-api:${error.operation}`, message: error.message };
    }
    throw error;
  }
}

function metadataOf(row: Pick<DevMessageRow, 'metadata'>): Record<string, unknown> {
  const value = row.metadata;
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function sortRows(rows: DevMessageRow[]): DevMessageRow[] {
  return [...rows].sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
}

function replyMessage(row: DevMessageRow): ReplyMessage {
  return { id: row.id, text: row.text, occurredAt: new Date(row.occurredAt).toISOString(), metadata: { ...metadataOf(row) } };
}
