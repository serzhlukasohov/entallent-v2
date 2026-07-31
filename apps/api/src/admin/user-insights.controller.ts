import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { and, desc, eq, isNull } from 'drizzle-orm';
import {
  surveyAssessments,
  surveyEvidence,
  surveyQuestions,
  surveyWindows,
} from '@entalent/database';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { DatabaseService } from '../database/database.service';

export interface QuestionInsight {
  questionId: string;
  stableKey: string;
  title: string;
  canonicalMeaning: string;
  group: string;
  displayOrder: number;
  // Assessment (computed state)
  assessmentStatus: string | null;
  score: number | null;
  assessmentConfidence: number | null;
  currentState: string | null;   // reasoningSummary — synthesised view of the employee's state
  assessedAt: string | null;
  // Latest evidence (root cause)
  polarity: string | null;
  evidenceStrength: number | null;
  rootCause: string | null;      // evidenceSummary — what drove the current state
  evidenceUpdatedAt: string | null;
}

export interface UserInsightsResponse {
  userId: string;
  windowId: string | null;
  periodEnd: string | null;
  questions: QuestionInsight[];
}

@Controller('admin/users/:userId/insights')
@UseGuards(ApiKeyGuard)
export class UserInsightsController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  async getInsights(
    @Param('userId') userId: string,
    @Query('tenantId') _tenantId?: string,
  ): Promise<UserInsightsResponse> {
    // 1. Find active window for this user
    const [window] = await this.db.client
      .select({ id: surveyWindows.id, periodEnd: surveyWindows.periodEnd, definitionId: surveyWindows.surveyDefinitionId })
      .from(surveyWindows)
      .where(and(eq(surveyWindows.userId, userId), eq(surveyWindows.status, 'active')))
      .limit(1);

    if (!window) {
      return { userId, windowId: null, periodEnd: null, questions: [] };
    }

    // 2. All questions for this window's definition
    const questions = await this.db.client
      .select({
        id: surveyQuestions.id,
        stableKey: surveyQuestions.stableKey,
        title: surveyQuestions.title,
        canonicalMeaning: surveyQuestions.canonicalMeaning,
        group: surveyQuestions.questionGroup,
        displayOrder: surveyQuestions.displayOrder,
      })
      .from(surveyQuestions)
      .where(eq(surveyQuestions.surveyDefinitionId, window.definitionId))
      .orderBy(surveyQuestions.displayOrder);

    // 3. Assessments for this window
    const assessments = await this.db.client
      .select({
        questionId: surveyAssessments.surveyQuestionId,
        status: surveyAssessments.status,
        score: surveyAssessments.score,
        confidence: surveyAssessments.confidence,
        reasoningSummary: surveyAssessments.reasoningSummary,
        calculatedAt: surveyAssessments.calculatedAt,
      })
      .from(surveyAssessments)
      .where(eq(surveyAssessments.surveyWindowId, window.id));

    const assessmentByQuestion = new Map(assessments.map((a) => [a.questionId, a]));

    // 4. Latest non-superseded evidence per question
    const evidenceRows = await this.db.client
      .select({
        questionId: surveyEvidence.surveyQuestionId,
        polarity: surveyEvidence.polarity,
        strength: surveyEvidence.strength,
        evidenceSummary: surveyEvidence.evidenceSummary,
        createdAt: surveyEvidence.createdAt,
      })
      .from(surveyEvidence)
      .where(
        and(
          eq(surveyEvidence.surveyWindowId, window.id),
          eq(surveyEvidence.userId, userId),
          isNull(surveyEvidence.supersededAt),
        ),
      )
      .orderBy(desc(surveyEvidence.createdAt));

    // Keep only the latest evidence per question
    const latestEvidence = new Map<string, typeof evidenceRows[0]>();
    for (const row of evidenceRows) {
      if (!latestEvidence.has(row.questionId)) {
        latestEvidence.set(row.questionId, row);
      }
    }

    const result: QuestionInsight[] = questions.map((q) => {
      const assessment = assessmentByQuestion.get(q.id);
      const evidence = latestEvidence.get(q.id);

      return {
        questionId: q.id,
        stableKey: q.stableKey,
        title: q.title,
        canonicalMeaning: q.canonicalMeaning,
        group: q.group,
        displayOrder: q.displayOrder,
        assessmentStatus: assessment?.status ?? null,
        score: assessment?.score != null ? Number(assessment.score) : null,
        assessmentConfidence: assessment?.confidence != null ? Number(assessment.confidence) : null,
        currentState: assessment?.reasoningSummary ?? null,
        assessedAt: assessment?.calculatedAt?.toISOString() ?? null,
        polarity: evidence?.polarity ?? null,
        evidenceStrength: evidence?.strength != null ? Number(evidence.strength) : null,
        rootCause: evidence?.evidenceSummary ?? null,
        evidenceUpdatedAt: evidence?.createdAt?.toISOString() ?? null,
      };
    });

    return {
      userId,
      windowId: window.id,
      periodEnd: window.periodEnd.toISOString(),
      questions: result,
    };
  }
}
