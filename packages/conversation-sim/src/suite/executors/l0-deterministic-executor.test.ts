import { describe, expect, it, vi } from 'vitest';
import { evaluate } from '../evaluate';
import { RULES } from '../rules/registry';
import { CaseRunSchema, type CaseRun, type LoadedCriterion, type LoadedTest, type ScriptedStep } from '../schema';
import { satisfied, type FixtureModule } from '../fixtures/types';
import { L0_FIXTURES } from '../fixtures';
import { DEFAULT_L0_CLOCK_START, L0DeterministicExecutor } from './l0-deterministic-executor';
import type { ExecutorOptions } from './types';
import { InMemoryQuestionConfirmationRepository } from '../../fakes/question-confirmation';
import { ScriptedAiProvider } from '../../fakes/scripted-ai';
import { SIM_CONVERSATION_ID, SIM_TENANT_ID, SIM_USER_ID } from '../../harness/coach-harness';
import { createL0World } from './l0-deterministic-executor';
import { InMemoryProactiveSchedulerRepository, driveObservationWindow, type ProactiveUserSpec } from './proactive-l0';
import { FixedClock } from './clock';
import { InMemoryConversationRepository } from '../../fakes/repositories';
import { createSimConversation } from '../../harness/coach-harness';
import { z } from 'zod';

const TRUST = { trusted: false, reason: 'no-agreement', pin: null, agreement: null };
const OPTIONS: ExecutorOptions = { attempt: 1, interMessageGapMs: 60_000 };
const START = DEFAULT_L0_CLOCK_START.getTime();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Every model output one orchestrator turn needs (risk, classification, response, memory). */
function scriptedStep(step: number, text = `Scripted reply ${step}.`): ScriptedStep {
  return { step, classification: {}, risk: {}, memoryProposal: {}, response: { text } };
}

function criterion(overrides: Partial<LoadedCriterion> & Pick<LoadedCriterion, 'id'>): LoadedCriterion {
  return {
    evaluatedAt: 'reply:1',
    checks: [{ type: 'rule', rule: 'reply-present' }],
    layer: 'P',
    passCondition: 'Suite text.',
    ...overrides,
  };
}

function atomicTest(overrides: Partial<LoadedTest> = {}): LoadedTest {
  return {
    id: 'X-01.A1',
    sourceCase: 'X-01',
    requirement: ['REQ-1'],
    kind: 'atomic',
    levels: ['L0'],
    runProfile: 'isolated',
    setup: [],
    seed: { history: [] },
    scripted: [scriptedStep(1)],
    preconditions: [],
    steps: [{ text: 'The release slipped again.' }],
    criteria: [criterion({ id: 'X-01.C1' })],
    ...overrides,
  };
}

function journeyTest(stepCount: number, overrides: Partial<LoadedTest> = {}): LoadedTest {
  return {
    id: 'X-01.J',
    sourceCase: 'X-01',
    requirement: ['REQ-1'],
    kind: 'journey',
    levels: ['L0'],
    runProfile: 'isolated',
    setup: [{ name: 'clock' }],
    scripted: Array.from({ length: stepCount }, (_, index) => scriptedStep(index + 1)),
    preconditions: [],
    steps: Array.from({ length: stepCount }, (_, index) => ({ text: `User step ${index + 1}.` })),
    criteria: Array.from({ length: stepCount }, (_, index) =>
      criterion({ id: `X-01.C${index + 1}`, evaluatedAt: `reply:${index + 1}` }),
    ),
    ...overrides,
  };
}

const PROACTIVE_USER = {
  timezone: 'UTC',
  quietHours: { enabled: true, startHour: 22, endHour: 8 },
  scan: { minSilenceDays: 3, minCheckInGapDays: 2, quietHoursEnabled: true },
};

