import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Architecture AD-14: the L0 executor never reaches `scenarios/config.ts` (judge and
 * simulator models, credentials) or `OpenAiProvider` (live model calls). This walks the
 * executor's static relative imports transitively; `import type` (and all-`type`
 * specifier lists, which TypeScript elides) are skipped because they vanish at runtime.
 * The executor, runner and CLI also never import `vitest` at runtime (Story 12.8), so
 * they load in plain Node/tsx. Model egress is a human boundary (Story 13.1): they never
 * reach the live judge adapter `suite/judge/live-judge-model.ts` or value-import any
 * `@ai-sdk/*` provider package. Nor do they reach the live calibration entry
 * `suite/judge/calibrate-live.ts` (Story 13.2), which refuses without `--live-judge`.
 * Story 13.4: the L1 executor obeys the same rules (its coach provider is injected), the CLI
 * and runner never reach the L1 executor or the live run entry `suite/run-live.ts`, and
 * `run-live.ts` is the only entry that reaches `live-provider` and `live-judge-model`.
 * Story 14.2: the CLI and runner never reach the L2 executor or its dev API client (the only
 * code that may touch the network to a local stack); `run-live.ts` does. Story 14.3: the L2
 * workflow helper `suite/l2-stack.ts` reaches no executor.
 */
const SRC = resolve(__dirname, '..', '..');
const PACKAGE_DIR = resolve(SRC, '..');
const EXECUTOR = join(SRC, 'suite', 'executors', 'l0-deterministic-executor.ts');
const RUNNER = join(SRC, 'suite', 'runner.ts');
const CLI = join(SRC, 'suite', 'cli.ts');
const L1_EXECUTOR = join(SRC, 'suite', 'executors', 'l1-orchestrator-executor.ts');
const RUN_LIVE = join(SRC, 'suite', 'run-live.ts');
const L2_EXECUTOR = join(SRC, 'suite', 'executors', 'l2-application-executor.ts');
const L2_MODULES = [join('suite', 'executors', 'l2-application-executor.ts'), join('suite', 'executors', 'dev-api-client.ts')];

interface ImportStatement {
  specifier: string;
  /** Value-imported binding names (empty for side-effect, namespace-only or dynamic imports). */
  names: string[];
  /** Reaches the whole module at runtime: namespace, default, `export *`, side-effect or dynamic import. */
  whole: boolean;
}

interface Violation {
  file: string;
  specifier: string;
  reason: string;
}

type ReadSource = (file: string) => string | null;

const readFromDisk: ReadSource = (file) => (existsSync(file) ? readFileSync(file, 'utf8') : null);

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
}

/** Value imports and re-exports of one module; type-only ones are dropped. */
function valueImports(source: string): ImportStatement[] {
  const code = stripComments(source);
  const statements: ImportStatement[] = [];
  const fromClause = /(?:^|[\n;])\s*(import|export)\s+([^;]*?)\s+from\s+['"]([^'"]+)['"]/g;
  for (const match of code.matchAll(fromClause)) {
    const clause = match[2]!.trim();
    if (/^type\s/.test(clause)) continue;
    const braces = /\{([\s\S]*)\}/.exec(clause);
    const elements = braces ? braces[1]!.split(',').map((part) => part.trim()).filter(Boolean) : [];
    const valueElements = elements.filter((element) => !/^type\s/.test(element));
    const outsideBraces = clause.replace(/\{[\s\S]*\}/, '').replace(/,/g, ' ').trim();
    if (braces && valueElements.length === 0 && outsideBraces === '') continue;
    const names = valueElements.map((element) => element.split(/\s+as\s+/)[0]!.trim());
    if (outsideBraces && !outsideBraces.startsWith('*')) names.push(outsideBraces.split(/\s+/)[0]!);
    // Anything outside the braces is a default binding, `* as ns` or `export *`.
    statements.push({ specifier: match[3]!, names, whole: outsideBraces !== '' });
  }
  for (const match of code.matchAll(/(?:^|[\n;])\s*import\s+['"]([^'"]+)['"]/g)) {
    statements.push({ specifier: match[1]!, names: [], whole: true });
  }
  for (const match of code.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    statements.push({ specifier: match[1]!, names: [], whole: true });
  }
  return statements;
}

function resolveRelative(from: string, specifier: string, read: ReadSource): string | null {
  const base = resolve(dirname(from), specifier.replace(/\.js$/, ''));
  for (const candidate of [`${base}.ts`, join(base, 'index.ts'), base]) {
    if (candidate.endsWith('.ts') && read(candidate) !== null) return candidate;
  }
  return null;
}

