import { Injectable } from '@nestjs/common';
import { eq, and, isNull, inArray } from 'drizzle-orm';
import {
  surveyDefinitions,
  surveyWindows,
  surveyQuestions,
  surveyEvidence,
  surveyAssessments,
  type DbSurveyQuestion,
} from '@entalent/database';
import type {
  SurveyRepositoryPort,
  SaveSurveyEvidenceParams,
  UpsertAssessmentParams,
  UpsertGroupStateParams,
  SurveyQuestionRecord,
  SurveyWindowRecord,
  SurveyEvidenceRecord,
  SurveyGroupStateRecord,
} from '@entalent/application';
import { DatabaseService } from '../../database/database.service';
import { GroupStateRepository } from './group-state.repository';
import { TeamRepository } from './team.repository';

@Injectable()
export class SurveyRepository implements SurveyRepositoryPort {
  constructor(
    private readonly db: DatabaseService,
    private readonly groupStateRepo: GroupStateRepository,
    private readonly teamRepo: TeamRepository,
  ) {}

  async findOrCreateActiveWindow(userId: string, tenantId: string): Promise<SurveyWindowRecord | null> {
    const [existing] = await this.db.client
      .select()
      .from(surveyWindows)
      .where(
        and(
          eq(surveyWindows.userId, userId),
          eq(surveyWindows.tenantId, tenantId),
          eq(surveyWindows.status, 'active'),
        ),
      )
      .limit(1);

    if (existing) return mapWindow(existing);

    // Find active definition for this tenant (tenant-specific first, then global)
    const [tenantDef] = await this.db.client
      .select()
      .from(surveyDefinitions)
      .where(and(eq(surveyDefinitions.tenantId, tenantId), eq(surveyDefinitions.active, true)))
      .limit(1);

    const [globalDef] = tenantDef
      ? [tenantDef]
      : await this.db.client
          .select()
          .from(surveyDefinitions)
          .where(and(isNull(surveyDefinitions.tenantId), eq(surveyDefinitions.active, true)))
          .limit(1);

    if (!globalDef) return null;

    const { periodStart, periodEnd } = currentQuarterBounds();

    const [created] = await this.db.client
      .insert(surveyWindows)
      .values({
        tenantId,
        userId,
        surveyDefinitionId: globalDef.id,
        periodType: 'quarter',
        periodStart,
        periodEnd,
        status: 'active',
      })
      .returning();

    return mapWindow(created);
  }

  async findQuestionsForWindow(windowId: string): Promise<SurveyQuestionRecord[]> {
    const [window] = await this.db.client
      .select({ surveyDefinitionId: surveyWindows.surveyDefinitionId })
      .from(surveyWindows)
      .where(eq(surveyWindows.id, windowId))
      .limit(1);

    if (!window) return [];

    const rows = await this.db.client
      .select()
      .from(surveyQuestions)
      .where(eq(surveyQuestions.surveyDefinitionId, window.surveyDefinitionId))
      .orderBy(surveyQuestions.displayOrder);

    return rows.map(mapQuestion);
  }

