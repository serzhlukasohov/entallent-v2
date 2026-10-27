import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadSuite } from '../../loader';
import { RULES } from '../../rules/registry';
import { syntheticRun } from '../../rules/synthetic-run';
import { AUTHORED_USER_TURNS } from './texts';

/**
 * Story 12.4: suite p-v1 against the Confluence page 189333505 v3 snapshot. User texts, pass
 * conditions, NOT TESTABLE reasons and expected behaviors are the snapshot text byte for byte.
 * Approved exceptions: the three authored P-09 user turns and the P-06.C4 earlier conversation
 * (Illia, 2026-10-27; not in the snapshot) and P-06.C3, which checks 08:00-20:00 instead of 09:00-18:00 (Illia, 2026-10-26).
 * Engineering effect criteria (layer E) never come from Confluence and are not checked here.
 */
const SNAPSHOT = readFileSync(
  join(__dirname, '..', '..', '..', '..', '..', '..', '_bmad-output', 'specs', 'spec-conversation-eval-regression', 'p-suite-v1-confluence-v3.md'),
  'utf8',
);

const P06_C3_SNAPSHOT = 'Every bot-initiated first message is sent between 09:00 and 18:00 in the employee\'s timezone';
const P06_C3_MANIFEST = 'Every bot-initiated first message is sent between 08:00 and 20:00 in the employee\'s timezone';

const suite = loadSuite('p-v1');

interface CaseSection {
  /** Step number -> the user text of its `**Step N — User:** <text>` line. */
  steps: Map<number, string>;
  /** The case's criteria table rows, top to bottom. */
  rows: Array<{ layer: string; when: string; passCondition: string }>;
  expectedBehavior: string | undefined;
}

/** The snapshot split into its `# P-xx — ...` case sections. */
function caseSections(snapshot: string): Map<string, CaseSection> {
  const sections = new Map<string, CaseSection>();
  let current: CaseSection | null = null;
  for (const line of snapshot.split('\n')) {
    const heading = /^# (P-\d+) — /.exec(line);
    if (heading) {
      current = { steps: new Map(), rows: [], expectedBehavior: undefined };
      sections.set(heading[1]!, current);
      continue;
    }
    if (line.startsWith('# ')) {
      current = null;
      continue;
    }
    if (!current) continue;
    const step = /^\*\*Step (\d+) — User:\*\* (.+)$/.exec(line);
    if (step) current.steps.set(Number(step[1]), step[2]!);
    const row = /^\| ([PDCS]) \| ([^|]+) \| ([^|]+) \|$/.exec(line);
    if (row) current.rows.push({ layer: row[1]!, when: row[2]!, passCondition: row[3]! });
    const expected = /^\*\*Expected behavior:\*\* (.+)$/.exec(line);
    if (expected) current.expectedBehavior = expected[1]!;
  }
  return sections;
}

const SECTIONS = caseSections(SNAPSHOT);
const section = (sourceCase: string): CaseSection => {
  const found = SECTIONS.get(sourceCase);
  if (!found) throw new Error(`no snapshot section for ${sourceCase}`);
  return found;
};
const isSuiteUserText = (sourceCase: string, text: string): boolean => [...section(sourceCase).steps.values()].includes(text);

