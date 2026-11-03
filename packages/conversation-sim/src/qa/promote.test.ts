import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listQaTests, QA_TESTS_DIR } from './load';
import { promoteDraft } from './promote';

const EXAMPLE = JSON.parse(readFileSync(join(QA_TESTS_DIR, 'examples', 'release-week-no-pulse-question.json'), 'utf8')) as Record<string, unknown>;

let root = '';
let qaDir = '';
let draftsDir = '';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'qa-promote-'));
  qaDir = join(root, 'qa-tests');
  draftsDir = join(qaDir, 'drafts');
  mkdirSync(draftsDir, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function draft(name: string, body: Record<string, unknown>): string {
  const path = join(draftsDir, `${name}.json`);
  writeFileSync(path, JSON.stringify(body));
  return path;
}

describe('promoteDraft', () => {
  it('moves a valid draft into the QA tests folder', () => {
    const path = draft('trace-0123abcd', EXAMPLE);
    const result = promoteDraft({ draft: path, qaTestsDir: qaDir });
    expect(result).toEqual({ target: join(qaDir, 'trace-0123abcd.json'), id: 'trace-0123abcd' });
    expect(existsSync(path)).toBe(false);
    expect(listQaTests(qaDir)).toEqual([result.target]);
  });

  it('keeps an unfinished draft (no expected result, no hard check) where it is', () => {
    const { hardChecks: _h, ...rest } = EXAMPLE;
    void _h;
    const path = draft('trace-unfilled', { ...rest, expected: [] });
    expect(() => promoteDraft({ draft: path, qaTestsDir: qaDir })).toThrow(/invalid QA test/);
    expect(existsSync(path)).toBe(true);
    expect(listQaTests(qaDir)).toEqual([]);
  });

  it('refuses a draft whose precondition does not exist', () => {
    const path = draft('trace-noprecondition', { ...EXAMPLE, precondition: 'traced/trace-missing.json' });
    expect(() => promoteDraft({ draft: path, qaTestsDir: qaDir })).toThrow(/precondition: file not found/);
    expect(existsSync(path)).toBe(true);
  });

  it('never overwrites an existing test', () => {
    writeFileSync(join(qaDir, 'trace-dup.json'), '{}');
    const path = draft('trace-dup', EXAMPLE);
    expect(() => promoteDraft({ draft: path, qaTestsDir: qaDir })).toThrow(/already exists/);
    expect(readFileSync(join(qaDir, 'trace-dup.json'), 'utf8')).toBe('{}');
    expect(existsSync(path)).toBe(true);
  });

  it('refuses a missing file, a non-JSON file and a file already in the folder', () => {
    expect(() => promoteDraft({ draft: join(draftsDir, 'nope.json'), qaTestsDir: qaDir })).toThrow(/draft not found/);
    const txt = join(draftsDir, 'notes.txt');
    writeFileSync(txt, 'x');
    expect(() => promoteDraft({ draft: txt, qaTestsDir: qaDir })).toThrow(/\.json file/);
    const inPlace = join(qaDir, 'already.json');
    writeFileSync(inPlace, JSON.stringify(EXAMPLE));
    expect(() => promoteDraft({ draft: inPlace, qaTestsDir: qaDir })).toThrow(/only files in/);
  });

  it('refuses a draft outside qa-tests/drafts and one still titled DRAFT', () => {
    const outside = join(root, 'elsewhere.json');
    writeFileSync(outside, JSON.stringify(EXAMPLE));
    expect(() => promoteDraft({ draft: outside, qaTestsDir: qaDir })).toThrow(/only files in/);
    const titled = draft('trace-titled', { ...EXAMPLE, title: 'DRAFT - fill expected: traced turn x' });
    expect(() => promoteDraft({ draft: titled, qaTestsDir: qaDir })).toThrow(/starts with DRAFT/);
    expect(existsSync(titled)).toBe(true);
  });
});

describe('sim:qa:promote CLI', () => {
  // Runs outside Vitest, so a Vitest import anywhere on its path breaks it; this guards that.
  it('promotes a valid draft from the command line', () => {
    const path = draft('trace-cli', EXAMPLE);
    const cli = join(__dirname, 'promote-cli.ts');
    const run = spawnSync(process.execPath, ['--import', 'tsx', cli, path, '--qa-tests', qaDir], { encoding: 'utf8', cwd: join(__dirname, '..', '..') });
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('promoted:');
    expect(run.stdout).toContain('-t "trace-cli"');
    expect(existsSync(join(qaDir, 'trace-cli.json'))).toBe(true);
  });
});
