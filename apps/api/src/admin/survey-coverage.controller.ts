import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { surveyAssessments, surveyDefinitions, surveyQuestions, surveyWindows, users } from '@entalent/database';
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
    cohortSize: number | null;
    note?: string;
  }> {
    if (!tenantId?.trim()) {
      throw new BadRequestException('tenantId query param is required');
    }

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
      .innerJoin(surveyWindows, eq(surveyAssessments.surveyWindowId, surveyWindows.id))
      .innerJoin(users, and(eq(users.id, surveyWindows.userId), eq(users.tenantId, surveyWindows.tenantId)))
      .innerJoin(surveyQuestions, and(
        eq(surveyAssessments.surveyQuestionId, surveyQuestions.id),
        eq(surveyQuestions.surveyDefinitionId, surveyWindows.surveyDefinitionId),
      ))
      .innerJoin(surveyDefinitions, and(
        eq(surveyDefinitions.id, surveyWindows.surveyDefinitionId),
        or(isNull(surveyDefinitions.tenantId), eq(surveyDefinitions.tenantId, surveyWindows.tenantId)),
      ))
      .where(
        and(
          eq(surveyWindows.status, 'active'),
          eq(surveyWindows.tenantId, tenantId),
          sql`NOT EXISTS (SELECT 1 FROM survey_window_scoring_policies v2
            WHERE v2.survey_window_id = ${surveyWindows.id}
              AND v2.tenant_id = ${surveyWindows.tenantId})`,
        ),
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

      const usersByStatus = new Map<string, Set<string>>();
      const scoredUsers = new Set<string>();
      for (const row of questionRows) {
        const statusUsers = usersByStatus.get(row.status) ?? new Set<string>();
        statusUsers.add(row.userId);
        usersByStatus.set(row.status, statusUsers);
        if (row.score !== null) scoredUsers.add(row.userId);
      }
      // Every displayed status and score must represent a full cohort.
      if ([...usersByStatus.values()].some((members) => members.size < MIN_COHORT_SIZE)
        || (scoredUsers.size > 0 && scoredUsers.size < MIN_COHORT_SIZE)) continue;

      const first = questionRows[0];
      const statusDistribution: Record<string, number> = {};
      let scoreSum = 0;
      let scoreCount = 0;

      for (const [status, members] of usersByStatus) {
        statusDistribution[status] = members.size;
      }
      for (const row of questionRows) {
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
      cohortSize: cohortSize < MIN_COHORT_SIZE ? null : cohortSize,
      note:
        cohortSize < MIN_COHORT_SIZE
          ? `Cohort is below the minimum threshold (${MIN_COHORT_SIZE}). No data shown.`
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

}
