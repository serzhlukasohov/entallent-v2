import { Injectable } from '@nestjs/common';
import { eq, and, gt, isNull, inArray, lte, or, sql } from 'drizzle-orm';
import {
  surveyDefinitions,
  surveyReportingCohorts,
  surveyWindows,
  surveyQuestions,
  surveyEvidence,
  surveyGroupStates,
  surveyAssessments,
  teamMemberships,
  teams,
  users,
  type DbSurveyQuestion,
} from '@entalent/database';
import {
  type SurveyRepositoryPort,
  type SurveyEvidencePolarity,
  type SaveSurveyEvidenceParams,
  type UpsertAssessmentParams,
  type UpsertGroupStateParams,
  type StageGroupConfirmationParams,
  type ConfirmGroupStateParams,
  type RecordGroupDeidentificationDecisionParams,
  type TransitionAwaitingGroupStateParams,
  type WithdrawGroupStateParams,
  type FindConfirmedGroupStatesParams,
  type FindReportingCohortsReadyForFinalReportsParams,
  type ConfirmedGroupReportStateRecord,
  type SurveyTeamRecord,
  type SurveyQuestionRecord,
  type SurveyWindowRecord,
  type SurveyEvidenceRecord,
  type SurveyGroupStateRecord,
  type OpenSurveyReportingCycleParams,
  type SurveyReportingCohortRecord,
} from '@entalent/application';
import { DatabaseService } from '../../database/database.service';
import { GroupStateRepository } from './group-state.repository';
import { TeamRepository } from './team.repository';

const SURVEY_EVIDENCE_POLARITIES: readonly SurveyEvidencePolarity[] = [
  'positive',
  'negative',
  'neutral',
  'mixed',
];

@Injectable()
export class SurveyRepository implements SurveyRepositoryPort {
  constructor(
    private readonly db: DatabaseService,
    private readonly groupStateRepo: GroupStateRepository,
    private readonly teamRepo: TeamRepository,
  ) {}

  async openReportingCycle(
    params: OpenSurveyReportingCycleParams,
  ): Promise<SurveyReportingCohortRecord[]> {
    return this.db.client.transaction(async (tx) => {
      const [definition] = await tx
        .select({ id: surveyDefinitions.id })
        .from(surveyDefinitions)
        .where(and(
          eq(surveyDefinitions.id, params.surveyDefinitionId),
          eq(surveyDefinitions.active, true),
          or(eq(surveyDefinitions.tenantId, params.tenantId), isNull(surveyDefinitions.tenantId)),
        ))
        .limit(1);
      if (!definition) throw new Error('survey_reporting_definition_not_available');

      const existingCohorts = await tx
        .select()
        .from(surveyReportingCohorts)
        .where(and(
          eq(surveyReportingCohorts.tenantId, params.tenantId),
          eq(surveyReportingCohorts.surveyDefinitionId, params.surveyDefinitionId),
          eq(surveyReportingCohorts.periodStart, params.periodStart),
          eq(surveyReportingCohorts.periodEnd, params.periodEnd),
        ))
        .orderBy(surveyReportingCohorts.teamId);
      if (existingCohorts.length > 0) return existingCohorts.map(mapReportingCohort);

      const tenantTeams = await tx
        .select({ teamId: teams.id })
        .from(teams)
        .where(eq(teams.tenantId, params.tenantId));
      if (tenantTeams.length === 0) throw new Error('survey_reporting_cycle_has_no_teams');
      const eligibleMemberships = await tx
        .select({ teamId: teamMemberships.teamId, userId: teamMemberships.userId })
        .from(teamMemberships)
        .innerJoin(teams, eq(teams.id, teamMemberships.teamId))
        .innerJoin(users, eq(users.id, teamMemberships.userId))
        .where(and(
          eq(teams.tenantId, params.tenantId),
          eq(teamMemberships.role, 'member'),
          lte(teamMemberships.joinedAt, params.openedAt),
          or(isNull(teamMemberships.leftAt), gt(teamMemberships.leftAt, params.openedAt)),
          eq(users.tenantId, params.tenantId),
          eq(users.status, 'active'),
          isNull(users.deletedAt),
          sql`${users.consentState}->'surveyEnabled' = 'true'::jsonb`,
          sql`not exists (
            select 1
            from ${teamMemberships} other_membership
            join ${teams} other_team on other_team.id = other_membership.team_id
            where other_membership.user_id = ${teamMemberships.userId}
              and other_membership.team_id <> ${teamMemberships.teamId}
              and other_membership.role = 'member'
              and other_membership.joined_at <= ${params.openedAt}
              and (other_membership.left_at is null or other_membership.left_at > ${params.openedAt})
              and other_team.tenant_id = ${params.tenantId}
          )`,
        ));

      const rosters = new Map(tenantTeams.map((team) => [team.teamId, [] as string[]]));
      for (const membership of eligibleMemberships) {
        const roster = rosters.get(membership.teamId) ?? [];
        roster.push(membership.userId);
        rosters.set(membership.teamId, roster);
      }
      if (rosters.size > 0) {
        await tx
          .insert(surveyReportingCohorts)
          .values([...rosters].map(([teamId, userIds]) => ({
            tenantId: params.tenantId,
            teamId,
            surveyDefinitionId: params.surveyDefinitionId,
            periodStart: params.periodStart,
            periodEnd: params.periodEnd,
            rosterUserIds: [...new Set(userIds)].sort(),
            openedAt: params.openedAt,
          })))
          .onConflictDoNothing();
      }

      const cohorts = await tx
        .select()
        .from(surveyReportingCohorts)
        .where(and(
          eq(surveyReportingCohorts.tenantId, params.tenantId),
          eq(surveyReportingCohorts.surveyDefinitionId, params.surveyDefinitionId),
          eq(surveyReportingCohorts.periodStart, params.periodStart),
          eq(surveyReportingCohorts.periodEnd, params.periodEnd),
        ))
        .orderBy(surveyReportingCohorts.teamId);
      return cohorts.map(mapReportingCohort);
    });
  }

