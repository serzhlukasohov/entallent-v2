import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { makeClassification, makeMemoryProposal, ScriptedAiProvider } from '../fakes/scripted-ai';
import { harnessFromPrecondition, loadPrecondition, parsePrecondition, PreconditionError, restoreClock } from '../preconditions/load';
import type { PreconditionInput } from '../preconditions/schema';
import { loadQaTest } from '../qa/load';
import { ApproveError, approveCandidate } from './approve';
import { historyMinutes } from './export';
import { loadRecording, PACKAGE_ROOT, PRECONDITIONS_DIR, RecordingError } from './load';
import { recordPrecondition, writeCandidate } from './record';

const EXAMPLE_RECORDING = join(PACKAGE_ROOT, 'qa-tests/recordings/onboarded-release-week.json');
const RECORD_CLI = join(PACKAGE_ROOT, 'report/record-precondition.mjs');
const APPROVE_CLI = join(PACKAGE_ROOT, 'src/recording/approve-cli.ts');

const dirs: string[] = [];
const tempDir = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};
const writeJson = (path: string, value: unknown) => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2));
  return path;
};
const recordingFile = (value: Record<string, unknown>) => writeJson(join(tempDir('recording-'), 'recording.json'), value);

const reply = (text: string) => () => ({ text, confidence: 0.9, containsSurveyProbe: false });

/** Scripted bot that remembers one fact on the first turn and answers every reply with its number. */
const scriptedBot = () => new ScriptedAiProvider({
  memoryProposals: [makeMemoryProposal({
    memoryItems: [{
      category: 'project_context', canonicalKey: 'release_role', content: 'Hands the release over to the support team',
      confidence: 0.9, importance: 0.7, sensitivity: 'normal', expectedLifetime: 'months', sourceMessageIds: [],
      action: 'create', existingItemId: null,
    }],
  }), makeMemoryProposal()],
  responses: [reply('Bot reply 1.'), reply('Bot reply 2.')],
});

async function recordScripted(recordingPath: string, provider = scriptedBot()) {
  return recordPrecondition(loadRecording(recordingPath), { provider: 'scripted', aiProvider: provider });
}

/** A recorded candidate in `<dir>/<name>/precondition.json`. */
async function candidateIn(dir: string): Promise<{ path: string; candidate: PreconditionInput }> {
  const { candidate } = await recordScripted(EXAMPLE_RECORDING);
  return { path: writeCandidate(candidate, dir), candidate };
}

