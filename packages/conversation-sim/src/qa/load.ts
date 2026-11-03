import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import type { ZodError } from 'zod';
// Vitest-free import: the promote CLI loads QA tests outside Vitest.
import { loadPrecondition, type ResolvedPrecondition } from '../preconditions/parse';
import { HARD_CHECK_NAMES, QA_TEST_SCHEMA_VERSION, qaTestSchema, type QaTestFile } from './schema';

// The package compiles as CommonJS, where `import.meta` does not typecheck; `__dirname` is the same anchor.
const PACKAGE_ROOT = join(__dirname, '..', '..');
/** QA drops test files here; every top-level `*.json` is one `pnpm sim` test. */
export const QA_TESTS_DIR = join(PACKAGE_ROOT, 'qa-tests');
/** Precondition paths in a QA test resolve against this folder. */
export const PRECONDITIONS_DIR = join(PACKAGE_ROOT, 'preconditions');

/** A validated QA test with its precondition loaded. */
export interface QaTest extends QaTestFile {
  /** File the test was loaded from. */
  source: string;
  /** File name without `.json`; the test's stable id. */
  id: string;
  resolvedPrecondition: ResolvedPrecondition;
}

export class QaTestError extends Error {
  override name = 'QaTestError';
}

/** Top-level `*.json` files of a QA tests folder, sorted; subfolders (examples) are not tests. */
export function listQaTests(dir: string = QA_TESTS_DIR): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
    .map((entry) => join(dir, entry.name))
    .sort();
}

/** Reads and validates a QA test file and its precondition. Errors name the file and the field path. */
export function loadQaTest(path: string, preconditionsDir: string = PRECONDITIONS_DIR): QaTest {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new QaTestError(`${path}: cannot read QA test JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const version = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>).schemaVersion : undefined;
  if (version !== QA_TEST_SCHEMA_VERSION) {
    throw new QaTestError(
      `${path}: schemaVersion: unsupported QA test version ${JSON.stringify(version)}; this harness reads version ${QA_TEST_SCHEMA_VERSION}`,
    );
  }
  const parsed = qaTestSchema.safeParse(raw);
  if (!parsed.success) throw new QaTestError(formatIssues(path, parsed.error));

  const preconditionPath = resolve(preconditionsDir, parsed.data.precondition);
  if (isAbsolute(parsed.data.precondition) || relative(preconditionsDir, preconditionPath).startsWith('..')) {
    throw new QaTestError(`${path}: precondition: must be a path inside ${preconditionsDir}, got ${parsed.data.precondition}`);
  }
  if (!existsSync(preconditionPath)) {
    throw new QaTestError(`${path}: precondition: file not found: ${preconditionPath} (paths are relative to ${preconditionsDir})`);
  }
  let resolvedPrecondition: ResolvedPrecondition;
  try {
    resolvedPrecondition = loadPrecondition(preconditionPath);
  } catch (error) {
    throw new QaTestError(`${path}: precondition: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { ...parsed.data, source: path, id: basename(path).replace(/\.json$/i, ''), resolvedPrecondition };
}

function formatIssues(label: string, error: ZodError): string {
  const lines = error.issues.map((issue) => {
    const path = issue.path.join('.') || '(root)';
    const menuHint = issue.path[0] === 'hardChecks' && (issue.code === 'invalid_union_discriminator' || issue.path.at(-1) === 'check')
      ? ` (hard checks: ${HARD_CHECK_NAMES.join(', ')})`
      : '';
    return `${path}: ${issue.message}${menuHint}`;
  });
  return `${label}: invalid QA test\n  ${lines.join('\n  ')}`;
}
