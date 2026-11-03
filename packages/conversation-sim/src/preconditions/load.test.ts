import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ScenarioResult } from '@langwatch/scenario';
import { afterEach, describe, expect, it } from 'vitest';
import type { InMemoryScheduledActionRepository } from '../fakes/repositories';
import { makeClassification, ScriptedAiProvider } from '../fakes/scripted-ai';
import { SIM_SCOPE } from '../harness/coach-harness';
import { reportRun, type ScenarioRunReport } from '../harness/report';
import { harnessFromPrecondition, loadPrecondition, parsePrecondition, restoreClock } from './load';

// The package compiles as CommonJS, where `import.meta` does not typecheck; `__dirname` is the same anchor.
const PACKAGE_ROOT = join(__dirname, '..', '..');
const EXAMPLE = join(PACKAGE_ROOT, 'preconditions/examples/cycle-open-with-history.json');
const FROM_SIM_RUN = join(PACKAGE_ROOT, 'report/from-sim-run.mjs');
const MINUTE_MS = 60_000;
const scope = { tenantId: SIM_SCOPE.tenantId, userId: SIM_SCOPE.userId };
const scripted = () => new ScriptedAiProvider();

afterEach(() => restoreClock());

describe('loadPrecondition: full file', () => {
  it('seeds history, memory, goals, style, scheduled actions, onboarding and the pulse cycle', async () => {
    const precondition = loadPrecondition(EXAMPLE);
    const harness = await harnessFromPrecondition(precondition, { aiProvider: scripted() });

    expect(precondition.name).toBe('cycle-open-with-history');
    expect(harness.transcript.map((message) => [message.direction, message.text.slice(0, 20)])).toEqual([
      ['outbound', 'Hi Olena. Your refle'],
      ['inbound', 'Hey. Release week, s'],
      ['outbound', 'Release weeks have t'],
      ['inbound', 'Finishing the checkl'],
      ['outbound', 'That kind of cover m'],
    ]);
    expect(harness.transcript[0]?.metadata).toEqual({ reportingDisclosureVersion: 'reporting-disclosure-v1' });
    expect(harness.memoryItems.map((item) => item.content)).toEqual([
      'Leads the release checklist for the mobile app',
      'Prefers short messages during release weeks',
    ]);
    expect(harness.goalRepo.goals.map((goal) => [goal.title, goal.status])).toEqual([
      ['Hand over release duty to a teammate by December', 'active'],
      ['Finish the onboarding guide', 'completed'],
    ]);
    expect((await harness.styleProfile())?.adaptationWeight).toBe(0.4);
    const actions = (harness.scheduledActions as InMemoryScheduledActionRepository).actions;
    expect(actions).toEqual([expect.objectContaining({
      type: 'user_reminder', intent: 'check in after the release ships', status: 'pending', timezone: 'Europe/Kyiv',
    })]);
    expect(actions[0]!.dueAt.getTime() - Date.parse('2026-10-28T10:30:00+02:00')).toBeGreaterThanOrEqual(1440 * MINUTE_MS);

    const context = harness.context;
    expect(context.precondition).toMatchObject({
      name: 'cycle-open-with-history',
      origin: 'authored',
      presets: ['onboarding-done', 'cycle-open (3 topics, 1 closed)', 'elapsed (90 min since the last message)'],
      onboarding: 'employee: intro completed, participation active',
      goals: ['Hand over release duty to a teammate by December (active)', 'Finish the onboarding guide (completed)'],
      cycle: {
        open: true, topicsTotal: 3, topicsClosed: 1, openTopics: ['belonging', 'growth'],
        topics: ['autonomy: confirmed', 'belonging: collecting', 'growth: collecting'], nextProbe: 'q-growth (open)',
      },
      evidence: ['belonging [temporary]: The team covers for each other during release week.'],
      scheduledActions: ['user_reminder "check in after the release ships" due in 1440 min'],
    });
    expect(context.precondition?.user).toContain('Olena, timezone Europe/Kyiv');
  });

  it('wires onboarding, cycle progress, evidence and the next probe to the ports', async () => {
    const harness = await harnessFromPrecondition(loadPrecondition(EXAMPLE), { aiProvider: scripted() });
    const options = (harness as unknown as { options: Parameters<typeof harnessFromPrecondition>[1] }).options!;

    expect((await options.onboardingTurn!.contextFor(scope.tenantId, scope.userId))?.state).toMatchObject({
      introStatus: 'completed', participation: 'active',
    });
    expect(await options.questionConfirmationRepo!.findCycleProgress!(scope)).toEqual({
      surveyWindowId: 'sim-window',
      groups: [
        { questionGroup: 'autonomy', questions: [{ surveyQuestionId: 'q-autonomy', status: 'confirmed' }] },
        { questionGroup: 'belonging', questions: [{ surveyQuestionId: 'q-belonging', status: 'collecting' }] },
        { questionGroup: 'growth', questions: [{ surveyQuestionId: 'q-growth', status: 'collecting' }] },
      ],
    });
    const source = harness.transcript[3]!;
    const captures = await options.surveyRepo!.findPulseCaptureForConversation({
      ...scope, conversationId: SIM_SCOPE.conversationId, beforeOccurredAt: new Date(), sourceMessageId: source.id,
    });
    expect(captures).toEqual([{
      evidenceSummary: 'The team covers for each other during release week.',
      questionGroup: 'belonging', sourceMessageIds: [source.id], status: 'temporary',
    }]);
    const probe = await options.pulseBacklogService!.getNextProbeQuestion(scope.userId, scope.tenantId);
    expect(probe).toMatchObject({
      windowId: 'sim-window', focus: 'open',
      question: { id: 'q-growth', questionGroup: 'growth', title: 'Room to grow', probeStrategies: ['What they would like to learn next in their role'] },
    });
  });

  it('starts the test clock at startTime and lets it run', async () => {
    const harness = await harnessFromPrecondition(loadPrecondition(EXAMPLE), { aiProvider: scripted() });
    const start = Date.parse('2026-10-28T10:30:00+02:00');

    expect(Date.now() - start).toBeGreaterThanOrEqual(0);
    expect(Date.now() - start).toBeLessThan(5_000);
    expect(new Date().getTime() - start).toBeLessThan(5_000);
    // Elapsed 90 minutes applies to the last of five history messages, spaced one minute apart.
    const times = harness.transcript.map((message) => start - message.occurredAt.getTime());
    expect(times.map((ms) => Math.round(ms / MINUTE_MS))).toEqual([94, 93, 92, 91, 90]);
    class Stamp extends Date {}
    expect(new Stamp()).toBeInstanceOf(Stamp);
    restoreClock();
    expect(Date.now() - start).toBeGreaterThan(MINUTE_MS);
  });
});