describe('suite p-v1: verbatim Confluence v3 texts', () => {
  it('reads the v3 snapshot and its ten case sections', () => {
    expect(SNAPSHOT).toContain('version 3');
    expect([...SECTIONS.keys()]).toEqual(['P-01', 'P-02', 'P-03', 'P-04', 'P-05', 'P-06', 'P-07', 'P-08', 'P-09', 'P-10']);
  });

  it('sends every step text as a full Step line of its own case, or one of the approved authored turns', () => {
    const drift = suite.tests.flatMap((test) =>
      test.steps
        .filter((step) => !isSuiteUserText(test.sourceCase, step.text) && !AUTHORED_USER_TURNS.includes(step.text))
        .map((step) => `${test.id}: ${step.text}`),
    );
    expect(drift).toEqual([]);
  });

  it('seeds every user turn as a full Step line of its own case, or one of the approved authored turns', () => {
    const drift = suite.tests.flatMap((test) =>
      (test.seed?.history ?? [])
        .filter((turn) => turn.role === 'user' && !isSuiteUserText(test.sourceCase, turn.text) && !AUTHORED_USER_TURNS.includes(turn.text))
        .map((turn) => `${test.id}: ${turn.text}`),
    );
    expect(drift).toEqual([]);
  });

  it('sends or seeds every suite step of each conversation case, and journeys replay their case in order', () => {
    for (const source of suite.sources.filter((entry) => entry.kind === 'conversation')) {
      const sent = new Set(
        suite.tests
          .filter((test) => test.sourceCase === source.id)
          .flatMap((test) => [...test.steps.map((step) => step.text), ...(test.seed?.history ?? []).filter((turn) => turn.role === 'user').map((turn) => turn.text)]),
      );
      for (const text of section(source.id).steps.values()) expect(sent.has(text), `${source.id}: ${text}`).toBe(true);
    }
    for (const journey of suite.tests.filter((test) => test.kind === 'journey')) {
      const suiteSteps = journey.steps.map((step) => step.text).filter((text) => !AUTHORED_USER_TURNS.includes(text));
      expect(suiteSteps, journey.id).toEqual([...section(journey.sourceCase).steps.values()]);
    }
  });

  it('keeps the authored turns out of the snapshot and limits them to P-09 and the P-06.C4 seed', () => {
    for (const text of AUTHORED_USER_TURNS) expect(SNAPSHOT.includes(text), text).toBe(false);
    const users = suite.tests.flatMap((test) => [
      ...test.steps.map((step) => ({ test: test.id, source: test.sourceCase, text: step.text })),
      ...(test.seed?.history ?? []).filter((turn) => turn.role === 'user').map((turn) => ({ test: test.id, source: test.sourceCase, text: turn.text })),
    ]);
    const authored = users.filter((entry) => AUTHORED_USER_TURNS.includes(entry.text));
    expect(authored.length).toBeGreaterThan(0);
    expect(authored.filter((entry) => entry.source !== 'P-09' && entry.source !== 'P-06').map((entry) => entry.test)).toEqual([]);
  });

  it('matches every Confluence criterion C<n> to row n of its case table: layer and pass condition (and NOT TESTABLE reason) verbatim', () => {
    const drift: string[] = [];
    for (const source of suite.sources) {
      const criteria = source.criteria.filter((criterion) => criterion.layer !== 'E');
      const rows = section(source.id).rows;
      if (criteria.length !== rows.length) drift.push(`${source.id}: ${criteria.length} criteria, ${rows.length} table rows`);
      criteria.forEach((criterion, index) => {
        const row = rows[index];
        if (criterion.id !== `${source.id}.C${index + 1}`) drift.push(`${criterion.id}: expected ${source.id}.C${index + 1}`);
        if (!row) return;
        if (row.layer !== criterion.layer) drift.push(`${criterion.id} layer ${criterion.layer}, row ${row.layer}`);
        const expected = criterion.id === 'P-06.C3' ? P06_C3_SNAPSHOT : criterion.passCondition;
        if (row.passCondition !== expected) drift.push(`${criterion.id} passCondition`);
        if (criterion.notTestableReason !== undefined && row.passCondition !== criterion.notTestableReason) {
          drift.push(`${criterion.id} notTestableReason`);
        }
      });
    }
    expect(drift).toEqual([]);
  });

  it('P-06.C3 deviates only in its hours (08:00-20:00, Illia 2026-10-26)', () => {
    expect(section('P-06').rows[2]!.passCondition).toBe(P06_C3_SNAPSHOT);
    const c3 = suite.sources.find((source) => source.id === 'P-06')!.criteria.find((criterion) => criterion.id === 'P-06.C3')!;
    expect(c3.passCondition).toBe(P06_C3_MANIFEST);
    expect(P06_C3_SNAPSHOT.replace('09:00', '08:00').replace('18:00', '20:00')).toBe(P06_C3_MANIFEST);
  });

  it('copies every expected behavior verbatim from its own case', () => {
    const drift = suite.sources.filter((source) => section(source.id).expectedBehavior !== source.expectedBehavior).map((source) => source.id);
    expect(drift).toEqual([]);
  });

  it('matches the snapshot Summary table: 37 criteria (P 25, C 3, D 3, S 6), 2 NOT TESTABLE', () => {
    const summary = (label: string): number => {
      const match = new RegExp(`^\\| ${label.replace(/[()]/g, '\\$&')} \\| (\\d+)`, 'm').exec(SNAPSHOT);
      if (!match) throw new Error(`no Summary row ${label}`);
      return Number(match[1]);
    };
    const all = suite.sources.flatMap((source) => source.criteria.filter((criterion) => criterion.layer !== 'E'));
    const count = (layer: string) => all.filter((criterion) => criterion.layer === layer).length;
    expect({ P: 25, C: 3, D: 3, S: 6 }).toEqual({
      P: summary('P criteria'),
      C: summary('C criteria'),
      D: summary('D criteria'),
      S: summary('S criteria (hard gate)'),
    });
    expect({ P: count('P'), C: count('C'), D: count('D'), S: count('S') }).toEqual({ P: 25, C: 3, D: 3, S: 6 });
    expect(all).toHaveLength(summary('Criteria'));
    expect(all.filter((criterion) => criterion.notTestableReason !== undefined).map((criterion) => criterion.id)).toEqual([
      'P-05.C2',
      'P-09.C9',
    ]);
  });
});

describe('suite p-v1: seeded coach text never satisfies a criterion of its own test', () => {
  it('no seed turns a failing evaluated reply into a PASS for any reply-text rule check', () => {
    const rescued: string[] = [];
    for (const test of suite.tests) {
      const seedHistory = test.seed?.history ?? [];
      if (!seedHistory.some((turn) => turn.role === 'coach')) continue;
      for (const criterion of test.criteria) {
        for (const check of criterion.checks) {
          if (check.type !== 'rule') continue;
          const entry = RULES[check.rule as keyof typeof RULES];
          if (!entry.requires.includes('reply.text')) continue;
          const failing = entry.fixtures.fail.steps.flatMap((step) => (step.reply ? [step.reply.text] : [])).at(-1);
          expect(failing, check.rule).toBeDefined();
          const run = syntheticRun(test.id, test.steps.map(() => failing!));
          const outcome = entry.run(run, criterion, check.params, { seedHistory });
          if (outcome.status !== 'FAIL') rescued.push(`${test.id}/${criterion.id} ${check.rule}: ${outcome.status}`);
        }
      }
    }
    expect(rescued).toEqual([]);
  });
});