function observationTest(overrides: Partial<LoadedTest> = {}): LoadedTest {
  return {
    id: 'P-06',
    sourceCase: 'P-06',
    requirement: ['CF-003'],
    kind: 'observation',
    levels: ['L0'],
    runProfile: 'isolated',
    setup: [{ name: 'clock' }, { name: 'proactiveUsers', params: PROACTIVE_USER }],
    scripted: [],
    preconditions: [],
    steps: [],
    observationWindow: { durationMs: 7 * DAY, scanEveryMs: HOUR },
    criteria: [
      criterion({ id: 'P-06.C1', evaluatedAt: 'observation-window', checks: [{ type: 'rule', rule: 'proactive-initiated' }] }),
      criterion({ id: 'P-06.C2', evaluatedAt: 'observation-window', checks: [{ type: 'rule', rule: 'proactive-spacing' }] }),
      criterion({
        id: 'P-06.C3',
        evaluatedAt: 'observation-window',
        checks: [{ type: 'rule', rule: 'proactive-working-hours', params: { timezone: 'UTC' } }],
      }),
    ],
    ...overrides,
  };
}

async function execute(test: LoadedTest, executor = new L0DeterministicExecutor(), options = OPTIONS): Promise<CaseRun> {
  const run = await executor.run(test, options);
  // Every run is a valid observation record.
  CaseRunSchema.parse(run);
  return run;
}

function clockLeakOutcome(run: CaseRun): { status: string; evidence?: string } {
  return RULES['clock-leak'].run(run, { id: 'X-01.C9', evaluatedAt: 'conversation' });
}

function clockLeak(run: CaseRun): string {
  return clockLeakOutcome(run).status;
}

function statuses(test: LoadedTest, run: CaseRun): Record<string, string> {
  return Object.fromEntries(
    evaluate(test, run, null, TRUST).map((result) => [result.criterionId, `${result.status}${result.reason ? ` ${result.reason}` : ''}`]),
  );
}

