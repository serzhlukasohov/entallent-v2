import { describe, expect, it } from 'vitest';
import { evaluate } from '../evaluate';
import { fakeJudge } from '../judge/__fixtures__/calibration';
import { labelsSha256 } from '../judge/calibrate';
import { RUNNER_CONFIG } from '../__fixtures__/runner';
import { runSuite } from '../runner';
import { CaseRunSchema, type CaseRun, type LoadedCriterion, type LoadedTest } from '../schema';
import { DevApiClient } from './dev-api-client';
import { FakeStack, KEY, RUN_ID, T0, TENANT, WORKER_ENV, l2JourneySuite, type Out } from './__fixtures__/fake-dev-stack';
import { L2ApplicationExecutor } from './l2-application-executor';
import type { ExecutorOptions } from './types';

const TRUST = { trusted: false, reason: 'no-agreement', pin: null, agreement: null };
const OPTIONS: ExecutorOptions = { attempt: 1, interMessageGapMs: 60_000, runId: RUN_ID, sample: 1 };

function criterion(overrides: Partial<LoadedCriterion> & Pick<LoadedCriterion, 'id'>): LoadedCriterion {
  return { evaluatedAt: 'reply:1', checks: [{ type: 'rule', rule: 'reply-present' }], layer: 'P', passCondition: 'Suite text.', ...overrides };
}

function journey(stepCount: number, overrides: Partial<LoadedTest> = {}): LoadedTest {
  return {
    id: 'X-10.J',
    sourceCase: 'X-10',
    requirement: ['REQ-1'],
    kind: 'journey',
    levels: ['L2'],
    runProfile: 'isolated',
    setup: [],
    preconditions: [],
    steps: Array.from({ length: stepCount }, (_, index) => ({ text: `User step ${index + 1}.` })),
    criteria: Array.from({ length: stepCount }, (_, index) => criterion({ id: `X-10.C${index + 1}`, evaluatedAt: `reply:${index + 1}` })),
    ...overrides,
  };
}

const reply = (text: string): Out[] => [{ text }];

async function execute(stack: FakeStack, test: LoadedTest, options: ExecutorOptions = OPTIONS): Promise<CaseRun> {
  const run = await stack.executor().run(test, options);
  // Every run the executor returns is a valid CaseRun.
  return CaseRunSchema.parse(run);
}

