import { realpathSync } from 'node:fs';
import type { AiProviderPort } from '@entalent/application';
import { createLiveProvider } from '../harness/live-provider';
import { CliUsageError, defaultDeps, main, parseArgs, type CliDeps } from './cli';
import { DevApiClient, DevApiConfigError, createFetchTransport, devApiConfigFromEnv, type DevApiConfig, type DevApiTransport } from './executors/dev-api-client';
import { L1OrchestratorExecutor } from './executors/l1-orchestrator-executor';
import { L2ApplicationExecutor } from './executors/l2-application-executor';
import { createCriterionJudge, type JudgeModel } from './judge/criterion-judge';
import { createLiveJudgeModel, type JudgeEnv } from './judge/live-judge-model';
import type { SuiteConfig } from './schema';

/**
 * `suite:run:live` (architecture AD-14, AD-15, AD-16): the only entry that wires the live
 * coach provider and the live pinned judge into `suite:run` and `suite:ci`. Model egress and
 * cost are a human boundary, so it refuses (exit 1, nothing built) unless `--live-model` is
 * passed, and it runs only the `run` and `ci` commands at `--level L1`, plus `run --level L2`
 * with `--live-app` too (Story 14.2: it drives a running local API, queue and worker over the
 * dev endpoints, whose worker calls its own coach model; `SUITE_L2_API_BASE` must be a
 * localhost URL, validated before anything is built). `ci --level L2` stays refused (Story
 * 14.3 owns the L2 workflow), and `--live-app` at any other level is refused. Its only automated
 * callers are the opt-in L1 pull-request gate (`.github/workflows/conversation-suite-l1-pr.yml`,
 * live only when `CONVERSATION_SUITE_L1_PR_GATE_ENABLED` is `true`) and the opt-in scheduled
 * `suite-l1` job of `.github/workflows/conversation-sim.yml` (`ci --level L1 --runs N
 * --include-unbaselined`; scheduled runs need `CONVERSATION_SIM_SCHEDULED_ENABLED=true`, and
 * `workflow_dispatch` is a manual run); no test or script runs it with the flag. The CLI, runner and executors never import this module
 * (`executors/import-graph.test.ts`).
 */

export const LIVE_MODEL_FLAG = '--live-model';
export const LIVE_APP_FLAG = '--live-app';
/** Per dev API request timeout of the default L2 transport. */
export const DEV_API_TIMEOUT_MS = 30_000;

export interface RunLiveDeps {
  /** The CLI `main`; injected in tests. */
  run: (argv: readonly string[], deps: CliDeps) => Promise<number>;
  cliDeps: () => CliDeps;
  /** Builds the coach provider; called by the L1 executor once per test attempt. */
  createProvider: () => AiProviderPort;
  createJudgeModel: (judge: Pick<SuiteConfig['judge'], 'provider' | 'model'>, env: JudgeEnv) => JudgeModel;
  /** Builds the L2 dev API transport (the default is the global fetch); called once per L2 executor. */
  createDevApiTransport: () => DevApiTransport;
  error: (line: string) => void;
}

const DEFAULTS: RunLiveDeps = {
  run: main,
  cliDeps: defaultDeps,
  createProvider: createLiveProvider,
  createJudgeModel: createLiveJudgeModel,
  createDevApiTransport: () => createFetchTransport(DEV_API_TIMEOUT_MS),
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
  const liveApp = argv.includes(LIVE_APP_FLAG);
  const stripped = argv.filter((arg) => arg !== LIVE_MODEL_FLAG && arg !== LIVE_APP_FLAG);
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
  if (parsed.level !== 'L1' && parsed.level !== 'L2') {
    deps.error(`[suite] run:live runs only --level L1 or L2, got ${parsed.level}`);
    return 1;
  }
  if (parsed.level === 'L1' && liveApp) {
    deps.error(`[suite] run:live accepts ${LIVE_APP_FLAG} only with --level L2`);
    return 1;
  }
  let devApi: DevApiConfig | null = null;
  const cliDeps = deps.cliDeps();
  if (parsed.level === 'L2') {
    if (parsed.command === 'ci') {
      deps.error('[suite] run:live ci --level L2 is not wired yet (Story 14.3 owns the L2 workflow); use run --level L2');
      return 1;
    }
    if (!liveApp) {
      deps.error(`[suite] run:live --level L2 refuses without ${LIVE_APP_FLAG}: it drives a running local API, queue and worker (and their coach model)`);
      return 1;
    }
    try {
      devApi = devApiConfigFromEnv(cliDeps.env);
    } catch (error) {
      if (!(error instanceof DevApiConfigError)) throw error;
      deps.error(error.message);
      return 1;
    }
  }
  const level = parsed.level;
  return deps.run(stripped, {
    ...cliDeps,
    createExecutor: (requested) => {
      if (requested !== level) throw new Error(`[suite] run:live runs only --level ${level}, got ${requested}`);
      if (requested === 'L2') return new L2ApplicationExecutor({ client: new DevApiClient(devApi!, deps.createDevApiTransport()) });
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
