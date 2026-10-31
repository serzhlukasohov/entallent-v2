import OpenAI, { AzureOpenAI } from 'openai';
import type { PulseLanguageGeneratorPort, AnalyticalRenditionGeneratorPort, AnalyticalRenditionSource } from '@entalent/application';
import type { PulseResourceKind } from '@entalent/contracts';
import type { OpenAiProviderConfig } from './openai-provider';
import type { PulseSdkClient } from './pulse-report-narrative.adapter';
import { PULSE_LANGUAGE_GENERATE, PULSE_LANGUAGE_REVIEW, PULSE_RENDITION_GENERATE, PULSE_RENDITION_REVIEW } from './prompts/pulse-language';
const reviewSchema = { type: 'object', properties: { semanticPass: { type: 'boolean' } }, required: ['semanticPass'], additionalProperties: false };
export class PulseLanguageAdapter implements PulseLanguageGeneratorPort, AnalyticalRenditionGeneratorPort {
  readonly modelId: string;
  private readonly client: PulseSdkClient;
  constructor(config: OpenAiProviderConfig, client?: PulseSdkClient) {
    this.modelId = config.azure ? config.deploymentName : config.models?.generation ?? config.model ?? 'gpt-4o';
    this.client = client ?? (config.azure
      ? new AzureOpenAI({ endpoint: config.endpoint, apiKey: config.apiKey, apiVersion: config.apiVersion, maxRetries: 0, timeout: 30000 })
      : new OpenAI({ apiKey: config.apiKey, organization: config.organizationId, maxRetries: 0, timeout: 30000 }));
  }
  generate(input: { locale: string; kind: PulseResourceKind; source: Readonly<Record<string, string>>; attempt: number }) {
    const keys = Object.keys(input.source);
    return this.complete(PULSE_LANGUAGE_GENERATE, input, { type: 'object', properties: Object.fromEntries(keys.map(k => [k, { type: 'string' }])), required: keys, additionalProperties: false });
  }
  async review(input: { locale: string; kind: PulseResourceKind; source: Readonly<Record<string, string>>; candidate: Readonly<Record<string, string>> }) {
    return this.reviewWith(PULSE_LANGUAGE_REVIEW, input);
  }
  async translate(input: { source: AnalyticalRenditionSource; locale: string; attempt: number }) {
    const result = await this.complete(PULSE_RENDITION_GENERATE, { summary: input.source.summary, support: input.source.support, locale: input.locale }, { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false });
    return (result as { text?: unknown })?.text;
  }
  reviewTranslation(input: { source: AnalyticalRenditionSource; locale: string; text: string }) {
    return this.reviewWith(PULSE_RENDITION_REVIEW, { summary: input.source.summary, support: input.source.support, locale: input.locale, text: input.text });
  }
  private async reviewWith(system: string, input: unknown) {
    const output = await this.complete(system, input, reviewSchema);
    return { semanticPass: (output as { semanticPass?: unknown })?.semanticPass === true, modelId: this.modelId, promptVersion: 'pulse-language-review-v1' };
  }
  private async complete(system: string, input: unknown, schema: Record<string, unknown>): Promise<unknown> {
    const body = JSON.stringify(input);
    if (Buffer.byteLength(body) > 64 * 1024) throw new Error('language_capacity_exceeded');
    const output = await this.client.chat.completions.create({ model: this.modelId, messages: [{ role: 'system', content: system }, { role: 'user', content: body }], max_tokens: 12000, stream: false, response_format: { type: 'json_schema', json_schema: { name: 'pulse_language', strict: true, schema } } });
    const choice = output.choices[0];
    if (!choice || choice.finish_reason !== 'stop' || choice.message.refusal || choice.message.tool_calls?.length || !choice.message.content) throw new Error('language_generation_unavailable');
    return JSON.parse(choice.message.content) as unknown;
  }
}