  async findReportingCohortsReadyForFinalReports(
    params: FindReportingCohortsReadyForFinalReportsParams,
  ): Promise<SurveyReportingCohortRecord[]> {
    const rows = await this.db.client
      .select()
      .from(surveyReportingCohorts)
      .where(and(
        eq(surveyReportingCohorts.tenantId, params.tenantId),
        params.surveyDefinitionId
          ? eq(surveyReportingCohorts.surveyDefinitionId, params.surveyDefinitionId)
          : undefined,
        lte(surveyReportingCohorts.periodEnd, params.now),
      ))
      .orderBy(surveyReportingCohorts.teamId);
    return rows.map(mapReportingCohort);
  }

  async expireTemporaryGroupStatesForClosedCohorts(
    params: FindReportingCohortsReadyForFinalReportsParams,
  ): Promise<number> {
    const closeInstantIso = params.now.toISOString();
    const rows = await this.db.client
      .update(surveyGroupStates)
      .set({
        status: 'expired',
        aiSummary: null,
        employeeScore: null,
        personalRecs: null,
        deidentificationDecision: null,
        confirmationPromptMessageId: null,
        confirmedAt: null,
        reportingDisclosureVersion: null,
        reportingDisclosureShownAt: null,
        confirmationMessageId: null,
        withdrawnAt: null,
        withdrawalMessageId: null,
        updatedAt: params.now,
      })
      .where(and(
        eq(surveyGroupStates.tenantId, params.tenantId),
        inArray(surveyGroupStates.status, ['in_progress', 'pending_confirmation', 'awaiting_confirmation']),
        sql`exists (
          select 1
          from ${surveyWindows}
          join ${surveyReportingCohorts}
            on ${surveyWindows.reportingCohortId} = ${surveyReportingCohorts.id}
          where ${surveyWindows.id} = ${surveyGroupStates.surveyWindowId}
            and ${surveyWindows.tenantId} = ${params.tenantId}
            and ${surveyWindows.userId} = ${surveyGroupStates.userId}
            and ${surveyReportingCohorts.tenantId} = ${params.tenantId}
            ${params.surveyDefinitionId
              ? sql`and ${surveyReportingCohorts.surveyDefinitionId} = ${params.surveyDefinitionId}`
              : sql``}
            and ${surveyReportingCohorts.periodEnd} <= ${closeInstantIso}::timestamptz
        )`,
      ))
      .returning({ id: surveyGroupStates.id });
    return rows.length;
  }

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