describe('L0DeterministicExecutor', () => {
  it('declares L0, its fixtures and its observation fields', () => {
    const executor = new L0DeterministicExecutor();
    expect(executor.level).toBe('L0');
    for (const name of ['clock', 'seededHistory', 'confirmationState', 'freshPersona', 'pendingBotQuestion', 'disclosureDelivered', 'proactiveUsers'] as const) {
      expect(executor.supports(name)).toBe(true);
    }
    expect(executor.supports('pulseCycle')).toBe(false);
    expect(executor.observes()).toEqual(expect.arrayContaining(['reply.messages', 'turn.mode', 'events', 'window.outbound', 'steps.gapMs']));
    expect(executor.observes()).not.toContain('reply.text');
    expect(executor.observes()).not.toContain('state.surveyEvidenceCount');
  });

  it('journey: realizes the suite gap plus advanceClock before each later step', async () => {
    const test = journeyTest(3);
    test.steps[2] = { ...test.steps[2]!, advanceClock: 300_000 };
    const run = await execute(test);

    expect(run.errors).toEqual([]);
    expect(run.steps.map((step) => step.index)).toEqual([1, 2, 3]);
    expect(run.steps.map((step) => step.gapMs)).toEqual([0, 60_000, 360_000]);
    expect(run.steps.map((step) => step.reply?.messages[0]?.occurredAt)).toEqual([
      new Date(START).toISOString(),
      new Date(START + 60_000).toISOString(),
      new Date(START + 420_000).toISOString(),
    ]);
    expect(run.steps.every((step) => step.reply?.messages.every((message) => message.text.startsWith('Scripted reply')))).toBe(true);
    expect(run.steps[0]?.turn).toMatchObject({ mode: expect.any(String), intent: 'casual_conversation' });
    expect(run.clock).toEqual({ from: new Date(START).toISOString(), to: new Date(START + 420_000).toISOString() });
    expect(clockLeak(run)).toBe('PASS');
    expect(statuses(test, run)).toEqual({ 'X-01.C1': 'PASS', 'X-01.C2': 'PASS', 'X-01.C3': 'PASS' });
  });

  it('atomic: realizes the gap from the last seed offset and records seed then turn events', async () => {
    const test = atomicTest({
      seed: {
        history: [
          { role: 'user', text: 'We ship on Friday.', atOffsetMs: 300_000 },
          { role: 'coach', text: 'What could get in the way?', atOffsetMs: 120_000 },
        ],
      },
      criteria: [
        criterion({ id: 'X-01.C1' }),
        criterion({
          id: 'X-01.C2',
          evaluatedAt: 'state',
          stateQuery: { name: 'outboundCount', at: 'after-step:1', kind: 'change' },
          checks: [{ type: 'rule', rule: 'state-equals', params: { query: 'outboundCount', at: 'after-step:1', expected: 2 } }],
          stateEffect: { port: 'conversationRepo', method: 'saveMessage', expected: 2 },
        }),
      ],
    });
    const run = await execute(test);

    expect(run.errors).toEqual([]);
    expect(run.preconditions).toEqual([expect.objectContaining({ source: 'fixture', name: 'seededHistory', satisfied: true })]);
    const [step] = run.steps;
    expect(step?.gapMs).toBe(120_000);
    const replyAt = Date.parse(step!.reply!.messages[0]!.occurredAt);
    expect(replyAt).toBe(START);
    expect(replyAt - (START - 120_000)).toBe(120_000);
    expect(run.clock?.from).toBe(new Date(START - 300_000).toISOString());

    // Seed writes at stepIndex 0, the turn's calls at stepIndex 1, all in call order.
    const seedEvents = run.events.filter((event) => event.stepIndex === 0);
    expect(seedEvents.map((event) => `${event.port}.${event.method}`)).toEqual(['conversationRepo.saveMessage', 'conversationRepo.saveMessage']);
    expect(run.events.map((event) => event.seq)).toEqual(run.events.map((_, position) => position));
    expect(run.events.map((event) => event.stepIndex)).toEqual([...run.events.map((event) => event.stepIndex)].sort((a, b) => a - b));
    const turnCalls = run.events.filter((event) => event.stepIndex === 1).map((event) => `${event.port}.${event.method}`);
    expect(turnCalls[0]).toBe('conversationRepo.saveMessage');
    expect(turnCalls).toEqual(
      expect.arrayContaining(['aiProvider.detectRisk', 'aiProvider.classifySituation', 'aiProvider.generateResponse', 'outbox.enqueueMessageSend']),
    );
    expect(turnCalls.indexOf('aiProvider.classifySituation')).toBeLessThan(turnCalls.indexOf('aiProvider.generateResponse'));
    expect(run.events.every((event) => event.durationMs === 0 && event.outcome === 'ok')).toBe(true);

    expect(run.state.before).toMatchObject({ outboundCount: 1 });
    expect(run.state.afterStep['1']).toMatchObject({ outboundCount: 2 });
    expect(clockLeak(run)).toBe('PASS');
    expect(statuses(test, run)).toEqual({ 'X-01.C1': 'PASS', 'X-01.C2': 'PASS' });
  });

  it('is deterministic: the same test yields the same run', async () => {
    const test = atomicTest({ seed: { history: [{ role: 'user', text: 'Hi.', atOffsetMs: 60_000 }] } });
    expect(await execute(test)).toEqual(await execute(test));
  });

  it('stop checkpoint: a failed checkpoint after step 1 sends nothing more', async () => {
    const test = journeyTest(3);
    // No bundle turn happens at L0 here, so `answer-then-bundle` FAILs on step 1.
    test.steps[0] = { ...test.steps[0]!, checkpoint: { checks: [{ type: 'rule', rule: 'answer-then-bundle' }], onFail: 'stop' } };
    const run = await execute(test);

    expect(run.stoppedAtStep).toBe(1);
    expect(run.steps).toHaveLength(1);
    expect(run.events.some((event) => event.stepIndex > 1)).toBe(false);
    expect(statuses(test, run)).toEqual({ 'X-01.C1': 'PASS', 'X-01.C2': 'INVALID checkpoint:1', 'X-01.C3': 'INVALID checkpoint:1' });
  });

  it('continue checkpoint: every step is still sent', async () => {
    const test = journeyTest(2);
    test.steps[0] = { ...test.steps[0]!, checkpoint: { checks: [{ type: 'rule', rule: 'answer-then-bundle' }], onFail: 'continue' } };
    const run = await execute(test);
    expect(run.stoppedAtStep).toBeUndefined();
    expect(run.steps).toHaveLength(2);
  });

  it('unsupported fixture: sends no turn and reports unsupported-fixture', async () => {
    const test = atomicTest({ setup: [{ name: 'pulseCycle' }] });
    const run = await execute(test);

    expect(run.steps).toEqual([]);
    expect(run.events).toEqual([]);
    expect(run.errors).toEqual([expect.objectContaining({ kind: 'infrastructure', step: 0, reason: 'unsupported-fixture:pulseCycle' })]);
    expect(statuses(test, run)).toEqual({ 'X-01.C1': 'NOT_RUN unsupported-fixture:pulseCycle' });
    // Nothing was stamped (no world was built): never a FAIL.
    expect(clockLeakOutcome(run).status).toBe('NOT_OBSERVABLE');
  });

  it('fixture apply failure: ends the case with fixture-apply:<name> at step 0', async () => {
    const throwing: FixtureModule<Record<string, never>> = {
      name: 'freshPersona',
      params: z.object({}).strict().default({}),
      create: () => ({
        apply: async () => {
          throw new Error('cannot write persona');
        },
        verify: async () => satisfied('freshPersona', true),
      }),
    };
    const executor = new L0DeterministicExecutor({ fixtures: { ...L0_FIXTURES, freshPersona: throwing } });
    const test = atomicTest({ setup: [{ name: 'freshPersona' }] });
    const run = await execute(test, executor);

    expect(run.steps).toEqual([]);
    expect(run.errors).toEqual([
      expect.objectContaining({ kind: 'infrastructure', step: 0, reason: 'fixture-apply:freshPersona', message: 'Error: cannot write persona' }),
    ]);
    expect(statuses(test, run)).toEqual({ 'X-01.C1': 'ERROR fixture-apply:freshPersona' });
    expect(clockLeakOutcome(run)).toEqual({ status: 'NOT_OBSERVABLE', evidence: 'no-messages' });
  });

  it('fixture params a fixture rejects are an apply failure', async () => {
    const test = atomicTest({ setup: [{ name: 'pendingBotQuestion', params: { atOffsetMs: 1000 } }] });
    const run = await execute(test);
    expect(run.errors).toEqual([expect.objectContaining({ reason: 'fixture-apply:pendingBotQuestion' })]);
  });

  it('verify false: records the failed precondition and the criteria are INVALID', async () => {
    // The seed answers the bot question, so it is no longer pending.
    const test = atomicTest({
      seed: { history: [{ role: 'user', text: 'Fine, thanks.', atOffsetMs: 30_000 }] },
      setup: [{ name: 'seededHistory' }, { name: 'pendingBotQuestion', params: { text: 'How was the week?', atOffsetMs: 60_000 } }],
    });
    const run = await execute(test);

    expect(run.preconditions).toContainEqual(expect.objectContaining({ source: 'fixture', name: 'pendingBotQuestion', satisfied: false }));
    expect(statuses(test, run)).toEqual({ 'X-01.C1': 'INVALID precondition:pendingBotQuestion' });
  });

  it('rule preconditions are evaluated after fixtures, before any step', async () => {
    const test = atomicTest({
      seed: { history: [{ role: 'coach', text: 'Earlier note.', atOffsetMs: 60_000 }] },
      preconditions: [{ type: 'rule', rule: 'state-equals', params: { query: 'outboundCount', at: 'before', expected: 0 } }],
    });
    const run = await execute(test);
    expect(run.preconditions).toContainEqual(expect.objectContaining({ source: 'rule', name: 'state-equals', satisfied: false }));
    expect(statuses(test, run)).toEqual({ 'X-01.C1': 'INVALID precondition:state-equals' });
  });

  it('missing scripted output: fails loudly instead of replying with a default', async () => {
    const test = atomicTest({ scripted: [{ step: 1, classification: {}, risk: {}, memoryProposal: {} }] });
    const run = await execute(test);

    expect(run.steps).toEqual([]);
    expect(run.errors).toEqual([expect.objectContaining({ kind: 'product', step: 1, reason: 'scripted-output-missing:1' })]);
    expect(statuses(test, run)).toEqual({ 'X-01.C1': 'ERROR scripted-output-missing:1' });
    expect(clockLeakOutcome(run)).toEqual({ status: 'NOT_OBSERVABLE', evidence: 'no-messages' });
  });

  it('missing scripted step: no entry for the step at all', async () => {
    const test = journeyTest(2, { scripted: [scriptedStep(1)] });
    const run = await execute(test);
    expect(run.steps).toHaveLength(1);
    expect(run.errors).toEqual([expect.objectContaining({ reason: 'scripted-output-missing:2', step: 2 })]);
    expect(statuses(test, run)).toEqual({ 'X-01.C1': 'PASS', 'X-01.C2': 'ERROR scripted-output-missing:2' });
  });

  it('P-06 window: drives the scheduler and check-ins over seven days', async () => {
    const test = observationTest();
    const run = await execute(test);

    expect(run.errors).toEqual([]);
    expect(run.steps).toEqual([]);
    expect(run.window?.from).toBe(new Date(START).toISOString());
    expect(run.window?.to).toBe(new Date(START + 7 * DAY).toISOString());
    const outbound = run.window!.outbound;
    expect(outbound.length).toBeGreaterThan(0);
    for (const message of outbound) {
      expect(message.metadata.messageType).toBe('proactive_check_in');
      expect(Date.parse(message.occurredAt)).toBeGreaterThanOrEqual(Date.parse(run.window!.from));
      expect(Date.parse(message.occurredAt)).toBeLessThanOrEqual(Date.parse(run.window!.to));
    }
    // Two-day gap from the scan config, first scan at 08:00 UTC (quiet hours end at 08).
    expect(outbound.map((message) => message.occurredAt)).toEqual([0, 2, 4, 6].map((days) => new Date(START + days * DAY).toISOString()));
    expect(run.events.some((event) => event.port === 'proactiveSchedulerRepo' && event.method === 'findCheckInCandidates')).toBe(true);
    expect(run.events.filter((event) => event.port === 'checkInQueue')).toHaveLength(4);
    expect(clockLeak(run)).toBe('PASS');
    // 08:00 UTC lies outside the suite's 09-18 working hours: the known red is a decided FAIL.
    expect(statuses(test, run)).toEqual({ 'P-06.C1': 'PASS', 'P-06.C2': 'PASS', 'P-06.C3': 'FAIL' });
  });

  it('P-06 window: quiet hours hold check-ins back to the first allowed scan', async () => {
    const test = observationTest({
      setup: [
        { name: 'clock', params: { start: '2026-01-05T00:30:00.000Z' } },
        { name: 'proactiveUsers', params: { ...PROACTIVE_USER, timezone: 'Europe/Berlin' } },
      ],
      observationWindow: { durationMs: DAY, scanEveryMs: HOUR },
    });
    const run = await execute(test);
    // Berlin is UTC+1 in January: quiet until 08:00 local = 07:00 UTC; scans run at hh:30.
    expect(run.window!.outbound.map((message) => message.occurredAt)).toEqual(['2026-01-05T07:30:00.000Z']);
  });

  it('confirmation bundle: the stateful question-confirmation fake stages a bundle the real orchestrator composes', async () => {
    const ready = (id: string, workingSummary: string) => ({
      surveyQuestionId: id,
      questionVersion: 'v1',
      questionGroup: 'belonging',
      workingSummary,
      status: 'ready' as const,
    });
    const test = atomicTest({
      id: 'P-10.A1',
      sourceCase: 'P-10',
      setup: [
        { name: 'disclosureDelivered', params: { text: 'Your reflections can be used in aggregated reporting.', atOffsetMs: 600_000 } },
        {
          name: 'confirmationState',
          params: {
            surveyWindowId: 'window-1',
            questions: [ready('q1', 'You feel part of the team.'), ready('q2', 'People include you.'), ready('q3', 'You can be yourself.')],
          },
        },
      ],
      seed: { history: [{ role: 'user', text: 'I feel part of this team and I can be myself.', atOffsetMs: 900_000 }] },
      scripted: [{ ...scriptedStep(1, 'The team meeting is on Tuesdays.'), classification: { dialogueAct: 'question' } }],
      steps: [{ text: 'When is the next team meeting?' }],
      criteria: [
        criterion({ id: 'P-10.C1', checks: [{ type: 'rule', rule: 'bundle-staged' }] }),
        criterion({ id: 'P-10.C2', checks: [{ type: 'rule', rule: 'answer-then-bundle' }] }),
        criterion({
          id: 'P-10.C3',
          evaluatedAt: 'state',
          stateQuery: { name: 'stagedBundleCount', at: 'after', kind: 'change' },
          checks: [{ type: 'rule', rule: 'state-equals', params: { query: 'stagedBundleCount', at: 'after', expected: 1 } }],
          stateEffect: { port: 'questionConfirmationRepo', method: 'stageQuestionConfirmationBundle', expected: 1 },
        }),
      ],
    });
    const run = await execute(test);

    expect(run.errors).toEqual([]);
    expect(run.preconditions.every((result) => result.satisfied)).toBe(true);
    expect(run.state.before).toMatchObject({ stagedBundleCount: 0 });
    expect(run.state.after).toMatchObject({ stagedBundleCount: 1 });
    expect(run.steps[0]?.turn?.bundleReply).toBe('answer_then_bundle');
    expect(clockLeak(run)).toBe('PASS');
    expect(statuses(test, run)).toEqual({ 'P-10.C1': 'PASS', 'P-10.C2': 'PASS', 'P-10.C3': 'PASS' });
  });

  it('atomic gap: measured from the latest fixture message when there is no seed', async () => {
    const test = atomicTest({ setup: [{ name: 'pendingBotQuestion', params: { text: 'How was the demo?', atOffsetMs: 90_000 } }] });
    const run = await execute(test);
    expect(run.errors).toEqual([]);
    expect(run.steps[0]?.gapMs).toBe(90_000);
  });

  it('atomic gap: the latest message wins over the last seed turn', async () => {
    const test = atomicTest({
      seed: { history: [{ role: 'user', text: 'Earlier.', atOffsetMs: 300_000 }] },
      setup: [{ name: 'seededHistory' }, { name: 'disclosureDelivered', params: { text: 'Disclosure.', atOffsetMs: 45_000 } }],
    });
    const run = await execute(test);
    expect(run.steps[0]?.gapMs).toBe(45_000);
  });

  it('stop checkpoint: a rule that cannot observe its input ends the case instead of passing', async () => {
    const test = journeyTest(3);
    // `no-greeting-restart` needs `reply.text`, which L0 never observes.
    test.steps[0] = { ...test.steps[0]!, checkpoint: { checks: [{ type: 'rule', rule: 'no-greeting-restart' }], onFail: 'stop' } };
    const run = await execute(test);
    expect(run.steps).toHaveLength(1);
    expect(run.stoppedAtStep).toBeUndefined();
    expect(run.errors).toEqual([
      expect.objectContaining({ kind: 'infrastructure', step: 1, reason: 'checkpoint-not-observable:no-greeting-restart' }),
    ]);
  });

  it('a rule that throws on its params is an infrastructure error with a CaseRun', async () => {
    const test = journeyTest(2);
    test.steps[0] = { ...test.steps[0]!, checkpoint: { checks: [{ type: 'rule', rule: 'state-equals', params: {} }], onFail: 'stop' } };
    const run = await execute(test);
    expect(run.steps).toHaveLength(1);
    expect(run.errors).toEqual([expect.objectContaining({ kind: 'infrastructure', step: 1, reason: 'rule-error:state-equals' })]);

    const precondition = atomicTest({ preconditions: [{ type: 'rule', rule: 'state-equals', params: { query: 'outboundCount' } }] });
    const preRun = await execute(precondition);
    expect(preRun.steps).toEqual([]);
    expect(preRun.errors).toEqual([expect.objectContaining({ kind: 'infrastructure', step: 0, reason: 'rule-error:state-equals' })]);
  });

  it('a state value failing its schema is an infrastructure error with a CaseRun', async () => {
    const spy = vi.spyOn(InMemoryQuestionConfirmationRepository.prototype, 'stagedBundleCount').mockReturnValue(-1);
    try {
      const run = await execute(atomicTest());
      expect(run.steps).toEqual([]);
      expect(run.errors).toEqual([expect.objectContaining({ kind: 'infrastructure', step: 0, reason: 'state-query:stagedBundleCount' })]);
    } finally {
      spy.mockRestore();
    }
  });

  it('observation without a proactiveUsers user reports proactive-users-missing', async () => {
    const run = await execute(observationTest({ setup: [{ name: 'clock' }] }));
    expect(run.window).toBeUndefined();
    expect(run.errors).toEqual([expect.objectContaining({ kind: 'infrastructure', step: 0, reason: 'proactive-users-missing' })]);
  });

  it('observation window keeps only proactive-type outbound messages', async () => {
    const test = observationTest();
    const world = createL0World(test, new Date(START));
    world.proactive.users.push(PROACTIVE_USER);
    // Every check-in generation also writes an unrelated outbound without a proactive type.
    const model = new ScriptedAiProvider();
    const generate = model.generateResponse.bind(model);
    model.generateResponse = async (...args) => {
      await world.state.conversationRepo.saveMessage({
        conversationId: SIM_CONVERSATION_ID, tenantId: SIM_TENANT_ID, userId: SIM_USER_ID, direction: 'outbound', text: 'Side note.',
      });
      return generate(...args);
    };
    const result = await driveObservationWindow({
      window: { durationMs: DAY, scanEveryMs: HOUR },
      clock: world.clock,
      sink: world.sink,
      world: world.proactive,
      ports: { ...world.ports, aiProvider: model, conversationState: world.state.conversationRepo },
    });
    expect(world.state.conversationRepo.messages.some((message) => message.text === 'Side note.')).toBe(true);
    expect(result.outbound).toHaveLength(1);
    expect(world.state.conversationRepo.sideFieldsOf(result.outbound[0]!.id).messageType).toBe('proactive_check_in');
  });

  it('observation: a recent user inbound holds the first check-in until minSilenceDays after it', async () => {
    const user: ProactiveUserSpec = {
      timezone: 'UTC',
      quietHours: { enabled: false },
      scan: { minSilenceDays: 3, minCheckInGapDays: 2, quietHoursEnabled: false },
    };
    const test = observationTest();
    const world = createL0World(test, new Date(START));
    world.proactive.users.push(user);
    await world.state.conversationRepo.saveMessage({
      conversationId: SIM_CONVERSATION_ID, tenantId: SIM_TENANT_ID, userId: SIM_USER_ID, direction: 'inbound',
      text: 'Busy week.', occurredAt: new Date(START - HOUR),
    });
    const result = await driveObservationWindow({
      window: { durationMs: 4 * DAY, scanEveryMs: HOUR },
      clock: world.clock,
      sink: world.sink,
      world: world.proactive,
      ports: { ...world.ports, conversationState: world.state.conversationRepo },
    });
    // Silence ends exactly 3 days after the inbound (07:00 on day 3), the first hourly scan at or after it.
    expect(result.outbound.map((message) => message.occurredAt.toISOString())).toEqual([new Date(START - HOUR + 3 * DAY).toISOString()]);
  });

  it('scheduler facts mirror the worker SQL for __init__ and proactive_check_in_request', async () => {
    const clock = new FixedClock(new Date(START));
    const conversations = new InMemoryConversationRepository(createSimConversation({ clock }), clock);
    const save = (direction: 'inbound' | 'outbound', text: string, offsetMs: number, messageType?: string) =>
      conversations.saveMessage({
        conversationId: SIM_CONVERSATION_ID, tenantId: SIM_TENANT_ID, userId: SIM_USER_ID, direction, text,
        occurredAt: new Date(START - offsetMs), ...(messageType ? { messageType } : {}),
      });
    const repo = new InMemoryProactiveSchedulerRepository({ users: [] }, conversations, clock);

    await save('outbound', 'Check-in.', 5 * HOUR, 'proactive_check_in');
    await save('inbound', '__init__', HOUR);
    // `__init__` neither counts as an inbound nor answers the check-in.
    expect(repo.facts()).toEqual({
      lastInboundAt: null,
      lastProactiveContactAt: new Date(START - 5 * HOUR),
      recentProactiveCount: 1,
      hasUnansweredProactive: true,
      inQaCadenceCohort: false,
    });

    await save('inbound', 'please check in', 2 * HOUR, 'proactive_check_in_request');
    // A system request is proactive contact and, like any inbound except `__init__`, an inbound.
    expect(repo.facts()).toMatchObject({
      lastInboundAt: new Date(START - 2 * HOUR),
      lastProactiveContactAt: new Date(START - 2 * HOUR),
      hasUnansweredProactive: false,
    });
  });

  it('runs a journey, an atomic and an observation test with every rule criterion decided', async () => {
    const tests = [journeyTest(2), atomicTest(), observationTest()];
    for (const test of tests) {
      const run = await execute(test);
      const results = evaluate(test, run, null, TRUST);
      for (const result of results) {
        expect(['PASS', 'FAIL'], `${test.id}/${result.criterionId}: ${result.status} ${result.reason ?? ''}`).toContain(result.status);
      }
      expect(clockLeak(run)).toBe('PASS');
    }
  });
});
