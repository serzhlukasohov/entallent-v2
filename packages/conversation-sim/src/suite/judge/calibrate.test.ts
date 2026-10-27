import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RUNNER_CONFIG } from '../__fixtures__/runner';
import { stableJson } from '../baseline';
import { syntheticRun } from '../rules/synthetic-run';
import { AgreementFileSchema, type LabelsFile } from '../schema';
import {
  agreementPath,
  agreementStats,
  calibrate,
  calibrationLines,
  computeAgreement,
  importQaExport,
  labelJudgeInput,
  labelsPath,
  labelsSha256,
  qaExportToLabels,
  readAgreementFile,
  readLabelsFile,
  resolveLabelContext,
  transcriptSha256,
  writeAgreementFile,
  writeLabelsFile,
  type AgreementPair,
} from './calibrate';
import { DIALOGUE, REPLY, UNCOVERED, calibrationSuite, fakeJudge, label, qaExport } from './__fixtures__/calibration';
import { computeJudgeFingerprint, sha256 } from './fingerprint';
import { buildJudgeInput } from './judge-input';
import { QaSessionExportSchema } from '../schema';

const EMPTY: LabelsFile = { schemaVersion: 1, labels: [] };
const NOW = () => new Date('2026-10-25T10:00:00.000Z');

describe('resolveLabelContext', () => {
  const suite = calibrationSuite();

  it('resolves layer, manifest text, guidance, fixture context and scope', () => {
    expect(resolveLabelContext(suite, 'Y-01.C2')).toEqual({
      ok: true,
      context: {
        criterionId: 'Y-01.C2',
        layer: 'D',
        passCondition: 'The question is about priorities.',
        expectedBehavior: 'The coach asks one focused question.',
        judgeGuidance: 'Deadlines count as priorities.',
        fixtureContext: { pulseCycle: { uncoveredTopics: UNCOVERED } },
        scope: 'reply',
      },
    });
    expect(resolveLabelContext(suite, 'Y-01.C3')).toMatchObject({ ok: true, context: { scope: 'conversation', judgeGuidance: null } });
  });

  it.each([
    ['X-99.C1', 'unknown-criterion'],
    ['Y-01.C4', 'not-testable'],
    ['Y-01.C5', 'not-judgeable'],
  ])('refuses %s as %s', (criterionId, reason) => {
    expect(resolveLabelContext(suite, criterionId)).toMatchObject({ ok: false, reason });
  });

  it.each([
    ['guidance', 'judgeGuidance'],
    ['fixture', 'fixture context'],
    ['scope', 'scope'],
  ] as const)('refuses a criterion whose two tests differ only in %s', (conflict, field) => {
    const result = resolveLabelContext(calibrationSuite({ conflict }), 'Y-01.C2');
    expect(result).toMatchObject({ ok: false, reason: 'ambiguous-context' });
    expect(!result.ok && result.message).toContain(`different ${field} in Y-01.A1 and Y-01.J`);
  });

  it('resolves an after-step criterion with reply scope and builds the same input as buildJudgeInput', () => {
    const result = resolveLabelContext(suite, 'Y-01.C6');
    expect(result).toMatchObject({ ok: true, context: { scope: 'reply', layer: 'C' } });
    if (!result.ok) return;
    const test = suite.tests[0]!;
    const run = { ...syntheticRun('Y-01.A1', [REPLY]), level: 'L1' as const };
    run.steps[0]!.userText = 'Two releases this week.';
    const built = buildJudgeInput(test, run, test.criteria.find((entry) => entry.id === 'Y-01.C6')!);
    const fromLabel = labelJudgeInput(label({ criterionId: 'Y-01.C6', status: 'PASS', transcript: built.input.transcript }), result.context);
    expect(fromLabel).toEqual(built);
  });
});