    if (!globalDef) return existing ? mapWindow(existing) : null;

    const now = new Date();
    const currentTeam = await this.teamRepo.findTeamByMemberId(userId, tenantId);
    const cohorts = await this.db.client
      .select()
      .from(surveyReportingCohorts)
      .where(and(
        eq(surveyReportingCohorts.tenantId, tenantId),
        eq(surveyReportingCohorts.surveyDefinitionId, globalDef.id),
        lte(surveyReportingCohorts.periodStart, now),
        gt(surveyReportingCohorts.periodEnd, now),
        sql`${userId} = any(${surveyReportingCohorts.rosterUserIds})`,
      ))
      .limit(2);
    const cohort = cohorts.length === 1 && currentTeam?.teamId === cohorts[0].teamId
      ? cohorts[0]
      : null;
    if (!cohort) {
      if (existing && currentTeam && (existing.reportingCohortId || existing.reportingTeamId !== currentTeam.teamId)) {
        const created = await this.db.client.transaction(async (tx) => {
          await tx
            .update(surveyWindows)
            .set({ status: 'closed', completedAt: now })
            .where(and(
              eq(surveyWindows.userId, userId),
              eq(surveyWindows.tenantId, tenantId),
              eq(surveyWindows.status, 'active'),
            ));
          const [row] = await tx.insert(surveyWindows).values({
            tenantId,
            userId,
            surveyDefinitionId: globalDef.id,
            periodType: 'quarter',
            periodStart: existing.periodStart,
            periodEnd: existing.periodEnd,
            reportingCohortId: null,
            reportingTeamId: currentTeam.teamId,
            reportingRosterUserIds: [],
            status: 'active',
          }).returning();
          return row;
        });
        return mapWindow(created);
      }
      if (existing && existing.reportingCohortId) {
        await this.db.client
          .update(surveyWindows)
          .set({ status: 'closed', completedAt: now })
          .where(and(
            eq(surveyWindows.userId, userId),
            eq(surveyWindows.tenantId, tenantId),
            eq(surveyWindows.status, 'active'),
          ));
        return null;
      }
      return existing ? mapWindow(existing) : null;
    }
    const sameScope = existing?.reportingCohortId === cohort.id
      && existing.surveyDefinitionId === cohort.surveyDefinitionId
      && existing.periodStart.getTime() === cohort.periodStart.getTime()
      && existing.periodEnd.getTime() === cohort.periodEnd.getTime()
      && existing.reportingTeamId === cohort.teamId
      && existing.reportingRosterUserIds.length === cohort.rosterUserIds.length
      && existing.reportingRosterUserIds.every((id, index) => id === cohort.rosterUserIds[index]);
    if (sameScope) return mapWindow(existing);

    const created = await this.db.client.transaction(async (tx) => {
      if (existing) {
        await tx
          .update(surveyWindows)
          .set({ status: 'closed', completedAt: now })
          .where(and(
            eq(surveyWindows.userId, userId),
            eq(surveyWindows.tenantId, tenantId),
            eq(surveyWindows.status, 'active'),
          ));
      }
      const [row] = await tx.insert(surveyWindows).values({
        tenantId,
        userId,
        surveyDefinitionId: globalDef.id,
        periodType: 'quarter',
        periodStart: cohort.periodStart,
        periodEnd: cohort.periodEnd,
        reportingCohortId: cohort.id,
        reportingTeamId: cohort.teamId,
        reportingRosterUserIds: cohort.rosterUserIds,
        status: 'active',
      }).returning();
      return row;
    });

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

