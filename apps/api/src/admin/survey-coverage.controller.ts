import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { surveyAssessments, surveyQuestions, surveyWindows } from '@entalent/database';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { DatabaseService } from '../database/database.service';

const MIN_COHORT_SIZE = 5;

interface QuestionCoverage {
  questionId: string;
  stableKey: string;
  title: string;
  dimension: string;
  totalUsers: number;
  statusDistribution: Record<string, number>;
  avgScore: number | null;
  coverageRate: number;
}

@Controller('admin/survey/coverage')
@UseGuards(ApiKeyGuard)
export class SurveyCoverageController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  async getCoverage(
    @Query('tenantId') tenantId?: string,
  ): Promise<{
    questions: QuestionCoverage[];
    cohortSize: number;
    note?: string;
  }> {
    const tenantFilter = tenantId ? eq(surveyWindows.tenantId, tenantId) : undefined;

    const rows = await this.db.client
      .select({
        questionId: surveyQuestions.id,
        stableKey: surveyQuestions.stableKey,
        title: surveyQuestions.title,
        dimension: surveyQuestions.dimension,
        status: surveyAssessments.status,
        score: surveyAssessments.score,
        userId: surveyWindows.userId,
      })
      .from(surveyAssessments)
      .innerJoin(surveyQuestions, eq(surveyAssessments.surveyQuestionId, surveyQuestions.id))
      .innerJoin(surveyWindows, eq(surveyAssessments.surveyWindowId, surveyWindows.id))
      .where(
        and(eq(surveyWindows.status, 'active'), tenantFilter),
      );

    // Count distinct users across all questions (overall cohort)
    const allUsers = new Set(rows.map((r) => r.userId));
    const cohortSize = allUsers.size;

    // Group by question
    const byQuestion = new Map<string, typeof rows>();
    for (const row of rows) {
      const existing = byQuestion.get(row.questionId) ?? [];
      existing.push(row);
      byQuestion.set(row.questionId, existing);
    }

    const questions: QuestionCoverage[] = [];

    for (const [questionId, questionRows] of byQuestion) {
      const uniqueUsers = new Set(questionRows.map((r) => r.userId));
      const totalUsers = uniqueUsers.size;

      // Skip questions with fewer than MIN_COHORT_SIZE unique users
      if (totalUsers < MIN_COHORT_SIZE) continue;

      const first = questionRows[0];
      const statusDistribution: Record<string, number> = {};
      let scoreSum = 0;
      let scoreCount = 0;

      for (const row of questionRows) {
        statusDistribution[row.status] = (statusDistribution[row.status] ?? 0) + 1;
        if (row.score !== null) {
          scoreSum += Number(row.score);
          scoreCount++;
        }
      }

      const scoredCount = statusDistribution['scored'] ?? 0;

      questions.push({
        questionId,
        stableKey: first.stableKey,
        title: first.title,
        dimension: first.dimension,
        totalUsers,
        statusDistribution,
        avgScore: scoreCount > 0 ? Math.round((scoreSum / scoreCount) * 100) / 100 : null,
        coverageRate: Math.round((scoredCount / totalUsers) * 100) / 100,
      });
    }

    questions.sort((a, b) => a.dimension.localeCompare(b.dimension) || a.stableKey.localeCompare(b.stableKey));

    return {
      questions,
      cohortSize,
      note:
        cohortSize < MIN_COHORT_SIZE
          ? `Cohort size (${cohortSize}) is below the minimum threshold (${MIN_COHORT_SIZE}). No data shown.`
          : undefined,
    };
  }

  @Get('definitions')
  async getDefinitions(): Promise<{ definitions: unknown[] }> {
    const defs = await this.db.client
      .select({
        questionId: surveyQuestions.id,
        stableKey: surveyQuestions.stableKey,
        title: surveyQuestions.title,
        dimension: surveyQuestions.dimension,
        canonicalMeaning: surveyQuestions.canonicalMeaning,
        evidenceRequirements: surveyQuestions.evidenceRequirements,
      })
      .from(surveyQuestions)
      .orderBy(surveyQuestions.dimension, surveyQuestions.stableKey);

    return { definitions: defs };
  }

  @Get('windows')
  async getWindows(
    @Query('tenantId') tenantId?: string,
    @Query('status') status?: string,
  ): Promise<{ windows: unknown[]; total: number }> {
    const conditions = [
      tenantId ? eq(surveyWindows.tenantId, tenantId) : undefined,
      status ? eq(surveyWindows.status, status) : undefined,
    ].filter(Boolean);

    const where =
      conditions.length > 0 ? and(...(conditions as Parameters<typeof and>)) : undefined;

    const [rows, [{ total }]] = await Promise.all([
      this.db.client
        .select({
          id: surveyWindows.id,
          tenantId: surveyWindows.tenantId,
          userId: surveyWindows.userId,
          periodType: surveyWindows.periodType,
          periodStart: surveyWindows.periodStart,
          periodEnd: surveyWindows.periodEnd,
          status: surveyWindows.status,
          coverage: surveyWindows.coverage,
        })
        .from(surveyWindows)
        .where(where)
        .limit(100),
      this.db.client
        .select({ total: sql<number>`count(*)::int` })
        .from(surveyWindows)
        .where(where),
    ]);

    return { windows: rows, total };
  }
}