describe('L2ApplicationExecutor', () => {
  it('declares L2, journeys only, three verify-only fixtures, no coach model and no events', () => {
    const l2 = new FakeStack().executor();
    expect(l2.level).toBe('L2');
    expect(l2.coachModel).toBeNull();
    expect(['freshPersona', 'pulseCycle', 'disclosureDelivered'].every((name) => l2.supports(name as never))).toBe(true);
    for (const name of ['seededHistory', 'confirmationState', 'clock', 'pendingBotQuestion', 'proactiveUsers']) {
      expect(l2.supports(name as never)).toBe(false);
    }
    expect(l2.observes()).toEqual([
      'reply.text',
      'reply.messages',
      'steps.gapMs',
      'state.questionProgress',
      'state.stagedBundleCount',
      'state.surveyEvidenceCount',
      'state.outboundCount',
    ]);
  });

  it('happy journey: isolates a fresh persona, sends each step, attributes replies by traceId and reads state', async () => {
    const stack = new FakeStack({ steps: [{ polls: [reply('Morning. What is on your plate?')] }, { polls: [[], reply('Which one is riskier?')] }] });
    const test = journey(2, {
      criteria: [
        criterion({ id: 'X-10.C1' }),
        criterion({
          id: 'X-10.C2',
          evaluatedAt: 'state',
          stateQuery: { name: 'outboundCount', at: 'after-step:1', kind: 'change' },
          checks: [{ type: 'rule', rule: 'state-equals', params: { query: 'outboundCount', at: 'after-step:1', expected: 1 } }],
          stateEffect: { port: 'conversationRepo', method: 'saveMessage', expected: 99 },
        }),
      ],
    });
    const run = await execute(stack, test);

    expect(run.errors).toEqual([]);
    expect(run.subject).toEqual({ externalUserId: `suite-${RUN_ID}-X-10.J`, userId: 'user-1', conversationId: 'conv-1', tenantId: TENANT });
    expect(run.steps.map((step) => [step.index, step.traceId, step.gapMs, step.reply?.text ?? null, step.unsolicited.length])).toEqual([
      [1, 'trace-1', 0, 'Morning. What is on your plate?', 0],
      [2, 'trace-2', 60_000, 'Which one is riskier?', 0],
    ]);
    expect(run.steps[0]!.reply!.messages[0]).toEqual({ id: 'm-2', text: 'Morning. What is on your plate?', occurredAt: new Date(T0 + 2_000).toISOString(), metadata: {} });
    expect(run.state.before).toEqual({ questionProgress: { answered: 0, total: 0 }, stagedBundleCount: 0, surveyEvidenceCount: 0, outboundCount: 0 });
    expect(run.state.afterStep).toEqual({ '1': expect.objectContaining({ outboundCount: 1 }) });
    expect(run.state.after.outboundCount).toBe(2);
    expect(run.events).toEqual([]);
    expect(run.clock).toBeUndefined();
    expect(run.observed).not.toContain('events');
    // The 60 s gap is waited for real (through the injected sleep) before step 2 only.
    expect(stack.sleeps.filter((ms) => ms === 60_000)).toHaveLength(1);
    expect(stack.routes().slice(0, 4)).toEqual([
      'GET find-conversation',
      'POST reset-user',
      'GET find-conversation',
      'GET conversation/:id/messages',
    ]);
    for (const request of stack.requests) expect(request.headers['X-Api-Key']).toBe(KEY);
    const simulate = stack.requests.filter((request) => request.url.endsWith('simulate-message')).map((request) => JSON.parse(request.body!));
    expect(simulate).toEqual([
      { tenantId: TENANT, userId: `suite-${RUN_ID}-X-10.J`, text: 'User step 1.' },
      { tenantId: TENANT, userId: `suite-${RUN_ID}-X-10.J`, text: 'User step 2.' },
    ]);

    const results = Object.fromEntries(evaluate(test, run, null, TRUST).map((result) => [result.criterionId, result]));
    expect(results['X-10.C1']).toMatchObject({ status: 'PASS', method: 'n/a' });
    // Observed at L2, and no synthesized effect-count pairing (it would FAIL with 99).
    expect(results['X-10.C2']).toMatchObject({ status: 'PASS', method: 'observed' });
  });

  it('records a multi-message reply arriving over two polls, ordered and joined', async () => {
    const stack = new FakeStack({ steps: [{ polls: [reply('First part.'), reply('Second part.')] }] });
    const run = await execute(stack, journey(1));
    expect(run.steps[0]!.reply).toEqual({
      messages: [expect.objectContaining({ text: 'First part.' }), expect.objectContaining({ text: 'Second part.' })],
      text: 'First part.\n\nSecond part.',
    });
  });

  it('puts a foreign outbound after the reply in unsolicited', async () => {
    const stack = new FakeStack({ steps: [{ polls: [reply('The reply.'), [{ text: 'A check-in.', own: false }]] }] });
    const run = await execute(stack, journey(1));
    expect(run.errors).toEqual([]);
    expect(run.steps[0]!.reply!.text).toBe('The reply.');
    expect(run.steps[0]!.unsolicited.map((message) => message.text)).toEqual(['A check-in.']);
  });

  it('a foreign outbound before the reply ends the case unsolicited-outbound, retried once by the runner', async () => {
    const stack = new FakeStack({ steps: [{ polls: [[{ text: 'An intro.', own: false }], reply('Too late.')] }] });
    const run = await execute(stack, journey(1));
    expect(run.errors).toEqual([expect.objectContaining({ kind: 'infrastructure', step: 1, reason: 'unsolicited-outbound' })]);
    expect(run.steps).toEqual([]);
  });

  it('a foreign outbound earlier than the first own one in the same poll ends the case unsolicited-outbound', async () => {
    const stack = new FakeStack({ steps: [{ polls: [[{ text: 'An intro.', own: false }, { text: 'The reply.' }]] }] });
    const run = await execute(stack, journey(1));
    expect(run.errors).toEqual([expect.objectContaining({ kind: 'infrastructure', step: 1, reason: 'unsolicited-outbound' })]);
    // A later foreign one in the same poll is unsolicited, not an error.
    const later = await execute(new FakeStack({ steps: [{ polls: [[{ text: 'The reply.' }, { text: 'A check-in.', own: false }]] }] }), journey(1));
    expect(later.errors).toEqual([]);
    expect(later.steps[0]!.unsolicited.map((message) => message.text)).toEqual(['A check-in.']);
  });

  it('a reply first seen on the poll that crosses the deadline gets one more poll for its tail', async () => {
    const stack = new FakeStack({ steps: [{ polls: [[], [], reply('Part one.'), reply('Part two.')] }] });
    const run = CaseRunSchema.parse(await stack.executor({ replyTimeoutMs: 1_000 }).run(journey(1), OPTIONS));
    expect(run.errors).toEqual([]);
    expect(run.steps[0]!.reply!.text).toBe('Part one.\n\nPart two.');
  });

  it('an error after isolation keeps the subject ids, before and the afterStep snapshots collected so far', async () => {
    const notEmpty = await execute(new FakeStack({ leftover: 1 }), journey(1));
    expect(notEmpty.errors).toEqual([expect.objectContaining({ reason: 'isolation-not-empty' })]);
    expect(notEmpty.subject).toEqual({ externalUserId: `suite-${RUN_ID}-X-10.J`, userId: 'user-1', conversationId: 'conv-1', tenantId: TENANT });

    const stack = new FakeStack({ steps: [{ polls: [reply('One.')] }, { jobStatus: 'failed' }] });
    const test = journey(2, {
      criteria: [
        criterion({ id: 'X-10.C1' }),
        criterion({
          id: 'X-10.C2',
          evaluatedAt: 'state',
          stateQuery: { name: 'outboundCount', at: 'after-step:1', kind: 'change' },
          checks: [{ type: 'rule', rule: 'state-equals', params: { query: 'outboundCount', at: 'after-step:1', expected: 1 } }],
        }),
      ],
    });
    const run = await execute(stack, test);
    expect(run.errors).toEqual([expect.objectContaining({ kind: 'product', step: 2, reason: 'job-failed' })]);
    expect(run.subject.conversationId).toBe('conv-1');
    expect(run.state.before).toMatchObject({ outboundCount: 0 });
    expect(run.state.afterStep).toEqual({ '1': expect.objectContaining({ outboundCount: 1 }) });
  });

  it('silence: on timeout with jobStatus completed and an empty re-poll the reply is null and evaluated', async () => {
    const stack = new FakeStack({ steps: [{ jobStatus: 'completed' }] });
    const test = journey(1);
    const run = await execute(stack, test);
    expect(run.errors).toEqual([]);
    expect(run.steps[0]!.reply).toBeNull();
    expect(stack.now - T0).toBeGreaterThanOrEqual(60_000);
    expect(stack.sleeps.every((ms) => ms === 500)).toBe(true);
    expect(evaluate(test, run, null, TRUST)).toEqual([expect.objectContaining({ status: 'FAIL' })]);
  });

  it('late reply race: a completed job whose re-poll finds the reply records it', async () => {
    const stack = new FakeStack({ steps: [{ jobStatus: 'completed', late: reply('Sorry for the wait.') }] });
    const run = await execute(stack, journey(1));
    expect(run.errors).toEqual([]);
    expect(run.steps[0]!.reply!.text).toBe('Sorry for the wait.');
  });

  it.each([
    ['failed', { kind: 'product', reason: 'job-failed' }],
    ['processing', { kind: 'infrastructure', reason: 'reply-timeout:processing' }],
    ['queued', { kind: 'infrastructure', reason: 'reply-timeout:queued' }],
    [null, { kind: 'infrastructure', reason: 'reply-timeout:none' }],
  ] as const)('timeout with jobStatus %s', async (jobStatus, expected) => {
    const stack = new FakeStack({ steps: [{ jobStatus }] });
    const run = await execute(stack, journey(1));
    expect(run.errors).toEqual([expect.objectContaining({ ...expected, step: 1 })]);
  });

  it('refuses to construct without a non-empty workerEnv (suite.config.json l2.workerEnv)', () => {
    const client = new DevApiClient({ origin: 'http://localhost:3000', tenantId: TENANT, apiKey: KEY }, async () => ({ status: 200, body: {} }));
    const refusal = /workerEnv \(suite\.config\.json l2\.workerEnv\) is missing or empty/;
    expect(() => new L2ApplicationExecutor({ client } as never)).toThrow(refusal);
    expect(() => new L2ApplicationExecutor({ client, workerEnv: {} })).toThrow(refusal);
    expect(new L2ApplicationExecutor({ client, workerEnv: WORKER_ENV }).workerEnv).toEqual({ PROACTIVE_SCAN_ENABLED: 'false' });
  });

  it('a reset-user 404 (onboarding restart without a people row) is a completed reset; the empty check decides', async () => {
    const stack = new FakeStack({ status: { 'reset-user': 404 }, resetCommits: true, steps: [{ polls: [reply('Hi.')] }] });
    const run = await execute(stack, journey(1));
    expect(run.errors).toEqual([]);
    expect(run.subject).toMatchObject({ conversationId: 'conv-1' });
    expect(run.steps[0]!.reply!.text).toBe('Hi.');
    expect(stack.routes().slice(0, 4)).toEqual(['GET find-conversation', 'POST reset-user', 'GET find-conversation', 'GET conversation/:id/messages']);

    const dirty = new FakeStack({ status: { 'reset-user': 404 }, resetCommits: true, leftover: 1 });
    const blocked = await execute(dirty, journey(1));
    expect(blocked.errors).toEqual([expect.objectContaining({ kind: 'infrastructure', step: 0, reason: 'isolation-not-empty' })]);
    expect(dirty.routes()).not.toContain('POST simulate-message');

    for (const status of [400, 401, 500]) {
      const failed = await execute(new FakeStack({ status: { 'reset-user': status }, resetCommits: true }), journey(1));
      expect(failed.errors).toEqual([expect.objectContaining({ kind: 'infrastructure', step: 0, reason: 'dev-api:resetUser' })]);
    }
  });

  it('a 400 on messages?after= is messages-after-rejected', async () => {
    const stack = new FakeStack({ afterStatus: 400, steps: [{}] });
    const run = await execute(stack, journey(1));
    expect(run.errors).toEqual([expect.objectContaining({ kind: 'infrastructure', step: 1, reason: 'messages-after-rejected' })]);
  });

  it('another failing dev read is dev-api:<operation> at the current step', async () => {
    const run = await execute(new FakeStack({ status: { 'user/:id/survey-state': 500 } }), journey(1));
    expect(run.errors).toEqual([expect.objectContaining({ kind: 'infrastructure', step: 0, reason: 'dev-api:surveyState' })]);
    const after = await execute(new FakeStack({ afterStatus: 503, steps: [{}] }), journey(1));
    expect(after.errors).toEqual([expect.objectContaining({ kind: 'infrastructure', step: 1, reason: 'dev-api:messages' })]);
    const reset = await execute(new FakeStack({ status: { 'reset-user': 500 } }), journey(1));
    expect(reset.errors).toEqual([expect.objectContaining({ reason: 'dev-api:resetUser' })]);
  });

  it('an after read returning the inbound is after-not-honored', async () => {
    const stack = new FakeStack({ steps: [{ includeInbound: true, polls: [reply('Hi.')] }] });
    const run = await execute(stack, journey(1));
    expect(run.errors).toEqual([expect.objectContaining({ kind: 'infrastructure', reason: 'after-not-honored' })]);
  });

  it('a simulate-message answering another conversation is conversation-mismatch', async () => {
    const stack = new FakeStack({ steps: [{ otherConversation: true }] });
    const run = await execute(stack, journey(1));
    expect(run.errors).toEqual([expect.objectContaining({ kind: 'infrastructure', step: 1, reason: 'conversation-mismatch' })]);
  });

  it('a conversation that is not empty after the reset is isolation-not-empty and nothing is sent', async () => {
    const stack = new FakeStack({ leftover: 2 });
    const run = await execute(stack, journey(1));
    expect(run.errors).toEqual([expect.objectContaining({ kind: 'infrastructure', step: 0, reason: 'isolation-not-empty' })]);
    expect(stack.routes()).not.toContain('POST simulate-message');
  });

  it.each([['seededHistory'], ['clock'], ['confirmationState']] as const)('an unsupported fixture %s is unsupported-fixture and sends nothing', async (name) => {
    const stack = new FakeStack();
    const run = await execute(stack, journey(1, { setup: [{ name }] }));
    expect(run.errors).toEqual([expect.objectContaining({ step: 0, reason: `unsupported-fixture:${name}` })]);
    expect(stack.requests).toEqual([]);
  });

  it('refuses non-journey tests and a missing run id', async () => {
    const stack = new FakeStack();
    const atomic = await execute(stack, journey(1, { kind: 'atomic', seed: { history: [] } }));
    expect(atomic.errors).toEqual([expect.objectContaining({ kind: 'product', reason: 'l2-journeys-only' })]);
    const missing = await execute(stack, journey(1), { attempt: 1, interMessageGapMs: 60_000 });
    expect(missing.errors).toEqual([expect.objectContaining({ kind: 'infrastructure', reason: 'run-id-missing' })]);
    expect(stack.requests).toEqual([]);
  });

  it('names the persona per sample and attempt above 1', async () => {
    const stack = new FakeStack({ steps: [{ polls: [reply('a')] }, { polls: [reply('b')] }] });
    const first = await execute(stack, journey(1), { ...OPTIONS, sample: 2 });
    expect(first.subject.externalUserId).toBe(`suite-${RUN_ID}-X-10.J-s2-a1`);
    const retry = await execute(stack, journey(1), { ...OPTIONS, attempt: 2 });
    expect(retry.subject.externalUserId).toBe(`suite-${RUN_ID}-X-10.J-s1-a2`);
  });

  it('disclosureDelivered absent on a fresh persona: unsatisfied, criteria INVALID; apply writes nothing', async () => {
    const stack = new FakeStack({ steps: [{ polls: [reply('Hi.')] }] });
    const test = journey(1, { setup: [{ name: 'disclosureDelivered', params: { text: 'We report in aggregate.', atOffsetMs: 60_000 } }] });
    const run = await execute(stack, test);
    expect(run.preconditions).toEqual([{ source: 'fixture', name: 'disclosureDelivered', satisfied: false, detail: 'no delivered disclosure' }]);
    expect(evaluate(test, run, null, TRUST)).toEqual([expect.objectContaining({ status: 'INVALID', reason: 'precondition:disclosureDelivered' })]);
    // Only reads before the first send: the fixture wrote nothing.
    const firstSend = stack.routes().indexOf('POST simulate-message');
    expect(stack.routes().slice(0, firstSend).filter((route) => route.startsWith('POST') && route !== 'POST reset-user')).toEqual([]);
  });

  it('freshPersona verifies memory, survey evidence and the question window from the dev reads', async () => {
    const clean = await execute(new FakeStack({ steps: [{ polls: [reply('Hi.')] }] }), journey(1, { setup: [{ name: 'freshPersona' }] }));
    expect(clean.preconditions).toEqual([
      { source: 'fixture', name: 'freshPersona', satisfied: true, detail: 'style and goals not checked (no dev read)' },
    ]);
    const dirty = await execute(
      new FakeStack({ memory: 2, survey: 1, confirmation: { surveyWindowId: 'w-1', stagedBundleCount: 1 }, steps: [{ polls: [reply('Hi.')] }] }),
      journey(1, { setup: [{ name: 'freshPersona' }] }),
    );
    expect(dirty.preconditions[0]).toMatchObject({ satisfied: false });
    expect(dirty.preconditions[0]!.detail).toMatch(/^memory:2, survey-evidence:1, question-window, staged-bundles; style and goals/);
    const pending = await execute(
      new FakeStack({ confirmation: { pendingClarification: { surveyQuestionId: 'q', questionGroup: 'autonomy' } }, steps: [{ polls: [reply('Hi.')] }] }),
      journey(1, { setup: [{ name: 'freshPersona' }] }),
    );
    expect(pending.preconditions[0]).toMatchObject({ satisfied: false });
    expect(pending.preconditions[0]!.detail).toMatch(/^pending-clarification; /);
  });

  it('pulseCycle is satisfied only by an active window with an open question of every declared topic; questionProgress reads its group', async () => {
    const pulse = {
      name: 'pulseCycle' as const,
      params: {
        surveyWindowId: 'window-1',
        questions: [
          { surveyQuestionId: 'q-a1', questionVersion: 'v2', questionGroup: 'autonomy', workingSummary: 'S.', title: 'T', status: 'pending' },
        ],
        uncoveredTopics: [{ topic: 'autonomy', canonicalQuestions: ['How much say do you have?'] }],
      },
    };
    const test = journey(1, { setup: [pulse] });
    const open = new FakeStack({
      confirmation: {
        surveyWindowId: 'w-real',
        questions: [{ surveyQuestionId: 'other-id', stableKey: 'k', questionGroup: 'autonomy', status: 'no_data' }],
        progress: { answered: 0, total: 1 },
      },
      steps: [{ polls: [reply('Hi.')] }],
    });
    const run = await execute(open, test);
    expect(run.preconditions).toEqual([{ source: 'fixture', name: 'pulseCycle', satisfied: true, detail: 'every declared topic is open' }]);
    expect(run.state.before.questionProgress).toEqual({ answered: 0, total: 1 });
    const groups = open.requests.filter((request) => request.url.includes('question-confirmation')).map((request) => new URL(request.url).searchParams.get('group'));
    // The fixture verify reads the whole window; the snapshots read the fixture's group.
    expect(groups[0]).toBeNull();
    expect(groups.slice(1).every((group) => group === 'autonomy')).toBe(true);

    const closed = await execute(
      new FakeStack({
        confirmation: { surveyWindowId: 'w-real', questions: [{ surveyQuestionId: 'q', stableKey: 'k', questionGroup: 'autonomy', status: 'confirmed' }] },
        steps: [{ polls: [reply('Hi.')] }],
      }),
      test,
    );
    expect(closed.preconditions[0]).toMatchObject({ satisfied: false, detail: 'not open: autonomy' });
    const declined = await execute(
      new FakeStack({
        confirmation: { surveyWindowId: 'w-real', questions: [{ surveyQuestionId: 'q', stableKey: 'k', questionGroup: 'autonomy', status: 'declined' }] },
        steps: [{ polls: [reply('Hi.')] }],
      }),
      test,
    );
    expect(declined.preconditions[0]).toMatchObject({ satisfied: false, detail: 'not open: autonomy' });
    const none = await execute(new FakeStack({ steps: [{ polls: [reply('Hi.')] }] }), test);
    expect(none.preconditions[0]).toMatchObject({ satisfied: false, detail: 'no active survey window' });
  });

  it('an invalid state value is state-query:<name>', async () => {
    const run = await execute(new FakeStack({ confirmation: { progress: { answered: 3, total: 1 } } }), journey(1));
    expect(run.errors).toEqual([expect.objectContaining({ kind: 'infrastructure', reason: 'state-query:questionProgress' })]);
  });

  it('a stop checkpoint that fails ends the journey after that step', async () => {
    const stack = new FakeStack({ steps: [{ jobStatus: 'completed' }, { polls: [reply('never')] }] });
    const test = journey(2, {
      steps: [{ text: 'One.', checkpoint: { checks: [{ type: 'rule', rule: 'reply-present' }], onFail: 'stop' } }, { text: 'Two.' }],
    });
    const run = await execute(stack, test);
    expect(run.errors).toEqual([]);
    expect(run.stoppedAtStep).toBe(1);
    expect(run.steps).toHaveLength(1);
    expect(stack.routes().filter((route) => route === 'POST simulate-message')).toHaveLength(1);
  });
});