afterEach(() => {
  restoreClock();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('recordPrecondition', () => {
  it('records from a presets-only base: history, onboarding, memory and a candidate origin', async () => {
    const { candidate } = await recordScripted(EXAMPLE_RECORDING);

    expect(candidate.name).toBe('onboarded-release-week');
    expect(candidate.origin).toMatchObject({
      kind: 'recorded', approved: false, provider: 'scripted', base: 'inline base',
      recordedFrom: 'qa-tests/recordings/onboarded-release-week.json',
    });
    expect(candidate.presets).toBeUndefined();
    expect(candidate.user).toEqual({ name: 'Olena', timezone: 'Europe/Kyiv' });
    expect(candidate.history?.map((entry) => [entry.role, entry.text])).toEqual([
      ['employee', 'Release week again, I\'m swamped.'],
      ['bot', 'Bot reply 1.'],
      ['employee', 'Mostly the checklist and the handover to the support team.'],
      ['bot', 'Bot reply 2.'],
    ]);
    const minutes = candidate.history!.map((entry) => entry.minutesBeforeStart!);
    expect(minutes.at(-1)).toBeGreaterThanOrEqual(1);
    minutes.slice(1).forEach((value, index) => expect(value).toBeLessThan(minutes[index]!));
    expect(candidate.memory).toEqual([{ category: 'project_context', content: 'Hands the release over to the support team', importance: 0.7 }]);
    expect(candidate.onboarding).toMatchObject({ role: 'employee', introStatus: 'completed', participation: 'active' });
    // Pinned to the end of the recording, so the exported absolute dates (onboarding) keep their distance.
    expect(Math.abs(Date.parse(candidate.startTime!) - Date.now())).toBeLessThan(60_000);
    expect(Date.parse(candidate.onboarding!.completedAt!)).toBeLessThan(Date.parse(candidate.startTime!));
    // A candidate loads only for the approve command.
    expect(() => parsePrecondition(candidate)).toThrow(/candidate precondition.*sim:approve/);
    expect(parsePrecondition(candidate, null, { allowCandidate: true }).state.history).toHaveLength(4);
  });

  it('records from a file base: base history, goals, cycle, style and scheduled actions carry over', async () => {
    const path = recordingFile({
      schemaVersion: 1, name: 'cycle-follow-up', base: 'examples/cycle-open-with-history.json', replies: ['Handover is done.'],
    });
    const { candidate } = await recordScripted(path, new ScriptedAiProvider({
      // Evaluated at call time, on the clock shifted to the base start time.
      classifications: [() => makeClassification({ reminderRequest: { intent: 'review the release notes', dueAt: new Date(Date.now() + 86_400_000 * 3).toISOString() } })],
    }));
    const base = loadPrecondition(join(PRECONDITIONS_DIR, 'examples/cycle-open-with-history.json'));

    // Outside the repo only the file name is kept: the origin is committed, machine paths are not.
    expect(candidate.origin).toMatchObject({ base: 'cycle-open-with-history', recordedFrom: 'recording.json' });
    expect(candidate.history?.slice(0, 5).map((entry) => entry.text)).toEqual(base.state.history?.map((entry) => entry.text));
    expect(candidate.history?.[0]?.metadata).toEqual({ reportingDisclosureVersion: 'reporting-disclosure-v1' });
    expect(candidate.history?.[5]).toMatchObject({ role: 'employee', text: 'Handover is done.' });
    expect(candidate.history).toHaveLength(7);
    // The base started at a fixed time, so the candidate keeps one: the moment the recording ended.
    expect(Date.parse(candidate.startTime!)).toBeGreaterThanOrEqual(Date.parse(base.state.startTime!));
    expect(candidate.goals?.map((goal) => `${goal.title} (${goal.status})`)).toEqual(base.state.goals?.map((goal) => `${goal.title} (${goal.status})`));
    expect(candidate.styleProfile?.adaptationWeight).toBe(base.state.styleProfile?.adaptationWeight);
    expect(candidate.pulseCycle?.topics?.map((topic) => [topic.group, topic.questions.map((question) => question.status)]))
      .toEqual(base.state.pulseCycle?.topics.map((topic) => [topic.group, topic.questions.map((question) => question.status)]));
    expect(candidate.pulseCycle?.topics?.flatMap((topic) => topic.evidence ?? []))
      .toEqual(base.state.pulseCycle?.topics.flatMap((topic) => topic.evidence).map((item) => expect.objectContaining({
        summary: item.summary, sourceHistoryIndexes: item.sourceHistoryIndexes,
      })));
    expect(candidate.pulseCycle?.nextProbe).toEqual(base.state.pulseCycle?.nextProbe ?? null);
    expect(candidate.scheduledActions?.map((action) => action.intent)).toEqual([
      ...(base.state.scheduledActions ?? []).map((action) => action.intent), 'review the release notes',
    ]);
    // Due times stay relative to the start: the base action due in a day, the new reminder in three.
    expect(candidate.scheduledActions?.map((action) => Math.round(action.dueInMinutes / 60)))
      .toEqual([...(base.state.scheduledActions ?? []).map((action) => Math.round(action.dueInMinutes / 60)), 72]);
    // The candidate rebuilds into the same conversation.
    const rebuilt = await harnessFromPrecondition(parsePrecondition(candidate, null, { allowCandidate: true }), { aiProvider: new ScriptedAiProvider() });
    expect(rebuilt.transcript.map((message) => message.text)).toEqual(candidate.history?.map((entry) => entry.text));
  });

  it('exports nothing when a turn throws', async () => {
    const candidatesDir = tempDir('candidates-');
    const failing = new ScriptedAiProvider({
      responses: [reply('Bot reply 1.'), () => { throw new Error('model down'); }],
    });
    await expect(recordScripted(EXAMPLE_RECORDING, failing).then(({ candidate }) => writeCandidate(candidate, candidatesDir)))
      .rejects.toThrow('model down');
    expect(existsSync(join(candidatesDir, 'onboarded-release-week'))).toBe(false);
  });

  it('refuses an implied provider', async () => {
    const recording = loadRecording(EXAMPLE_RECORDING);
    await expect(recordPrecondition(recording, { provider: 'scripted' })).rejects.toThrow(/scripted aiProvider/);
    await expect(recordPrecondition(recording, { provider: 'live', aiProvider: new ScriptedAiProvider() })).rejects.toThrow(/do not pass aiProvider/);
  });

  it('keeps exported history strictly ordered when turns share a millisecond', () => {
    expect(historyMinutes([1_000, 1_000, 1_000], 1_000)).toEqual([1.02, 1.01, 1]);
    expect(historyMinutes([0, 60_000 * 9], 60_000 * 10)).toEqual([10, 1]);
  });
});

describe('loadRecording errors', () => {
  it.each([
    [{ schemaVersion: 2, name: 'x', replies: ['hi'] }, /schemaVersion: unsupported recording version 2/],
    [{ schemaVersion: 1, name: 'x' }, /replies: Required/],
    [{ schemaVersion: 1, name: 'Bad Name', replies: ['hi'] }, /name: use lowercase/],
    [{ schemaVersion: 1, name: 'x', replies: ['hi'], extra: true }, /Unrecognized key/],
    [{ schemaVersion: 1, name: 'x', base: '../qa-tests/README.md', replies: ['hi'] }, /base: must be a path inside/],
    [{ schemaVersion: 1, name: 'x', base: 'missing.json', replies: ['hi'] }, /base: file not found/],
    [{ schemaVersion: 1, name: 'x', base: { schemaVersion: 1, presets: ['vacation'] }, replies: ['hi'] }, /base: [\s\S]*known presets/],
  ])('rejects %j', (value, message) => {
    const path = recordingFile(value);
    expect(() => loadRecording(path)).toThrow(RecordingError);
    expect(() => loadRecording(path)).toThrow(message);
    expect(() => loadRecording(path)).toThrow(path);
  });
});

describe('candidates are never test state', () => {
  it('rejects an unapproved recording placed among the preconditions, and an approval without who or when', async () => {
    const preconditionsDir = tempDir('preconditions-');
    const { candidate } = await recordScripted(EXAMPLE_RECORDING);
    writeJson(join(preconditionsDir, 'recorded/sneaky.json'), candidate);
    const qaFile = writeJson(join(tempDir('qa-'), 'uses-candidate.json'), {
      schemaVersion: 1, title: 'uses a candidate', precondition: 'recorded/sneaky.json', replies: ['hi'],
      hardChecks: [{ check: 'no-question' }],
    });
    expect(() => loadQaTest(qaFile, preconditionsDir)).toThrow(/origin\.approved: candidate precondition/);

    const unsigned = { ...candidate, origin: { ...candidate.origin, approved: true } };
    expect(() => parsePrecondition(unsigned, 'unsigned.json')).toThrow(PreconditionError);
    expect(() => parsePrecondition(unsigned, 'unsigned.json')).toThrow(/origin\.approvedBy/);
    const blankApprover = { ...candidate, origin: { ...candidate.origin, approved: true, approvedBy: '  ', approvedAt: '2026-11-01T00:00:00Z' } };
    expect(() => parsePrecondition(blankApprover, 'blank.json')).toThrow(/origin\.approvedBy/);
  });

  it('cannot reference the candidates folder from a QA test', () => {
    const qaFile = writeJson(join(tempDir('qa-'), 'outside.json'), {
      schemaVersion: 1, title: 'outside', precondition: '../precondition-candidates/x/precondition.json', replies: ['hi'],
      hardChecks: [{ check: 'no-question' }],
    });
    expect(() => loadQaTest(qaFile)).toThrow(/must be a path inside/);
  });
});

describe('approveCandidate', () => {
  it('marks the candidate approved and moves it into preconditions/recorded, leaving the reports', async () => {
    const candidatesDir = tempDir('candidates-');
    const preconditionsDir = tempDir('preconditions-');
    const { path } = await candidateIn(candidatesDir);
    const reportFile = writeJson(join(candidatesDir, 'onboarded-release-week/runs/report.json'), { meta: {} });

    const result = approveCandidate({
      candidate: join(candidatesDir, 'onboarded-release-week'), approvedBy: 'Olena QA', allowScripted: true,
      now: new Date('2026-11-01T09:00:00Z'), preconditionsDir,
    });

    expect(result).toEqual({ target: join(preconditionsDir, 'recorded/onboarded-release-week.json'), reference: 'recorded/onboarded-release-week.json' });
    expect(existsSync(path)).toBe(false);
    expect(existsSync(reportFile)).toBe(true);
    const approved = loadPrecondition(result.target);
    expect(approved.origin).toMatchObject({
      kind: 'recorded', approved: true, approvedBy: 'Olena QA', approvedAt: '2026-11-01T09:00:00.000Z',
      recordedFrom: 'qa-tests/recordings/onboarded-release-week.json', base: 'inline base', provider: 'scripted',
    });
  });

  it('refuses a scripted recording without the flag, an approved file, an existing target and an empty approver', async () => {
    const candidatesDir = tempDir('candidates-');
    const preconditionsDir = tempDir('preconditions-');
    const { path, candidate } = await candidateIn(candidatesDir);
    const approve = (overrides: Partial<Parameters<typeof approveCandidate>[0]> = {}) =>
      approveCandidate({ candidate: path, approvedBy: 'QA', allowScripted: true, preconditionsDir, ...overrides });

    expect(() => approve({ allowScripted: false })).toThrow(/scripted provider/);
    const unknownProvider = writeJson(join(candidatesDir, 'unknown/precondition.json'), {
      ...candidate, name: 'unknown', origin: { ...candidate.origin, provider: undefined },
    });
    expect(() => approve({ candidate: unknownProvider, allowScripted: false })).toThrow(/unknown provider/);
    expect(() => approve({ approvedBy: '  ' })).toThrow(/approver is empty/);
    expect(() => approve({ candidate: join(candidatesDir, 'missing') })).toThrow(/candidate not found/);
    writeJson(join(preconditionsDir, 'recorded/onboarded-release-week.json'), { taken: true });
    expect(() => approve()).toThrow(/already exists/);
    expect(existsSync(path)).toBe(true);

    const signed = writeJson(join(candidatesDir, 'signed/precondition.json'), {
      ...candidate, origin: { ...candidate.origin, approved: true, approvedBy: 'X', approvedAt: '2026-10-01T00:00:00Z' },
    });
    expect(() => approve({ candidate: signed })).toThrow(ApproveError);
    expect(() => approve({ candidate: signed })).toThrow(/already approved by X/);
  });
});

describe('an approved precondition in a QA test', () => {
  it('seeds the recorded history with no model call before the first reply', async () => {
    const candidatesDir = tempDir('candidates-');
    const preconditionsDir = tempDir('preconditions-');
    const { candidate } = await candidateIn(candidatesDir);
    const { reference } = approveCandidate({
      candidate: join(candidatesDir, 'onboarded-release-week'), approvedBy: 'QA', allowScripted: true, preconditionsDir,
    });
    const qaFile = writeJson(join(tempDir('qa-'), 'after-release-week.json'), {
      schemaVersion: 1, title: 'after the release week', precondition: reference, replies: ['It shipped!'],
      hardChecks: [{ check: 'reply-under', chars: 600 }],
    });

    const test = loadQaTest(qaFile, preconditionsDir);
    const harness = await harnessFromPrecondition(test.resolvedPrecondition, { aiProvider: new ScriptedAiProvider() });

    expect(harness.transcript.map((message) => message.text)).toEqual(candidate.history?.map((entry) => entry.text));
    expect(harness.trace.events.filter((event) => event.kind === 'llm')).toEqual([]);
    expect(harness.memoryItems.map((item) => item.content)).toEqual(['Hands the release over to the support team']);
    expect(harness.context.precondition?.origin).toMatch(/^recorded \(approved by QA on \d{4}-\d{2}-\d{2}, from qa-tests\/recordings\//);

    await harness.send('It shipped!');
    expect(harness.trace.events.filter((event) => event.kind === 'llm').length).toBeGreaterThan(0);
  });
});

describe('sim:record and sim:approve commands (scripted)', () => {
  it('requires an explicit provider', () => {
    const child = spawnSync(process.execPath, [RECORD_CLI, EXAMPLE_RECORDING], { encoding: 'utf8', cwd: PACKAGE_ROOT });
    expect(child.status).toBe(1);
    expect(child.stderr).toContain('--live | --scripted');
  });

  it('records a candidate with a suite report, then approves it into a loadable precondition', () => {
    const candidatesDir = tempDir('candidates-');
    const preconditionsDir = tempDir('preconditions-');
    // INIT_CWD from the outer pnpm run would redirect relative paths; these are absolute anyway.
    const env = { ...process.env, INIT_CWD: PACKAGE_ROOT, SIM_RECORD_FILE: '', SIM_GATE_REPORT_DIR: '' };
    const record = spawnSync(process.execPath, [RECORD_CLI, EXAMPLE_RECORDING, '--scripted', '--candidates', candidatesDir], {
      encoding: 'utf8', cwd: PACKAGE_ROOT, env,
    });
    expect(record.status, `${record.stdout}\n${record.stderr}`).toBe(0);

    const candidateDir = join(candidatesDir, 'onboarded-release-week');
    expect(existsSync(join(candidateDir, 'precondition.json'))).toBe(true);
    const suite = JSON.parse(readFileSync(join(candidateDir, 'runs/report.json'), 'utf8')) as {
      meta: { title: string };
      suite: { tests: Array<{ status: string; given: { summary: string }; steps: unknown[] }> };
    };
    expect(suite.meta.title).toBe('Recording onboarded-release-week (scripted)');
    expect(suite.suite.tests).toHaveLength(1);
    expect(suite.suite.tests[0]!.status).toBe('passed');
    expect(suite.suite.tests[0]!.given.summary).toContain('inline base');
    expect(JSON.stringify(suite.suite.tests[0]!.steps)).toContain('Mostly the checklist and the handover to the support team.');

    const approve = spawnSync(process.execPath, [
      '--import', 'tsx', APPROVE_CLI, candidateDir, '--by', 'QA tester', '--allow-scripted', '--preconditions', preconditionsDir,
    ], { encoding: 'utf8', cwd: PACKAGE_ROOT, env });
    expect(approve.status, approve.stderr).toBe(0);
    expect(approve.stdout).toContain('"precondition": "recorded/onboarded-release-week.json"');
    expect(loadPrecondition(join(preconditionsDir, 'recorded/onboarded-release-week.json')).origin)
      .toMatchObject({ approved: true, approvedBy: 'QA tester' });
  }, 120_000);

  it('approve resolves relative paths against the folder pnpm started in, and rejects a flag without a value', async () => {
    const workDir = tempDir('work-');
    const { candidate } = await recordScripted(EXAMPLE_RECORDING);
    writeCandidate(candidate, join(workDir, 'candidates'));
    const env = { ...process.env, INIT_CWD: workDir };
    const run = (...args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', APPROVE_CLI, ...args], { encoding: 'utf8', cwd: PACKAGE_ROOT, env });

    const missingValue = run('candidates/onboarded-release-week', '--allow-scripted', '--preconditions');
    expect(missingValue.status).toBe(1);
    expect(missingValue.stderr).toContain('--preconditions needs a value');

    const approved = run('candidates/onboarded-release-week', '--by', 'QA', '--allow-scripted', '--preconditions', 'preconditions');
    expect(approved.status, approved.stderr).toBe(0);
    expect(existsSync(join(workDir, 'preconditions/recorded/onboarded-release-week.json'))).toBe(true);
  }, 60_000);
});
