import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CREDENTIAL_NAMES,
  L1_GATE_VARIABLE,
  decideL1Gate,
  isL1GatePath,
  l1GateChangedPaths,
  missingL1Credentials,
  runL1Gate,
  type CredentialName,
  type L1GateInput,
} from './l1-gate';

const PACKAGE_DIR = resolve(__dirname, '..', '..');
const SECRET = 'sk-test-not-a-real-key-l1-gate';

describe('isL1GatePath', () => {
  it.each([
    'packages/ai-openai/src/prompts/x.md',
    'packages/ai-openai/src/prompts/coach/system.ts',
    'packages/ai-openai/src/openai-provider.ts',
    'packages/application/src/use-cases/conversation-orchestrator.ts',
    'packages/application/src/use-cases/proactive-check-in.ts',
    'packages/application/src/use-cases/proactive-check-in.use-case.ts',
    'packages/application/src/policies/a/b.ts',
    'packages/application/src/policies/check-in-cadence.ts',
    'packages/application/src/utils/quiet-hours.ts',
    'packages/conversation-sim/README.md',
    'packages/conversation-sim/src/suite/cli.ts',
    'packages/conversation-sim/baselines/smoke-v1/L1.json',
  ])('gates %s', (path) => {
    expect(isL1GatePath(path)).toBe(true);
  });

  it.each([
    'apps/api/x.ts',
    'packages/application/src/use-cases/proactive/x.ts',
    'packages/application/src/use-cases/other.ts',
    'packages/application/src/use-cases/conversation-orchestrator.test.ts.bak/x',
    'packages/application/src/utils/quiet-hours.test.ts',
    'packages/ai-openai/src/openai-provider.test.ts',
    'packages/ai-openai/src/prompts',
    'packages/application/src/policies',
    'packages/conversation-sim',
    'packages/conversation-simx/a.ts',
    'xpackages/conversation-sim/a.ts',
    '.github/workflows/conversation-suite-l1-pr.yml',
  ])('does not gate %s', (path) => {
    expect(isL1GatePath(path)).toBe(false);
  });

  it('filters changed paths in input order', () => {
    expect(l1GateChangedPaths(['apps/api/x.ts', 'packages/conversation-sim/a.ts', 'README.md', 'packages/ai-openai/src/prompts/x.md'])).toEqual([
      'packages/conversation-sim/a.ts',
      'packages/ai-openai/src/prompts/x.md',
    ]);
    expect(l1GateChangedPaths([])).toEqual([]);
  });
});

const ALL: Record<CredentialName, boolean> = Object.fromEntries(CREDENTIAL_NAMES.map((name) => [name, true])) as Record<CredentialName, boolean>;
const NONE: Record<CredentialName, boolean> = Object.fromEntries(CREDENTIAL_NAMES.map((name) => [name, false])) as Record<CredentialName, boolean>;
const openAiOnly = { ...NONE, OPENAI_API_KEY: true };

function input(overrides: Partial<L1GateInput> = {}): L1GateInput {
  return { changed: true, fork: false, enabled: 'true', judgeProvider: 'openai', credentials: openAiOnly, ...overrides };
}

describe('decideL1Gate', () => {
  it('skips when no gated path changed, before every other check', () => {
    const result = decideL1Gate(input({ changed: false, fork: true, enabled: undefined, credentials: NONE }));
    expect(result.decision).toBe('skip');
    expect(result.message).toContain('no gated path changed');
  });

  it('skips a fork pull request even when enabled and configured', () => {
    const result = decideL1Gate(input({ fork: true, credentials: ALL }));
    expect(result).toEqual({ decision: 'skip', message: expect.stringContaining('forks') });
  });

  it.each([[undefined], [''], ['TRUE'], ['True'], ['1'], ['yes'], [' true']])('skips naming the variable when it is %j', (enabled) => {
    const result = decideL1Gate(input({ enabled, credentials: ALL }));
    expect(result.decision).toBe('skip');
    expect(result.message).toContain(L1_GATE_VARIABLE);
  });

  it('fails closed when enabled without OPENAI_API_KEY', () => {
    const result = decideL1Gate(input({ credentials: NONE }));
    expect(result.decision).toBe('error');
    expect(result.message).toContain('OPENAI_API_KEY');
    expect(result.message).toContain(L1_GATE_VARIABLE);
  });

  it('fails closed on a partial Azure set: endpoint without the testing deployment', () => {
    const credentials = { ...ALL, AZURE_OPENAI_TESTING_DEPLOYMENT: false };
    const result = decideL1Gate(input({ credentials }));
    expect(result.decision).toBe('error');
    expect(result.message).toContain('missing: AZURE_OPENAI_TESTING_DEPLOYMENT.');
  });

  it('runs when enabled with OpenAI credentials, or the full Azure set plus the OpenAI judge key', () => {
    expect(decideL1Gate(input()).decision).toBe('run');
    expect(decideL1Gate(input({ credentials: ALL })).decision).toBe('run');
  });

  it('every message is a single line', () => {
    const cases = [input({ changed: false }), input({ fork: true }), input({ enabled: undefined }), input({ credentials: NONE }), input()];
    for (const entry of cases) expect(decideL1Gate(entry).message).not.toMatch(/[\r\n]/);
  });
});

