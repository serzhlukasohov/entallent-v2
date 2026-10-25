import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { testCriterionKey } from './score';
import {
  SuiteRunReportSchema,
  type Coverage,
  type CoverageRow,
  type JudgeError,
  type JudgeTrust,
  type Level,
  type ScoredCriterion,
  type SuiteRunReport,
  type SuiteScore,
  type Usage,
} from './schema';

export interface SuiteReportMeta {
  /** `<ISO timestamp with - for : and .>-<short sha>`, as in `run-gate.ts`. */
  runId: string;
  suiteId: string;
  level: Level;
  n: number;
  git: { sha: string | null; dirty: boolean };
  models: { coach: string | null; judge: string | null };
  /** Copied verbatim; never recomputed here (AD-8). */
  judgeTrust: JudgeTrust;
  judgeErrors: JudgeError[];
  usage: Usage;
}

/** Assembles `SuiteRunReport` v1 (architecture AD-11) from a score; pure. */
export function buildSuiteReport(score: SuiteScore, meta: SuiteReportMeta): SuiteRunReport {
  if (meta.suiteId !== score.suite.id || meta.level !== score.level || meta.n !== score.n) {
    throw new Error(
      `[suite] report: meta (${meta.suiteId} ${meta.level} n=${meta.n}) does not match the score (${score.suite.id} ${score.level} n=${score.n})`,
    );
  }
  const results: Record<string, ScoredCriterion> = {};
  for (const result of score.results) results[testCriterionKey(result.testId, result.criterionId)] = result;

  const report: SuiteRunReport = {
    schemaVersion: 1,
    runId: meta.runId,
    suiteId: meta.suiteId,
    level: meta.level,
    n: meta.n,
    git: meta.git,
    models: meta.models,
    judgeTrust: meta.judgeTrust,
    results,
    layers: score.layers,
    verdict: score.verdict,
    complete: score.complete,
    provisional: score.provisional,
    ...(score.provisionalReason !== undefined ? { provisionalReason: score.provisionalReason } : {}),
    coverage: coverage(score),
    journeys: score.journeys,
    judgeErrors: meta.judgeErrors,
    usage: meta.usage,
  };
  return SuiteRunReportSchema.parse(report) as SuiteRunReport;
}

function coverage(score: SuiteScore): Coverage {
  const resultsByKey = new Map(
    score.results.map((result) => [testCriterionKey(result.testId, result.criterionId), result] as const),
  );
  const rows: CoverageRow[] = [];
  const notTestable: Coverage['notTestable'] = [];
  for (const source of score.suite.sources) {
    for (const criterion of source.criteria) {
      if (criterion.notTestableReason !== undefined) {
        notTestable.push({ key: testCriterionKey(source.id, criterion.id), reason: criterion.notTestableReason });
        rows.push({
          requirement: source.requirement,
          sourceCase: source.id,
          testId: null,
          criterionId: criterion.id,
          layer: criterion.layer,
          status: 'NOT_TESTABLE',
          reason: criterion.notTestableReason,
        });
        continue;
      }
      const tests = score.suite.tests.filter(
        (test) => test.sourceCase === source.id && test.criteria.some((entry) => entry.id === criterion.id),
      );
      for (const test of tests) {
        const result = resultsByKey.get(testCriterionKey(test.id, criterion.id));
        rows.push({
          requirement: source.requirement,
          sourceCase: source.id,
          testId: test.id,
          criterionId: criterion.id,
          layer: criterion.layer,
          status: result?.status ?? null,
          ...(result?.reason !== undefined ? { reason: result.reason } : {}),
        });
      }
    }
  }

  const judgeOnly = score.suite.tests.flatMap((test) =>
    test.criteria
      .filter((criterion) => criterion.checks.every((check) => check.type === 'meaning'))
      .map((criterion) => testCriterionKey(test.id, criterion.id)),
  );

  const unobservable = score.results.flatMap((result) => {
    const match = /^unobservable:([^@]+)@/.exec(result.reason ?? '');
    return result.status === 'NOT_RUN' && match
      ? [{ key: testCriterionKey(result.testId, result.criterionId), field: match[1]! }]
      : [];
  });

  return { rows, notTestable, judgeOnly, unobservable };
}