  async findPendingProbeQuestion(
    userId: string,
    _tenantId: string,
    windowId: string,
  ): Promise<SurveyQuestionRecord | null> {
    const questions = await this.findQuestionsForWindow(windowId);
    if (!questions.length) return null;

    const assessments = await this.db.client
      .select()
      .from(surveyAssessments)
      .where(eq(surveyAssessments.surveyWindowId, windowId));

    const assessmentByQuestion = new Map(assessments.map((a) => [a.surveyQuestionId, a.status]));

    const evidenceRows = await this.db.client
      .select()
      .from(surveyEvidence)
      .where(
        and(
          eq(surveyEvidence.surveyWindowId, windowId),
          eq(surveyEvidence.userId, userId),
          isNull(surveyEvidence.supersededAt),
        ),
      );

    const evidenceByQuestion = new Map<string, { count: number; latestDate: Date }>();
    for (const ev of evidenceRows) {
      const existing = evidenceByQuestion.get(ev.surveyQuestionId);
      if (!existing) {
        evidenceByQuestion.set(ev.surveyQuestionId, { count: 1, latestDate: ev.createdAt });
      } else {
        existing.count++;
        if (ev.createdAt > existing.latestDate) existing.latestDate = ev.createdAt;
      }
    }

    const now = new Date();

    for (const question of [...questions].sort((a, b) => a.displayOrder - b.displayOrder)) {
      const status = assessmentByQuestion.get(question.id);
      if (status === 'scored' || status === 'covered') continue;

      const info = evidenceByQuestion.get(question.id);
      if (info && info.count >= question.maxFollowUpProbes) continue;

      if (info) {
        const daysSince =
          (now.getTime() - info.latestDate.getTime()) / (1000 * 60 * 60 * 24);
        if (daysSince < question.cooldownDays) continue;
      }

      return question;
    }

    return null;
  }

  async saveEvidence(params: SaveSurveyEvidenceParams): Promise<SurveyEvidenceRecord> {
    const [row] = await this.db.client
      .insert(surveyEvidence)
      .values({
        surveyWindowId: params.surveyWindowId,
        surveyQuestionId: params.surveyQuestionId,
        userId: params.userId,
        sourceMessageIds: params.sourceMessageIds,
        evidenceSummary: params.evidenceSummary,
        polarity: params.polarity,
        strength: String(params.strength),
        completeness: String(params.completeness),
        confidence: String(params.confidence),
        evaluatorVersion: params.evaluatorVersion,
        promptVersion: params.promptVersion,
      })
      .returning();

    return mapEvidence(row);
  }

  async markEvidenceSuperseded(evidenceIds: string[]): Promise<void> {
    if (evidenceIds.length === 0) return;
    await this.db.client
      .update(surveyEvidence)
      .set({ supersededAt: new Date() })
      .where(inArray(surveyEvidence.id, evidenceIds));
  }

  async upsertAssessment(params: UpsertAssessmentParams): Promise<void> {
    const [existing] = await this.db.client
      .select()
      .from(surveyAssessments)
      .where(
        and(
          eq(surveyAssessments.surveyWindowId, params.surveyWindowId),
          eq(surveyAssessments.surveyQuestionId, params.surveyQuestionId),
        ),
      )
      .limit(1);

    if (existing) {
      const updatedIds = [...new Set([...(existing.evidenceIds ?? []), params.evidenceId])];
      await this.db.client
        .update(surveyAssessments)
        .set({
          confidence: String(params.confidence),
          status: params.status,
          evidenceIds: updatedIds,
          evaluatorVersion: params.evaluatorVersion,
          calculatedAt: new Date(),
        })
        .where(eq(surveyAssessments.id, existing.id));
    } else {
      await this.db.client.insert(surveyAssessments).values({
        surveyWindowId: params.surveyWindowId,
        surveyQuestionId: params.surveyQuestionId,
        confidence: String(params.confidence),
        status: params.status,
        evidenceIds: [params.evidenceId],
        evaluatorVersion: params.evaluatorVersion,
      });
    }
  }

  async findEvidenceForQuestion(
    userId: string,
    questionId: string,
    windowId: string,
  ): Promise<SurveyEvidenceRecord[]> {
    const rows = await this.db.client
      .select()
      .from(surveyEvidence)
      .where(
        and(
          eq(surveyEvidence.surveyWindowId, windowId),
          eq(surveyEvidence.surveyQuestionId, questionId),
          eq(surveyEvidence.userId, userId),
          isNull(surveyEvidence.supersededAt),
        ),
      );

    return rows.map(mapEvidence);
  }