describe('missingL1Credentials', () => {
  it('OpenAI judge and OpenAI coach need only OPENAI_API_KEY', () => {
    expect(missingL1Credentials({ judgeProvider: 'openai', credentials: openAiOnly })).toEqual([]);
    expect(missingL1Credentials({ judgeProvider: 'openai', credentials: NONE })).toEqual(['OPENAI_API_KEY']);
  });

  it('an Azure endpoint makes the coach need the full Azure set including the testing deployment', () => {
    expect(missingL1Credentials({ judgeProvider: 'openai', credentials: { ...openAiOnly, AZURE_OPENAI_ENDPOINT: true } })).toEqual([
      'AZURE_OPENAI_API_KEY',
      'AZURE_OPENAI_API_VERSION',
      'AZURE_OPENAI_TESTING_DEPLOYMENT',
    ]);
    // The OpenAI judge still needs its key next to a complete Azure coach set.
    expect(missingL1Credentials({ judgeProvider: 'openai', credentials: { ...ALL, OPENAI_API_KEY: false } })).toEqual(['OPENAI_API_KEY']);
  });

  it('an Azure judge needs the Azure trio; the coach then needs the deployment too', () => {
    expect(missingL1Credentials({ judgeProvider: 'azure_openai', credentials: openAiOnly })).toEqual([
      'AZURE_OPENAI_ENDPOINT',
      'AZURE_OPENAI_API_KEY',
      'AZURE_OPENAI_API_VERSION',
    ]);
    expect(missingL1Credentials({ judgeProvider: 'azure_openai', credentials: { ...ALL, OPENAI_API_KEY: false } })).toEqual([]);
    expect(
      missingL1Credentials({ judgeProvider: 'azure_openai', credentials: { ...ALL, OPENAI_API_KEY: false, AZURE_OPENAI_TESTING_DEPLOYMENT: false } }),
    ).toEqual(['AZURE_OPENAI_TESTING_DEPLOYMENT']);
  });
});

