import { realpathSync } from 'node:fs';
import { defaultDeps, main, type CliDeps } from '../cli';
import type { SuiteConfig } from '../schema';
import { createCriterionJudge, type JudgeModel } from './criterion-judge';
import { createLiveJudgeModel, type JudgeEnv } from './live-judge-model';

/**
 * `suite:calibrate:live` (architecture AD-8): the only entry that wires the live pinned
 * judge into `suite:calibrate`. Model egress and cost are a human boundary, so it refuses
 * (exit 1, no model built) unless `--live-judge` is passed; no test, script or CI step runs
 * it with the flag. The CLI, runner and executors never import this module
 * (`executors/import-graph.test.ts`).
 */

export const LIVE_JUDGE_FLAG = '--live-judge';

export interface CalibrateLiveDeps {
  /** The CLI `main`; injected in tests. */
  run: (argv: readonly string[], deps: CliDeps) => Promise<number>;
  cliDeps: () => CliDeps;
  createModel: (judge: Pick<SuiteConfig['judge'], 'provider' | 'model'>, env: JudgeEnv) => JudgeModel;
  error: (line: string) => void;
}

const DEFAULTS: CalibrateLiveDeps = {
  run: main,
  cliDeps: defaultDeps,
  createModel: createLiveJudgeModel,
  error: (line) => console.error(line),
};

export async function calibrateLive(argv: readonly string[], overrides: Partial<CalibrateLiveDeps> = {}): Promise<number> {
  const deps: CalibrateLiveDeps = { ...DEFAULTS, ...overrides };
  if (!argv.includes(LIVE_JUDGE_FLAG)) {
    deps.error(`[suite] calibrate:live refuses without ${LIVE_JUDGE_FLAG}: it calls the pinned judge model (model egress and cost are a human boundary)`);
    return 1;
  }
  const stripped = argv.filter((arg) => arg !== LIVE_JUDGE_FLAG);
  const command = (stripped[0] === '--' ? stripped[1] : stripped[0]) ?? '';
  if (command !== 'calibrate') {
    deps.error(`[suite] calibrate:live runs only the calibrate command, got ${command || '(none)'}`);
    return 1;
  }
  const cliDeps = deps.cliDeps();
  return deps.run(stripped, {
    ...cliDeps,
    createCalibrationJudge: (judge, { callTimeoutMs }) =>
      createCriterionJudge({ model: deps.createModel(judge, cliDeps.env), decoding: judge.decoding, timeoutMs: callTimeoutMs }),
  });
}

function isEntryPoint(): boolean {
  if (process.argv[1] === undefined) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(__filename);
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  void calibrateLive(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
