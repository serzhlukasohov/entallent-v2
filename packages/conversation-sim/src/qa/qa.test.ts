import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeClassification, ScriptedAiProvider } from '../fakes/scripted-ai';
import type { TurnEffects } from '../harness/coach-harness';
import { buildMarkdownReport, type ScenarioRunReport } from '../harness/report';
import { restoreClock } from '../preconditions/load';
import { evaluateHardChecks, type QaRunView } from './hard-checks';
import { listQaTests, loadQaTest, QA_TESTS_DIR, QaTestError } from './load';
import { assertQaRun, runQaTest, scriptedQaDriver } from './run';
import type { HardCheck } from './schema';

// The package compiles as CommonJS, where `import.meta` does not typecheck; `__dirname` is the same anchor.
const PACKAGE_ROOT = join(__dirname, '..', '..');
const EXAMPLE = join(QA_TESTS_DIR, 'examples', 'release-week-no-pulse-question.json');
const FROM_SIM_RUN = join(PACKAGE_ROOT, 'report/from-sim-run.mjs');
const RUNNER_FILE = join(PACKAGE_ROOT, 'src/scenarios/qa-tests.sim.test.ts');

const dirs: string[] = [];
const originalReportDir = process.env.SIM_GATE_REPORT_DIR;
let runsDir = '';
let qaDir = '';

beforeEach(() => {
  runsDir = tempDir('qa-runs-');
  qaDir = tempDir('qa-tests-');
  process.env.SIM_GATE_REPORT_DIR = runsDir;
});

