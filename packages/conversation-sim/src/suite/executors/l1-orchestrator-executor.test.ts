import { run as scenarioRun, type ScenarioConfig } from '@langwatch/scenario';
import { ProviderContentFilterError, type ConversationTurn, type SurveyQuestionForEvaluation } from '@entalent/application';
import type { SurveyEvidenceEvaluation } from '@entalent/contracts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { InMemoryConversationRepository } from '../../fakes/repositories';
import { ScriptedAiProvider, type ScriptedAiOptions } from '../../fakes/scripted-ai';
import { evaluate } from '../evaluate';
import { caseRunFailureKind } from '../runner';
import { CaseRunSchema, type CaseRun, type LoadedCriterion, type LoadedTest } from '../schema';
import { DEFAULT_L0_CLOCK_START } from './l0-deterministic-executor';
import { L1OrchestratorExecutor, guardCoachProvider, type L1ExecutorOptions } from './l1-orchestrator-executor';
import type { ExecutorOptions } from './types';
import { LANGWATCH_ENV_KEYS, withoutLangwatchEnv } from './__fixtures__/offline-scenario-env';
import { InMemoryQuestionConfirmationRepository } from '../../fakes/question-confirmation';

const TRUST = { trusted: false, reason: 'no-agreement', pin: null, agreement: null };
const OPTIONS: ExecutorOptions = { attempt: 1, interMessageGapMs: 60_000, suiteId: 'x-suite' };
const START = DEFAULT_L0_CLOCK_START.getTime();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const COACH = 'openai:gpt-4o-test';

function criterion(overrides: Partial<LoadedCriterion> & Pick<LoadedCriterion, 'id'>): LoadedCriterion {
  return { evaluatedAt: 'reply:1', checks: [{ type: 'rule', rule: 'reply-present' }], layer: 'P', passCondition: 'Suite text.', ...overrides };
}

function atomicTest(overrides: Partial<LoadedTest> = {}): LoadedTest {
  return {
    id: 'X-01.A1',
    sourceCase: 'X-01',
    requirement: ['REQ-1'],
    kind: 'atomic',
    levels: ['L1'],
    runProfile: 'isolated',
    setup: [],
    seed: { history: [] },
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
    levels: ['L1'],
    runProfile: 'isolated',
    setup: [{ name: 'clock' }],
    preconditions: [],
    steps: Array.from({ length: stepCount }, (_, index) => ({ text: `User step ${index + 1}.` })),
    criteria: Array.from({ length: stepCount }, (_, index) => criterion({ id: `X-01.C${index + 1}`, evaluatedAt: `reply:${index + 1}` })),
    ...overrides,
  };
}

const PULSE_CYCLE = {
  name: 'pulseCycle' as const,
  params: {
    surveyWindowId: 'window-1',
    questions: [
      { surveyQuestionId: 'q-autonomy-1', questionVersion: 'v2', questionGroup: 'autonomy', workingSummary: 'You choose your methods.', title: 'Choice of methods', status: 'pending' },
      { surveyQuestionId: 'q-autonomy-2', questionVersion: 'v2', questionGroup: 'autonomy', workingSummary: 'You set your pace.', title: 'Pace', status: 'confirmed' },
      { surveyQuestionId: 'q-growth-1', questionVersion: 'v2', questionGroup: 'growth', workingSummary: 'You are learning.', title: 'Learning', status: 'confirmed' },
    ],
    uncoveredTopics: [{ topic: 'autonomy', canonicalQuestions: ['How much say do you have over how you work?'] }],
  },
};

/** A scripted provider whose survey evaluation reports one strong evidence item per call. */
class EvidenceProvider extends ScriptedAiProvider {
  readonly evaluations: SurveyQuestionForEvaluation[][] = [];

  override async evaluateSurveyEvidence(_turns: ConversationTurn[], questions: SurveyQuestionForEvaluation[]): Promise<SurveyEvidenceEvaluation> {
    this.evaluations.push(questions);
    const question = questions.find((candidate) => candidate.id === 'q-autonomy-1');
    if (!question) return { candidateQuestionIds: [], evidence: [] };
    return {
      candidateQuestionIds: [question.id],
      evidence: [
        {
          questionId: question.id,
          evidenceSummary: 'Chooses their own methods.',
          polarity: 'positive',
          strength: 0.8,
          completeness: 0.8,
          confidence: 0.9,
          followUpProbeNeeded: false,
          thresholdReached: true,
          assessmentShouldRemainUnknown: false,
        },
      ],
    };
  }
}