  async saveEvidence(params: SaveSurveyEvidenceParams): Promise<SurveyEvidenceRecord> {
    if (!isSurveyEvidencePolarity(params.polarity)) {
      throw new Error('survey_evidence_invalid_polarity');
    }

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
          score: params.score == null ? null : String(params.score),
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
        score: params.score == null ? null : String(params.score),
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

  async findAssessmentsForWindow(
    windowId: string,
  ): Promise<Array<{ surveyQuestionId: string; status: string; score: number | null }>> {
    const rows = await this.db.client
      .select({
        surveyQuestionId: surveyAssessments.surveyQuestionId,
        status: surveyAssessments.status,
        score: surveyAssessments.score,
      })
      .from(surveyAssessments)
      .where(eq(surveyAssessments.surveyWindowId, windowId));
    return rows.map((row) => ({
      ...row,
      score: row.score == null ? null : Number(row.score),
    }));
  }

  // Group state methods — delegated to GroupStateRepository
  findGroupState(
    userId: string,
    windowId: string,
    questionGroup: string,
  ): Promise<SurveyGroupStateRecord | null> {
    return this.groupStateRepo.findGroupState(userId, windowId, questionGroup);
  }

  findPendingConfirmationGroups(
    userId: string,
    tenantId: string,
  ): Promise<SurveyGroupStateRecord[]> {
    return this.groupStateRepo.findPendingConfirmationGroups(userId, tenantId);
  }

  findAwaitingConfirmationGroups(
    userId: string,
    tenantId: string,
    conversationId: string,
  ): Promise<SurveyGroupStateRecord[]> {
    return this.groupStateRepo.findAwaitingConfirmationGroups(userId, tenantId, conversationId);
  }

  upsertGroupState(params: UpsertGroupStateParams): Promise<SurveyGroupStateRecord> {
    return this.groupStateRepo.upsertGroupState(params);
  }

  recordGroupDeidentificationDecision(params: RecordGroupDeidentificationDecisionParams): Promise<boolean> {
    return this.groupStateRepo.recordGroupDeidentificationDecision(params);
  }

  stageGroupConfirmation(params: StageGroupConfirmationParams): Promise<boolean> {
    return this.groupStateRepo.stageGroupConfirmation(params);
  }

  transitionAwaitingGroupState(params: TransitionAwaitingGroupStateParams): Promise<boolean> {
    return this.groupStateRepo.transitionAwaitingGroupState(params);
  }

  withdrawGroupState(params: WithdrawGroupStateParams): Promise<boolean> {
    return this.groupStateRepo.withdrawGroupState(params);
  }

  confirmGroupState(params: ConfirmGroupStateParams): Promise<boolean> {
    return this.groupStateRepo.confirmGroupState(params);
  }

  findConfirmedGroupStates(params: FindConfirmedGroupStatesParams): Promise<ConfirmedGroupReportStateRecord[]> {
    return this.groupStateRepo.findConfirmedGroupStates(params);
  }

  // Team methods — delegated to TeamRepository
  findTeamByMemberId(
    userId: string,
    tenantId: string,
    surveyWindowId?: string,
  ): Promise<SurveyTeamRecord | null> {
    return this.teamRepo.findTeamByMemberId(userId, tenantId, surveyWindowId);
  }

  findTeamById(
    teamId: string,
    tenantId: string,
    reportingCohortId?: string,
  ): Promise<SurveyTeamRecord | null> {
    return this.teamRepo.findTeamById(teamId, tenantId, reportingCohortId);
  }
}

function isSurveyEvidencePolarity(value: string): boolean {
  return (SURVEY_EVIDENCE_POLARITIES as readonly string[]).includes(value);
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
    reportingCohortId: row.reportingCohortId,
    reportingTeamId: row.reportingTeamId,
    reportingRosterUserIds: row.reportingRosterUserIds,
    status: row.status,
  };
}

function mapReportingCohort(
  row: typeof surveyReportingCohorts.$inferSelect,
): SurveyReportingCohortRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    teamId: row.teamId,
    surveyDefinitionId: row.surveyDefinitionId,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    rosterUserIds: row.rosterUserIds,
    openedAt: row.openedAt,
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
