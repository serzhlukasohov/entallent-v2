import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { ScenarioResult } from '@langwatch/scenario';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InMemoryScheduledActionRepository } from '../fakes/repositories';
import { makeClassification, ScriptedAiProvider } from '../fakes/scripted-ai';
import { CoachHarness, RecordingAiProvider } from './coach-harness';
import { buildMarkdownReport, reportRun, type ScenarioRunReport } from './report';

const PROVIDER_ERROR = 'provider exploded during generation';

function throwingProvider(): ScriptedAiProvider {
  return new ScriptedAiProvider({
    responses: [
      () => {
        throw new TypeError(PROVIDER_ERROR);
      },
    ],
  });
}

describe('CoachHarness.send when the agent turn throws', () => {
  it('records the error on the harness and rethrows it', async () => {
    const harness = new CoachHarness({ aiProvider: throwingProvider() });

    await expect(harness.send('hello there')).rejects.toThrow(PROVIDER_ERROR);

    expect(harness.turns).toHaveLength(0);
    expect(harness.failures).toEqual([
      expect.objectContaining({ turn: 1, name: 'TypeError', message: PROVIDER_ERROR }),
    ]);
    expect(harness.failures[0]?.stack).toContain(PROVIDER_ERROR);
    // The inbound message and the generation attempt made before the throw stay observable.
    expect(harness.transcript.map((message) => message.direction)).toEqual(['inbound']);
    expect(harness.generateResponseCalls).toHaveLength(1);
  });
});