describe('harnessFromPrecondition: presets', () => {
  it('builds a state from presets only', async () => {
    const precondition = parsePrecondition({
      schemaVersion: 1,
      presets: ['onboarding-done', { name: 'cycle-open', topicsTotal: 3, topicsClosed: 1 }],
    }, 'presets-only.json');
    const harness = await harnessFromPrecondition(precondition, { aiProvider: scripted() });
    const options = (harness as unknown as { options: Parameters<typeof harnessFromPrecondition>[1] }).options!;

    expect((await options.onboardingTurn!.contextFor(scope.tenantId, scope.userId))?.state).toMatchObject({
      introStatus: 'completed', participation: 'active', completedAt: expect.any(Date),
    });
    const snapshot = await options.questionConfirmationRepo!.findCycleProgress!(scope);
    expect(snapshot?.groups.map((group) => [group.questionGroup, group.questions.map((question) => question.status)])).toEqual([
      ['autonomy', ['confirmed']], ['belonging', ['collecting']], ['growth', ['collecting']],
    ]);
    expect(harness.context.precondition).toMatchObject({
      name: 'presets-only',
      cycle: { topicsTotal: 3, topicsClosed: 1, openTopics: ['belonging', 'growth'] },
    });
    expect(await options.pulseBacklogService!.getNextProbeQuestion(scope.userId, scope.tenantId)).toBeNull();
  });

  it('lets explicit cycle topics win over the cycle-open preset', async () => {
    const precondition = parsePrecondition({
      schemaVersion: 1,
      presets: [{ name: 'cycle-open', topicsTotal: 3, topicsClosed: 1 }],
      pulseCycle: { topics: [{ group: 'purpose', questions: [{ id: 'q-purpose', status: 'pending_confirmation' }] }] },
    });
    const harness = await harnessFromPrecondition(precondition, { aiProvider: scripted() });

    expect(harness.context.precondition?.cycle).toMatchObject({
      open: true, topicsTotal: 1, topicsClosed: 0, topics: ['purpose: pending_confirmation'],
    });
  });

  it('places the last history message `elapsed` before the start and keeps earlier spacing', async () => {
    const precondition = parsePrecondition({
      schemaVersion: 1,
      startTime: '2026-10-28T09:00:00Z',
      presets: [{ name: 'elapsed', minutes: 90 }],
      history: [
        { role: 'employee', text: 'Morning.', minutesBeforeStart: 200 },
        { role: 'bot', text: 'Morning! How is the week going?', minutesBeforeStart: 195 },
        { role: 'employee', text: 'Busy.' },
      ],
    });
    const harness = await harnessFromPrecondition(precondition, { aiProvider: scripted() });
    const start = Date.parse('2026-10-28T09:00:00Z');
    const minutesBefore = harness.transcript.map((message) => Math.round((start - message.occurredAt.getTime()) / MINUTE_MS));

    // Raw offsets 200, 195, 1 are shifted together so the last message is 90 minutes old.
    expect(minutesBefore).toEqual([289, 284, 90]);
    expect(harness.context.precondition?.elapsedMinutes).toBe(90);
  });
});

