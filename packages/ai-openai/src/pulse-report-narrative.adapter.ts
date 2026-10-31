import OpenAI, { AzureOpenAI } from 'openai';
import {
  PULSE_ENGLISH_LABELS,
  PULSE_SEMANTIC_VIOLATIONS,
  PulseAssemblyError,
  type PulseLabels,
  type PulseNarrativeRequest,
} from '@entalent/contracts';
import type { PulseReportNarrativePort } from '@entalent/application';
import type { OpenAiProviderConfig } from './openai-provider';
import {
  PULSE_NARRATIVE_SYSTEM,
  PULSE_NARRATIVE_REVIEW_SYSTEM,
  PULSE_LABEL_SYSTEM,
  PULSE_LABEL_REVIEW_SYSTEM,
} from './prompts/pulse-report-narrative';
const string = { type: 'string' };
const refs = { type: 'array', items: string };
const object = (properties: Record<string, unknown>) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const statement = object({ text: string, references: refs });
const narrativeSchema = object({
  explanation: { type: 'array', items: statement },
  focus: {
    anyOf: [
      object({ kind: { const: 'none_supported', type: 'string' } }),
      object({ kind: { const: 'problem', type: 'string' }, text: string, references: refs }),
    ],
  },
  actions: { type: 'array', items: object({ title: string, detail: string, references: refs }) },
});
const reviewSchema = object({
  verdict: { type: 'string', enum: ['pass', 'fail'] },
  violations: { type: 'array', items: { type: 'string', enum: [...PULSE_SEMANTIC_VIOLATIONS] } },
});
const labelSchema = object(
  Object.fromEntries(Object.keys(PULSE_ENGLISH_LABELS).map((k) => [k, string])),
);
export interface PulseSdkClient {
  chat: {
    completions: {
      create(
        input: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
      ): Promise<Pick<OpenAI.Chat.Completions.ChatCompletion, 'choices'>>;
    };
  };
}
/** Dedicated client: SDK retry/fallback is deliberately disabled. No request occurs at construction. */
export class PulseReportNarrativeAdapter implements PulseReportNarrativePort {
  private readonly client: PulseSdkClient;
  private readonly model: string;
  constructor(config: OpenAiProviderConfig, client?: PulseSdkClient) {
    this.model = config.azure
      ? config.deploymentName
      : (config.models?.generation ?? config.model ?? 'gpt-4o');
    this.client =
      client ??
      (config.azure
        ? new AzureOpenAI({
            endpoint: config.endpoint,
            apiKey: config.apiKey,
            apiVersion: config.apiVersion,
            maxRetries: 0,
            timeout: 30_000,
          })
        : new OpenAI({
            apiKey: config.apiKey,
            organization: config.organizationId,
            maxRetries: 0,
            timeout: 30_000,
          }));
  }
  draft(input: PulseNarrativeRequest, corrections: readonly string[]) {
    return this.complete(
      PULSE_NARRATIVE_SYSTEM,
      { input, corrections },
      'pulse_narrative',
      narrativeSchema,
    );
  }
  review(input: PulseNarrativeRequest, draft: unknown) {
    return this.complete(
      PULSE_NARRATIVE_REVIEW_SYSTEM,
      { input, draft },
      'pulse_review',
      reviewSchema,
    );
  }
  localize(locale: string, meanings: PulseLabels, corrections: readonly string[]) {
    return this.complete(
      PULSE_LABEL_SYSTEM,
      { locale, meanings, corrections },
      'pulse_labels',
      labelSchema,
    );
  }
  reviewLabels(locale: string, meanings: PulseLabels, draft: unknown) {
    return this.complete(
      PULSE_LABEL_REVIEW_SYSTEM,
      { locale, meanings, draft },
      'pulse_label_review',
      reviewSchema,
    );
  }
  private async complete(
    system: string,
    input: unknown,
    name: string,
    schema: Record<string, unknown>,
  ): Promise<unknown> {
    const request: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
      model: this.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify(input) },
      ],
      max_tokens: 4096,
      response_format: { type: 'json_schema', json_schema: { name, strict: true, schema } },
      stream: false,
    };
    if (Buffer.byteLength(JSON.stringify(request), 'utf8') > 64 * 1024)
      throw new PulseAssemblyError('assembly_capacity_exceeded');
    let result: Pick<OpenAI.Chat.Completions.ChatCompletion, 'choices'>;
    try {
      result = await this.client.chat.completions.create(request);
    } catch {
      throw new PulseAssemblyError('blocked');
    }
    const choice = result.choices[0];
    if (
      !choice ||
      choice.finish_reason !== 'stop' ||
      choice.message.refusal ||
      !choice.message.content ||
      choice.message.tool_calls?.length
    )
      throw new PulseAssemblyError('blocked');
    try {
      return JSON.parse(choice.message.content) as unknown;
    } catch {
      return null;
    }
  }
}