function executor(overrides: Partial<L1ExecutorOptions> = {}, scripted: ScriptedAiOptions = {}): L1OrchestratorExecutor & { built: () => number } {
  let built = 0;
  const instance = new L1OrchestratorExecutor({
    createAiProvider: () => {
      built += 1;
      return new ScriptedAiProvider(scripted);
    },
    coachModel: COACH,
    ...overrides,
  });
  return Object.assign(instance, { built: () => built });
}

async function execute(test: LoadedTest, l1: L1OrchestratorExecutor = executor(), options = OPTIONS): Promise<CaseRun> {
  const run = await l1.run(test, options);
  CaseRunSchema.parse(run);
  return run;
}

function statuses(test: LoadedTest, run: CaseRun): Record<string, string> {
  return Object.fromEntries(
    evaluate(test, run, null, TRUST).map((result) => [result.criterionId, `${result.status}${result.reason ? ` ${result.reason}` : ''}`]),
  );
}

describe('L1OrchestratorExecutor', () => {
  withoutLangwatchEnv();

  it('declares L1, every fixture, its coach model and its observation fields', () => {
    const l1 = executor();
    expect(l1.level).toBe('L1');
    expect(l1.coachModel).toBe(COACH);
    for (const name of ['clock', 'seededHistory', 'confirmationState', 'pulseCycle', 'pendingBotQuestion', 'freshPersona', 'disclosureDelivered', 'proactiveUsers'] as const) {
      expect(l1.supports(name), name).toBe(true);
    }
    expect(l1.observes()).toEqual(
      expect.arrayContaining([
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
        'window.outbound',
        'events',
      ]),
    );
    expect(l1.built()).toBe(0);
  });

  it('atomic: one turn through the real orchestrator, reply attributed by traceId, AI events carry the model record', async () => {
    const l1 = executor({}, { responses: [{ text: 'Which deadline matters most?', confidence: 0.9, containsSurveyProbe: false }] });
    const test = atomicTest({
      seed: { history: [{ role: 'coach', text: 'Morning. How is the week?', atOffsetMs: 120_000 }] },
    });
    const run = await execute(test, l1);

    expect(run.errors).toEqual([]);
    expect(run.subject.externalUserId).toBe('l1-X-01.A1');
    expect(run.observed).toContain('reply.text');
    expect(run.steps).toHaveLength(1);
    const [step] = run.steps;
    expect(step?.gapMs).toBe(120_000);
    expect(step?.reply?.text).toBe('Which deadline matters most?');
    expect(step?.unsolicited).toEqual([]);
    expect(step?.turn).toMatchObject({ intent: 'casual_conversation', mode: expect.any(String) });

    const ai = run.events.filter((event) => event.port === 'aiProvider');
    expect(ai.map((event) => event.method)).toEqual(expect.arrayContaining(['detectRisk', 'classifySituation', 'generateResponse']));
    for (const event of ai) expect(event.model).toMatchObject({ name: COACH, settings: {} });
    const generate = ai.find((event) => event.method === 'generateResponse')!;
    expect(generate.model?.response).toMatchObject({ text: 'Which deadline matters most?' });
    expect(Array.isArray(generate.model?.request)).toBe(true);
    expect(run.events.filter((event) => event.port !== 'aiProvider').every((event) => event.model === undefined)).toBe(true);
    expect(run.state.before).toEqual({ questionProgress: { answered: 0, total: 0 }, stagedBundleCount: 0, surveyEvidenceCount: 0, outboundCount: 1 });
    expect(run.state.after).toMatchObject({ outboundCount: 2 });
    expect(statuses(test, run)).toEqual({ 'X-01.C1': 'PASS' });
    expect(l1.built()).toBe(1);
  });

  it('journey: realizes the suite gap plus advanceClock and sends every step', async () => {
    const test = journeyTest(3);
    test.steps[1] = { ...test.steps[1]!, advanceClock: 300_000 };
    const run = await execute(test);

    expect(run.errors).toEqual([]);
    expect(run.steps.map((step) => step.index)).toEqual([1, 2, 3]);
    expect(run.steps.map((step) => step.gapMs)).toEqual([0, 360_000, 60_000]);
    expect(run.steps.map((step) => step.reply?.messages[0]?.occurredAt)).toEqual([
      new Date(START).toISOString(),
      new Date(START + 360_000).toISOString(),
      new Date(START + 420_000).toISOString(),
    ]);
    expect(new Set(run.steps.map((step) => step.traceId)).size).toBe(3);
    expect(run.clock).toEqual({ from: new Date(START).toISOString(), to: new Date(START + 420_000).toISOString() });
    expect(statuses(test, run)).toEqual({ 'X-01.C1': 'PASS', 'X-01.C2': 'PASS', 'X-01.C3': 'PASS' });
  });

  it('stop checkpoint: a failed rule after step 1 ends the script before step 2', async () => {
    const test = journeyTest(2);
    test.steps[0] = { ...test.steps[0]!, checkpoint: { checks: [{ type: 'rule', rule: 'answer-then-bundle' }], onFail: 'stop' } };
    const run = await execute(test);

    expect(run.stoppedAtStep).toBe(1);
    expect(run.steps).toHaveLength(1);
    expect(run.events.some((event) => event.stepIndex > 1)).toBe(false);
    expect(statuses(test, run)).toEqual({ 'X-01.C1': 'PASS', 'X-01.C2': 'INVALID checkpoint:1' });
  });

  it('turn throws: a product agent-turn-error at step 1, no step 2 and no retry', async () => {
    const l1 = executor({}, {
      classifications: [
        () => {
          throw new TypeError('classifier exploded');
        },
      ],
    });
    const test = journeyTest(2);
    const run = await execute(test, l1);

    expect(run.steps).toEqual([]);
    expect(run.errors).toEqual([expect.objectContaining({ kind: 'product', step: 1, reason: 'agent-turn-error' })]);
    expect(run.events.some((event) => event.stepIndex > 1)).toBe(false);
    expect(caseRunFailureKind(run)).toBe('product');
    expect(statuses(test, run)).toEqual({ 'X-01.C1': 'ERROR agent-turn-error', 'X-01.C2': 'ERROR agent-turn-error' });
  });

  it('silence: no outbound under the trace is reply null with turn.outcome, evaluated rather than ERROR', async () => {
    const l1 = executor({}, {
      classifications: [
        () => {
          throw new ProviderContentFilterError('input');
        },
      ],
    });
    // The filtered-input explanation is saved under a foreign trace, so the turn's own trace has no outbound.
    const original = InMemoryConversationRepository.prototype.sideFieldsOf;
    const spy = vi.spyOn(InMemoryConversationRepository.prototype, 'sideFieldsOf').mockImplementation(function (this: InMemoryConversationRepository, id: string) {
      const fields = original.call(this, id);
      return fields.traceId ? { ...fields, traceId: `foreign-${fields.traceId}` } : fields;
    });
    try {
      const test = atomicTest();
      const run = await execute(test, l1);
      expect(run.errors).toEqual([]);
      expect(run.steps[0]?.reply).toBeNull();
      expect(run.steps[0]?.turn?.outcome).toBe('input_filtered');
      expect(run.steps[0]?.unsolicited).toHaveLength(1);
      expect(statuses(test, run)).toEqual({ 'X-01.C1': 'FAIL' });
    } finally {
      spy.mockRestore();
    }
  });

  it('pulseCycle: the precondition holds and questionProgress reads the first uncovered topic group', async () => {
    const test = atomicTest({ setup: [PULSE_CYCLE] });
    const run = await execute(test);
    expect(run.errors).toEqual([]);
    expect(run.preconditions).toContainEqual(expect.objectContaining({ name: 'pulseCycle', satisfied: true }));
    expect(run.state.before.questionProgress).toEqual({ answered: 1, total: 2 });
  });

  it('pulseCycle with confirmationState: fixture-apply:pulseCycle', async () => {
    const confirmation = {
      name: 'confirmationState' as const,
      params: {
        surveyWindowId: 'window-1',
        questions: [{ surveyQuestionId: 'q1', questionVersion: 'v1', questionGroup: 'autonomy', workingSummary: 'S.', status: 'ready' }],
      },
    };
    for (const setup of [[confirmation, PULSE_CYCLE], [PULSE_CYCLE, confirmation]]) {
      const run = await execute(atomicTest({ setup }));
      expect(run.steps).toEqual([]);
      expect(run.errors).toEqual([expect.objectContaining({ kind: 'infrastructure', step: 0, reason: 'fixture-apply:pulseCycle' })]);
    }
  });

  it('survey evidence: the orchestrator enqueues it, the inline outbox extracts it, surveyEvidenceCount grows', async () => {
    const provider = new EvidenceProvider();
    const l1 = new L1OrchestratorExecutor({ createAiProvider: () => provider, coachModel: COACH });
    const test = atomicTest({
      setup: [PULSE_CYCLE],
      criteria: [
        criterion({
          id: 'X-01.C1',
          evaluatedAt: 'state',
          stateQuery: { name: 'surveyEvidenceCount', at: 'after', kind: 'change' },
          checks: [{ type: 'rule', rule: 'state-equals', params: { query: 'surveyEvidenceCount', at: 'after', expected: 1 } }],
          stateEffect: { port: 'surveyRepo', method: 'saveEvidence', expected: 1 },
        }),
      ],
    });
    const run = await execute(test, l1);

    expect(run.errors).toEqual([]);
    expect(provider.evaluations.length).toBeGreaterThan(0);
    expect(run.state.before.surveyEvidenceCount).toBe(0);
    expect(run.state.after.surveyEvidenceCount).toBe(1);
    expect(run.events.some((event) => event.port === 'outbox' && event.method === 'enqueueSurveyEvidence')).toBe(true);
    expect(run.events.some((event) => event.port === 'surveyRepo' && event.method === 'saveEvidence' && event.stepIndex === 1)).toBe(true);
    const results = evaluate(test, run, null, TRUST);
    expect(results).toEqual([expect.objectContaining({ criterionId: 'X-01.C1', status: 'PASS', method: 'substituted' })]);
  });

  it('state criteria at L1 are substituted and paired with the synthesized effect-count', async () => {
    const test = atomicTest({
      criteria: [
        criterion({ id: 'X-01.C1' }),
        criterion({
          id: 'X-01.C2',
          evaluatedAt: 'state',
          stateQuery: { name: 'outboundCount', at: 'after-step:1', kind: 'change' },
          checks: [{ type: 'rule', rule: 'state-equals', params: { query: 'outboundCount', at: 'after-step:1', expected: 1 } }],
          stateEffect: { port: 'conversationRepo', method: 'saveMessage', expected: 3 },
        }),
      ],
    });
    const run = await execute(test);
    expect(run.state.afterStep['1']).toMatchObject({ outboundCount: 1 });
    const results = Object.fromEntries(evaluate(test, run, null, TRUST).map((result) => [result.criterionId, result]));
    expect(results['X-01.C1']).toMatchObject({ status: 'PASS', method: 'n/a' });
    // Two saves happen (inbound, outbound), so the paired effect-count of 3 FAILs the criterion.
    expect(results['X-01.C2']).toMatchObject({ status: 'FAIL', method: 'substituted' });
  });

  it('P-06: check-in generation runs on the injected provider and fills window.outbound', async () => {
    const provider = new ScriptedAiProvider();
    const generate = vi.spyOn(provider, 'generateResponse');
    const l1 = new L1OrchestratorExecutor({ createAiProvider: () => provider, coachModel: COACH });
    const test: LoadedTest = {
      id: 'P-06',
      sourceCase: 'P-06',
      requirement: ['CF-003'],
      kind: 'observation',
      levels: ['L1'],
      runProfile: 'isolated',
      setup: [
        { name: 'clock' },
        {
          name: 'proactiveUsers',
          params: {
            timezone: 'UTC',
            quietHours: { enabled: true, startHour: 22, endHour: 8 },
            scan: { minSilenceDays: 3, minCheckInGapDays: 2, quietHoursEnabled: true },
          },
        },
      ],
      preconditions: [],
      steps: [],
      observationWindow: { durationMs: 7 * DAY, scanEveryMs: HOUR },
      criteria: [criterion({ id: 'P-06.C1', evaluatedAt: 'observation-window', checks: [{ type: 'rule', rule: 'proactive-initiated' }] })],
    };
    const run = await execute(test, l1);
    expect(run.errors).toEqual([]);
    expect(run.observed).toContain('window.outbound');
    expect(run.window?.outbound.map((message) => message.occurredAt)).toEqual([0, 2, 4, 6].map((days) => new Date(START + days * DAY).toISOString()));
    expect(generate).toHaveBeenCalled();
    expect(run.events.filter((event) => event.port === 'aiProvider').every((event) => event.model?.name === COACH)).toBe(true);
    expect(statuses(test, run)).toEqual({ 'P-06.C1': 'PASS' });

    const missing = await execute({ ...test, setup: [{ name: 'clock' }] }, l1);
    expect(missing.errors).toEqual([expect.objectContaining({ reason: 'proactive-users-missing' })]);
  });

  it('drives one Scenario run per conversation test with the suite set id, the coach agent and the LangWatch key', async () => {
    const seen: ScenarioConfig[] = [];
    const spy = vi.fn(async (cfg: ScenarioConfig) => {
      seen.push(cfg);
      // Never stream in tests: the real driver runs with an empty key.
      return scenarioRun({ ...cfg, langwatch: { apiKey: '' } });
    });
    const keyed = executor({ runScenario: spy as unknown as typeof scenarioRun, langwatch: { apiKey: 'lw-test-key', endpoint: 'https://langwatch.example' } });
    const test = journeyTest(2);
    const withKey = await execute(test, keyed);
    const withoutKey = await execute(test, executor());

    expect(spy).toHaveBeenCalledTimes(1);
    const [cfg] = seen;
    expect(cfg).toMatchObject({
      name: 'X-01.J',
      setId: 'entalent-suite-x-suite',
      maxTurns: 3,
      langwatch: { apiKey: 'lw-test-key', endpoint: 'https://langwatch.example' },
    });
    // The coach agent plus a passive User-role adapter Scenario needs for fixed user texts; no judge.
    expect(cfg!.agents.map((agent) => agent.role)).toEqual(['User', 'Agent']);
    await expect(cfg!.agents[0]!.call({} as never)).rejects.toThrow('never asked to generate');
    // Per step: gap, user, agent, record; then succeed.
    expect(cfg!.script).toHaveLength(2 * 4 + 1);
    expect(withKey).toEqual(withoutKey);

    const unnamed = executor({ runScenario: spy as unknown as typeof scenarioRun });
    await execute(atomicTest(), unnamed, { attempt: 1, interMessageGapMs: 60_000 });
    expect(seen[1]).toMatchObject({ setId: 'entalent-suite-unknown', langwatch: { apiKey: '' } });
    expect(seen[1]!.langwatch).not.toHaveProperty('endpoint');
  });

  it('a Scenario driver failure is an infrastructure error with a CaseRun', async () => {
    const l1 = executor({ runScenario: (async () => { throw new Error('driver down'); }) as unknown as typeof scenarioRun });
    const run = await execute(atomicTest(), l1);
    expect(run.errors).toEqual([expect.objectContaining({ kind: 'infrastructure', reason: 'scenario-driver-error' })]);
  });

  it('builds a fresh world and provider per attempt, and an unsupported fixture sends nothing', async () => {
    const l1 = executor();
    const test = atomicTest();
    const first = await execute(test, l1);
    const second = await execute(test, l1, { ...OPTIONS, attempt: 2 });
    expect(l1.built()).toBe(2);
    expect(second.attempt).toBe(2);
    expect({ ...second, attempt: 1 }).toEqual(first);

    const limited = executor({ fixtures: {} });
    const run = await execute(atomicTest({ setup: [{ name: 'pulseCycle', params: PULSE_CYCLE.params }] }), limited);
    expect(run.errors).toEqual([expect.objectContaining({ reason: 'unsupported-fixture:pulseCycle' })]);
    expect(limited.built()).toBe(0);
  });

  it('never reads process.env (its own module and the shared executor helpers)', () => {
    for (const file of ['l1-orchestrator-executor.ts', 'shared.ts', join('..', 'fixtures', 'state-queries.ts'), join('..', 'fixtures', 'pulse-cycle.ts')]) {
      expect(readFileSync(join(__dirname, file), 'utf8'), file).not.toMatch(/process\.env/);
    }
  });
  it('runs Scenario with the LangWatch variables cleared from process.env', async () => {
    const seen: Array<Record<string, string | undefined>> = [];
    const spy = (async (cfg: ScenarioConfig) => {
      seen.push(Object.fromEntries(LANGWATCH_ENV_KEYS.map((key) => [key, process.env[key]])));
      return scenarioRun(cfg);
    }) as unknown as typeof scenarioRun;
    await execute(atomicTest(), executor({ runScenario: spy }));
    expect(seen).toEqual([{ LANGWATCH_API_KEY: undefined, LANGWATCH_ENDPOINT: undefined }]);
  });

  it('a Scenario run that ends early without throwing is an infrastructure scenario-incomplete error', async () => {
    // Runs only step 1's four script steps, then returns (no succeed, no throw).
    const truncated = (async (cfg: ScenarioConfig) => scenarioRun({ ...cfg, script: cfg.script!.slice(0, 4) })) as unknown as typeof scenarioRun;
    const test = journeyTest(2);
    const run = await execute(test, executor({ runScenario: truncated }));
    expect(run.steps).toHaveLength(1);
    expect(run.errors).toEqual([expect.objectContaining({ kind: 'infrastructure', step: 2, reason: 'scenario-incomplete' })]);
    expect(statuses(test, run)).toEqual({ 'X-01.C1': 'PASS', 'X-01.C2': 'ERROR scenario-incomplete' });
  });

  it('a stop checkpoint whose rule throws on its params is an infrastructure rule-error at step 1', async () => {
    const test = journeyTest(2);
    test.steps[0] = { ...test.steps[0]!, checkpoint: { checks: [{ type: 'rule', rule: 'state-equals', params: {} }], onFail: 'stop' } };
    const run = await execute(test);
    expect(run.steps).toHaveLength(1);
    expect(run.errors).toEqual([expect.objectContaining({ kind: 'infrastructure', step: 1, reason: 'rule-error:state-equals' })]);
    expect(run.events.some((event) => event.stepIndex > 1)).toBe(false);
  });

  it('a stop checkpoint that cannot observe its input ends the case without sending step 2', async () => {
    const test = journeyTest(2);
    // `proactive-initiated` needs `window.outbound`, which a conversation test never observes.
    test.steps[0] = { ...test.steps[0]!, checkpoint: { checks: [{ type: 'rule', rule: 'proactive-initiated' }], onFail: 'stop' } };
    const run = await execute(test);
    expect(run.steps).toHaveLength(1);
    expect(run.stoppedAtStep).toBeUndefined();
    expect(run.errors).toEqual([expect.objectContaining({ kind: 'infrastructure', step: 1, reason: 'checkpoint-not-observable:proactive-initiated' })]);
    expect(run.events.some((event) => event.stepIndex > 1)).toBe(false);
  });

  it('a state value failing its schema is an infrastructure state-query error, before and inside the script', async () => {
    const before = vi.spyOn(InMemoryQuestionConfirmationRepository.prototype, 'stagedBundleCount').mockReturnValue(-1);
    try {
      const run = await execute(atomicTest());
      expect(run.steps).toEqual([]);
      expect(run.errors).toEqual([expect.objectContaining({ kind: 'infrastructure', step: 0, reason: 'state-query:stagedBundleCount' })]);
    } finally {
      before.mockRestore();
    }

    // Valid at `before`, invalid at the after-step:1 snapshot the recording script step reads.
    const inScript = vi.spyOn(InMemoryQuestionConfirmationRepository.prototype, 'stagedBundleCount').mockReturnValueOnce(0).mockReturnValue(-1);
    try {
      const test = atomicTest({
        criteria: [
          criterion({
            id: 'X-01.C1',
            evaluatedAt: 'state',
            stateQuery: { name: 'stagedBundleCount', at: 'after-step:1', kind: 'invariant' },
            checks: [{ type: 'rule', rule: 'state-equals', params: { query: 'stagedBundleCount', at: 'after-step:1', expected: 0 } }],
          }),
        ],
      });
      const run = await execute(test);
      expect(run.steps).toHaveLength(1);
      expect(run.errors).toEqual([expect.objectContaining({ kind: 'infrastructure', step: 1, reason: 'state-query:stagedBundleCount' })]);
    } finally {
      inScript.mockRestore();
    }
  });

  it('a false disclosureDelivered verify (saved, never delivered) makes every criterion INVALID', async () => {
    const delivery = vi.spyOn(InMemoryConversationRepository.prototype, 'updateMessageDelivery').mockResolvedValue(undefined as never);
    try {
      const test = atomicTest({ setup: [{ name: 'disclosureDelivered', params: { text: 'Your reflections are aggregated.', atOffsetMs: 600_000 } }] });
      const run = await execute(test);
      expect(run.preconditions).toContainEqual(
        expect.objectContaining({ source: 'fixture', name: 'disclosureDelivered', satisfied: false, detail: 'no delivered disclosure' }),
      );
      expect(statuses(test, run)).toEqual({ 'X-01.C1': 'INVALID precondition:disclosureDelivered' });
    } finally {
      delivery.mockRestore();
    }
  });
});