describe('L2 through runSuite (P-10-like journey, fake transport, stub judge)', () => {
  const suite = () => l2JourneySuite();

  it('runs the journey on the fake stack: observed state, n/a (journeys only), subject ids, no coach calls', async () => {
    const stack = new FakeStack({ steps: [{ polls: [reply('That sounds heavy. What happened?')] }, { polls: [reply('Which release matters most?')] }] });
    const judge = fakeJudge(() => 'PASS');
    const { report, caseRuns } = await runSuite({
      suite: suite(),
      level: 'L2',
      n: 1,
      executor: stack.executor(),
      config: RUNNER_CONFIG,
      runId: RUN_ID,
      git: { sha: 'abc1234def', dirty: false },
      judging: { judge: judge.judge, model: 'gpt-4o', unpinned: false, agreement: null, labelsSha256: labelsSha256([]) },
    });
    expect(report.verdict).toBe('n/a (journeys only)');
    expect(report.layers).toBeNull();
    expect(report.results['X-10.J/X-10.C1']).toMatchObject({ status: 'PASS', inScope: true, method: 'n/a' });
    expect(report.results['X-10.J/X-10.C2']).toMatchObject({ status: 'PASS', advisory: true });
    expect(report.results['X-10.J/X-10.C3']).toMatchObject({ status: 'PASS', method: 'observed' });
    // The atomic coverage test never declares L2: out of scope, level-not-declared.
    expect(report.results['X-10.A1/X-10.C1']).toMatchObject({ inScope: false, status: 'NOT_RUN', reason: 'level-not-declared' });
    expect(judge.inputs).toHaveLength(1);
    expect(caseRuns).toHaveLength(1);
    expect(caseRuns[0]!.run.subject).toEqual({ externalUserId: `suite-${RUN_ID}-X-10.J`, userId: 'user-1', conversationId: 'conv-1', tenantId: TENANT });
    expect(report.models.coach).toBeNull();
    expect(report.budget?.coachCalls).toBe(0);
  });

  it('retries an infrastructure error once with a fresh persona per attempt', async () => {
    const stack = new FakeStack({
      steps: [{ polls: [[{ text: 'An intro.', own: false }]] }, { polls: [reply('One.')] }, { polls: [reply('Two.')] }],
    });
    const { caseRuns } = await runSuite({
      suite: suite(),
      level: 'L2',
      n: 1,
      executor: stack.executor(),
      config: RUNNER_CONFIG,
      runId: RUN_ID,
      git: { sha: null, dirty: false },
      judging: { judge: fakeJudge(() => 'PASS').judge, model: 'gpt-4o', unpinned: false, agreement: null, labelsSha256: labelsSha256([]) },
    });
    expect(caseRuns[0]!.run.attempt).toBe(2);
    expect(caseRuns[0]!.run.errors).toEqual([]);
    expect(caseRuns[0]!.run.subject.externalUserId).toBe(`suite-${RUN_ID}-X-10.J-s1-a2`);
    expect(stack.routes().filter((route) => route === 'POST reset-user')).toHaveLength(2);
  });
});
