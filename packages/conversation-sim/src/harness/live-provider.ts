import { OpenAiProvider } from '@entalent/ai-openai';
import type { AiProviderPort } from '@entalent/application';

/**
 * Mirrors `AiService` in the worker so simulations exercise the shipped provider setup.
 * Kept apart from `coach-harness.ts` so offline callers (the L0 suite executor) never
 * reach `OpenAiProvider` or read model credentials; only live call sites import it.
 */
export function createLiveProvider(): AiProviderPort {
  const azureEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
  if (azureEndpoint) {
    return new OpenAiProvider({
      azure: true,
      endpoint: azureEndpoint,
      apiKey: requireEnv('AZURE_OPENAI_API_KEY'),
      apiVersion: requireEnv('AZURE_OPENAI_API_VERSION'),
      deploymentName: process.env.OPENAI_MODEL_BALANCED ?? 'gpt-4o',
    });
  }

  return new OpenAiProvider({
    apiKey: requireEnv('OPENAI_API_KEY'),
    organizationId: process.env.OPENAI_ORG_ID || undefined,
  });
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required to run conversation simulations.`);
  return value;
}