/** Walks relative value imports from `entry`; returns every forbidden edge it reaches. */
function forbiddenImports(entry: string, read: ReadSource = readFromDisk, root = SRC): { visited: string[]; violations: Violation[] } {
  const visited = new Set<string>();
  const violations: Violation[] = [];
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (visited.has(file)) continue;
    visited.add(file);
    const source = read(file);
    if (source === null) throw new Error(`cannot read ${file}`);
    for (const statement of valueImports(source)) {
      const at = relative(root, file);
      if (statement.names.includes('OpenAiProvider')) {
        violations.push({ file: at, specifier: statement.specifier, reason: 'value import of OpenAiProvider' });
      } else if (statement.whole && /^@entalent\/ai-openai(?:\/|$)/.test(statement.specifier)) {
        // A namespace, default, star or dynamic import reaches OpenAiProvider without naming it.
        violations.push({ file: at, specifier: statement.specifier, reason: 'whole-module import of @entalent/ai-openai' });
      }
      if (/^@ai-sdk\//.test(statement.specifier) && (statement.whole || statement.names.length > 0)) {
        violations.push({ file: at, specifier: statement.specifier, reason: 'value import of @ai-sdk provider' });
      }
      if (/^vitest(?:\/|$)/.test(statement.specifier)) {
        violations.push({ file: at, specifier: statement.specifier, reason: 'value import of vitest' });
      }
      if (!statement.specifier.startsWith('.')) continue;
      const target = resolveRelative(file, statement.specifier, read);
      if (!target) throw new Error(`${at}: cannot resolve ${statement.specifier}`);
      const targetPath = relative(root, target);
      if (targetPath === join('scenarios', 'config.ts')) {
        violations.push({ file: at, specifier: statement.specifier, reason: 'imports scenarios/config.ts' });
      }
      if (targetPath === join('harness', 'live-provider.ts')) {
        violations.push({ file: at, specifier: statement.specifier, reason: 'value import of live-provider' });
      }
      if (targetPath === join('suite', 'judge', 'live-judge-model.ts')) {
        violations.push({ file: at, specifier: statement.specifier, reason: 'value import of live-judge-model' });
      }
      if (targetPath === join('suite', 'judge', 'calibrate-live.ts')) {
        violations.push({ file: at, specifier: statement.specifier, reason: 'value import of calibrate-live' });
      }
      if (targetPath === join('suite', 'run-live.ts')) {
        violations.push({ file: at, specifier: statement.specifier, reason: 'value import of run-live' });
      }
      queue.push(target);
    }
  }
  return { visited: [...visited].map((file) => relative(root, file)), violations };
}