describe('scenario report after a failed agent turn', () => {
  const fixtureDirs: string[] = [];
  const originalReportDir = process.env.SIM_GATE_REPORT_DIR;
  const originalRunId = process.env.SIM_GATE_RUN_ID;

  afterEach(() => {
    process.env.SIM_GATE_REPORT_DIR = originalReportDir;
    process.env.SIM_GATE_RUN_ID = originalRunId;
    for (const dir of fixtureDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('reportRun writes the recorded error as an agent-turn-error violation', async () => {
    const reportDir = mkdtempSync(join(process.cwd(), 'report-fixture-'));
    fixtureDirs.push(reportDir);
    process.env.SIM_GATE_REPORT_DIR = reportDir;
    process.env.SIM_GATE_RUN_ID = '';

    const harness = new CoachHarness({ aiProvider: throwingProvider() });
    await expect(harness.send('hello there')).rejects.toThrow(PROVIDER_ERROR);

    await reportRun(
      'agent turn error fixture',
      harness,
      { success: false, metCriteria: [], unmetCriteria: [], reasoning: 'judge not reached' } as unknown as ScenarioResult,
      false,
    );

    const report = JSON.parse(readFileSync(join(reportDir, 'agent-turn-error-fixture.json'), 'utf8')) as ScenarioRunReport;
    expect(report.deterministic.passed).toBe(false);
    expect(report.deterministic.violations).toEqual([
      { turn: 1, rule: 'agent-turn-error', detail: `TypeError: ${PROVIDER_ERROR}` },
    ]);
    expect(report.agentTurnErrors?.[0]).toEqual(
      expect.objectContaining({ turn: 1, name: 'TypeError', message: PROVIDER_ERROR }),
    );
    expect(report.turns).toEqual([]);
    const markdown = readFileSync(join(reportDir, 'agent-turn-error-fixture.md'), 'utf8');
    expect(markdown).toContain('agent-turn-error');
    expect(markdown).toContain(PROVIDER_ERROR);
    expect(markdown).not.toContain('all clear');
  });

  it('leaves a report with the error class when the test aborts before reportRun', () => {
    // Keep generated TypeScript outside src so parallel typechecks cannot discover a deleted fixture.
    const fixtureDir = mkdtempSync(join(process.cwd(), 'report-fixture-'));
    fixtureDirs.push(fixtureDir);
    const reportDir = join(fixtureDir, 'reports');
    const fixtureFile = join(fixtureDir, 'agent-turn-error.test.ts');
    const fixtureConfig = join(fixtureDir, 'vitest.config.mjs');
    writeFileSync(fixtureFile, `
      import { it } from 'vitest';
      import { CoachHarness } from ${JSON.stringify(join(process.cwd(), 'src/harness/coach-harness.ts'))};
      import { ScriptedAiProvider } from ${JSON.stringify(join(process.cwd(), 'src/fakes/scripted-ai.ts'))};
      it('aborted agent turn', async () => {
        const harness = new CoachHarness({
          aiProvider: new ScriptedAiProvider({ responses: [() => { throw new TypeError(${JSON.stringify(PROVIDER_ERROR)}); }] }),
        });
        await harness.send('hello there');
        throw new Error('unreachable: send must rethrow');
      });
    `);
    writeFileSync(fixtureConfig, `export default { root: ${JSON.stringify(process.cwd())}, test: { include: [${JSON.stringify(relative(process.cwd(), fixtureFile))}] } };`);

    const child = spawnSync('pnpm', ['exec', 'vitest', 'run', '--config', fixtureConfig, fixtureFile], {
      cwd: process.cwd(), encoding: 'utf8', timeout: 60_000,
      env: { ...process.env, SIM_GATE_REPORT_DIR: reportDir, SIM_GATE_RUN_ID: 'sample-1', SIM_GATE_ID: 'gate-1' },
    });
    expect(child.error).toBeUndefined();
    expect(child.status, `${child.stdout} ${child.stderr}`).toBe(1);

    const report = JSON.parse(readFileSync(join(reportDir, 'aborted-agent-turn-sample-1.json'), 'utf8')) as ScenarioRunReport;
    expect(report.gateId).toBe('gate-1');
    expect(report.gateRunId).toBe('sample-1');
    expect(report.judge.evaluated).toBe(false);
    expect(report.deterministic.passed).toBe(false);
    expect(report.deterministic.violations).toEqual(expect.arrayContaining([
      { turn: 1, rule: 'agent-turn-error', detail: `TypeError: ${PROVIDER_ERROR}` },
      expect.objectContaining({ rule: 'test-failure', detail: expect.stringContaining(PROVIDER_ERROR) }),
    ]));
    expect(readFileSync(join(reportDir, 'aborted-agent-turn-sample-1.md'), 'utf8')).toContain(PROVIDER_ERROR);
  }, 70_000);
});

describe('RecordingAiProvider', () => {
  it('forwards the bundle variant to the delegate', async () => {
    const delegate = new ScriptedAiProvider();
    const compose = vi.spyOn(delegate, 'composeQuestionBundle');
    const provider = new RecordingAiProvider(delegate, []);
    const turns = [{ role: 'user' as const, content: 'hi', timestamp: new Date() }];
    const questions = [{ surveyQuestionId: 'q-b', workingSummary: 'I decide my methods.' }];

    await provider.composeQuestionBundle(turns, questions, 'en', 'corrected_statement');

    expect(compose).toHaveBeenCalledWith(turns, questions, 'en', 'corrected_statement');
  });
});

describe('CoachHarness turn trace', () => {
  it('records the inbound, model calls, writes and outcome of a turn in order', async () => {
    const harness = new CoachHarness({ aiProvider: new ScriptedAiProvider() });

    const reply = await harness.send('hello there');

    const turnOne = harness.trace.events.filter((event) => event.turn === 1);
    const names = turnOne.map((event) => event.name);
    expect(turnOne[0]).toMatchObject({ kind: 'inbound', name: 'message accepted' });
    expect(names).toEqual(expect.arrayContaining(['classifySituation', 'detectRisk', 'generateResponse', 'conversation.saveMessage']));
    expect(names.indexOf('classifySituation')).toBeLessThan(names.indexOf('generateResponse'));
    expect(turnOne.find((event) => event.name === 'classifySituation')?.summary).toMatch(/^primary=/);
    expect(turnOne.at(-1)).toMatchObject({ kind: 'decision', name: 'turn outcome' });
    expect(turnOne.at(-1)?.summary).toContain('reply written by the model');
    expect(harness.userMessages).toEqual(['hello there']);
    expect(reply).not.toBe('');
  });

  it('renders the turn as user, numbered events, bot and storage summary', async () => {
    const harness = new CoachHarness({ aiProvider: new ScriptedAiProvider() });
    await harness.send('first message');
    await harness.send('second message');

    const markdown = buildMarkdownReport({
      schemaVersion: 1, gateId: null, gateRunId: null, scenarioName: 'trace fixture', scenarioSlug: 'trace-fixture',
      runAt: '2026-10-29T00:00:00.000Z', gitSha: null,
      models: { coachBalanced: null, simulator: null, judge: null, azureTestingDeployment: null },
      judge: { evaluated: true, passed: true, metCriteria: ['answers'], unmetCriteria: [], reasoning: null },
      deterministic: { passed: true, violations: [] },
      context: harness.context,
      userMessages: harness.userMessages,
      trace: harness.trace.events,
      turns: harness.turns.map((turn, index) => ({
        index: index + 1, mode: turn.mode, primaryIntent: turn.classification.primaryIntent,
        requiresSafetyCheck: false, risk: { severity: 'none', type: null },
        responseLength: turn.responseText.length, responseText: turn.responseText,
        replyPlan: harness.responseCallsByTurn[index]?.context.replyPlan ?? null, replyBrief: null,
      })),
      memoryItems: [],
      styleProfile: null,
    });

    expect(markdown).toContain('**Result: PASS**');
    expect(markdown).toMatch(/## Context[\s\S]*\*\*User:\*\* first message\n\*\*Bot:\*\* /);
    expect(markdown).toMatch(/## Turn 2\n\n\*\*User:\*\* second message\n\n1\. \*\*IN\*\* `message accepted`/);
    expect(markdown).toMatch(/\d+\. \*\*LLM\*\* `classifySituation` -> primary=/);
    expect(markdown).toMatch(/Written to storage: .*conversation\.saveMessage x\d/);
    expect(markdown).toContain('<details><summary>Turn 1</summary>');
  });
});

describe('CoachHarness scheduled actions', () => {
  it('schedules and confirms a classified reminder by default, and traces the write', async () => {
    const dueAt = new Date(Date.now() + 86_400_000).toISOString();
    const harness = new CoachHarness({
      aiProvider: new ScriptedAiProvider({
        classifications: [{ ...makeClassification(), reminderRequest: { intent: 'prepare for the interview', dueAt } }],
      }),
    });

    await harness.send('remind me tomorrow to prepare for the interview');

    const save = harness.trace.events.find((event) => event.name === 'scheduledActions.save');
    expect(save).toMatchObject({ turn: 1, kind: 'write' });
    expect(save?.summary).toContain('prepare for the interview');
    expect(harness.responseCallsByTurn[0]?.context.reminderConfirmation).toEqual({ intent: 'prepare for the interview', dueAt });
    expect(harness.scheduledActions).toBeInstanceOf(InMemoryScheduledActionRepository);
    expect((harness.scheduledActions as InMemoryScheduledActionRepository).actions).toEqual([
      expect.objectContaining({ type: 'user_reminder', intent: 'prepare for the interview', dueAt: new Date(dueAt) }),
    ]);
  });
});
