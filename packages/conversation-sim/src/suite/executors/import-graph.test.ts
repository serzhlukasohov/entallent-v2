import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Architecture AD-14: the L0 executor never reaches `scenarios/config.ts` (judge and
 * simulator models, credentials) or `OpenAiProvider` (live model calls). This walks the
 * executor's static relative imports transitively; `import type` (and all-`type`
 * specifier lists, which TypeScript elides) are skipped because they vanish at runtime.
 */
const SRC = resolve(__dirname, '..', '..');
const EXECUTOR = join(SRC, 'suite', 'executors', 'l0-deterministic-executor.ts');

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
