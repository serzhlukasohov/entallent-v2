import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Architecture AD-6 / AD-12: suite rules and their term lists stay inside
 * `conversation-sim`. No product package or app imports `@entalent/conversation-sim`
 * or any `suite/` path.
 */
const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.next', '.turbo', 'coverage']);
const SOURCE_FILE = /\.(?:[cm]?[jt]sx?)$/;
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g;

function sourceRoots(): string[] {
  return ['packages', 'apps'].flatMap((group) => {
    const groupDir = join(REPO_ROOT, group);
    return readdirSync(groupDir)
      .filter((name) => !(group === 'packages' && name === 'conversation-sim'))
      .map((name) => join(groupDir, name, 'src'))
      .filter((dir) => {
        try {
          return statSync(dir).isDirectory();
        } catch {
          return false;
        }
      });
  });
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) ? [] : sourceFiles(join(dir, entry.name));
    return entry.isFile() && SOURCE_FILE.test(entry.name) ? [join(dir, entry.name)] : [];
  });
}

function isForbiddenSpecifier(specifier: string): boolean {
  return (
    specifier === '@entalent/conversation-sim' ||
    specifier.startsWith('@entalent/conversation-sim/') ||
    /(?:^|\/)suite(?:\/|$)/.test(specifier)
  );
}

describe('suite isolation', () => {
  it('recognizes forbidden specifiers', () => {
    expect(isForbiddenSpecifier('@entalent/conversation-sim')).toBe(true);
    expect(isForbiddenSpecifier('@entalent/conversation-sim/src/suite/rules/registry')).toBe(true);
    expect(isForbiddenSpecifier('../../conversation-sim/src/suite/rules/terms/internal-terms')).toBe(true);
    expect(isForbiddenSpecifier('./suite')).toBe(true);
    expect(isForbiddenSpecifier('@entalent/application')).toBe(false);
    expect(isForbiddenSpecifier('./test-suite-helpers')).toBe(false);
  });

  it('finds no import of conversation-sim or suite/ in product packages and apps', () => {
    const roots = sourceRoots();
    expect(roots.length).toBeGreaterThan(0);
    const files = roots.flatMap(sourceFiles);
    expect(files.length).toBeGreaterThan(0);
    const offenders = files.flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(SPECIFIER)]
        .map((match) => match[1]!)
        .filter(isForbiddenSpecifier)
        .map((specifier) => `${relative(REPO_ROOT, file)}: ${specifier}`),
    );
    expect(offenders).toEqual([]);
  });
});