describe('L0 executor import graph', () => {
  it('reaches neither scenarios/config.ts nor OpenAiProvider nor live-provider', () => {
    const { visited, violations } = forbiddenImports(EXECUTOR);
    expect(visited).toContain(join('harness', 'coach-harness.ts'));
    expect(visited).toContain(join('suite', 'fixtures', 'seeded-history.ts'));
    expect(violations).toEqual([]);
  });

  it.each([
    ['executor', EXECUTOR, join('harness', 'report.ts')],
    ['runner', RUNNER, join('suite', 'judge', 'criterion-judge.ts')],
    ['cli', CLI, join('harness', 'report.ts')],
    ['cli (calibration)', CLI, join('suite', 'judge', 'calibrate.ts')],
    ['L1 executor', L1_EXECUTOR, join('suite', 'fixtures', 'pulse-cycle.ts')],
    ['L1 executor (state queries)', L1_EXECUTOR, join('suite', 'fixtures', 'state-queries.ts')],
    ['L2 executor', L2_EXECUTOR, join('suite', 'executors', 'dev-api-client.ts')],
    ['L2 executor (state queries)', L2_EXECUTOR, join('suite', 'fixtures', 'state-queries.ts')],
  ])('the %s reaches no forbidden module and no vitest', (_name, entry, reached) => {
    const { visited, violations } = forbiddenImports(entry);
    expect(visited).toContain(reached);
    expect(violations).toEqual([]);
  });

  it.each([
    ['runner', RUNNER],
    ['cli', CLI],
  ])('the %s never reaches the L1 executor or the live run entry', (_name, entry) => {
    const { visited } = forbiddenImports(entry);
    expect(visited).not.toContain(join('suite', 'executors', 'l1-orchestrator-executor.ts'));
    expect(visited).not.toContain(join('suite', 'run-live.ts'));
  });

  it.each([
    ['runner', RUNNER],
    ['cli', CLI],
    ['L1 executor', L1_EXECUTOR],
  ])('the %s never reaches the L2 executor or the dev API client', (_name, entry) => {
    const { visited } = forbiddenImports(entry);
    for (const module of L2_MODULES) expect(visited).not.toContain(module);
  });

  it('l2-stack (the L2 workflow helper) reaches no executor, dev API client or live module', () => {
    const { visited, violations } = forbiddenImports(join(SRC, 'suite', 'l2-stack.ts'));
    expect(visited).toContain(join('suite', 'config.ts'));
    expect(visited.filter((file) => file.startsWith(join('suite', 'executors')))).toEqual([]);
    expect(violations).toEqual([]);
  });

  it('run-live reaches the L2 executor and the dev API client', () => {
    const { visited } = forbiddenImports(RUN_LIVE);
    expect(visited).toEqual(expect.arrayContaining(L2_MODULES));
  });

  it('refuses L2 through the default CLI in plain Node naming the gated live entry, writing nothing', () => {
    const listing = () => {
      const root = join(PACKAGE_DIR, 'runs', 'suites');
      return existsSync(root) ? readdirSync(root).sort() : null;
    };
    const before = listing();
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/suite/cli.ts', 'run', '--suite', 'smoke-v1', '--level', 'L2'], {
      cwd: PACKAGE_DIR,
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '' },
      timeout: 60_000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('run suite:run:live --suite <id> --level L2 --live-model --live-app');
    expect(listing()).toEqual(before);
  });

  it('refuses L2 through the live entry without --live-app in plain Node, sending nothing and writing nothing', () => {
    const listing = () => {
      const root = join(PACKAGE_DIR, 'runs', 'suites');
      return existsSync(root) ? readdirSync(root).sort() : null;
    };
    const before = listing();
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'src/suite/run-live.ts', 'run', '--suite', 'smoke-v1', '--level', 'L2', '--live-model'],
      { cwd: PACKAGE_DIR, encoding: 'utf8', env: { PATH: process.env.PATH ?? '' }, timeout: 60_000 },
    );
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('[suite] run:live --level L2 refuses without --live-app');
    expect(listing()).toEqual(before);
  });

  it('run-live is the entry that reaches live-provider and live-judge-model, and nothing else forbidden', () => {
    const { visited, violations } = forbiddenImports(RUN_LIVE);
    expect(visited).toEqual(expect.arrayContaining([join('suite', 'executors', 'l1-orchestrator-executor.ts'), join('suite', 'cli.ts')]));
    expect(violations).toEqual(
      expect.arrayContaining([
        { file: join('suite', 'run-live.ts'), specifier: '../harness/live-provider', reason: 'value import of live-provider' },
        { file: join('suite', 'run-live.ts'), specifier: './judge/live-judge-model', reason: 'value import of live-judge-model' },
      ]),
    );
    // Everything else is what those two adapters themselves import (the provider and the @ai-sdk packages).
    const rest = violations.filter((violation) => violation.file !== join('suite', 'run-live.ts'));
    expect(rest.map((violation) => `${violation.file}: ${violation.reason}`).sort()).toEqual([
      `${join('harness', 'live-provider.ts')}: value import of OpenAiProvider`,
      `${join('suite', 'judge', 'live-judge-model.ts')}: value import of @ai-sdk provider`,
      `${join('suite', 'judge', 'live-judge-model.ts')}: value import of @ai-sdk provider`,
    ]);
    expect(violations.some((violation) => /vitest|scenarios\/config|calibrate-live/.test(violation.reason))).toBe(false);
  });

  it('refuses the live run entry without --live-model in plain Node, writing nothing', () => {
    const listing = () => {
      const root = join(PACKAGE_DIR, 'runs', 'suites');
      return existsSync(root) ? readdirSync(root).sort() : null;
    };
    const before = listing();
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/suite/run-live.ts', 'run', '--suite', 'smoke-v1', '--level', 'L1'], {
      cwd: PACKAGE_DIR,
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '' },
      timeout: 60_000,
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('[suite] run:live refuses without --live-model');
    expect(listing()).toEqual(before);
  });

  it('runs one scripted atomic L1 case through the L1 executor and Scenario in plain Node (no Vitest)', () => {
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/suite/executors/__fixtures__/l1-plain-node-probe.ts'], {
      cwd: PACKAGE_DIR,
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '' },
      timeout: 60_000,
    });
    expect(result.status, result.stderr).toBe(0);
    const line = result.stdout.split('\n').find((entry) => entry.startsWith('{"steps"'));
    expect(JSON.parse(line ?? '{}')).toEqual({ steps: 1, reply: true, errors: [] });
  });

  it('refuses L1 through the default CLI in plain Node with the live-entry message, writing nothing', () => {
    const listing = () => {
      const root = join(PACKAGE_DIR, 'runs', 'suites');
      return existsSync(root) ? readdirSync(root).sort() : null;
    };
    const before = listing();
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/suite/cli.ts', 'run', '--suite', 'smoke-v1', '--level', 'L1'], {
      cwd: PACKAGE_DIR,
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '' },
      timeout: 60_000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('[suite] L1 runs call live models; run suite:run:live with --live-model');
    expect(listing()).toEqual(before);
  });

  it('flags value imports of vitest, not type-only ones', () => {
    const files: Record<string, string> = {
      [EXECUTOR]: ["import type { TestContext } from 'vitest';", "import { helper } from './helper';"].join('\n'),
      [join(SRC, 'suite', 'executors', 'helper.ts')]: [
        "import { onTestFailed } from 'vitest';",
        "import { vi } from 'vitest/dist/index.js';",
        'export const helper = [onTestFailed, vi];',
      ].join('\n'),
    };
    const { violations } = forbiddenImports(EXECUTOR, (file) => files[file] ?? null);
    expect(violations.map((violation) => `${violation.specifier}: ${violation.reason}`)).toEqual([
      'vitest: value import of vitest',
      'vitest/dist/index.js: value import of vitest',
    ]);
  });

  it('loads the CLI in plain Node with tsx (no Vitest)', () => {
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/suite/cli.ts', '--help'], {
      cwd: PACKAGE_DIR,
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '' },
      timeout: 60_000,
    });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('suite:run --suite <id> --level L0');
  });

  it('flags an import of the live calibration entry', () => {
    const files: Record<string, string> = {
      [CLI]: "const live = import('./judge/calibrate-live');\n",
      [join(SRC, 'suite', 'judge', 'calibrate-live.ts')]: 'export const calibrateLive = 1;\n',
    };
    const { violations } = forbiddenImports(CLI, (file) => files[file] ?? null);
    expect(violations.map((violation) => violation.reason)).toEqual(['value import of calibrate-live']);
  });

  it('refuses the live calibration entry without --live-judge in plain Node', () => {
    const listing = () => {
      const root = join(PACKAGE_DIR, 'calibration');
      return existsSync(root) ? readdirSync(root, { recursive: true }).map(String).sort() : null;
    };
    const before = listing();
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/suite/judge/calibrate-live.ts', 'calibrate', '--suite', 'smoke-v1'], {
      cwd: PACKAGE_DIR,
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '' },
      timeout: 60_000,
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('[suite] calibrate:live refuses without --live-judge');
    expect(listing()).toEqual(before);
  });

  it('runs the real CLI wiring on smoke-v1 in plain Node and writes the report under the package', () => {
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/suite/cli.ts', 'run', '--suite', 'smoke-v1', '--level', 'L0'], {
      cwd: PACKAGE_DIR,
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '' },
      timeout: 60_000,
    });
    const match = /^\[suite\] report: (runs\/suites\/([^/\s]+)\/report\.json)$/m.exec(result.stdout);
    try {
      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
      expect(match, result.stdout).not.toBeNull();
      expect(existsSync(join(PACKAGE_DIR, match![1]!))).toBe(true);
    } finally {
      if (match) rmSync(join(PACKAGE_DIR, 'runs', 'suites', match[2]!), { recursive: true, force: true });
    }
  });

  it('fails on a fixture file that imports scenarios/config.ts', () => {
    const files: Record<string, string> = {
      [join(SRC, 'suite', 'executors', 'l0-deterministic-executor.ts')]: "import { L0_FIXTURES } from '../fixtures';\n",
      [join(SRC, 'suite', 'fixtures', 'index.ts')]: "export { badFixture } from './bad';\n",
      [join(SRC, 'suite', 'fixtures', 'bad.ts')]: "import { judgeModel } from '../../scenarios/config';\nexport const badFixture = judgeModel;\n",
      [join(SRC, 'scenarios', 'config.ts')]: 'export const judgeModel = 1;\n',
    };
    const { violations } = forbiddenImports(EXECUTOR, (file) => files[file] ?? null);
    expect(violations).toEqual([
      { file: join('suite', 'fixtures', 'bad.ts'), specifier: '../../scenarios/config', reason: 'imports scenarios/config.ts' },
    ]);
  });

  it('flags value imports of OpenAiProvider and live-provider, not type-only ones', () => {
    const files: Record<string, string> = {
      [join(SRC, 'suite', 'executors', 'l0-deterministic-executor.ts')]: [
        "import type { OpenAiProvider } from '@entalent/ai-openai';",
        "import { type createLiveProvider } from '../../harness/live-provider';",
        "import { helper } from './helper';",
      ].join('\n'),
      [join(SRC, 'suite', 'executors', 'helper.ts')]: [
        '/* import { OpenAiProvider } from "@entalent/ai-openai"; */',
        "import {\n  OpenAiProvider,\n} from '@entalent/ai-openai';",
        "import { createLiveProvider } from '../../harness/live-provider';",
        'export const helper = [OpenAiProvider, createLiveProvider];',
      ].join('\n'),
      [join(SRC, 'harness', 'live-provider.ts')]: 'export const createLiveProvider = 1;\n',
    };
    const { violations } = forbiddenImports(EXECUTOR, (file) => files[file] ?? null);
    expect(violations.map((violation) => `${violation.file}: ${violation.reason}`)).toEqual([
      `${join('suite', 'executors', 'helper.ts')}: value import of OpenAiProvider`,
      `${join('suite', 'executors', 'helper.ts')}: value import of live-provider`,
    ]);
  });

  it('flags the live judge adapter and value imports of @ai-sdk providers, not type-only ones', () => {
    const files: Record<string, string> = {
      [RUNNER]: [
        "import type { createOpenAI } from '@ai-sdk/openai';",
        "import { judge } from './judge/wiring';",
      ].join('\n'),
      [join(SRC, 'suite', 'judge', 'wiring.ts')]: [
        "import { createLiveJudgeModel } from './live-judge-model';",
        "import * as azure from '@ai-sdk/azure';",
        "import { createOpenAI } from '@ai-sdk/openai';",
        'export const judge = [createLiveJudgeModel, azure, createOpenAI];',
      ].join('\n'),
      [join(SRC, 'suite', 'judge', 'live-judge-model.ts')]: 'export const createLiveJudgeModel = 1;\n',
    };
    const { violations } = forbiddenImports(RUNNER, (file) => files[file] ?? null);
    expect(violations.map((violation) => `${violation.specifier}: ${violation.reason}`)).toEqual([
      './live-judge-model: value import of live-judge-model',
      '@ai-sdk/azure: value import of @ai-sdk provider',
      '@ai-sdk/openai: value import of @ai-sdk provider',
    ]);
  });

  it('flags namespace, default, star and dynamic imports of @entalent/ai-openai but not other named bindings', () => {
    const files: Record<string, string> = {
      [join(SRC, 'suite', 'executors', 'l0-deterministic-executor.ts')]: [
        "import * as ai from '@entalent/ai-openai';",
        "import aiDefault from '@entalent/ai-openai';",
        "export * from '@entalent/ai-openai';",
        "const lazy = import('@entalent/ai-openai');",
        "import { hasReflectiveOpener } from '@entalent/ai-openai';",
      ].join('\n'),
    };
    const { violations } = forbiddenImports(EXECUTOR, (file) => files[file] ?? null);
    expect(violations.map((violation) => violation.reason)).toEqual(Array(4).fill('whole-module import of @entalent/ai-openai'));
  });

  it('parses import forms', () => {
    expect(valueImports("import a, { b as c, type D } from './x';")).toEqual([{ specifier: './x', names: ['b', 'a'], whole: true }]);
    expect(valueImports("import { b } from './x';")).toEqual([{ specifier: './x', names: ['b'], whole: false }]);
    expect(valueImports("import { type A, type B } from './types';")).toEqual([]);
    expect(valueImports("export * from './all';\nimport './side';\nconst m = import('./lazy');")).toEqual([
      { specifier: './all', names: [], whole: true },
      { specifier: './side', names: [], whole: true },
      { specifier: './lazy', names: [], whole: true },
    ]);
  });
});