afterEach(() => {
  restoreClock();
  // Assigning undefined would store the string "undefined" and send later reports to ./undefined.
  if (originalReportDir === undefined) delete process.env.SIM_GATE_REPORT_DIR;
  else process.env.SIM_GATE_REPORT_DIR = originalReportDir;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

const example = () => JSON.parse(readFileSync(EXAMPLE, 'utf8')) as Record<string, unknown>;

function writeQaTest(name: string, body: Record<string, unknown>): string {
  const path = join(qaDir, `${name}.json`);
  writeFileSync(path, JSON.stringify(body));
  return path;
}

function readRun(): ScenarioRunReport {
  const file = readdirSync(runsDir).find((name) => name.endsWith('.json'))!;
  return JSON.parse(readFileSync(join(runsDir, file), 'utf8')) as ScenarioRunReport;
}

const EXAMPLE_REPLIES = example().replies as string[];
/** Bot reply i answers employee reply i, however often the orchestrator regenerates. */
const plainReplies = (texts: string[], employee: string[] = EXAMPLE_REPLIES) => new ScriptedAiProvider({
  responses: [({ turns }) => {
    const last = [...turns].reverse().find((turn) => turn.role === 'user')?.content ?? '';
    return { text: texts[employee.indexOf(last)] ?? 'Noted.', confidence: 0.9, containsSurveyProbe: false };
  }],
});

describe('loadQaTest', () => {
  it('loads the shipped example with its precondition', () => {
    const test = loadQaTest(EXAMPLE);
    expect(test).toMatchObject({
      id: 'release-week-no-pulse-question', jira: 'ENT-123', story: '2', tags: ['pulse', 'release-week'],
    });
    expect(test.replies).toHaveLength(2);
    expect(test.hardChecks.map((check) => check.check)).toEqual([
      'no-pulse-question', 'reply-under', 'no-question', 'escalation', 'memory-contains',
    ]);
    expect(test.resolvedPrecondition.name).toBe('cycle-open-with-history');
  });

  it('lists only top-level JSON files, so examples never run', () => {
    copyFileSync(EXAMPLE, join(qaDir, 'b.json'));
    copyFileSync(EXAMPLE, join(qaDir, 'a.json'));
    writeFileSync(join(qaDir, 'README.md'), '#');
    mkdirSync(join(qaDir, 'examples'));
    copyFileSync(EXAMPLE, join(qaDir, 'examples', 'c.json'));
    expect(listQaTests(qaDir)).toEqual([join(qaDir, 'a.json'), join(qaDir, 'b.json')]);
    expect(listQaTests(join(qaDir, 'missing'))).toEqual([]);
    writeFileSync(join(qaDir, 'UPPER.JSON'), '{}');
    expect(listQaTests(qaDir)).toContain(join(qaDir, 'UPPER.JSON'));
  });

  it('rejects an unknown schemaVersion naming the file and field', () => {
    const path = writeQaTest('v2', { ...example(), schemaVersion: 2 });
    expect(() => loadQaTest(path)).toThrow(QaTestError);
    expect(() => loadQaTest(path)).toThrow(/v2\.json: schemaVersion: unsupported QA test version 2/);
  });

  it('rejects an unknown hard check and lists the menu', () => {
    const path = writeQaTest('tone', { ...example(), hardChecks: [{ check: 'tone' }] });
    expect(() => loadQaTest(path)).toThrow(
      /hardChecks\.0\.check: .*\(hard checks: no-question, no-pulse-question, memory-contains, escalation, reply-under\)/,
    );
  });

  it('rejects unknown fields, empty replies, a turn past the last reply, and a test with nothing to check', () => {
    expect(() => loadQaTest(writeQaTest('typo', { ...example(), hardcheck: [] }))).toThrow(/Unrecognized key\(s\) in object: 'hardcheck'/);
    expect(() => loadQaTest(writeQaTest('empty', { ...example(), replies: [] }))).toThrow(/replies: /);
    expect(() => loadQaTest(writeQaTest('late', { ...example(), hardChecks: [{ check: 'no-question', turn: 3 }] })))
      .toThrow(/hardChecks\.0\.turn: turn 3 is past the last reply \(2\)/);
    expect(() => loadQaTest(writeQaTest('nothing', { ...example(), expected: [], hardChecks: [] })))
      .toThrow(/expected: a QA test needs at least one expected result or hard check/);
  });

  it('rejects a precondition path outside the preconditions folder', () => {
    expect(() => loadQaTest(writeQaTest('escape', { ...example(), precondition: '../qa-tests/examples/release-week-no-pulse-question.json' })))
      .toThrow(/escape\.json: precondition: must be a path inside/);
    expect(() => loadQaTest(writeQaTest('absolute', { ...example(), precondition: EXAMPLE }))).toThrow(/must be a path inside/);
  });

  it('rejects a missing precondition naming the QA file and the resolved path', () => {
    const path = writeQaTest('lost', { ...example(), precondition: 'examples/nope.json' });
    expect(() => loadQaTest(path)).toThrow(/lost\.json: precondition: file not found: .*preconditions\/examples\/nope\.json/);
  });
});

describe('evaluateHardChecks', () => {
  const effects = (overrides: Partial<TurnEffects> = {}): TurnEffects => ({
    outboundMetadata: null, memoryAdded: [], escalations: [], generationAttempts: 1, ...overrides,
  });
  const view = (overrides: Partial<QaRunView> = {}): QaRunView => ({
    sent: 2, replies: ['Sounds heavy.', 'What made it slip?'], effects: [effects(), effects()], memory: ['Leads the release checklist'],
    ...overrides,
  });
  const one = (check: HardCheck, run: QaRunView = view()) => evaluateHardChecks([check], run)[0]!;

  it('no-question checks every reply or the one turn', () => {
    expect(one({ check: 'no-question' })).toMatchObject({ met: false, actual: 'reply 2: 1 question(s): «What made it slip?»' });
    expect(one({ check: 'no-question', turn: 1 })).toMatchObject({ met: true, label: 'no question in reply 1', actual: 'as expected' });
  });

  it('no-pulse-question reads the topic question and survey probe metadata', () => {
    // Shapes the orchestrator writes (conversation-orchestrator.ts: topicQuestion object plus containsSurveyProbe).
    const run = view({ effects: [
      effects({ outboundMetadata: {
        topicQuestion: { questionGroup: 'growth', focus: 'open', policyVersion: 'v1' }, containsSurveyProbe: true, surveyProbeQuestionId: 'q-growth',
      } }),
      effects({ outboundMetadata: { containsSurveyProbe: true, surveyProbeQuestionId: 'q-belonging' } }),
    ] });
    expect(one({ check: 'no-pulse-question' }, run)).toMatchObject({
      met: false, actual: 'reply 1: topic question on growth (q-growth); reply 2: pulse probe q-belonging',
    });
    expect(one({ check: 'no-pulse-question' })).toMatchObject({ met: true });
  });

  it('memory-contains is a case-insensitive substring over memory after the run', () => {
    expect(one({ check: 'memory-contains', text: 'RELEASE checklist' })).toMatchObject({ met: true, actual: 'found: «Leads the release checklist»' });
    expect(one({ check: 'memory-contains', text: 'vacation' })).toMatchObject({ met: false, actual: 'not found in 1 memory item(s)' });
  });

  it('escalation checks raised and not raised', () => {
    const raised = view({ effects: [effects(), effects({ escalations: [{ type: 'risk', severity: 'high', riskType: 'burnout' }] })] });
    expect(one({ check: 'escalation', raised: true }, raised)).toMatchObject({ met: true, actual: 'turn 2: risk · high' });
    expect(one({ check: 'escalation', raised: false }, raised)).toMatchObject({ met: false, label: 'no escalation is raised' });
    expect(one({ check: 'escalation', raised: false })).toMatchObject({ met: true, actual: 'no escalation' });
  });

  it('reply-under fails a long reply and a reply that never came', () => {
    expect(one({ check: 'reply-under', chars: 15 })).toMatchObject({ met: false, actual: 'reply 2: 18 characters' });
    expect(one({ check: 'reply-under', chars: 15, turn: 1 })).toMatchObject({ met: true });
    expect(one({ check: 'reply-under', chars: 3 }, view({ sent: 1, replies: ['🙂🙂'], effects: [effects()] }))).toMatchObject({ met: true });
    const broken = view({ replies: ['Sounds heavy.'], effects: [effects()] });
    expect(one({ check: 'reply-under', chars: 500 }, broken)).toMatchObject({
      met: false, actual: 'reply 2: no reply (the turn failed or did not run)',
    });
  });
});

describe('runQaTest with a scripted provider and judge', () => {
  it('sends the replies from the precondition and records every expectation and hard check in the run report', async () => {
    const test = loadQaTest(EXAMPLE);
    const judged: string[][] = [];
    const result = await runQaTest(test, {
      aiProvider: plainReplies(['Slipped releases wear people down.', 'Late handoffs make a week feel endless.']),
      driver: scriptedQaDriver((replies, expected) => {
        judged.push(replies);
        return { met: [expected[0]!], unmet: [expected[1]!], reasoning: 'scripted' };
      }),
    });

    expect(judged).toEqual([['Slipped releases wear people down.', 'Late handoffs make a week feel endless.']]);
    expect(result.harness.userMessages).toEqual(test.replies);
    // Seeded history from the precondition comes before the QA replies.
    expect(result.harness.transcript).toHaveLength(5 + 4);
    expect(result.verdict).toMatchObject({ evaluated: true, success: false });

    const run = readRun();
    expect(run.qa).toEqual({
      file: 'qa-tests/examples/release-week-no-pulse-question.json',
      id: 'release-week-no-pulse-question',
      title: 'No pulse question right after a release-week vent',
      jira: 'ENT-123',
      story: '2',
      tags: ['pulse', 'release-week'],
      precondition: 'examples/cycle-open-with-history.json',
      expectations: [
        { text: 'The first reply acknowledges the exhaustion before anything else', met: true },
        { text: 'No reply asks a check-in or survey question about a pulse topic', met: false },
      ],
      hardChecks: [
        { check: 'no-pulse-question', label: 'no pulse question in every reply', met: true, actual: 'as expected' },
        { check: 'reply-under', label: 'every reply under 600 characters', met: true, actual: 'as expected' },
        { check: 'no-question', label: 'no question in reply 2', met: true, actual: 'as expected' },
        { check: 'escalation', label: 'no escalation is raised', met: true, actual: 'no escalation' },
        // The scripted provider extracts no memory, so text the precondition does not hold is not found.
        { check: 'memory-contains', label: 'memory contains «QA handoff»', met: false, actual: 'not found in 2 memory item(s)' },
      ],
    });
    expect(run.judge).toMatchObject({ evaluated: true, passed: false, reasoning: 'scripted' });
    expect(run.context?.precondition?.name).toBe('cycle-open-with-history');
  });

  it('marks a failing hard check with the offending reply', async () => {
    const path = writeQaTest('asks', { ...example(), hardChecks: [{ check: 'no-question' }] });
    const result = await runQaTest(loadQaTest(path), {
      aiProvider: plainReplies(['Rough week.', 'What slipped first?']),
      driver: scriptedQaDriver(),
    });
    expect(result.hardChecks).toEqual([expect.objectContaining({ met: false, actual: 'reply 2: 1 question(s): «What slipped first?»' })]);
    // Without a scripted verdict the expectations stay unjudged.
    expect(readRun().qa?.expectations.map((e) => e.met)).toEqual([null, null]);
  });

  it('with hard checks only, never calls the judge', async () => {
    const path = writeQaTest('checks-only', { ...example(), expected: [], hardChecks: [{ check: 'reply-under', chars: 100 }] });
    let judgeCalls = 0;
    const result = await runQaTest(loadQaTest(path), {
      aiProvider: plainReplies(['Short.', 'Also short.']),
      driver: scriptedQaDriver(() => { judgeCalls += 1; return { met: [], unmet: [] }; }),
    });
    expect(judgeCalls).toBe(0);
    expect(result.verdict.evaluated).toBe(false);
    expect(readRun().qa).toMatchObject({ expectations: [], hardChecks: [{ check: 'reply-under', met: true }] });
  });

  it('writes the report with the QA section when a turn throws, then rethrows', async () => {
    const path = writeQaTest('boom', { ...example(), hardChecks: [{ check: 'reply-under', chars: 500 }] });
    const provider = new ScriptedAiProvider({
      classifications: [
        makeClassification(),
        () => { throw new Error('classifier down'); },
      ],
      responses: [{ text: 'First reply.', confidence: 0.9, containsSurveyProbe: false }],
    });
    await expect(runQaTest(loadQaTest(path), {
      aiProvider: provider,
      driver: scriptedQaDriver(() => ({ met: [], unmet: [] })),
    })).rejects.toThrow('classifier down');

    const run = readRun();
    expect(run.qa?.expectations.map((e) => e.met)).toEqual([null, null]);
    expect(run.qa?.hardChecks).toEqual([expect.objectContaining({ met: false, actual: 'reply 2: no reply (the turn failed or did not run)' })]);
    expect(run.judge.evaluated).toBe(false);
    expect(run.deterministic.violations.map((v) => v.rule)).toContain('agent-turn-error');
  });
});

describe('suite report for QA tests', () => {
  function suiteFor(run: ScenarioRunReport, status: 'passed' | 'failed', failure = '') {
    const vitestJson = join(runsDir, 'vitest.json');
    writeFileSync(vitestJson, JSON.stringify({
      startTime: Date.parse(run.runAt),
      testResults: [{
        name: RUNNER_FILE,
        assertionResults: [{ fullName: run.testName, status, duration: 10, failureMessages: failure ? [failure] : [] }],
      }],
    }));
    const out = join(runsDir, 'suite.out');
    const child = spawnSync(process.execPath, [
      FROM_SIM_RUN, '--vitest', vitestJson, '--runs', runsDir, '--since', '1970-01-01T00:00:00Z', '--out', out,
    ], { encoding: 'utf8', cwd: PACKAGE_ROOT });
    expect(child.status, child.stderr).toBe(0);
    return (JSON.parse(readFileSync(out, 'utf8')) as {
      suite: { tests: Array<{
        descriptionSummary: string;
        description: Array<{ key: string; value: unknown }>;
        actual: { comparisons: Array<{ source: string; expected: string; actual: string; met: boolean | 'info' }> };
      }> };
    }).suite.tests[0]!;
  }

  it('shows Jira, story and tags, and one met / not met row per expectation and hard check', async () => {
    // Discovered the way the runner does: a file dropped into a QA tests folder.
    copyFileSync(EXAMPLE, join(qaDir, 'release-week-no-pulse-question.json'));
    const [file] = listQaTests(qaDir);
    await runQaTest(loadQaTest(file!), {
      aiProvider: plainReplies(['Slipped releases wear people down.', 'Late handoffs make a week feel endless.']),
      driver: scriptedQaDriver((_replies, expected) => ({ met: [expected[0]!], unmet: [expected[1]!] })),
    });
    const test = suiteFor(readRun(), 'failed', 'AssertionError: judge did not pass');
    const rows = Object.fromEntries(test.description.map((row) => [row.key, row.value]));
    expect(rows).toMatchObject({
      Jira: 'ENT-123',
      'сторі': '2',
      'теги': '`pulse` `release-week`',
      'мета': 'No pulse question right after a release-week vent',
    });
    expect(String(rows['сценарій'])).toContain('release-week-no-pulse-question.json');
    expect(test.descriptionSummary).toBe('ENT-123 story 2 pulse release-week');

    const qaRows = test.actual.comparisons.filter((row) => row.source === 'суддя' || row.source === 'жорстка перевірка');
    expect(qaRows).toHaveLength(2 + 5);
    expect(qaRows.filter((row) => row.source === 'суддя').map((row) => [row.expected, row.met])).toEqual([
      ['No reply asks a check-in or survey question about a pulse topic', false],
      ['The first reply acknowledges the exhaustion before anything else', true],
    ]);
    expect(qaRows.filter((row) => row.source === 'жорстка перевірка').map((row) => row.met)).toEqual([false, true, true, true, true]);
    // The runner file's own asserts are not listed as checks of a QA test.
    expect(test.actual.comparisons.some((row) => row.source === 'код тесту')).toBe(false);
  });

  it('shows the failure as a harness row when no QA row explains it, including a file that failed to load', () => {
    const vitestJson = join(runsDir, 'vitest.json');
    writeFileSync(vitestJson, JSON.stringify({
      startTime: Date.now(),
      testResults: [{
        name: RUNNER_FILE,
        assertionResults: [{ fullName: 'QA tests broken', status: 'failed', duration: 1, failureMessages: ['QaTestError: broken.json: invalid QA test'] }],
      }],
    }));
    const out = join(runsDir, 'suite.out');
    const child = spawnSync(process.execPath, [
      FROM_SIM_RUN, '--vitest', vitestJson, '--runs', runsDir, '--since', '1970-01-01T00:00:00Z', '--out', out,
    ], { encoding: 'utf8', cwd: PACKAGE_ROOT });
    expect(child.status, child.stderr).toBe(0);
    const test = (JSON.parse(readFileSync(out, 'utf8')) as {
      suite: { tests: Array<{ actual: { comparisons: Array<{ source: string; actual: string; met: unknown }> } }> };
    }).suite.tests[0]!;
    expect(test.actual.comparisons).toEqual([expect.objectContaining({ source: 'харнес', met: false, actual: expect.stringContaining('broken.json') })]);
  });

  it('shows a dash for missing Jira, story and tags', async () => {
    const rest = example();
    delete rest['jira'];
    delete rest['story'];
    delete rest['tags'];
    await runQaTest(loadQaTest(writeQaTest('bare', rest)), {
      aiProvider: plainReplies(['Okay.', 'Fine.']),
      driver: scriptedQaDriver((_replies, expected) => ({ met: expected, unmet: [] })),
    });
    const test = suiteFor(readRun(), 'passed');
    const rows = Object.fromEntries(test.description.map((row) => [row.key, row.value]));
    expect([rows['Jira'], rows['сторі'], rows['теги']]).toEqual(['—', '—', '—']);
    expect(test.descriptionSummary).toBe('qa-tests.sim.test.ts');
  });
});

describe('verdicts and assertions', () => {
  it('matches echoed criteria ignoring case and a trailing period; a passing judge covers unechoed lines', async () => {
    const test = loadQaTest(EXAMPLE);
    const [first, second] = test.expected as [string, string];
    await runQaTest(test, {
      aiProvider: plainReplies(['One.', 'Two.']),
      driver: scriptedQaDriver(() => ({ met: [`${first.toUpperCase()}.`], unmet: [`${second}.`] })),
    });
    expect(readRun().qa?.expectations.map((e) => e.met)).toEqual([true, false]);

    rmSync(runsDir, { recursive: true, force: true });
    mkdirSync(runsDir);
    await runQaTest(test, {
      aiProvider: plainReplies(['One.', 'Two.']),
      driver: scriptedQaDriver(() => ({ met: ['a reworded criterion'], unmet: [] })),
    });
    expect(readRun().qa?.expectations.map((e) => e.met)).toEqual([true, true]);
  });

  it('assertQaRun fails on a failed hard check and passes a hard-checks-only run without a judge', async () => {
    const asks = loadQaTest(writeQaTest('asks', { ...example(), expected: [], hardChecks: [{ check: 'no-question' }] }));
    const failing = await runQaTest(asks, { aiProvider: plainReplies(['Ok.', 'Why?']), driver: scriptedQaDriver() });
    expect(() => assertQaRun(asks, failing)).toThrow(/hard checks/);

    const short = loadQaTest(writeQaTest('short', { ...example(), expected: [], hardChecks: [{ check: 'reply-under', chars: 100 }] }));
    const passing = await runQaTest(short, { aiProvider: plainReplies(['Ok.', 'Fine.']), driver: scriptedQaDriver() });
    expect(() => assertQaRun(short, passing)).not.toThrow();
  });

  it('assertQaRun fails when expectations exist but the judge did not pass', async () => {
    const test = loadQaTest(EXAMPLE);
    const result = await runQaTest(test, { aiProvider: plainReplies(['One.', 'Two.']), driver: scriptedQaDriver() });
    expect(() => assertQaRun(test, result)).toThrow();
  });

  it('the Markdown run report fails on a failed hard check or an unjudged expectation and lists them', async () => {
    const path = writeQaTest('md', { ...example(), hardChecks: [{ check: 'no-question' }] });
    await runQaTest(loadQaTest(path), { aiProvider: plainReplies(['Ok.', 'Why?']), driver: scriptedQaDriver() });
    const markdown = buildMarkdownReport(readRun());
    expect(markdown).toContain('**Result: FAIL**');
    expect(markdown).toContain('| hard checks: 0/1 met');
    expect(markdown).toContain('- [UNMET] hard check: no question in every reply -> reply 2: 1 question(s): «Why?»');
    expect(markdown).toContain('- [NOT JUDGED] The first reply acknowledges the exhaustion before anything else');

    const run = readRun();
    const clean: ScenarioRunReport = { ...run, qa: { ...run.qa!, expectations: [], hardChecks: [{ check: 'no-question', label: 'x', met: true, actual: 'as expected' }] } };
    expect(buildMarkdownReport(clean)).toContain('**Result: PASS**');
  });
});
