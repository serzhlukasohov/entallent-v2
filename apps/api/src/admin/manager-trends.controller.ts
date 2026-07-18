import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { DatabaseService } from '../database/database.service';
import {
  buildTrends,
  type TrendsResult,
  type EngagementRow,
  type SignalRow,
  type FunnelRow,
  type QuestionRow,
} from './manager-trends.aggregate';

const DEFAULT_DAYS = 14;
const MAX_DAYS = 120;

@Controller('admin/manager/trends')
@UseGuards(ApiKeyGuard)
export class ManagerTrendsController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  async getTrends(
    @Query('tenantId') tenantId: string,
    @Query('days') daysRaw?: string,
  ): Promise<TrendsResult> {
    const days = clampDays(daysRaw);
    // Window: [today-(days-1), today], bucketed by UTC day.
    const since = sql`now() - make_interval(days => ${days - 1})`;

    const [engagement, signals, funnel, questions] = await Promise.all([
      // Daily engagement — active users + inbound message volume
      this.db.client.execute(sql`
        SELECT to_char(date_trunc('day', occurred_at), 'YYYY-MM-DD') AS day,
               count(DISTINCT user_id)::int AS "activeUsers",
               count(*)::int AS "inboundMessages"
        FROM messages
        WHERE tenant_id = ${tenantId}
          AND direction = 'inbound'
          AND text <> '__init__'
          AND deleted_at IS NULL
          AND occurred_at >= date_trunc('day', ${since})
        GROUP BY 1
        ORDER BY 1
      `) as unknown as Promise<EngagementRow[]>,

      // Daily signal capture by polarity (evidence is the immutable time-series)
      this.db.client.execute(sql`
        SELECT to_char(date_trunc('day', e.created_at), 'YYYY-MM-DD') AS day,
               e.polarity AS polarity,
               count(*)::int AS count
        FROM survey_evidence e
        JOIN survey_windows w ON e.survey_window_id = w.id
        WHERE w.tenant_id = ${tenantId}
          AND e.created_at >= date_trunc('day', ${since})
        GROUP BY 1, 2
        ORDER BY 1
      `) as unknown as Promise<SignalRow[]>,

      // Coverage funnel — current assessment status distribution (active windows)
      this.db.client.execute(sql`
        SELECT a.status AS status, count(*)::int AS count
        FROM survey_assessments a
        JOIN survey_windows w ON a.survey_window_id = w.id
        WHERE w.tenant_id = ${tenantId} AND w.status = 'active'
        GROUP BY 1
      `) as unknown as Promise<FunnelRow[]>,

      // Per-question cohort sentiment — active (non-superseded) evidence by polarity
      this.db.client.execute(sql`
        SELECT q.stable_key AS "stableKey",
               q.title AS title,
               q.dimension AS dimension,
               e.polarity AS polarity,
               count(*)::int AS count
        FROM survey_evidence e
        JOIN survey_windows w ON e.survey_window_id = w.id
        JOIN survey_questions q ON e.survey_question_id = q.id
        WHERE w.tenant_id = ${tenantId}
          AND w.status = 'active'
          AND e.superseded_at IS NULL
        GROUP BY 1, 2, 3, e.polarity
      `) as unknown as Promise<QuestionRow[]>,
    ]);

    const rangeEnd = new Date().toISOString().slice(0, 10);

    return buildTrends({
      rangeEnd,
      days,
      engagement,
      signals,
      funnel,
      questions,
    });
  }
}

function clampDays(raw?: string): number {
  const n = raw ? parseInt(raw, 10) : DEFAULT_DAYS;
  if (isNaN(n) || n < 1) return DEFAULT_DAYS;
  return Math.min(n, MAX_DAYS);
}