  async findAssessmentsForWindow(windowId: string): Promise<Array<{ surveyQuestionId: string; status: string }>> {
    const rows = await this.db.client
      .select({ surveyQuestionId: surveyAssessments.surveyQuestionId, status: surveyAssessments.status })
      .from(surveyAssessments)
      .where(eq(surveyAssessments.surveyWindowId, windowId));
    return rows;
  }

  // Group state methods — delegated to GroupStateRepository
  findGroupState(
    userId: string,
    windowId: string,
    questionGroup: string,
  ): Promise<SurveyGroupStateRecord | null> {
    return this.groupStateRepo.findGroupState(userId, windowId, questionGroup);
  }

  findPendingConfirmationGroups(userId: string): Promise<SurveyGroupStateRecord[]> {
    return this.groupStateRepo.findPendingConfirmationGroups(userId);
  }

  upsertGroupState(params: UpsertGroupStateParams): Promise<SurveyGroupStateRecord> {
    return this.groupStateRepo.upsertGroupState(params);
  }

  findConfirmedGroupStates(
    userIds: string[],
    questionGroup: string,
  ): Promise<SurveyGroupStateRecord[]> {
    return this.groupStateRepo.findConfirmedGroupStates(userIds, questionGroup);
  }

  // Team methods — delegated to TeamRepository
  findTeamByMemberId(
    userId: string,
  ): Promise<{ teamId: string; managerSlackUserId: string | null; activeTeamSize: number; memberUserIds: string[] } | null> {
    return this.teamRepo.findTeamByMemberId(userId);
  }

  findTeamById(
    teamId: string,
  ): Promise<{ teamId: string; managerSlackUserId: string | null; activeTeamSize: number; memberUserIds: string[] } | null> {
    return this.teamRepo.findTeamById(teamId);
  }
}

function mapWindow(row: typeof surveyWindows.$inferSelect): SurveyWindowRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    userId: row.userId,
    surveyDefinitionId: row.surveyDefinitionId,
    periodType: row.periodType,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    status: row.status,
  };
}

function mapQuestion(row: DbSurveyQuestion): SurveyQuestionRecord {
  return {
    id: row.id,
    surveyDefinitionId: row.surveyDefinitionId,
    stableKey: row.stableKey,
    title: row.title,
    canonicalMeaning: row.canonicalMeaning,
    dimension: row.dimension,
    positiveIndicators: (row.positiveIndicators as string[]) ?? [],
    negativeIndicators: (row.negativeIndicators as string[]) ?? [],
    probeStrategies: (row.probeStrategies as string[]) ?? [],
    contraindications: (row.contraindications as string[]) ?? [],
    confidenceThreshold: Number(row.confidenceThreshold),
    completenessThreshold: Number(row.completenessThreshold),
    minimumEvidenceCount: row.minimumEvidenceCount,
    cooldownDays: row.cooldownDays,
    maxFollowUpProbes: row.maxFollowUpProbes,
    displayOrder: row.displayOrder,
    questionGroup: row.questionGroup,
    responseType: row.responseType,
    version: row.version,
  };
}

function mapEvidence(row: typeof surveyEvidence.$inferSelect): SurveyEvidenceRecord {
  return {
    id: row.id,
    surveyWindowId: row.surveyWindowId,
    surveyQuestionId: row.surveyQuestionId,
    userId: row.userId,
    sourceMessageIds: row.sourceMessageIds ?? [],
    evidenceSummary: row.evidenceSummary,
    polarity: row.polarity,
    strength: Number(row.strength),
    completeness: Number(row.completeness),
    confidence: Number(row.confidence),
    evaluatorVersion: row.evaluatorVersion,
    promptVersion: row.promptVersion,
    createdAt: row.createdAt,
  };
}

function currentQuarterBounds(): { periodStart: Date; periodEnd: Date } {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-indexed
  const quarter = Math.floor(month / 3);
  const periodStart = new Date(year, quarter * 3, 1);
  const periodEnd = new Date(year, quarter * 3 + 3, 0, 23, 59, 59, 999);
  return { periodStart, periodEnd };
}
