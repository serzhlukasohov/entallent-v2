import { realpathSync } from 'node:fs';
import type { AiProviderPort } from '@entalent/application';
import { createLiveProvider } from '../harness/live-provider';
import { CliUsageError, defaultDeps, main, parseArgs, type CliDeps } from './cli';
import { L1OrchestratorExecutor } from './executors/l1-orchestrator-executor';
import { createCriterionJudge, type JudgeModel } from './judge/criterion-judge';
import { createLiveJudgeModel, type JudgeEnv } from './judge/live-judge-model';
import type { SuiteConfig } from './schema';

/**
 * `suite:run:live` (architecture AD-14, AD-15, AD-16): the only entry that wires the live
 * coach provider and the live pinned judge into `suite:run` and `suite:ci`. Model egress and
 * cost are a human boundary, so it refuses (exit 1, nothing built) unless `--live-model` is
 * passed, and it runs only the `run` and `ci` commands at `--level L1`. Its only automated
 * callers are the opt-in L1 pull-request gate (`.github/workflows/conversation-suite-l1-pr.yml`,
 * live only when `CONVERSATION_SUITE_L1_PR_GATE_ENABLED` is `true`) and the opt-in scheduled
 * `suite-l1` job of `.github/workflows/conversation-sim.yml` (`ci --level L1 --runs N
 * --include-unbaselined`; scheduled runs need `CONVERSATION_SIM_SCHEDULED_ENABLED=true`, and
 * `workflow_dispatch` is a manual run); no test or script runs it with the flag. The CLI, runner and executors never import this module
 * (`executors/import-graph.test.ts`).
 */

export const LIVE_MODEL_FLAG = '--live-model';

export interface RunLiveDeps {
  /** The CLI `main`; injected in tests. */
  run: (argv: readonly string[], deps: CliDeps) => Promise<number>;
  cliDeps: () => CliDeps;
  /** Builds the coach provider; called by the L1 executor once per test attempt. */
  createProvider: () => AiProviderPort;
  createJudgeModel: (judge: Pick<SuiteConfig['judge'], 'provider' | 'model'>, env: JudgeEnv) => JudgeModel;
  error: (line: string) => void;
}

const DEFAULTS: RunLiveDeps = {
  run: main,
  cliDeps: defaultDeps,
  createProvider: createLiveProvider,
  createJudgeModel: createLiveJudgeModel,
  error: (line) => console.error(line),
};

/**
 * The coach model label `createLiveProvider` talks to, recorded as `models.coach`: on Azure the
 * one deployment it resolves (same expression), on OpenAI the `OpenAiProvider` default tiers.
 */
export function liveCoachModel(env: Readonly<Record<string, string | undefined>>): string {
  if (env.AZURE_OPENAI_ENDPOINT) return `azure:${env.OPENAI_MODEL_BALANCED ?? 'gpt-4o'}`;
  return 'openai:analysis=gpt-4o-mini,generation=gpt-4o';
}

export async function runLive(argv: readonly string[], overrides: Partial<RunLiveDeps> = {}): Promise<number> {
  const deps: RunLiveDeps = { ...DEFAULTS, ...overrides };
  if (!argv.includes(LIVE_MODEL_FLAG)) {
    deps.error(`[suite] run:live refuses without ${LIVE_MODEL_FLAG}: it calls the live coach and judge models (model egress and cost are a human boundary)`);
    return 1;
  }
  const stripped = argv.filter((arg) => arg !== LIVE_MODEL_FLAG);
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs(stripped);
  } catch (error) {
    if (!(error instanceof CliUsageError)) throw error;
    deps.error(error.message);
    return 1;
  }
  if (parsed.command !== 'run' && parsed.command !== 'ci') {
    deps.error(`[suite] run:live runs only the run and ci commands, got ${parsed.command}`);
    return 1;
  }
  if (parsed.level !== 'L1') {
    deps.error(`[suite] run:live runs only --level L1, got ${parsed.level}`);
    return 1;
  }
  const cliDeps = deps.cliDeps();
  return deps.run(stripped, {
    ...cliDeps,
    createExecutor: (level) => {
      if (level !== 'L1') throw new Error(`[suite] run:live runs only --level L1, got ${level}`);
      return new L1OrchestratorExecutor({
        createAiProvider: deps.createProvider,
        coachModel: liveCoachModel(cliDeps.env),
        langwatch: { apiKey: cliDeps.env.LANGWATCH_API_KEY },
      });
    },
    createRunJudge: (judge, { callTimeoutMs }) =>
      createCriterionJudge({ model: deps.createJudgeModel(judge, cliDeps.env), decoding: judge.decoding, timeoutMs: callTimeoutMs }),
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
  void runLive(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
    // Scenario 0.4.15 `EventBus.drain` leaves a five-minute timer referenced after every run
    // (and its observability setup a metrics reader); exit after a grace period instead of
    // idling. Unreferenced, so a run with nothing left pending exits on its own.
    setTimeout(() => process.exit(code), 1_000).unref();
  });
}