describe('l1-gate imports', () => {
  it('imports Node builtins and loadSuiteConfig only, so the changes job needs no package build', () => {
    const source = readFileSync(join(__dirname, 'l1-gate.ts'), 'utf8');
    const imports = [...source.matchAll(/^import .* from '([^']+)';$/gm)].map((match) => match[1]);
    expect(imports.filter((name) => !name!.startsWith('node:'))).toEqual(['./config']);
    expect(source).toMatch(/^import \{ loadSuiteConfig \} from '\.\/config';$/m);
    expect(source).not.toMatch(/require\(/);
    expect(source).not.toMatch(/process\.env\.[A-Z]/);
  });
});

describe('runL1Gate decide', () => {
  let dir: string;
  let out: string[];
  let err: string[];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'suite-l1-gate-'));
    out = [];
    err = [];
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const output = () => join(dir, 'github-output');
  const decide = (env: Record<string, string | undefined>, argv: string[] = ['decide', '--changed', 'true', '--output', output()]) =>
    runL1Gate(argv, { cwd: dir, packageDir: PACKAGE_DIR, env, log: (line) => out.push(line), error: (line) => err.push(line) });
  const sameRepoEnabled = { L1_GATE_FORK: 'false', L1_GATE_ENABLED: 'true' };

  it('appends decision and message lines and exits 0 on skip', () => {
    writeFileSync(output(), 'changed=true\n');
    expect(decide({ L1_GATE_FORK: 'false' })).toBe(0);
    const lines = readFileSync(output(), 'utf8').split('\n');
    expect(lines[0]).toBe('changed=true');
    expect(lines[1]).toBe('decision=skip');
    expect(lines[2]).toMatch(new RegExp(`^message=L1 gate skipped: .*${L1_GATE_VARIABLE}`));
    expect(lines.slice(3)).toEqual(['']);
    expect(err).toEqual([]);
  });

  it('skips when nothing changed', () => {
    expect(decide(sameRepoEnabled, ['decide', '--changed', 'false', '--output', output()])).toBe(0);
    expect(readFileSync(output(), 'utf8')).toMatch(/^decision=skip\nmessage=L1 gate skipped: no gated path changed/);
  });

  it('treats a missing or non-false fork flag as a fork (fail safe)', () => {
    expect(decide({ L1_GATE_ENABLED: 'true', HAS_OPENAI_API_KEY: 'true' })).toBe(0);
    expect(readFileSync(output(), 'utf8')).toContain('message=L1 gate skipped: pull requests from forks');
    rmSync(output());
    expect(decide({ L1_GATE_FORK: 'true', L1_GATE_ENABLED: 'true', HAS_OPENAI_API_KEY: 'true' })).toBe(0);
    expect(readFileSync(output(), 'utf8')).toContain('decision=skip');
  });

  it('reads the judge provider from suite.config.json and the presence booleans: run', () => {
    expect(decide({ ...sameRepoEnabled, HAS_OPENAI_API_KEY: 'true', HAS_AZURE_OPENAI_ENDPOINT: 'false' })).toBe(0);
    expect(readFileSync(output(), 'utf8')).toMatch(/^decision=run\nmessage=.+\n$/);
  });

  it('exits 1 with decision=error when enabled and credentials are missing; only exact "true" counts as present', () => {
    expect(decide({ ...sameRepoEnabled, HAS_OPENAI_API_KEY: SECRET })).toBe(1);
    const written = readFileSync(output(), 'utf8');
    expect(written).toMatch(/^decision=error\nmessage=L1 gate is enabled .*missing: OPENAI_API_KEY\. .*\n$/);
    expect(err).toHaveLength(1);
    expect(`${written}${out.join('\n')}${err.join('\n')}`).not.toContain(SECRET);
  });

  it('a partial Azure set is an error', () => {
    const env = { ...sameRepoEnabled, HAS_OPENAI_API_KEY: 'true', HAS_AZURE_OPENAI_ENDPOINT: 'true', HAS_AZURE_OPENAI_API_KEY: 'true', HAS_AZURE_OPENAI_API_VERSION: 'true' };
    expect(decide(env)).toBe(1);
    expect(readFileSync(output(), 'utf8')).toContain('missing: AZURE_OPENAI_TESTING_DEPLOYMENT.');
  });

  it('prints the decision without --output', () => {
    expect(decide(sameRepoEnabled, ['decide', '--changed', 'false'])).toBe(0);
    expect(out).toEqual([expect.stringMatching(/^\[suite\] l1-gate: decision=skip: L1 gate skipped: no gated path changed/)]);
  });

  it.each([
    [['decide']],
    [['decide', '--changed', 'yes']],
    [['decide', '--changed', 'TRUE']],
    [['decide', '--changed', 'true', '--bogus']],
    [['nope']],
    [[]],
  ])('usage error %j exits 1 and writes nothing', (argv) => {
    expect(decide(sameRepoEnabled, [...argv])).toBe(1);
    expect(err).toHaveLength(1);
    expect(err[0]).toMatch(/^\[suite\] l1-gate: /);
    expect(() => readFileSync(output(), 'utf8')).toThrow();
  });

  it('a broken suite.config.json is an error exit, writing nothing', () => {
    writeFileSync(join(dir, 'suite.config.json'), '{ not json');
    const code = runL1Gate(['decide', '--changed', 'true', '--output', output()], {
      cwd: dir,
      packageDir: dir,
      env: sameRepoEnabled,
      log: (line) => out.push(line),
      error: (line) => err.push(line),
    });
    expect(code).toBe(1);
    expect(err[0]).toMatch(/^\[suite\] l1-gate: \[suite\] config: /);
    expect(() => readFileSync(output(), 'utf8')).toThrow();
  });
});

