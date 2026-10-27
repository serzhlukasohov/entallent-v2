import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ScriptedAiProvider } from '../fakes/scripted-ai';
import { RUNNER_CONFIG } from './__fixtures__/runner';
import type { CliDeps } from './cli';
import type { DevApiRequest } from './executors/dev-api-client';
import { L1OrchestratorExecutor } from './executors/l1-orchestrator-executor';
import { L2ApplicationExecutor } from './executors/l2-application-executor';
import { mockJudgeModel, stallingJudgeModel, verdict } from './judge/__fixtures__/mock-model';
import { liveCoachModel, runLive } from './run-live';
import type { LoadedTest } from './schema';

/** The package dir, so L2 reads the committed suite.config.json (with `l2.workerEnv`). */
const PACKAGE_DIR = resolve(__dirname, '..', '..');

/** No provider or model is ever built here: the factories count calls and throw, and `run` is a stub. */
function stubs(
  env: Record<string, string | undefined> = { OPENAI_API_KEY: 'sk-test-fake', LANGWATCH_API_KEY: 'lw-test-fake' },
  packageDir = PACKAGE_DIR,
) {
  const errors: string[] = [];
  const runs: Array<{ argv: readonly string[]; deps: CliDeps }> = [];
  const built = { providers: 0, models: 0 };
  const cliDeps = { env, packageDir } as unknown as CliDeps;
  return {
    errors,
    runs,
    built,
    overrides: {
      run: async (argv: readonly string[], deps: CliDeps) => {
        runs.push({ argv, deps });
        return 0;
      },
      cliDeps: () => cliDeps,
      createProvider: () => {
        built.providers += 1;
        throw new Error('no provider in tests');
      },
      createJudgeModel: () => {
        built.models += 1;
        throw new Error('no model in tests');
      },
      error: (line: string) => errors.push(line),
    },
  };
}

const L2_NO_APP = '[suite] run:live --level L2 refuses without --live-app: it drives a running local API, queue and worker (and their coach model)';
const L2_ENV = {
  SUITE_L2_API_BASE: 'http://localhost:3000',
  SUITE_L2_TENANT_ID: '00000000-0000-4000-8000-000000000001',
  ADMIN_API_KEY: 'admin-test-fake',
};

