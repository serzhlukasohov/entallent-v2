import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BASELINES_PREFIX, baselineGuardViolations, parseLabels, runBaselineGuard } from './baseline-guard';

describe('baselineGuardViolations', () => {
  const changed = ['packages/conversation-sim/baselines/smoke-v1/L0.json', 'packages/conversation-sim/src/suite/cli.ts', 'README.md'];

  it('lists changed baseline paths when the label is missing', () => {
    expect(baselineGuardViolations(changed, [])).toEqual(['packages/conversation-sim/baselines/smoke-v1/L0.json']);
    expect(baselineGuardViolations(changed, ['bug', 'Baseline-Change'])).toEqual(['packages/conversation-sim/baselines/smoke-v1/L0.json']);
  });

  it('passes with the label, and when no baseline changed', () => {
    expect(baselineGuardViolations(changed, ['baseline-change'])).toEqual([]);
    expect(baselineGuardViolations(['packages/conversation-sim/baselines.md', 'baselines/x.json'], [])).toEqual([]);
    expect(baselineGuardViolations([], [])).toEqual([]);
  });

  it('parses labels as a JSON array of strings only', () => {
    expect(parseLabels('[]')).toEqual([]);
    expect(parseLabels('[\n  "baseline-change"\n]')).toEqual(['baseline-change']);
    expect(() => parseLabels('baseline-change')).toThrow(/not valid JSON/);
    expect(() => parseLabels('{"name":"baseline-change"}')).toThrow(/JSON array of strings/);
    expect(() => parseLabels('[1]')).toThrow(/JSON array of strings/);
  });

  it('imports Node builtins only, so the governance workflow needs no package build', () => {
    const source = readFileSync(join(__dirname, 'baseline-guard.ts'), 'utf8');
    const imports = [...source.matchAll(/^import .* from '([^']+)';$/gm)].map((match) => match[1]);
    expect(imports.length).toBeGreaterThan(0);
    expect(imports.every((name) => name!.startsWith('node:'))).toBe(true);
    expect(source).not.toMatch(/require\(/);
  });
});

describe('runBaselineGuard in a real git repo', () => {
  let root: string;
  let out: string[];
  let err: string[];
  const git = (...args: string[]) => {
    const result = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], {
      cwd: root,
      encoding: 'utf8',
      env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
    });
    if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
    return result.stdout.trim();
  };
  const guard = (base: string, head: string, labels: string) =>
    runBaselineGuard(['--base', base, '--head', head, '--labels', labels], {
      cwd: join(root, 'packages', 'conversation-sim'),
      log: (line) => out.push(line),
      error: (line) => err.push(line),
    });
  const baseline = () => join(root, BASELINES_PREFIX, 'smoke-v1', 'L0.json');

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'suite-guard-'));
    out = [];
    err = [];
    mkdirSync(join(root, BASELINES_PREFIX, 'smoke-v1'), { recursive: true });
    writeFileSync(baseline(), '{"v":1}\n');
    git('init', '-q', '-b', 'main');
    git('add', '.');
    git('commit', '-q', '-m', 'base');
    git('checkout', '-q', '-b', 'feature');
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('exits 0 when no baseline changed', () => {
    writeFileSync(join(root, 'packages', 'conversation-sim', 'notes.md'), 'x\n');
    git('add', '.');
    git('commit', '-q', '-m', 'notes');
    expect(guard('main', 'feature', '[]')).toBe(0);
    expect(err).toEqual([]);
    expect(out).toEqual(['[suite] baseline:guard: no baseline changed']);

    // A non-ASCII path, which git quotes under core.quotePath, still matches the prefix.
    writeFileSync(join(root, BASELINES_PREFIX, 'smoke-v1', 'звіт é.json'), '{}\n');
    git('add', '.');
    git('commit', '-q', '-m', 'non-ascii');
    expect(guard('main', 'feature', '[]')).toBe(1);
    expect(err).toContain('[suite]   - packages/conversation-sim/baselines/smoke-v1/звіт é.json');
  });

  it('accepts the multi-line toJSON labels through the exact workflow command line', () => {
    writeFileSync(baseline(), '{"v":2}\n');
    git('commit', '-q', '-am', 'baseline');
    const packageDir = join(root, 'packages', 'conversation-sim');
    mkdirSync(join(packageDir, 'src', 'suite'), { recursive: true });
    copyFileSync(join(__dirname, 'baseline-guard.ts'), join(packageDir, 'src', 'suite', 'baseline-guard.ts'));
    // Untracked; lets `--import tsx` resolve from the temp repo as it does from the workspace.
    symlinkSync(resolve(__dirname, '..', '..', '..', '..', 'node_modules'), join(root, 'node_modules'));
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
    const run = (labels: string) =>
      spawnSync(process.execPath, ['--import', 'tsx', 'src/suite/baseline-guard.ts', '--base', 'main', '--head', 'feature', '--labels', labels], {
        cwd: packageDir,
        encoding: 'utf8',
        env,
      });
    const labeled = run('[\n  "bug",\n  "baseline-change"\n]');
    expect(labeled.stderr).toBe('');
    expect(labeled.status).toBe(0);
    expect(labeled.stdout).toContain('1 baseline file(s) changed with the baseline-change label');
    const unlabeled = run('[\n  "bug"\n]');
    expect(unlabeled.status).toBe(1);
    expect(unlabeled.stderr).toContain('packages/conversation-sim/baselines/smoke-v1/L0.json');
  });

  it('exits 1 listing the path when a baseline changed without the label, 0 with it', () => {
    writeFileSync(baseline(), '{"v":2}\n');
    git('commit', '-q', '-am', 'baseline');
    expect(guard('main', 'feature', '[]')).toBe(1);
    expect(err).toEqual([
      '[suite] baseline:guard: baselines changed without the baseline-change label:',
      '[suite]   - packages/conversation-sim/baselines/smoke-v1/L0.json',
    ]);
    err.length = 0;
    expect(guard('main', 'feature', '["baseline-change"]')).toBe(0);
    expect(err).toEqual([]);
    expect(out).toEqual(['[suite] baseline:guard: 1 baseline file(s) changed with the baseline-change label']);
  });

  it('ignores baseline changes on the base branch after the merge-base (three-dot diff)', () => {
    git('checkout', '-q', 'main');
    writeFileSync(baseline(), '{"v":3}\n');
    git('commit', '-q', '-am', 'main baseline');
    git('checkout', '-q', 'feature');
    writeFileSync(join(root, 'other.txt'), 'x\n');
    git('add', '.');
    git('commit', '-q', '-m', 'other');
    expect(guard('main', 'feature', '[]')).toBe(0);
  });

  it('flags a baseline moved out of baselines/ as a change', () => {
    git('mv', baseline(), join(root, 'moved.json'));
    git('commit', '-q', '-m', 'move');
    expect(guard('main', 'feature', '[]')).toBe(1);
    expect(err).toContain('[suite]   - packages/conversation-sim/baselines/smoke-v1/L0.json');
  });

  it('fails closed on a git failure, bad labels and missing flags', () => {
    expect(guard('main', 'no-such-rev', '[]')).toBe(1);
    expect(err[0]).toMatch(/^\[suite\] baseline:guard: git diff main\.\.\.no-such-rev failed/);
    expect(guard('main', 'feature', 'not json')).toBe(1);
    expect(err.at(-1)).toBe('[suite] baseline:guard: --labels is not valid JSON');
    expect(guard('main', 'feature', '[true]')).toBe(1);
    expect(runBaselineGuard(['--base', 'main', '--labels', '[]'], { cwd: root, log: () => {}, error: (line) => err.push(line) })).toBe(1);
    expect(err.at(-1)).toMatch(/--base <rev>, --head <rev> and --labels <json-array> are required/);
    expect(runBaselineGuard(['--bogus'], { cwd: root, log: () => {}, error: (line) => err.push(line) })).toBe(1);
    const outside = mkdtempSync(join(tmpdir(), 'suite-guard-nogit-'));
    try {
      expect(runBaselineGuard(['--base', 'a', '--head', 'b', '--labels', '[]'], { cwd: outside, log: () => {}, error: (line) => err.push(line) })).toBe(1);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