describe('L1OrchestratorExecutor: call budget and coach timeout (Story 13.5)', () => {
  withoutLangwatchEnv();
  const REPLY = { text: 'Which deadline matters most?', confidence: 0.9, containsSurveyProbe: false };

  /** Allows `allow` coach calls, then refuses; `asked` counts every reservation attempt. */
  function budget(allow: number) {
    let reserved = 0;
    let asked = 0;
    return {
      tryCoachCall: () => {
        asked += 1;
        if (reserved >= allow) return false;
        reserved += 1;
        return true;
      },
      reserved: () => reserved,
      asked: () => asked,
    };
  }

  it('reserves one budget call per provider call and behaves as before under budget', async () => {
    const hook = budget(100);
    const run = await execute(atomicTest(), executor({}, { responses: [REPLY] }), { ...OPTIONS, budget: hook, coachCallTimeoutMs: 60_000 });
    expect(run.errors).toEqual([]);
    expect(run.steps[0]?.reply?.text).toBe(REPLY.text);
    const ai = run.events.filter((event) => event.port === 'aiProvider');
    expect(hook.reserved()).toBe(ai.length);
    expect(ai.length).toBeGreaterThan(0);
  });

  it('a refused call the orchestrator swallowed (reply already saved) still ends the case as ERROR budget-exceeded', async () => {
    const baseline = await execute(atomicTest(), executor({}, { responses: [REPLY] }));
    const total = baseline.events.filter((event) => event.port === 'aiProvider').length;
    // Refuse only the last call of the turn (post-reply memory extraction, swallowed by the orchestrator).
    const hook = budget(total - 1);
    const test = atomicTest();
    const run = await execute(test, executor({}, { responses: [REPLY] }), { ...OPTIONS, budget: hook });

    expect(run.state.after.outboundCount).toBe(baseline.state.after.outboundCount);
    expect(run.errors).toEqual([{ kind: 'product', step: 1, reason: 'budget-exceeded', message: 'coach call budget spent' }]);
    expect(run.steps).toEqual([]);
    const refused = run.events.filter((event) => event.port === 'aiProvider').at(-1)!;
    expect(refused).toMatchObject({ outcome: 'error' });
    expect(refused.resultSummary).toContain('coach call budget spent');
    expect(caseRunFailureKind(run)).toBe('product');
    expect(statuses(test, run)).toEqual({ 'X-01.C1': 'ERROR budget-exceeded' });
  });

  it('a refused first call (swallowed risk detection, then a refused classification) is ERROR budget-exceeded at step 1', async () => {
    const run = await execute(journeyTest(2), executor({}, { responses: [REPLY] }), { ...OPTIONS, budget: budget(0) });
    expect(run.errors).toEqual([expect.objectContaining({ kind: 'product', step: 1, reason: 'budget-exceeded' })]);
    expect(run.steps).toEqual([]);
    expect(run.events.some((event) => event.stepIndex > 1)).toBe(false);
  });

  it('a stalled coach call times out: ERROR infrastructure coach-timeout, retried by the runner', async () => {
    const stalled = new ScriptedAiProvider({ responses: [REPLY] });
    vi.spyOn(stalled, 'generateResponse').mockImplementation(() => new Promise(() => undefined));
    const l1 = new L1OrchestratorExecutor({ createAiProvider: () => stalled, coachModel: COACH });
    const run = await execute(atomicTest(), l1, { ...OPTIONS, coachCallTimeoutMs: 20 });

    expect(run.errors).toEqual([{ kind: 'infrastructure', step: 1, reason: 'coach-timeout', message: 'coach call request timed out after 20 ms' }]);
    expect(run.steps).toEqual([]);
    const timedOut = run.events.find((event) => event.port === 'aiProvider' && event.method === 'generateResponse')!;
    expect(timedOut.outcome).toBe('error');
    expect(timedOut.resultSummary).toContain('request timed out');
    expect(caseRunFailureKind(run)).toBe('infrastructure');
  });

  it('a stalled check-in generation in the observation window is coach-timeout without a window', async () => {
    const stalled = new ScriptedAiProvider();
    vi.spyOn(stalled, 'generateResponse').mockImplementation(() => new Promise(() => undefined));
    const l1 = new L1OrchestratorExecutor({ createAiProvider: () => stalled, coachModel: COACH });
    const test: LoadedTest = {
      id: 'P-06',
      sourceCase: 'P-06',
      requirement: ['CF-003'],
      kind: 'observation',
      levels: ['L1'],
      runProfile: 'isolated',
      setup: [
        { name: 'clock' },
        {
          name: 'proactiveUsers',
          params: {
            timezone: 'UTC',
            quietHours: { enabled: true, startHour: 22, endHour: 8 },
            scan: { minSilenceDays: 3, minCheckInGapDays: 2, quietHoursEnabled: true },
          },
        },
      ],
      preconditions: [],
      steps: [],
      observationWindow: { durationMs: 2 * DAY, scanEveryMs: HOUR },
      criteria: [criterion({ id: 'P-06.C1', evaluatedAt: 'observation-window', checks: [{ type: 'rule', rule: 'proactive-initiated' }] })],
    };
    const run = await execute(test, l1, { ...OPTIONS, coachCallTimeoutMs: 20 });
    expect(run.errors).toEqual([expect.objectContaining({ kind: 'infrastructure', step: 0, reason: 'coach-timeout' })]);
    expect(run.window).toBeUndefined();
  });

  it('after a timeout, later calls in the same turn reject at once without calling the target or reserving budget', async () => {
    const stalled = new ScriptedAiProvider({ responses: [REPLY] });
    const risk = vi.spyOn(stalled, 'detectRisk').mockImplementation(() => new Promise(() => undefined));
    const classify = vi.spyOn(stalled, 'classifySituation');
    const hook = budget(100);
    const guard = guardCoachProvider(stalled, { budget: hook, coachCallTimeoutMs: 20 });
    await expect(guard.provider.detectRisk([], {} as never)).rejects.toThrow('request timed out');
    expect(hook.asked()).toBe(1);
    const started = Date.now();
    await expect(guard.provider.classifySituation([], {} as never)).rejects.toThrow('skipped: an earlier coach call request timed out');
    expect(Date.now() - started).toBeLessThan(15);
    expect(classify).not.toHaveBeenCalled();
    expect(risk).toHaveBeenCalledTimes(1);
    expect(hook.asked()).toBe(1);
    expect(guard.endCase(1)).toMatchObject({ reason: 'coach-timeout' });
  });

  it('after a refused call, later calls reject at once without asking the budget again', async () => {
    const provider = new ScriptedAiProvider({ responses: [REPLY] });
    const classify = vi.spyOn(provider, 'classifySituation');
    const hook = budget(0);
    const guard = guardCoachProvider(provider, { budget: hook });
    await expect(guard.provider.detectRisk([], {} as never)).rejects.toThrow('coach call budget spent');
    await expect(guard.provider.classifySituation([], {} as never)).rejects.toThrow('skipped: an earlier coach call was refused by the budget');
    expect(hook.asked()).toBe(1);
    expect(classify).not.toHaveBeenCalled();
  });

  it('without a budget or timeout the provider is not wrapped', async () => {
    const provider = new ScriptedAiProvider();
    const guard = guardCoachProvider(provider, {});
    expect(guard.provider).toBe(provider);
    expect(guard.endCase(1)).toBeNull();
    const run = await execute(atomicTest(), executor({}, { responses: [REPLY] }));
    expect(run.errors).toEqual([]);
    expect(run.steps).toHaveLength(1);
  });
});
