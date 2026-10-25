import { describe, expect, it } from 'vitest';
import { ScriptedAiProvider } from '../fakes/scripted-ai';
import { RUNNER_CONFIG } from './__fixtures__/runner';
import type { CliDeps } from './cli';
import { L1OrchestratorExecutor } from './executors/l1-orchestrator-executor';
import { mockJudgeModel, stallingJudgeModel, verdict } from './judge/__fixtures__/mock-model';
import { liveCoachModel, runLive } from './run-live';
import type { LoadedTest } from './schema';

/** No provider or model is ever built here: the factories count calls and throw, and `run` is a stub. */
function stubs(env: Record<string, string | undefined> = { OPENAI_API_KEY: 'sk-test-fake', LANGWATCH_API_KEY: 'lw-test-fake' }) {
  const errors: string[] = [];
  const runs: Array<{ argv: readonly string[]; deps: CliDeps }> = [];
  const built = { providers: 0, models: 0 };
  const cliDeps = { env } as unknown as CliDeps;
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
    [['calibrate', '--suite', 'smoke-v1', '--live-model'], '[suite] run:live runs only the run command, got calibrate'],
    [['run', '--suite', 'smoke-v1', '--level', 'L0', '--live-model'], '[suite] run:live runs only --level L1, got L0'],
    [['run', '--suite', 'smoke-v1', '--level', 'L2', '--live-model'], '[suite] run:live runs only --level L1, got L2'],
    [['run', '--suite', 'smoke-v1', '--live-model'], '[suite] run: --level <L0|L1|L2> is required'],
  ])('runs only the run command at L1: %j', async (argv, message) => {
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

  it('labels the live coach model from the environment', () => {
    expect(liveCoachModel({})).toBe('openai:analysis=gpt-4o-mini,generation=gpt-4o');
    expect(liveCoachModel({ OPENAI_MODEL_BALANCED: 'x' })).toBe('openai:analysis=gpt-4o-mini,generation=gpt-4o');
    expect(liveCoachModel({ AZURE_OPENAI_ENDPOINT: 'https://e' })).toBe('azure:gpt-4o');
    expect(liveCoachModel({ AZURE_OPENAI_ENDPOINT: 'https://e', OPENAI_MODEL_BALANCED: 'balanced-1' })).toBe('azure:balanced-1');
    // The provider's own expression: `??`, no trim.
    expect(liveCoachModel({ AZURE_OPENAI_ENDPOINT: 'https://e', OPENAI_MODEL_BALANCED: '' })).toBe('azure:');
  });
});
