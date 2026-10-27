import { createAzure } from '@ai-sdk/azure';
import { createOpenAI } from '@ai-sdk/openai';
import type { SuiteConfig } from '../schema';
import type { JudgeModel } from './criterion-judge';

/**
 * Optional live adapter for the pinned judge (architecture AD-7, AD-8). It builds a model
 * object only and makes no call. It reads only the `env` it is given, never `process.env`.
 * Model egress is a human boundary: nothing in the runner, the CLI or the executors imports
 * this module (enforced by `executors/import-graph.test.ts`).
 */
export type JudgeEnv = Readonly<Record<string, string | undefined>>;

export function createLiveJudgeModel(judge: Pick<SuiteConfig['judge'], 'provider' | 'model'>, env: JudgeEnv): JudgeModel {
  if (judge.provider === 'openai') {
    return createOpenAI({ apiKey: requireEnv(env, 'OPENAI_API_KEY'), organization: env.OPENAI_ORG_ID || undefined })(judge.model);
  }
  const endpoint = requireEnv(env, 'AZURE_OPENAI_ENDPOINT');
  const azure = createAzure({
    baseURL: `${endpoint.replace(/\/$/, '')}/openai`,
    apiKey: requireEnv(env, 'AZURE_OPENAI_API_KEY'),
    apiVersion: requireEnv(env, 'AZURE_OPENAI_API_VERSION'),
    useDeploymentBasedUrls: true,
  });
  // Azure addresses deployments; the pinned model name is the deployment name.
  return azure.chat(judge.model);
}

function requireEnv(env: JudgeEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`[suite] live judge: ${name} is required`);
  return value;
}
