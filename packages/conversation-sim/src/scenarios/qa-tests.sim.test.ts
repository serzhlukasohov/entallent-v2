import { basename } from 'node:path';
import { describe, it } from 'vitest';
import { liveQaDriver } from '../qa/live-driver';
import { listQaTests, loadQaTest, type QaTest } from '../qa/load';
import { assertQaRun, runQaTest } from '../qa/run';

/**
 * Every top-level `qa-tests/*.json` is one live test: its replies go to the real coach from its
 * precondition, the judge checks its expected results, and its hard checks run as code. A file
 * that fails validation shows as a failing test with the load error.
 */
const files = listQaTests();

describe('QA tests', () => {
  if (files.length === 0) {
    it.skip('no QA test files in qa-tests/', () => {});
    return;
  }
  for (const file of files) {
    let test: QaTest | null = null;
    let loadError: unknown = null;
    try {
      test = loadQaTest(file);
    } catch (error) {
      loadError = error;
    }
    const name = test ? `${test.id}: ${test.title}` : basename(file, '.json');
    it(name, async () => {
      if (!test) throw loadError;
      assertQaRun(test, await runQaTest(test, { driver: liveQaDriver() }));
    });
  }
});