describe('QA export import', () => {
  const suite = calibrationSuite();

  it('converts statuses into labels with truncated transcripts and provenance-only refs', () => {
    const exported = QaSessionExportSchema.parse(
      qaExport([
        {
          ref: 'qa-7',
          statuses: [
            { criterionId: 'Y-01.C1', status: 'PASS', replyIndex: 3 },
            { criterionId: 'Y-01.C3', status: 'FAIL', replyIndex: null },
          ],
        },
      ]),
    );
    const [first, second] = qaExportToLabels(exported);
    expect(first).toEqual({
      criterionId: 'Y-01.C1',
      status: 'PASS',
      transcript: { turns: DIALOGUE.slice(0, 4), evaluatedReplyIndex: 3 },
      source: { kind: 'qa-session', ref: 'qa-7' },
      labeler: 'qa-anna',
      labeledAt: '2026-10-20T09:00:00.000Z',
    });
    expect(second!.transcript).toEqual({ turns: DIALOGUE, evaluatedReplyIndex: null });
  });

  it('appends new labels in export order and keeps existing ones untouched', () => {
    const existing: LabelsFile = { schemaVersion: 1, labels: [label({ criterionId: 'Y-01.C2', status: 'FAIL', source: { kind: 'suite-run', ref: 'run-1' } })] };
    const result = importQaExport(
      suite,
      existing,
      qaExport([{ ref: 'qa-7', statuses: [{ criterionId: 'Y-01.C1', status: 'PASS', replyIndex: 3 }, { criterionId: 'Y-01.C1', status: 'FAIL', replyIndex: 5 }] }]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.file.labels[0]).toBe(existing.labels[0]);
    expect(result.file.labels.map((entry) => [entry.criterionId, entry.status, entry.transcript.evaluatedReplyIndex])).toEqual([
      ['Y-01.C2', 'FAIL', 3],
      ['Y-01.C1', 'PASS', 3],
      ['Y-01.C1', 'FAIL', 5],
    ]);
    expect(result.warnings).toEqual([]);
  });

  it('skips duplicates against existing labels and within the import, naming a differing status', () => {
    const existing: LabelsFile = { schemaVersion: 1, labels: [label({ criterionId: 'Y-01.C1', status: 'PASS' })] };
    const result = importQaExport(
      suite,
      existing,
      qaExport([
        { ref: 'qa-8', statuses: [{ criterionId: 'Y-01.C1', status: 'FAIL', replyIndex: 3 }] },
        { ref: 'qa-9', statuses: [{ criterionId: 'Y-01.C3', status: 'PASS', replyIndex: null }] },
        { ref: 'qa-10', statuses: [{ criterionId: 'Y-01.C3', status: 'PASS', replyIndex: null }] },
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.added.map((entry) => entry.source.ref)).toEqual(['qa-9']);
    expect(result.file.labels[0]!.status).toBe('PASS');
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings[0]).toMatch(/skipped duplicate label Y-01\.C1 from session qa-8 .*the export says FAIL, the kept label says PASS/);
    expect(result.warnings[1]).toMatch(/skipped duplicate label Y-01\.C3 from session qa-10/);
    expect(result.warnings[1]).not.toMatch(/export says/);
  });

  it.each([
    ['a replyIndex on a user turn', { criterionId: 'Y-01.C1', status: 'PASS', replyIndex: 2 }, /session qa-7, Y-01\.C1: .*coach turn/],
    ['a replyIndex outside the dialogue', { criterionId: 'Y-01.C1', status: 'PASS', replyIndex: 40 }, /session qa-7, Y-01\.C1: .*outside the dialogue/],
    ['an unknown criterion', { criterionId: 'X-99.C1', status: 'PASS', replyIndex: 3 }, /session qa-7, X-99\.C1: unknown-criterion/],
    ['a NOT TESTABLE criterion', { criterionId: 'Y-01.C4', status: 'PASS', replyIndex: 3 }, /session qa-7, Y-01\.C4: not-testable/],
    ['a not-judgeable criterion', { criterionId: 'Y-01.C5', status: 'PASS', replyIndex: 3 }, /session qa-7, Y-01\.C5: not-judgeable/],
    ['a reply index on a conversation criterion', { criterionId: 'Y-01.C3', status: 'PASS', replyIndex: 3 }, /Y-01\.C3 is a conversation criterion/],
    ['no reply index on a reply criterion', { criterionId: 'Y-01.C1', status: 'PASS', replyIndex: null }, /Y-01\.C1 is judged on one reply/],
  ] as const)('rejects the whole import on %s', (_name, bad, message) => {
    const result = importQaExport(
      suite,
      EMPTY,
      qaExport([{ ref: 'qa-7', statuses: [{ criterionId: 'Y-01.C2', status: 'PASS', replyIndex: 3 }, { ...bad }] }]),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join('\n')).toMatch(message);
  });

  it('rejects an export with the wrong schema version', () => {
    const result = importQaExport(suite, EMPTY, { ...qaExport([]), schemaVersion: 2 });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.join('\n')).toMatch(/schemaVersion/);
  });

  it('rejects a conversation status on a dialogue without a coach turn, naming session and criterion', () => {
    const result = importQaExport(
      suite,
      EMPTY,
      qaExport([{ ref: 'qa-11', dialogue: [{ role: 'user', text: 'Hi.' }], statuses: [{ criterionId: 'Y-01.C3', status: 'PASS', replyIndex: null }] }]),
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.join('\n')).toMatch(/\[suite\] import: session qa-11, Y-01\.C3: transcript\.turns: .*coach turn/);
  });
});

describe('hashes', () => {
  it('hashes transcripts and labels with stable JSON', () => {
    const transcript = { turns: DIALOGUE.slice(0, 4), evaluatedReplyIndex: 3 };
    expect(transcriptSha256(transcript)).toBe(sha256(stableJson(transcript)));
    expect(transcriptSha256({ evaluatedReplyIndex: 3, turns: DIALOGUE.slice(0, 4) })).toBe(transcriptSha256(transcript));
    const labels = [label({ criterionId: 'Y-01.C1', status: 'PASS' })];
    expect(labelsSha256(labels)).toBe(sha256(stableJson(labels)));
    expect(labelsSha256([{ ...labels[0]!, status: 'FAIL' }])).not.toBe(labelsSha256(labels));
  });
});

describe('agreement math', () => {
  const pair = (label: 'PASS' | 'FAIL', judge: 'PASS' | 'FAIL' | 'ERROR', layer: AgreementPair['layer'] = 'P'): AgreementPair => ({ layer, label, judge });

  it('computes overall agreement and Cohen kappa', () => {
    // po = 0.75; pe = 0.5 * 0.25 + 0.5 * 0.75 = 0.5; kappa = 0.5.
    expect(agreementStats([pair('PASS', 'PASS'), pair('PASS', 'FAIL'), pair('FAIL', 'FAIL'), pair('FAIL', 'FAIL')])).toEqual({
      n: 4,
      overall: 0.75,
      kappa: 0.5,
    });
  });

  it('is null for n = 0 and kappa null when chance agreement is 1', () => {
    expect(agreementStats([])).toEqual({ n: 0, overall: null, kappa: null });
    expect(agreementStats([pair('PASS', 'PASS'), pair('PASS', 'PASS')])).toEqual({ n: 2, overall: 1, kappa: null });
  });

  it('counts ERROR as its own disagreeing category', () => {
    // po = 0.5; human PASS 0.5, FAIL 0.5; judge PASS 0.25, FAIL 0.25, ERROR 0.5; pe = 0.25; kappa = 1/3.
    const stats = agreementStats([pair('PASS', 'PASS'), pair('FAIL', 'FAIL'), pair('PASS', 'ERROR'), pair('FAIL', 'ERROR')]);
    expect(stats.overall).toBe(0.5);
    expect(stats.kappa).toBeCloseTo(1 / 3, 10);
  });

  it('always reports all four layers', () => {
    const agreement = computeAgreement([pair('PASS', 'PASS', 'P'), pair('FAIL', 'PASS', 'S')]);
    expect(agreement).toEqual({
      n: 2,
      overall: 0.5,
      kappa: 0,
      perLayer: {
        P: { n: 1, overall: 1, kappa: null },
        D: { n: 0, overall: null, kappa: null },
        C: { n: 0, overall: null, kappa: null },
        S: { n: 1, overall: 0, kappa: 0 },
      },
    });
  });
});

describe('calibrate', () => {
  const suite = calibrationSuite();

  it('judges each label with the same input buildJudgeInput builds for an equivalent run', async () => {
    const test = suite.tests[0]!;
    const run = { ...syntheticRun('Y-01.A1', [REPLY]), level: 'L1' as const };
    run.steps[0]!.userText = 'Two releases this week.';
    const c2 = test.criteria.find((entry) => entry.id === 'Y-01.C2')!;
    const c3 = test.criteria.find((entry) => entry.id === 'Y-01.C3')!;
    const built2 = buildJudgeInput(test, run, c2);
    const built3 = buildJudgeInput(test, run, c3);
    const labels: LabelsFile = {
      schemaVersion: 1,
      labels: [
        label({ criterionId: 'Y-01.C2', status: 'PASS', transcript: built2.input.transcript }),
        label({ criterionId: 'Y-01.C3', status: 'PASS', transcript: built3.input.transcript }),
      ],
    };
    const fake = fakeJudge(() => 'PASS');
    const result = await calibrate({ suite, labels, judge: fake.judge, judgeConfig: RUNNER_CONFIG.judge, now: NOW });
    expect(fake.inputs).toEqual([built2.input, built3.input]);
    expect(result.agreement).toEqual({
      schemaVersion: 1,
      fingerprint: computeJudgeFingerprint(RUNNER_CONFIG.judge, suite),
      labelsSha256: labelsSha256(labels.labels),
      n: 2,
      overall: 1,
      kappa: null,
      perLayer: {
        P: { n: 0, overall: null, kappa: null },
        D: { n: 1, overall: 1, kappa: null },
        C: { n: 0, overall: null, kappa: null },
        S: { n: 1, overall: 1, kappa: null },
      },
      computedAt: '2026-10-25T10:00:00.000Z',
    });
    expect(AgreementFileSchema.parse(result.agreement)).toEqual(result.agreement);
    expect(result.usage).toEqual({ calls: 2, inputTokens: 20, outputTokens: 10, totalTokens: 30 });
  });

  it('records disagreements and judge errors, which count against agreement', async () => {
    const labels: LabelsFile = {
      schemaVersion: 1,
      labels: [
        label({ criterionId: 'Y-01.C1', status: 'PASS', source: { kind: 'qa-session', ref: 'qa-1' } }),
        label({ criterionId: 'Y-01.C2', status: 'PASS', source: { kind: 'qa-session', ref: 'qa-2' } }),
        label({ criterionId: 'Y-01.C3', status: 'FAIL', transcript: { turns: DIALOGUE, evaluatedReplyIndex: null }, source: { kind: 'qa-session', ref: 'qa-3' } }),
      ],
    };
    const fake = fakeJudge((input) => (input.layer === 'P' ? 'FAIL' : input.layer === 'D' ? 'reject' : 'FAIL'));
    const result = await calibrate({ suite, labels, judge: fake.judge, judgeConfig: RUNNER_CONFIG.judge, now: NOW });
    expect(result.outcomes.map((outcome) => [outcome.decision.status, outcome.agrees])).toEqual([
      ['FAIL', false],
      ['ERROR', false],
      ['FAIL', true],
    ]);
    expect(result.judgeErrors).toBe(1);
    expect(result.agreement.overall).toBeCloseTo(1 / 3, 10);
    const lines = calibrationLines(result, 40);
    expect(lines[0]).toBe('[suite] layer     n   agree   kappa');
    expect(lines).toContain('[suite] P         1    0.0%   0.000');
    expect(lines).toContain('[suite] C         0     n/a     n/a');
    expect(lines.filter((line) => line.startsWith('[suite] disagreement:'))).toEqual([
      '[suite] disagreement: Y-01.C1 label PASS judge FAIL ref qa-1 labeledAt 2026-10-20T09:00:00.000Z: judged FAIL',
      '[suite] disagreement: Y-01.C2 label PASS judge ERROR ref qa-2 labeledAt 2026-10-20T09:00:00.000Z: judge-transport: Error: socket hang up',
    ]);
    expect(lines).toContain('[suite] warning: 3 labels is below minLabels 40');
    expect(calibrationLines(result, 3).some((line) => line.includes('below minLabels'))).toBe(false);
  });

  it('re-asks once when PASS evidence is not a verbatim fragment, exactly as evaluate does', async () => {
    let calls = 0;
    const judge = async () => {
      calls += 1;
      return { status: 'PASS' as const, reason: 'ok', evidence: 'not in the reply', usage: { calls: 1, inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
    };
    const labels: LabelsFile = { schemaVersion: 1, labels: [label({ criterionId: 'Y-01.C1', status: 'PASS' })] };
    const result = await calibrate({ suite, labels, judge, judgeConfig: RUNNER_CONFIG.judge, now: NOW });
    expect(calls).toBe(2);
    expect(result.outcomes[0]!.decision).toMatchObject({ status: 'ERROR', reason: 'judge-invalid-output' });
  });

  it('refuses an unresolvable label before any judge call', async () => {
    const fake = fakeJudge(() => 'PASS');
    const labels: LabelsFile = {
      schemaVersion: 1,
      labels: [label({ criterionId: 'Y-01.C1', status: 'PASS' }), label({ criterionId: 'Y-01.C2', status: 'PASS', source: { kind: 'qa-session', ref: 'qa-5' } })],
    };
    await expect(
      calibrate({ suite: calibrationSuite({ conflict: 'guidance' }), labels, judge: fake.judge, judgeConfig: RUNNER_CONFIG.judge, now: NOW }),
    ).rejects.toThrow(/label #1 Y-01\.C2 \(qa-5\): ambiguous-context/);
    expect(fake.inputs).toEqual([]);
  });

  it('computes an empty agreement for zero labels', async () => {
    const result = await calibrate({ suite, labels: EMPTY, judge: fakeJudge(() => 'PASS').judge, judgeConfig: RUNNER_CONFIG.judge, now: NOW });
    expect(result.agreement).toMatchObject({ n: 0, overall: null, kappa: null, labelsSha256: labelsSha256([]) });
  });
});

describe('calibration files', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'suite-calibration-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('reads an absent labels file as zero labels and round-trips files under calibration/<suite>/', async () => {
    expect(readLabelsFile(dir, 'y-suite')).toEqual(EMPTY);
    expect(readAgreementFile(dir, 'y-suite')).toBeNull();
    const labels: LabelsFile = { schemaVersion: 1, labels: [label({ criterionId: 'Y-01.C1', status: 'PASS' })] };
    expect(relative(dir, writeLabelsFile(dir, 'y-suite', labels))).toBe(join('calibration', 'y-suite', 'labels.json'));
    expect(readLabelsFile(dir, 'y-suite')).toEqual(labels);
    const result = await calibrate({ suite: calibrationSuite(), labels, judge: fakeJudge(() => 'PASS').judge, judgeConfig: RUNNER_CONFIG.judge, now: NOW });
    const written = writeAgreementFile(dir, 'y-suite', result.agreement);
    expect(written).toBe(agreementPath(dir, 'y-suite'));
    expect(readAgreementFile(dir, 'y-suite')).toEqual(result.agreement);
    expect(readdirSync(join(dir, 'calibration', 'y-suite')).sort()).toEqual(['agreement.json', 'labels.json']);
  });

  it('throws on an invalid labels file and an unsafe suite id', () => {
    mkdirSync(join(dir, 'calibration', 'y-suite'), { recursive: true });
    writeFileSync(labelsPath(dir, 'y-suite'), JSON.stringify({ schemaVersion: 1, labels: [{ criterionId: 'Y-01.C1' }] }));
    expect(() => readLabelsFile(dir, 'y-suite')).toThrow(/\[suite\] calibrate: y-suite labels are invalid at labels\.0/);
    writeFileSync(labelsPath(dir, 'y-suite'), '{');
    expect(() => readLabelsFile(dir, 'y-suite')).toThrow(/not readable JSON/);
    expect(() => labelsPath(dir, '..')).toThrow(/unsafe suite id/);
  });
});

describe('agreement file ownership', () => {
  it('no src/ file except judge/calibrate.ts and tests names the agreement file', () => {
    const src = resolve(__dirname, '..', '..');
    const offenders: string[] = [];
    const walk = (folder: string) => {
      for (const entry of readdirSync(folder, { withFileTypes: true })) {
        const path = join(folder, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') && readFileSync(path, 'utf8').includes('agreement.json')) {
          offenders.push(relative(src, path));
        }
      }
    };
    walk(src);
    expect(offenders).toEqual([join('suite', 'judge', 'calibrate.ts')]);
  });
});
