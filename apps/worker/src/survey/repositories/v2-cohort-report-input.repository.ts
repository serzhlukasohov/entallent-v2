import { Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import {
  surveyCycleScoringPolicies, surveyDefinitions, surveyQuestionInsights, surveyQuestions,
  surveyReportingCohorts, surveyScoringPolicies, surveyWindowScoringPolicies, surveyWindows, teams, users,
} from '@entalent/database';
import type { V2CohortReportScope } from '@entalent/application';
import { DatabaseService } from '../../database/database.service';

@Injectable()
export class V2CohortReportInputRepository {
  constructor(private readonly db: DatabaseService) {}

  async load(input: { tenantId: string; reportingCohortId: string; questionGroup: string }): Promise<V2CohortReportScope | null> {
    const [cohort] = await this.db.client.select({
      tenantId: surveyReportingCohorts.tenantId,
      reportingCohortId: surveyReportingCohorts.id,
      teamId: surveyReportingCohorts.teamId,
      surveyDefinitionId: surveyReportingCohorts.surveyDefinitionId,
      periodStart: surveyReportingCohorts.periodStart,
      periodEnd: surveyReportingCohorts.periodEnd,
      rosterUserIds: surveyReportingCohorts.rosterUserIds,
      policyId: surveyScoringPolicies.id,
      policyVersion: surveyScoringPolicies.version,
    }).from(surveyReportingCohorts)
      .innerJoin(teams, and(
        eq(teams.id, surveyReportingCohorts.teamId), eq(teams.tenantId, surveyReportingCohorts.tenantId),
      ))
      .innerJoin(surveyDefinitions, eq(surveyDefinitions.id, surveyReportingCohorts.surveyDefinitionId))
      .innerJoin(surveyCycleScoringPolicies, and(
        eq(surveyCycleScoringPolicies.tenantId, surveyReportingCohorts.tenantId),
        eq(surveyCycleScoringPolicies.surveyDefinitionId, surveyReportingCohorts.surveyDefinitionId),
        eq(surveyCycleScoringPolicies.periodStart, surveyReportingCohorts.periodStart),
        eq(surveyCycleScoringPolicies.periodEnd, surveyReportingCohorts.periodEnd),
      ))
      .innerJoin(surveyScoringPolicies, and(
        eq(surveyScoringPolicies.id, surveyCycleScoringPolicies.scoringPolicyId),
        eq(surveyScoringPolicies.tenantId, surveyReportingCohorts.tenantId),
      ))
      .where(and(
        eq(surveyReportingCohorts.id, input.reportingCohortId),
        eq(surveyReportingCohorts.tenantId, input.tenantId),
        eq(surveyDefinitions.tenantId, input.tenantId),
      )).limit(1);
    if (!cohort) return null;
    const requiredQuestions = await this.db.client.select({ id: surveyQuestions.id, title: surveyQuestions.title, version: surveyQuestions.version })
      .from(surveyQuestions).where(and(
        eq(surveyQuestions.surveyDefinitionId, cohort.surveyDefinitionId),
        eq(surveyQuestions.questionGroup, input.questionGroup),
      ));
    const windows = cohort.rosterUserIds.length ? await this.db.client.select({
      userId: surveyWindows.userId,
      windowId: surveyWindows.id,
      policyVersion: surveyScoringPolicies.version,
      policyId: surveyWindowScoringPolicies.scoringPolicyId,
      rosterUserIds: surveyWindows.reportingRosterUserIds,
      teamId: surveyWindows.reportingTeamId,
      definitionId: surveyWindows.surveyDefinitionId,
      periodStart: surveyWindows.periodStart,
      periodEnd: surveyWindows.periodEnd,
    }).from(surveyWindows)
      .innerJoin(users, and(
        eq(users.id, surveyWindows.userId), eq(users.tenantId, input.tenantId),
        eq(users.status, 'active'), isNull(users.deletedAt),
      ))
      .leftJoin(surveyWindowScoringPolicies, and(
        eq(surveyWindowScoringPolicies.surveyWindowId, surveyWindows.id),
        eq(surveyWindowScoringPolicies.tenantId, input.tenantId),
      ))
      .leftJoin(surveyScoringPolicies, and(
        eq(surveyScoringPolicies.id, surveyWindowScoringPolicies.scoringPolicyId),
        eq(surveyScoringPolicies.tenantId, input.tenantId),
      ))
      .where(and(
        eq(surveyWindows.tenantId, input.tenantId),
        eq(surveyWindows.reportingCohortId, input.reportingCohortId),
        inArray(surveyWindows.userId, cohort.rosterUserIds),
      )) : [];
    if (windows.some((row) => row.policyId !== cohort.policyId || !row.policyVersion
      || row.teamId !== cohort.teamId || row.definitionId !== cohort.surveyDefinitionId
      || row.periodStart.getTime() !== cohort.periodStart.getTime()
      || row.periodEnd.getTime() !== cohort.periodEnd.getTime()
      || row.rosterUserIds.length !== cohort.rosterUserIds.length
      || row.rosterUserIds.some((id) => !cohort.rosterUserIds.includes(id)))) {
      throw new Error('v2_cohort_window_policy_mismatch');
    }
    const windowIds = windows.map((row) => row.windowId);
    const rows = windowIds.length ? await this.db.client.select({
      id: surveyQuestionInsights.id,
      userId: surveyQuestionInsights.userId,
      surveyWindowId: surveyQuestionInsights.surveyWindowId,
      questionId: surveyQuestionInsights.surveyQuestionId,
      questionVersion: surveyQuestionInsights.questionVersion,
      deidentifiedSummary: surveyQuestionInsights.deidentifiedSummary,
      outcome: surveyQuestionInsights.outcome,
      score: surveyQuestionInsights.score,
      scoringPolicyVersion: surveyQuestionInsights.scoringPolicyVersion,
      confirmedAt: surveyQuestionInsights.confirmedAt,
    }).from(surveyQuestionInsights)
      .innerJoin(surveyWindows, and(
        eq(surveyWindows.id, surveyQuestionInsights.surveyWindowId),
        eq(surveyWindows.userId, surveyQuestionInsights.userId),
      ))
      .innerJoin(surveyQuestions, eq(surveyQuestions.id, surveyQuestionInsights.surveyQuestionId))
      .where(and(
        eq(surveyQuestionInsights.tenantId, input.tenantId),
        eq(surveyQuestionInsights.surveyDefinitionId, cohort.surveyDefinitionId),
        eq(surveyQuestionInsights.questionGroup, input.questionGroup),
        eq(surveyQuestionInsights.isCurrent, true),
        isNull(surveyQuestionInsights.withdrawnAt),
        eq(surveyWindows.tenantId, input.tenantId),
        eq(surveyWindows.surveyDefinitionId, cohort.surveyDefinitionId),
        eq(surveyWindows.reportingCohortId, input.reportingCohortId),
        eq(surveyWindows.reportingTeamId, cohort.teamId),
        eq(surveyQuestions.surveyDefinitionId, cohort.surveyDefinitionId),
        eq(surveyQuestions.questionGroup, input.questionGroup),
        inArray(surveyQuestionInsights.surveyWindowId, windowIds),
      )) : [];
    return {
      tenantId: cohort.tenantId,
      reportingCohortId: cohort.reportingCohortId,
      teamId: cohort.teamId,
      surveyDefinitionId: cohort.surveyDefinitionId,
      periodStart: cohort.periodStart,
      periodEnd: cohort.periodEnd,
      rosterUserIds: cohort.rosterUserIds,
      policyVersion: cohort.policyVersion,
      requiredQuestionIds: requiredQuestions.map((row) => row.id),
      questionTitlesById: Object.fromEntries(requiredQuestions.map((row) => [row.id, row.title])),
      questionVersionsById: Object.fromEntries(requiredQuestions.map((row) => [row.id, row.version])),
      windowIdsByUser: windows.map((row) => ({ userId: row.userId, windowId: row.windowId, policyVersion: row.policyVersion! })),
      questions: rows.map((row) => ({ ...row,
        outcome: row.outcome as 'scored' | 'insufficient_evidence',
        score: row.score === null ? null : Number(row.score),
      })),
    };
  }
}