describe('harnessFromPrecondition: closed cycle', () => {
  it('treats `open: false` as no cycle on every port', async () => {
    const precondition = parsePrecondition({
      schemaVersion: 1,
      history: [{ role: 'employee', text: 'The team covers for each other.' }],
      pulseCycle: {
        open: false,
        topics: [{
          group: 'belonging', questions: [{ id: 'q-belonging', status: 'collecting' }],
          evidence: [{ summary: 'Team covers for each other.', sourceHistoryIndexes: [0] }],
        }],
        nextProbe: { questionId: 'q-belonging' },
      },
    });
    const harness = await harnessFromPrecondition(precondition, { aiProvider: scripted() });
    const options = (harness as unknown as { options: Parameters<typeof harnessFromPrecondition>[1] }).options!;

    expect(await options.questionConfirmationRepo!.findCycleProgress!(scope)).toBeNull();
    expect(await options.pulseBacklogService!.getNextProbeQuestion(scope.userId, scope.tenantId)).toBeNull();
    expect(await options.surveyRepo!.findPulseCaptureForConversation({
      ...scope, conversationId: SIM_SCOPE.conversationId, beforeOccurredAt: new Date(),
    })).toEqual([]);
    expect(harness.context.precondition?.cycle?.open).toBe(false);
  });
});

describe('parsePrecondition: rejected files', () => {
  it('rejects history that resolves out of order or after the start time', () => {
    expect(() => parsePrecondition({
      schemaVersion: 1,
      history: [
        { role: 'employee', text: 'First.', minutesBeforeStart: 2 },
        { role: 'bot', text: 'Second.', minutesBeforeStart: 30 },
      ],
    }, 'order.json')).toThrow(/order\.json: invalid precondition\n {2}history\.1: .*oldest first/);
    expect(() => parsePrecondition({
      schemaVersion: 1,
      elapsedMinutes: 0,
      history: [{ role: 'employee', text: 'Just now.' }],
    }, 'future.json')).toThrow(/future\.json: invalid precondition\n {2}history\.0: .*before startTime/);
  });

  it('caps the cycle-open preset at the four pulse topics', () => {
    expect(() => parsePrecondition({ schemaVersion: 1, presets: [{ name: 'cycle-open', topicsTotal: 5, topicsClosed: 0 }] }, 'five.json'))
      .toThrow(/five\.json: invalid precondition\n {2}presets\.0\.topicsTotal: /);
    expect(() => parsePrecondition({ schemaVersion: 1, presets: [{ name: 'cycle-open', topicsTotal: 2, topicsClosed: 3 }] }, 'over.json'))
      .toThrow(/presets\.0\.topicsClosed: topicsClosed cannot exceed topicsTotal/);
  });

  it('adds the known-presets hint to any preset error', () => {
    expect(() => parsePrecondition({ schemaVersion: 1, presets: [42] }, 'number.json'))
      .toThrow(/number\.json: invalid precondition\n {2}presets\.0: .*known presets: onboarding-done, cycle-open, elapsed/);
  });

  it('rejects an unknown schemaVersion naming the file and the field', () => {
    expect(() => parsePrecondition({ schemaVersion: 2 }, 'future.json'))
      .toThrow(/future\.json: schemaVersion: unsupported precondition version 2/);
  });

  it('rejects an invalid field naming the file and the field path', () => {
    expect(() => parsePrecondition({ schemaVersion: 1, goals: [{ title: 'Ship it', status: 'paused' }] }, 'bad-goal.json'))
      .toThrow(/bad-goal\.json: invalid precondition\n {2}goals\.0\.status: /);
  });

  it('rejects an unknown preset and lists the known ones', () => {
    expect(() => parsePrecondition({ schemaVersion: 1, presets: ['vacation'] }, 'vacation.json'))
      .toThrow(/vacation\.json: invalid precondition\n {2}presets\.0\.name: .*known presets: onboarding-done, cycle-open, elapsed/);
  });

  it('rejects evidence pointing past the history and a next probe outside the topics', () => {
    expect(() => parsePrecondition({
      schemaVersion: 1,
      pulseCycle: {
        topics: [{ group: 'growth', questions: [{ id: 'q-growth', status: 'collecting' }], evidence: [{ summary: 'x', sourceHistoryIndexes: [0] }] }],
        nextProbe: { questionId: 'q-missing' },
      },
    }, 'refs.json')).toThrow(/refs\.json: invalid precondition\n {2}pulseCycle\.topics\.0\.evidence\.0\.sourceHistoryIndexes\.0: [^\n]*\n {2}pulseCycle\.nextProbe\.questionId: /);
  });
});