describe('runL1Gate changes in a real git repo', () => {
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
  const write = (path: string, text = 'x\n') => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  const commit = (message: string) => {
    git('add', '-A');
    git('commit', '-q', '-m', message);
    return git('rev-parse', 'HEAD');
  };
  const output = () => join(root, '..', `${root.split(/[\\/]/).at(-1)}-output`);
  const changes = (base: string, head: string, withOutput = true) =>
    runL1Gate(['changes', '--base', base, '--head', head, ...(withOutput ? ['--output', output()] : [])], {
      cwd: join(root, 'packages', 'conversation-sim'),
      packageDir: PACKAGE_DIR,
      env: {},
      log: (line) => out.push(line),
      error: (line) => err.push(line),
    });

  let base: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'suite-l1-changes-'));
    out = [];
    err = [];
    write('apps/api/x.ts');
    write('packages/conversation-sim/README.md');
    write('packages/application/src/use-cases/proactive-check-in.use-case.ts');
    git('init', '-q', '-b', 'main');
    base = commit('base');
    git('checkout', '-q', '-b', 'feature');
  });
  afterEach(() => {
    rmSync(output(), { force: true });
    rmSync(root, { recursive: true, force: true });
  });

  it('an unrelated change appends changed=false', () => {
    write('apps/api/x.ts', 'y\n');
    const head = commit('api');
    expect(changes(base, head)).toBe(0);
    expect(readFileSync(output(), 'utf8')).toBe('changed=false\n');
    expect(out).toEqual(['[suite] l1-gate: 1 changed path(s), 0 gated', '[suite] l1-gate: changed=false']);
    expect(err).toEqual([]);
  });

  it.each([
    'packages/application/src/use-cases/proactive-check-in.ts',
    'packages/application/src/policies/a/b.ts',
    'packages/ai-openai/src/prompts/x.md',
  ])('a change to %s appends changed=true and lists it', (path) => {
    write('apps/api/x.ts', 'y\n');
    write(path);
    const head = commit('gated');
    expect(changes(base, head)).toBe(0);
    expect(readFileSync(output(), 'utf8')).toBe('changed=true\n');
    expect(out).toContain(`[suite]   - ${path}`);
  });

  it('moving a gated file out of a gated path is still a gated change (--no-renames)', () => {
    git('mv', 'packages/application/src/use-cases/proactive-check-in.use-case.ts', 'apps/api/moved.ts');
    const head = commit('move');
    expect(changes(base, head)).toBe(0);
    expect(readFileSync(output(), 'utf8')).toBe('changed=true\n');
  });

  it('diffs against the merge-base of base and head (three dots), ignoring base-only commits', () => {
    write('apps/api/x.ts', 'feature\n');
    const head = commit('feature');
    git('checkout', '-q', 'main');
    write('packages/conversation-sim/README.md', 'main moved on\n');
    const movedBase = commit('main');
    expect(changes(movedBase, head)).toBe(0);
    expect(readFileSync(output(), 'utf8')).toBe('changed=false\n');
  });

  it('appends to an existing output file and prints without --output', () => {
    write('packages/conversation-sim/README.md', 'y\n');
    const head = commit('sim');
    writeFileSync(output(), 'earlier=1\n');
    expect(changes(base, head)).toBe(0);
    expect(readFileSync(output(), 'utf8')).toBe('earlier=1\nchanged=true\n');
    out = [];
    expect(changes(base, head, false)).toBe(0);
    expect(out.at(-1)).toBe('[suite] l1-gate: changed=true');
  });

  it('a bad base sha exits 1 and writes no output (fail closed)', () => {
    const head = git('rev-parse', 'HEAD');
    expect(changes('0000000000000000000000000000000000000000', head)).toBe(1);
    expect(err).toHaveLength(1);
    expect(err[0]).toMatch(/^\[suite\] l1-gate: git diff 0{40}\.\.\..* failed \(/);
    expect(() => readFileSync(output(), 'utf8')).toThrow();
  });

  it.each([[['changes']], [['changes', '--base', 'a']], [['changes', '--head', 'b']], [['changes', '--base', 'a', '--head', 'b', '--x']]])(
    'usage error %j exits 1',
    (argv) => {
      const code = runL1Gate([...argv], { cwd: root, packageDir: PACKAGE_DIR, env: {}, log: (line) => out.push(line), error: (line) => err.push(line) });
      expect(code).toBe(1);
      expect(err).toHaveLength(1);
      expect(err[0]).toMatch(/^\[suite\] l1-gate: /);
    },
  );
});