/** Human-readable rendering of a report; contains no transcript text beyond rule evidence. */
export function renderSuiteReportMarkdown(report: SuiteRunReport): string {
  const lines: string[] = [];
  const results = Object.entries(report.results);
  const scored = results.filter(([, result]) => result.testKind === 'atomic' || result.testKind === 'observation');
  const journeys = results.filter(([, result]) => result.testKind === 'journey');

  lines.push(`# Suite ${report.suiteId} ${report.level} — ${report.runId}`, '');
  lines.push(`- Verdict: **${report.verdict}**${report.provisional ? ' (provisional)' : ''}`);
  if (report.provisionalReason) lines.push(`- Provisional: ${report.provisionalReason}`);
  lines.push(`- Complete: ${report.complete ? 'yes' : 'no'}`);
  lines.push(`- Samples: n = ${report.n}`);
  lines.push(`- Git: ${report.git.sha ?? 'unknown'}${report.git.dirty ? ' (dirty)' : ''}`);
  lines.push(`- Models: coach ${report.models.coach ?? 'n/a'}, judge ${report.models.judge ?? 'n/a'}`);
  lines.push(
    `- Meaning checks: ${report.judgeTrust.trusted ? 'trusted' : 'advisory (uncalibrated)'} (${report.judgeTrust.reason})`,
    '',
  );

  lines.push('## Layers', '');
  if (report.layers) {
    lines.push('| Layer | PASS | FAIL | Pass rate |', '| --- | --- | --- | --- |');
    for (const row of report.layers.rows) lines.push(`| ${row.layer} | ${row.pass} | ${row.fail} | ${rate(row.passRate)} |`);
    const pdc = report.layers.combinedPdc;
    lines.push(`| P+D+C | ${pdc.pass} | ${pdc.fail} | ${rate(pdc.passRate)} |`);
  } else {
    lines.push('n/a (journeys only)');
  }
  lines.push('');

  lines.push('## Results', '');
  pushResultTable(lines, scored);
  lines.push('## Journeys', '');
  if (journeys.length === 0) lines.push('No journey results.', '');
  else pushResultTable(lines, journeys);

  lines.push('## Coverage', '');
  lines.push('| Requirement | Source | Test | Criterion | Layer | Status |', '| --- | --- | --- | --- | --- | --- |');
  for (const row of report.coverage.rows) {
    lines.push(
      `| ${cell(row.requirement.join(', '))} | ${row.sourceCase} | ${row.testId ?? '—'} | ${row.criterionId} | ${row.layer} | ${row.status ?? 'not evaluated'} |`,
    );
  }
  lines.push('');

  lines.push('### NOT TESTABLE', '');
  pushList(lines, report.coverage.notTestable.map((entry) => `${entry.key}: ${entry.reason}`));
  lines.push('### Judge-only criteria', '');
  pushList(lines, report.coverage.judgeOnly);
  lines.push('### Unobservable fields', '');
  pushList(lines, report.coverage.unobservable.map((entry) => `${entry.key}: ${entry.field}`));
  lines.push('## Judge errors', '');
  pushList(lines, report.judgeErrors.map((error) => `${error.key}: ${error.reason}`));
  lines.push('## Usage', '');
  pushList(lines, Object.entries(report.usage).map(([name, value]) => `${name}: ${value}`));

  return `${lines.join('\n').trimEnd()}\n`;
}

/** Writes `<baseDir>/runs/suites/<runId>/report.{json,md}`; the only I/O of the core. */
export function writeSuiteReport(report: SuiteRunReport, baseDir: string): { json: string; markdown: string } {
  const parsed = SuiteRunReportSchema.parse(report) as SuiteRunReport;
  if (!/^[A-Za-z0-9._-]+$/.test(parsed.runId) || /^\.+$/.test(parsed.runId)) throw new Error(`[suite] report: unsafe run id ${parsed.runId}`);
  const dir = join(baseDir, 'runs', 'suites', parsed.runId);
  mkdirSync(dir, { recursive: true });
  const json = join(dir, 'report.json');
  const markdown = join(dir, 'report.md');
  writeFileSync(json, `${JSON.stringify(parsed, null, 2)}\n`);
  writeFileSync(markdown, renderSuiteReportMarkdown(parsed));
  return { json, markdown };
}

function pushResultTable(lines: string[], results: ReadonlyArray<[string, ScoredCriterion]>): void {
  if (results.length === 0) {
    lines.push('No results.', '');
    return;
  }
  lines.push('| Key | Layer | Status | Pass/n | Method | Reason / evidence |', '| --- | --- | --- | --- | --- | --- |');
  for (const [key, result] of results) {
    const status = `${result.status}${result.inScope ? '' : ' (out of scope)'}${result.advisory ? ' (advisory)' : ''}`;
    lines.push(
      `| ${key} | ${result.layer} | ${status} | ${result.passCount}/${result.n} | ${result.method} | ${cell([result.reason, result.evidence].filter((part) => part !== undefined).join(' — '))} |`,
    );
  }
  lines.push('');
}

function pushList(lines: string[], items: readonly string[]): void {
  if (items.length === 0) lines.push('None.');
  else for (const item of items) lines.push(`- ${item.replace(/\n/g, ' ')}`);
  lines.push('');
}

function rate(value: number | null): string {
  return value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`;
}

function cell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}
