import { existsSync, linkSync, statSync, unlinkSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { loadQaTest, PRECONDITIONS_DIR, QA_TESTS_DIR, QaTestError } from './load';

export interface PromoteDraftOptions {
  /** The finished draft, usually `qa-tests/drafts/<name>.json`. */
  draft: string;
  qaTestsDir?: string;
  preconditionsDir?: string;
}

export interface PromotedDraft {
  /** Where the test now lives; the next `pnpm sim` runs it. */
  target: string;
  /** The test id (file name without `.json`), usable as a Vitest `-t` filter. */
  id: string;
}

/**
 * Moves a finished QA test draft into the QA tests folder, after validating it exactly as the runner will
 * (schema, expected results or hard checks, precondition loads). An invalid draft stays where it is.
 */
export function promoteDraft(options: PromoteDraftOptions): PromotedDraft {
  const qaTestsDir = resolve(options.qaTestsDir ?? QA_TESTS_DIR);
  const draft = resolve(options.draft);
  if (!existsSync(draft) || !statSync(draft).isFile()) throw new QaTestError(`${draft}: draft not found`);
  if (!draft.toLowerCase().endsWith('.json')) throw new QaTestError(`${draft}: a QA test is a .json file`);
  if (dirname(draft) !== join(qaTestsDir, 'drafts')) throw new QaTestError(`${draft}: only files in ${join(qaTestsDir, 'drafts')} can be promoted`);
  const target = join(qaTestsDir, basename(draft));
  if (existsSync(target)) throw new QaTestError(`${target} already exists; rename the draft or remove the old test first`);
  const test = loadQaTest(draft, options.preconditionsDir ?? PRECONDITIONS_DIR);
  if (/^DRAFT\b/.test(test.title)) throw new QaTestError(`${draft}: title still starts with DRAFT; write the expected behavior as the title`);
  // link + unlink fails with EEXIST if a test appeared in between; rename would silently replace it.
  try {
    linkSync(draft, target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new QaTestError(`${target} already exists; rename the draft or remove the old test first`);
    throw error;
  }
  unlinkSync(draft);
  return { target, id: test.id };
}
