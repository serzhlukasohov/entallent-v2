import { Injectable } from '@nestjs/common';
import { llmRuns } from '@entalent/database';
import { DatabaseService } from '../database/database.service';

export interface RecordLlmRunParams {
  tenantId: string;
  userId?: string;
  taskType: string;
  model: string;
  promptVersion?: string;
  inputTokenCount?: number;
  outputTokenCount?: number;
  latencyMs: number;
  status: 'success' | 'error';
  traceId?: string;
  errorCode?: string;
  estimatedCost?: number;
}

const MODEL_COST_PER_1M: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4-turbo': { input: 10, output: 30 },
  'gpt-4': { input: 30, output: 60 },
};

export function estimateCost(model: string, inputTokens?: number, outputTokens?: number): number {
  const pricing = MODEL_COST_PER_1M[model] ?? MODEL_COST_PER_1M['gpt-4o'];
  const inputCost = ((inputTokens ?? 0) / 1_000_000) * pricing.input;
  const outputCost = ((outputTokens ?? 0) / 1_000_000) * pricing.output;
  return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000;
}

@Injectable()
export class LlmRunRepository {
  constructor(private readonly db: DatabaseService) {}

  async record(params: RecordLlmRunParams): Promise<void> {
    const cost = params.estimatedCost ?? estimateCost(params.model, params.inputTokenCount, params.outputTokenCount);

    await this.db.client.insert(llmRuns).values({
      tenantId: params.tenantId,
      userId: params.userId ?? null,
      taskType: params.taskType,
      provider: 'openai',
      model: params.model,
      promptVersion: params.promptVersion,
      inputTokenCount: params.inputTokenCount ?? null,
      outputTokenCount: params.outputTokenCount ?? null,
      latencyMs: params.latencyMs,
      estimatedCost: String(cost),
      status: params.status,
      traceId: params.traceId,
      errorCode: params.errorCode,
    });
  }
}