describe('runLive', () => {
  it('refuses without --live-model, building nothing and running nothing', async () => {
    const s = stubs();
    expect(await runLive(['run', '--suite', 'smoke-v1', '--level', 'L1'], s.overrides)).toBe(1);
    expect(s.errors).toEqual([
      '[suite] run:live refuses without --live-model: it calls the live coach and judge models (model egress and cost are a human boundary)',
    ]);
    expect(s.runs).toEqual([]);
    expect(s.built).toEqual({ providers: 0, models: 0 });
  });

  it.each([
    [['calibrate', '--suite', 'smoke-v1', '--live-model'], '[suite] run:live runs only the run and ci commands, got calibrate'],
    [['run', '--suite', 'smoke-v1', '--level', 'L0', '--live-model'], '[suite] run:live runs only --level L1 or L2, got L0'],
    [['run', '--suite', 'smoke-v1', '--level', 'L0', '--live-model', '--live-app'], '[suite] run:live runs only --level L1 or L2, got L0'],
    [['run', '--suite', 'smoke-v1', '--level', 'L2', '--live-model'], L2_NO_APP],
    [['run', '--suite', 'smoke-v1', '--level', 'L1', '--live-model', '--live-app'], '[suite] run:live accepts --live-app only with --level L2'],
    [['run', '--suite', 'smoke-v1', '--live-model'], '[suite] run: --level <L0|L1|L2> is required'],
    [['ci', '--level', 'L0', '--live-model'], '[suite] run:live runs only --level L1 or L2, got L0'],
    [['ci', '--level', 'L1', '--live-model', '--live-app'], '[suite] run:live accepts --live-app only with --level L2'],
    [['ci', '--level', 'L2', '--live-model'], L2_NO_APP],
    [['ci', '--level', 'L2', '--runs', '3', '--include-unbaselined', '--live-model'], L2_NO_APP],
    [['diff', '--run', 'x', '--live-model'], '[suite] run:live runs only the run and ci commands, got diff'],
    [['baseline:accept', '--run', 'x', '--live-model'], '[suite] run:live runs only the run and ci commands, got baseline:accept'],
  ])('runs only the run and ci commands at L1: %j', async (argv, message) => {
    const s = stubs();
    expect(await runLive(argv, s.overrides)).toBe(1);
    expect(s.errors).toEqual([message]);
    expect(s.runs).toEqual([]);
    expect(s.built).toEqual({ providers: 0, models: 0 });
  });

  it('refuses ci --level L1 without --live-model, building nothing and running nothing', async () => {
    const s = stubs();
    expect(await runLive(['ci', '--level', 'L1', '--summary', 'summary.md'], s.overrides)).toBe(1);
    expect(s.errors).toEqual([
      '[suite] run:live refuses without --live-model: it calls the live coach and judge models (model egress and cost are a human boundary)',
    ]);
    expect(s.runs).toEqual([]);
    expect(s.built).toEqual({ providers: 0, models: 0 });
  });

  it('with the flag, runs ci --level L1 through main with the same L1 executor and judge wiring', async () => {
    const s = stubs();
    expect(await runLive(['ci', '--level', 'L1', '--live-model', '--summary', 'summary.md'], s.overrides)).toBe(0);
    expect(s.errors).toEqual([]);
    expect(s.runs).toHaveLength(1);
    const { argv, deps } = s.runs[0]!;
    expect(argv).toEqual(['ci', '--level', 'L1', '--summary', 'summary.md']);
    const executor = deps.createExecutor('L1');
    expect(executor).toBeInstanceOf(L1OrchestratorExecutor);
    expect(executor.coachModel).toBe('openai:analysis=gpt-4o-mini,generation=gpt-4o');
    expect(() => deps.createExecutor('L0')).toThrow('[suite] run:live runs only --level L1, got L0');
    expect(() => deps.createExecutor('L2')).toThrow('[suite] run:live runs only --level L1, got L2');
    expect(s.built).toEqual({ providers: 0, models: 0 });
    expect(() => deps.createRunJudge!(RUNNER_CONFIG.judge, { callTimeoutMs: 60_000 })).toThrow('no model in tests');
    expect(s.built.models).toBe(1);
  });

  it('with the flag, passes the scheduled ci --runs and --include-unbaselined through to main without the flag', async () => {
    const s = stubs();
    expect(await runLive(['ci', '--level', 'L1', '--runs', '1', '--include-unbaselined', '--live-model'], s.overrides)).toBe(0);
    expect(s.errors).toEqual([]);
    expect(s.runs).toHaveLength(1);
    expect(s.runs[0]!.argv).toEqual(['ci', '--level', 'L1', '--runs', '1', '--include-unbaselined']);
    expect(s.runs[0]!.deps.createExecutor('L1')).toBeInstanceOf(L1OrchestratorExecutor);
    expect(s.built).toEqual({ providers: 0, models: 0 });
  });

  it.each([
    [['ci', '--level', 'L1', '--runs', '0', '--live-model'], '[suite] ci: --runs must be a positive integer, got 0'],
    [['ci', '--level', 'L0', '--runs', '3', '--live-model'], '[suite] ci: --runs and --include-unbaselined are accepted only at L1 and L2'],
  ])('refuses a bad scheduled ci %j before running anything', async (argv, message) => {
    const s = stubs();
    expect(await runLive(argv, s.overrides)).toBe(1);
    expect(s.errors).toEqual([message]);
    expect(s.runs).toEqual([]);
    expect(s.built).toEqual({ providers: 0, models: 0 });
  });

  it('with the flag, strips it and runs main with an L1 executor and a judge factory that build nothing until used', async () => {
    const s = stubs();
    expect(await runLive(['run', '--', '--suite', 'smoke-v1', '--live-model', '--level', 'L1', '--runs', '5'], s.overrides)).toBe(0);
    expect(s.runs).toHaveLength(1);
    const { argv, deps } = s.runs[0]!;
    expect(argv).toEqual(['run', '--', '--suite', 'smoke-v1', '--level', 'L1', '--runs', '5']);

    const executor = deps.createExecutor('L1');
    expect(executor).toBeInstanceOf(L1OrchestratorExecutor);
    expect(executor.level).toBe('L1');
    expect(executor.coachModel).toBe('openai:analysis=gpt-4o-mini,generation=gpt-4o');
    expect((executor as unknown as { langwatch: unknown }).langwatch).toEqual({ apiKey: 'lw-test-fake' });
    expect(() => deps.createExecutor('L0')).toThrow('[suite] run:live runs only --level L1, got L0');
    expect(() => deps.createExecutor('L2')).toThrow('[suite] run:live runs only --level L1, got L2');
    expect(s.built).toEqual({ providers: 0, models: 0 });

    // The provider is built per test attempt, only when the executor runs a test.
    const test: LoadedTest = {
      id: 'X-01.A1', sourceCase: 'X-01', requirement: [], kind: 'atomic', levels: ['L1'], runProfile: 'isolated',
      setup: [], seed: { history: [] }, preconditions: [], steps: [{ text: 'Hi.' }], criteria: [],
    };
    await expect(executor.run(test, { attempt: 1, interMessageGapMs: 60_000 })).rejects.toThrow('no provider in tests');
    expect(s.built.providers).toBe(1);

    expect(() => deps.createRunJudge!(RUNNER_CONFIG.judge, { callTimeoutMs: 60_000 })).toThrow('no model in tests');
    expect(s.built.models).toBe(1);
  });

  it('wires the coach provider factory into the executor and judges with the configured decoding', async () => {
    const s = stubs({ AZURE_OPENAI_ENDPOINT: 'https://example.invalid', OPENAI_MODEL_BALANCED: 'deploy-1' });
    const model = mockJudgeModel([verdict('FAIL', 'no', null)]);
    const modelArgs: unknown[][] = [];
    let providers = 0;
    const overrides = {
      ...s.overrides,
      createProvider: () => {
        providers += 1;
        return new ScriptedAiProvider();
      },
      createJudgeModel: (...args: unknown[]) => {
        modelArgs.push(args);
        return model;
      },
    };
    expect(await runLive(['run', '--suite', 'smoke-v1', '--level', 'L1', '--live-model'], overrides)).toBe(0);
    const { deps } = s.runs[0]!;
    const executor = deps.createExecutor('L1');
    expect(executor.coachModel).toBe('azure:deploy-1');
    expect((executor as unknown as { langwatch: unknown }).langwatch).toEqual({ apiKey: undefined });

    const judgeConfig = { ...RUNNER_CONFIG.judge, decoding: { temperature: 0.2, reasoningEffort: null, maxOutputTokens: 55 } };
    const judge = deps.createRunJudge!(judgeConfig, { callTimeoutMs: 60_000 });
    expect(modelArgs).toEqual([[judgeConfig, { AZURE_OPENAI_ENDPOINT: 'https://example.invalid', OPENAI_MODEL_BALANCED: 'deploy-1' }]]);
    await judge({
      transcript: { turns: [{ role: 'coach', text: 'Hi.' }], evaluatedReplyIndex: 0 },
      expectedBehavior: 'x',
      passCondition: 'x',
      judgeGuidance: null,
      layer: 'P',
      fixtureContext: null,
    });
    expect(model.doGenerateCalls[0]).toMatchObject({ temperature: 0.2, maxOutputTokens: 55 });
    // The call timeout reaches generateText, which aborts the model call through its signal.
    expect(model.doGenerateCalls[0]!.abortSignal).toBeInstanceOf(AbortSignal);
    expect(providers).toBe(0);
  });

  it('passes the judge call timeout: a stalled judge call is a transport failure after one retry', async () => {
    const s = stubs();
    const stalled = stallingJudgeModel();
    const overrides = { ...s.overrides, createJudgeModel: () => stalled.model };
    expect(await runLive(['run', '--suite', 'smoke-v1', '--level', 'L1', '--live-model'], overrides)).toBe(0);
    const judge = s.runs[0]!.deps.createRunJudge!(RUNNER_CONFIG.judge, { callTimeoutMs: 20 });
    const outcome = await judge({
      transcript: { turns: [{ role: 'coach', text: 'Hi.' }], evaluatedReplyIndex: 0 },
      expectedBehavior: 'x',
      passCondition: 'x',
      judgeGuidance: null,
      layer: 'P',
      fixtureContext: null,
    });
    expect(outcome).toMatchObject({ status: 'ERROR', reason: 'judge-transport', usage: { calls: 2 } });
    expect(stalled.calls()).toBe(2);
  });

  it('with --live-model and --live-app, validates the L2 env first and wires the L2 executor over the injected transport', async () => {
    const s = stubs(L2_ENV);
    const requests: DevApiRequest[] = [];
    let transports = 0;
    const overrides = {
      ...s.overrides,
      createDevApiTransport: () => {
        transports += 1;
        return async (request: DevApiRequest) => {
          requests.push(request);
          return { status: 200, body: { conversationId: 'c-1', userId: 'u-1' } };
        };
      },
    };
    expect(await runLive(['run', '--suite', 'smoke-v1', '--level', 'L2', '--live-model', '--live-app', '--case', 'P-10.J'], overrides)).toBe(0);
    expect(s.errors).toEqual([]);
    const { argv, deps } = s.runs[0]!;
    expect(argv).toEqual(['run', '--suite', 'smoke-v1', '--level', 'L2', '--case', 'P-10.J']);
    expect(transports).toBe(0);
    const executor = deps.createExecutor('L2');
    expect(executor).toBeInstanceOf(L2ApplicationExecutor);
    expect(executor.level).toBe('L2');
    expect(executor.coachModel).toBeNull();
    expect(transports).toBe(1);
    expect(requests).toEqual([]);
    expect(() => deps.createExecutor('L1')).toThrow('[suite] run:live runs only --level L2, got L1');
    expect(() => deps.createRunJudge!(RUNNER_CONFIG.judge, { callTimeoutMs: 60_000 })).toThrow('no model in tests');
    expect(s.built).toEqual({ providers: 0, models: 1 });
  });

  it.each([
    [{ ...L2_ENV, SUITE_L2_API_BASE: 'https://api.example.com' }, 'SUITE_L2_API_BASE must target localhost'],
    [{ ...L2_ENV, SUITE_L2_API_BASE: 'http://localhost:3000/x' }, 'SUITE_L2_API_BASE path must be empty, / or /api/v1'],
    [{ ...L2_ENV, SUITE_L2_API_BASE: undefined }, 'SUITE_L2_API_BASE is required'],
    [{ ...L2_ENV, SUITE_L2_TENANT_ID: 'tenant-1' }, 'SUITE_L2_TENANT_ID must be a UUID'],
    [{ ...L2_ENV, ADMIN_API_KEY: undefined }, 'ADMIN_API_KEY is required'],
  ])('refuses a bad L2 env before running or building anything (%#)', async (env, message) => {
    const s = stubs(env);
    let transports = 0;
    const overrides = {
      ...s.overrides,
      createDevApiTransport: () => {
        transports += 1;
        throw new Error('no transport in tests');
      },
    };
    expect(await runLive(['run', '--suite', 'smoke-v1', '--level', 'L2', '--live-model', '--live-app'], overrides)).toBe(1);
    expect(s.errors).toHaveLength(1);
    expect(s.errors[0]).toContain(message);
    expect(s.errors[0]).not.toContain('api.example.com');
    expect(s.errors[0]).not.toContain('tenant-1');
    expect(s.runs).toEqual([]);
    expect(transports).toBe(0);
    expect(s.built).toEqual({ providers: 0, models: 0 });
  });

  it('with --live-app, runs ci --level L2 through main with the L2 executor carrying l2.workerEnv', async () => {
    const s = stubs(L2_ENV);
    let transports = 0;
    const overrides = {
      ...s.overrides,
      createDevApiTransport: () => {
        transports += 1;
        return async () => ({ status: 500, body: {} });
      },
    };
    const argv = ['ci', '--level', 'L2', '--runs', '3', '--include-unbaselined', '--live-model', '--live-app', '--summary', 'summary.md'];
    expect(await runLive(argv, overrides)).toBe(0);
    expect(s.errors).toEqual([]);
    expect(s.runs[0]!.argv).toEqual(['ci', '--level', 'L2', '--runs', '3', '--include-unbaselined', '--summary', 'summary.md']);
    const executor = s.runs[0]!.deps.createExecutor('L2') as L2ApplicationExecutor;
    expect(executor).toBeInstanceOf(L2ApplicationExecutor);
    expect(executor.workerEnv).toEqual({ PROACTIVE_SCAN_ENABLED: 'false' });
    expect(transports).toBe(1);
    expect(typeof s.runs[0]!.deps.createRunJudge).toBe('function');
    expect(s.built).toEqual({ providers: 0, models: 0 });
  });

  describe('suite.config.json l2.workerEnv', () => {
    function configDir(mutate: (config: Record<string, unknown>) => void): string {
      const dir = mkdtempSync(join(tmpdir(), 'suite-run-live-'));
      const config = JSON.parse(readFileSync(join(PACKAGE_DIR, 'suite.config.json'), 'utf8')) as Record<string, unknown>;
      mutate(config);
      writeFileSync(join(dir, 'suite.config.json'), JSON.stringify(config));
      return dir;
    }

    it.each([
      [['run', '--suite', 'smoke-v1', '--level', 'L2', '--live-model', '--live-app']],
      [['ci', '--level', 'L2', '--runs', '3', '--include-unbaselined', '--live-model', '--live-app']],
    ])('refuses L2 without l2.workerEnv before building anything: %j', async (argv) => {
      const dir = configDir((config) => delete config.l2);
      try {
        // A bad env too: the workerEnv refusal comes first and is the only line.
        const s = stubs({ ...L2_ENV, SUITE_L2_API_BASE: 'https://api.example.com' }, dir);
        let transports = 0;
        const overrides = { ...s.overrides, createDevApiTransport: () => { transports += 1; throw new Error('no transport'); } };
        expect(await runLive(argv, overrides)).toBe(1);
        expect(s.errors).toEqual([
          "[suite] run:live --level L2 refuses: suite.config.json l2.workerEnv is absent (the env the stack's worker runs with, e.g. PROACTIVE_SCAN_ENABLED=false, so proactive check-ins cannot land in a case)",
        ]);
        expect(s.runs).toEqual([]);
        expect(transports).toBe(0);
        expect(s.built).toEqual({ providers: 0, models: 0 });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('an invalid config is a one-line refusal; L1 never reads l2', async () => {
      const dir = configDir((config) => (config.l2 = { workerEnv: {} }));
      try {
        const s = stubs(L2_ENV, dir);
        expect(await runLive(['run', '--suite', 'smoke-v1', '--level', 'L2', '--live-model', '--live-app'], s.overrides)).toBe(1);
        expect(s.errors).toHaveLength(1);
        expect(s.errors[0]).toMatch(/^\[suite\] config: .*l2\.workerEnv/);
        expect(s.runs).toEqual([]);
        const l1 = stubs(undefined, dir);
        expect(await runLive(['run', '--suite', 'smoke-v1', '--level', 'L1', '--live-model'], l1.overrides)).toBe(0);
        expect(l1.errors).toEqual([]);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  it('empty suites: real ci --level L2 --runs 3 --include-unbaselined skips both, nothing to check, exit 0, nothing built', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'suite-run-live-ci-'));
    try {
      writeFileSync(join(dir, 'suite.config.json'), readFileSync(join(PACKAGE_DIR, 'suite.config.json')));
      const out: string[] = [];
      const errors: string[] = [];
      let transports = 0;
      const cliDeps: CliDeps = {
        env: { ...L2_ENV },
        packageDir: dir,
        now: () => new Date('2026-10-26T10:00:00.000Z'),
        git: () => ({ sha: 'abc1234def', shortSha: 'abc1234', dirty: false }),
        log: (line) => out.push(line),
        error: (line) => errors.push(line),
        loadSuite: (id) => ({ id, sources: [], tests: [] }) as never,
        createExecutor: () => {
          throw new Error('the default executor is never used');
        },
        mergeBase: () => {
          throw new Error('no merge-base read for empty suites');
        },
      };
      const code = await runLive(['ci', '--level', 'L2', '--runs', '3', '--include-unbaselined', '--live-model', '--live-app'], {
        cliDeps: () => cliDeps,
        createProvider: () => {
          throw new Error('no provider');
        },
        createJudgeModel: () => {
          throw new Error('no judge');
        },
        createDevApiTransport: () => {
          transports += 1;
          throw new Error('no transport');
        },
        error: (line) => errors.push(line),
      });
      expect(code).toBe(0);
      expect(errors).toEqual([]);
      expect(out).toEqual([
        '[suite] ci: p-v1 skipped (no L2 tests)',
        '[suite] ci: smoke-v1 skipped (no L2 tests)',
        '[suite] ci: no registered suite has L2 tests; L2 run passes with nothing to check',
        '[suite] ci: L2 gate exit 0',
      ]);
      expect(transports).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses L2 without --live-model even with --live-app', async () => {
    const s = stubs(L2_ENV);
    expect(await runLive(['run', '--suite', 'smoke-v1', '--level', 'L2', '--live-app'], s.overrides)).toBe(1);
    expect(s.errors[0]).toContain('refuses without --live-model');
    expect(s.runs).toEqual([]);
  });

  it('labels the live coach model from the environment', () => {
    expect(liveCoachModel({})).toBe('openai:analysis=gpt-4o-mini,generation=gpt-4o');
    expect(liveCoachModel({ OPENAI_MODEL_BALANCED: 'x' })).toBe('openai:analysis=gpt-4o-mini,generation=gpt-4o');
    expect(liveCoachModel({ AZURE_OPENAI_ENDPOINT: 'https://e' })).toBe('azure:gpt-4o');
    expect(liveCoachModel({ AZURE_OPENAI_ENDPOINT: 'https://e', OPENAI_MODEL_BALANCED: 'balanced-1' })).toBe('azure:balanced-1');
    // The provider's own expression: `??`, no trim.
    expect(liveCoachModel({ AZURE_OPENAI_ENDPOINT: 'https://e', OPENAI_MODEL_BALANCED: '' })).toBe('azure:');
  });
});
