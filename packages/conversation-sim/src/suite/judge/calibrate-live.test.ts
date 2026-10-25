import { describe, expect, it } from 'vitest';
import { RUNNER_CONFIG } from '../__fixtures__/runner';
import type { CliDeps } from '../cli';
import { calibrateLive } from './calibrate-live';
import { mockJudgeModel, stallingJudgeModel, verdict } from './__fixtures__/mock-model';

/** No model is ever built here: `createModel` throws if called, and `run` is a stub. */
function stubs() {
  const errors: string[] = [];
  const runs: Array<{ argv: readonly string[]; deps: CliDeps }> = [];
  let modelsBuilt = 0;
  const cliDeps = { env: { OPENAI_API_KEY: 'sk-test-fake' } } as unknown as CliDeps;
  return {
    errors,
    runs,
    modelsBuilt: () => modelsBuilt,
    overrides: {
      run: async (argv: readonly string[], deps: CliDeps) => {
        runs.push({ argv, deps });
        return 0;
      },
      cliDeps: () => cliDeps,
      createModel: () => {
        modelsBuilt += 1;
        throw new Error('no model in tests');
      },
      error: (line: string) => errors.push(line),
    },
  };
}

describe('calibrateLive', () => {
  it('refuses without --live-judge, building no model and running nothing', async () => {
    const s = stubs();
    expect(await calibrateLive(['calibrate', '--suite', 'x-suite'], s.overrides)).toBe(1);
    expect(s.errors).toEqual([
      '[suite] calibrate:live refuses without --live-judge: it calls the pinned judge model (model egress and cost are a human boundary)',
    ]);
    expect(s.runs).toEqual([]);
    expect(s.modelsBuilt()).toBe(0);
  });

  it('refuses commands other than calibrate', async () => {
    const s = stubs();
    expect(await calibrateLive(['run', '--suite', 'x-suite', '--level', 'L0', '--live-judge'], s.overrides)).toBe(1);
    expect(s.runs).toEqual([]);
  });

  it('with the flag, strips it and runs main with a judge factory that builds the model only when called', async () => {
    const s = stubs();
    expect(await calibrateLive(['calibrate', '--', '--suite', 'x-suite', '--live-judge', '--import', 'qa.json'], s.overrides)).toBe(0);
    expect(s.runs).toHaveLength(1);
    expect(s.runs[0]!.argv).toEqual(['calibrate', '--', '--suite', 'x-suite', '--import', 'qa.json']);
    expect(typeof s.runs[0]!.deps.createCalibrationJudge).toBe('function');
    expect(s.modelsBuilt()).toBe(0);
    expect(() => s.runs[0]!.deps.createCalibrationJudge!(RUNNER_CONFIG.judge, { callTimeoutMs: 60_000 })).toThrow('no model in tests');
    expect(s.modelsBuilt()).toBe(1);
  });

  it('builds the model from the CLI env and the judge pin, and judges with the configured decoding', async () => {
    const s = stubs();
    const model = mockJudgeModel([verdict('FAIL', 'no', null)]);
    const modelArgs: unknown[][] = [];
    const overrides = {
      ...s.overrides,
      createModel: (...args: unknown[]) => {
        modelArgs.push(args);
        return model;
      },
    };
    expect(await calibrateLive(['calibrate', '--suite', 'x-suite', '--live-judge'], overrides)).toBe(0);
    const judgeConfig = { ...RUNNER_CONFIG.judge, model: 'gpt-pinned', decoding: { temperature: 0.3, reasoningEffort: null, maxOutputTokens: 77 } };
    const judge = s.runs[0]!.deps.createCalibrationJudge!(judgeConfig, { callTimeoutMs: 60_000 });
    expect(modelArgs).toEqual([[judgeConfig, { OPENAI_API_KEY: 'sk-test-fake' }]]);
    expect((modelArgs[0]![0] as { provider: string; model: string })).toMatchObject({ provider: 'openai', model: 'gpt-pinned' });
    await judge({
      transcript: { turns: [{ role: 'coach', text: 'Hi.' }], evaluatedReplyIndex: 0 },
      expectedBehavior: 'x',
      passCondition: 'x',
      judgeGuidance: null,
      layer: 'P',
      fixtureContext: null,
    });
    expect(model.doGenerateCalls[0]).toMatchObject({ temperature: 0.3, maxOutputTokens: 77 });
    expect(model.doGenerateCalls[0]!.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it('passes the judge call timeout: a stalled call is ERROR judge-transport after one retry', async () => {
    const s = stubs();
    const stalled = stallingJudgeModel();
    expect(await calibrateLive(['calibrate', '--suite', 'x-suite', '--live-judge'], { ...s.overrides, createModel: () => stalled.model })).toBe(0);
    const judge = s.runs[0]!.deps.createCalibrationJudge!(RUNNER_CONFIG.judge, { callTimeoutMs: 20 });
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
});
