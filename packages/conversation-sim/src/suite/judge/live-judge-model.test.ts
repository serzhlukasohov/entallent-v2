import { describe, expect, it } from 'vitest';
import { createLiveJudgeModel } from './live-judge-model';

// Fake values only; constructing a model makes no call.
const OPENAI_ENV = { OPENAI_API_KEY: 'sk-test-fake' };
const AZURE_ENV = {
  AZURE_OPENAI_ENDPOINT: 'https://example.invalid/',
  AZURE_OPENAI_API_KEY: 'fake-key',
  AZURE_OPENAI_API_VERSION: '2024-10-21',
};

function described(model: ReturnType<typeof createLiveJudgeModel>): { provider: string; modelId: string } {
  return { provider: model.provider, modelId: model.modelId };
}

describe('createLiveJudgeModel', () => {
  it('builds an OpenAI model for the pinned judge from the passed env', () => {
    const model = described(createLiveJudgeModel({ provider: 'openai', model: 'gpt-4o' }, OPENAI_ENV));
    expect(model.modelId).toBe('gpt-4o');
    expect(model.provider).toMatch(/^openai/);
  });

  it('builds an Azure chat model addressed by the pinned deployment', () => {
    const model = described(createLiveJudgeModel({ provider: 'azure_openai', model: 'gpt-4o' }, AZURE_ENV));
    expect(model.modelId).toBe('gpt-4o');
    expect(model.provider).toMatch(/azure/);
  });

  it('reads only the passed env and names the missing variable', () => {
    expect(() => createLiveJudgeModel({ provider: 'openai', model: 'gpt-4o' }, {})).toThrow('[suite] live judge: OPENAI_API_KEY is required');
    expect(() =>
      createLiveJudgeModel({ provider: 'azure_openai', model: 'gpt-4o' }, { ...AZURE_ENV, AZURE_OPENAI_API_VERSION: undefined }),
    ).toThrow(/AZURE_OPENAI_API_VERSION/);
  });
});
