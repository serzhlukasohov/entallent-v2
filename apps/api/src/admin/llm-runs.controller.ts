import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { llmRuns, promptVersions } from '@entalent/database';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { DatabaseService } from '../database/database.service';

const CURRENT_PROMPT_VERSIONS = {
  'classify-situation': '1.0.0',
  'detect-risk': '1.0.0',
  'extract-memory': '1.0.0',
  'generate-response': '1.0.0',
  'evaluate-survey-evidence': '1.0.0',
} as const;

@Controller('admin/llm-runs')
@UseGuards(ApiKeyGuard)
export class LlmRunsController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  async list(
    @Query('tenantId') tenantId?: string,
    @Query('taskType') taskType?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limitStr?: string,
  ): Promise<{ runs: unknown[]; total: number }> {
    const limit = Math.min(Number(limitStr) || 50, 200);

    const conditions = [
      tenantId ? eq(llmRuns.tenantId, tenantId) : undefined,
      taskType ? eq(llmRuns.taskType, taskType) : undefined,
      from ? gte(llmRuns.createdAt, new Date(from)) : undefined,
      to ? lte(llmRuns.createdAt, new Date(to)) : undefined,
    ].filter(Boolean);

    const where = conditions.length > 0 ? and(...(conditions as Parameters<typeof and>)) : undefined;

    const [rows, [{ total }]] = await Promise.all([
      this.db.client
        .select()
        .from(llmRuns)
        .where(where)
        .orderBy(desc(llmRuns.createdAt))
        .limit(limit),
      this.db.client
        .select({ total: sql<number>`count(*)::int` })
        .from(llmRuns)
        .where(where),
    ]);

    return { runs: rows, total };
  }

  @Get('cost-summary')
  async costSummary(
    @Query('tenantId') tenantId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<{ summary: unknown[] }> {
    const conditions = [
      tenantId ? eq(llmRuns.tenantId, tenantId) : undefined,
      from ? gte(llmRuns.createdAt, new Date(from)) : undefined,
      to ? lte(llmRuns.createdAt, new Date(to)) : undefined,
    ].filter(Boolean);

    const where = conditions.length > 0 ? and(...(conditions as Parameters<typeof and>)) : undefined;

    const rows = await this.db.client
      .select({
        taskType: llmRuns.taskType,
        model: llmRuns.model,
        callCount: sql<number>`count(*)::int`,
        totalInputTokens: sql<number>`sum(${llmRuns.inputTokenCount})::int`,
        totalOutputTokens: sql<number>`sum(${llmRuns.outputTokenCount})::int`,
        totalCost: sql<string>`sum(${llmRuns.estimatedCost}::numeric)::text`,
        avgLatencyMs: sql<number>`avg(${llmRuns.latencyMs})::int`,
        errorCount: sql<number>`count(*) filter (where ${llmRuns.status} = 'error')::int`,
      })
      .from(llmRuns)
      .where(where)
      .groupBy(llmRuns.taskType, llmRuns.model)
      .orderBy(llmRuns.taskType);

    return { summary: rows };
  }

  @Get('prompt-versions')
  async promptVersions(): Promise<{ versions: unknown[]; current: typeof CURRENT_PROMPT_VERSIONS }> {
    const dbVersions = await this.db.client
      .select()
      .from(promptVersions)
      .orderBy(desc(promptVersions.createdAt));

    return { versions: dbVersions, current: CURRENT_PROMPT_VERSIONS };
  }
}
