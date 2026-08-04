import { createAzure } from '@ai-sdk/azure';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';

/**
 * Models for the testing agents only — the coach under test always runs on the
 * production provider wiring, so a simulation measures what actually ships.
 *
 * Direct OpenAI is preferred for the simulator and the judge: it keeps the judge
 * independent of the model being judged and allows a cheap simulator. With Azure
 * only, everything collapses onto the single configured deployment.
 */
export const SET_ID = 'entalent-coach';

const SIMULATOR_MODEL = process.env.SIM_SIMULATOR_MODEL ?? 'gpt-4o-mini';
/** Keep this stable: changing the judge invalidates every recorded baseline. */
const JUDGE_MODEL = process.env.SIM_JUDGE_MODEL ?? 'gpt-4o';

export function simulatorModel(): LanguageModel {
  return testingModel(SIMULATOR_MODEL);
}

export function judgeModel(): LanguageModel {
  return testingModel(JUDGE_MODEL);
}

function testingModel(name: string): LanguageModel {
  const openAiKey = process.env.OPENAI_API_KEY;
  if (openAiKey) {
    return createOpenAI({ apiKey: openAiKey, organization: process.env.OPENAI_ORG_ID })(name);
  }

  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION;
  if (!endpoint || !apiKey || !apiVersion) {
    throw new Error(
      'Simulations need either OPENAI_API_KEY or the AZURE_OPENAI_* trio to drive the testing agents.',
    );
  }

  const azure = createAzure({
    baseURL: `${endpoint.replace(/\/$/, '')}/openai`,
    apiKey,
    apiVersion,
    useDeploymentBasedUrls: true,
  });
  // Azure exposes deployments, not model names, and the project configures one.
  const deployment =
    process.env.AZURE_OPENAI_TESTING_DEPLOYMENT ?? process.env.OPENAI_MODEL_BALANCED ?? name;
  // `azure(...)` targets the Responses API, which older Azure api-versions reject.
  return azure.chat(deployment);
}