describe('a scripted turn from the example precondition', () => {
  const dirs: string[] = [];
  const originalReportDir = process.env.SIM_GATE_REPORT_DIR;

  afterEach(() => {
    // Assigning undefined would store the string "undefined" and send later reports to ./undefined.
    if (originalReportDir === undefined) delete process.env.SIM_GATE_REPORT_DIR;
    else process.env.SIM_GATE_REPORT_DIR = originalReportDir;
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('feeds the file state to the response and carries the precondition into the run and suite reports', async () => {
    const goal = 'Hand over release duty to a teammate by December';
    const harness = await harnessFromPrecondition(loadPrecondition(EXAMPLE), {
      aiProvider: new ScriptedAiProvider({
        classifications: [makeClassification({
          // A goal reaches the reply only on a progress update whose topic is exactly that goal.
          primaryIntent: 'progress_update', topicAnchor: goal, latestUserSubstance: goal, cycleStatusQuestion: true,
        })],
      }),
    });

    await harness.send('Handover is moving. How far along are we with the check-in topics?');

    const context = harness.responseCallsByTurn[0]?.context;
    expect(context?.memoryContext?.items.map((item) => item.content)).toEqual(expect.arrayContaining([
      'Leads the release checklist for the mobile app', 'Prefers short messages during release weeks',
    ]));
    expect(context?.memoryContext?.goals).toEqual([expect.objectContaining({ title: goal, status: 'active' })]);
    expect(context?.cycleProgress).toMatchObject({ inCycle: true, topicsTotal: 3, topicsClosed: 1, openTopics: ['belonging', 'growth'] });

    const runsDir = mkdtempSync(join(tmpdir(), 'precondition-report-'));
    dirs.push(runsDir);
    process.env.SIM_GATE_REPORT_DIR = runsDir;
    await reportRun('precondition example turn', harness, {
      success: true, metCriteria: [], unmetCriteria: [], reasoning: '',
    } as unknown as ScenarioResult, false);
    const runFile = readdirSync(runsDir).find((file) => file.endsWith('.json'))!;
    const run = JSON.parse(readFileSync(join(runsDir, runFile), 'utf8')) as ScenarioRunReport;
    expect(run.context?.precondition).toMatchObject({ name: 'cycle-open-with-history', source: EXAMPLE });
    // The report timestamp stays real even though the test clock was shifted to the start time.
    expect(Math.abs(Date.parse(run.runAt) - performance.timeOrigin - performance.now())).toBeLessThan(60_000);

    // Suite report: the Given block lists the precondition and every state area from the file.
    const vitestJson = join(runsDir, 'vitest.json');
    writeFileSync(vitestJson, JSON.stringify({
      startTime: Date.parse(run.runAt),
      testResults: [{ name: run.testFile, assertionResults: [{ fullName: run.testName, status: 'passed', duration: 10 }] }],
    }));
    const out = join(runsDir, 'suite.json');
    const child = spawnSync(process.execPath, [
      FROM_SIM_RUN,
      '--vitest', vitestJson, '--runs', runsDir, '--since', '1970-01-01T00:00:00Z', '--out', out,
    ], { encoding: 'utf8' });
    expect(child.status, child.stderr).toBe(0);
    const suite = JSON.parse(readFileSync(out, 'utf8')) as {
      suite: { tests: Array<{ given: { summary: string; rows: Array<{ key: string; value: unknown }> } }> };
    };
    const given = suite.suite.tests[0]!.given;
    const rows = Object.fromEntries(given.rows.map((row) => [row.key, JSON.stringify(row.value)]));
    expect(given.summary).toContain('cycle-open-with-history');
    expect(rows['передумова']).toContain('cycle-open-with-history');
    expect(rows['пресети']).toContain('cycle-open (3 topics, 1 closed)');
    expect(rows['онбординг']).toContain('intro completed');
    expect(rows['пам\'ять']).toContain('Leads the release checklist');
    expect(rows['цілі']).toContain(goal);
    expect(rows['стиль']).toContain('weight 0.4');
    expect(rows['pulse-цикл']).toContain('закрито 1 з 3 тем');
    expect(rows['зібрані pulse-відповіді']).toContain('The team covers for each other');
    expect(rows['заплановані дії']).toContain('check in after the release ships');
    expect(rows['історія розмови']).toContain('5');
  });
});
