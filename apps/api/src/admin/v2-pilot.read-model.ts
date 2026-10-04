import { BadRequestException, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { AdminV2PilotCycle, AdminV2PilotQuestion, AdminV2PilotResponse } from '@entalent/contracts';
import { DatabaseService } from '../database/database.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type CycleRow = Omit<AdminV2PilotCycle, 'periodStart' | 'periodEnd' | 'lastInboundAt' | 'questions'> & {
  periodStart: Date;
  periodEnd: Date;
  lastInboundAt: Date | null;
};

type QuestionRow = AdminV2PilotQuestion;

@Injectable()
export class V2PilotReadModel {
  constructor(private readonly db: DatabaseService) {}

  async getStatus(tenantId: unknown, cohortIdsRaw: unknown): Promise<AdminV2PilotResponse> {
    if (typeof tenantId !== 'string' || !UUID.test(tenantId)) {
      throw new BadRequestException('tenantId query param must be a UUID');
    }
    const cohortIds = typeof cohortIdsRaw === 'string' ? cohortIdsRaw.split(',') : [];
    if (cohortIds.length < 1 || cohortIds.length > 5
      || new Set(cohortIds).size !== cohortIds.length || cohortIds.some((id) => !UUID.test(id))) {
      throw new BadRequestException('cohortIds must contain one to five distinct UUIDs');
    }

    // Only cohort and status metadata leave this query. Private text, source IDs,
    // employee IDs, individual scores, and report payloads are never selected.
    const rows = await this.db.client.execute(sql`
      SELECT c.id AS "cohortId",
             d.version AS "definitionVersion",
             p.version AS "scoringPolicyVersion",
             c.period_start AS "periodStart",
             c.period_end AS "periodEnd",
             cardinality(c.roster_user_ids)::int AS "rosterSize",
             (t.manager_slack_user_id IS NOT NULL) AS "managerTargetConfigured",
             (SELECT count(DISTINCT m.user_id)::int FROM messages m
               WHERE m.tenant_id = c.tenant_id AND m.user_id = ANY(c.roster_user_ids)
                 AND m.direction = 'inbound' AND m.deleted_at IS NULL
                 AND m.occurred_at >= c.period_start AND m.occurred_at < c.period_end) AS participants,
             (SELECT count(*)::int FROM messages m
               WHERE m.tenant_id = c.tenant_id AND m.user_id = ANY(c.roster_user_ids)
                 AND m.direction = 'inbound' AND m.deleted_at IS NULL
                 AND m.occurred_at >= c.period_start AND m.occurred_at < c.period_end) AS inbound,
             (SELECT count(*)::int FROM messages m
               JOIN conversation_job_receipts r ON r.message_id = m.id
               WHERE m.tenant_id = c.tenant_id AND m.user_id = ANY(c.roster_user_ids)
                 AND m.direction = 'inbound' AND m.deleted_at IS NULL
                 AND m.occurred_at >= c.period_start AND m.occurred_at < c.period_end) AS processed,
             (SELECT max(m.occurred_at) FROM messages m
               WHERE m.tenant_id = c.tenant_id AND m.user_id = ANY(c.roster_user_ids)
                 AND m.direction = 'inbound' AND m.deleted_at IS NULL
                 AND m.occurred_at >= c.period_start AND m.occurred_at < c.period_end) AS "lastInboundAt",
             (SELECT count(*)::int FROM survey_windows w
               WHERE w.tenant_id = c.tenant_id AND w.reporting_cohort_id = c.id) AS windows,
             (SELECT count(*)::int FROM survey_question_working_insights wi
               JOIN survey_windows w ON w.id = wi.survey_window_id
               WHERE wi.tenant_id = c.tenant_id AND w.reporting_cohort_id = c.id
                 AND wi.ready_for_confirmation AND wi.status IN ('collecting', 'pending_confirmation')) AS "readyMeanings",
             (SELECT count(*)::int FROM (
               SELECT wi.survey_window_id, q.question_group
               FROM survey_question_working_insights wi
               JOIN survey_windows w ON w.id = wi.survey_window_id
               JOIN survey_questions q ON q.id = wi.survey_question_id
               WHERE wi.tenant_id = c.tenant_id AND w.reporting_cohort_id = c.id
                 AND wi.ready_for_confirmation AND wi.status IN ('collecting', 'pending_confirmation')
               GROUP BY wi.survey_window_id, q.question_group
               HAVING count(DISTINCT wi.survey_question_id) = 3
             ) ready_groups) AS "completeGroups",
             (SELECT count(*)::int FROM survey_question_working_insights wi
               JOIN survey_windows w ON w.id = wi.survey_window_id
               WHERE wi.tenant_id = c.tenant_id AND w.reporting_cohort_id = c.id
                 AND wi.status = 'no_data') AS "noDataMeanings",
             (SELECT count(*)::int FROM survey_question_confirmation_bundles b
               JOIN survey_windows w ON w.id = b.survey_window_id
               WHERE b.tenant_id = c.tenant_id AND w.reporting_cohort_id = c.id) AS bundles,
             (SELECT count(*)::int FROM survey_question_confirmation_bundles b
               JOIN survey_windows w ON w.id = b.survey_window_id
               WHERE b.tenant_id = c.tenant_id AND w.reporting_cohort_id = c.id
                 AND b.status = 'awaiting_confirmation') AS "awaitingBundles",
             (SELECT count(*)::int FROM survey_question_confirmation_bundles b
               JOIN survey_windows w ON w.id = b.survey_window_id
               WHERE b.tenant_id = c.tenant_id AND w.reporting_cohort_id = c.id
                 AND b.status = 'resolved') AS "resolvedBundles",
             (SELECT count(*)::int FROM survey_question_insights i
               JOIN survey_windows w ON w.id = i.survey_window_id
               WHERE i.tenant_id = c.tenant_id AND w.reporting_cohort_id = c.id
                 AND i.is_current AND i.outcome = 'scored') AS "finalScored",
             (SELECT count(*)::int FROM survey_question_insights i
               JOIN survey_windows w ON w.id = i.survey_window_id
               WHERE i.tenant_id = c.tenant_id AND w.reporting_cohort_id = c.id
                 AND i.is_current AND i.outcome = 'insufficient_evidence') AS "finalInsufficient",
             (SELECT count(*)::int FROM survey_v2_report_snapshots s
               WHERE s.tenant_id = c.tenant_id AND s.reporting_cohort_id = c.id) AS "reportSnapshots",
             (SELECT count(*)::int FROM survey_v2_report_snapshots s
               WHERE s.tenant_id = c.tenant_id AND s.reporting_cohort_id = c.id
                 AND s.status = 'sent') AS "sentReports"
      FROM survey_reporting_cohorts c
      JOIN survey_definitions d ON d.id = c.survey_definition_id
        AND (d.tenant_id IS NULL OR d.tenant_id = c.tenant_id)
      JOIN survey_cycle_scoring_policies cp ON cp.tenant_id = c.tenant_id
        AND cp.survey_definition_id = c.survey_definition_id
        AND cp.period_start = c.period_start AND cp.period_end = c.period_end
      JOIN survey_scoring_policies p ON p.id = cp.scoring_policy_id AND p.tenant_id = c.tenant_id
      JOIN teams t ON t.id = c.team_id AND t.tenant_id = c.tenant_id
      WHERE c.tenant_id = ${tenantId}
        AND c.id IN (${sql.join(cohortIds.map((id) => sql`${id}::uuid`), sql`, `)})
      ORDER BY c.period_start DESC
    `) as unknown as CycleRow[];

    const cycles: AdminV2PilotCycle[] = await Promise.all(rows.map(async (row) =>
      projectPilotCycle(row, await this.getQuestions(tenantId, row.cohortId))));

    return { tenantId, checkedAt: new Date().toISOString(), cycles };
  }

  private async getQuestions(tenantId: string, cohortId: string): Promise<AdminV2PilotQuestion[]> {
    const rows = await this.db.client.execute(sql`
      SELECT q.stable_key AS "stableKey", q.title, q.question_group AS "group",
             (SELECT count(*)::int FROM survey_question_working_insights wi
               JOIN survey_windows w ON w.id = wi.survey_window_id
               WHERE wi.tenant_id = c.tenant_id AND w.reporting_cohort_id = c.id
                 AND wi.survey_question_id = q.id) AS working,
             (SELECT count(*)::int FROM survey_question_working_insights wi
               JOIN survey_windows w ON w.id = wi.survey_window_id
               WHERE wi.tenant_id = c.tenant_id AND w.reporting_cohort_id = c.id
                 AND wi.survey_question_id = q.id AND wi.ready_for_confirmation
                 AND wi.status IN ('collecting', 'pending_confirmation')) AS ready,
             (SELECT count(*)::int FROM survey_question_working_insights wi
               JOIN survey_windows w ON w.id = wi.survey_window_id
               WHERE wi.tenant_id = c.tenant_id AND w.reporting_cohort_id = c.id
                 AND wi.survey_question_id = q.id AND wi.status = 'no_data') AS "noData",
             (SELECT count(*)::int FROM survey_question_working_insights wi
               JOIN survey_windows w ON w.id = wi.survey_window_id
               WHERE wi.tenant_id = c.tenant_id AND w.reporting_cohort_id = c.id
                 AND wi.survey_question_id = q.id AND wi.status = 'confirmed') AS confirmed,
             (SELECT count(*)::int FROM survey_question_insights i
               JOIN survey_windows w ON w.id = i.survey_window_id
               WHERE i.tenant_id = c.tenant_id AND w.reporting_cohort_id = c.id
                 AND i.survey_question_id = q.id AND i.is_current AND i.outcome = 'scored') AS "finalScored",
             (SELECT count(*)::int FROM survey_question_insights i
               JOIN survey_windows w ON w.id = i.survey_window_id
               WHERE i.tenant_id = c.tenant_id AND w.reporting_cohort_id = c.id
                 AND i.survey_question_id = q.id AND i.is_current
                 AND i.outcome = 'insufficient_evidence') AS "finalInsufficient"
      FROM survey_reporting_cohorts c
      JOIN survey_questions q ON q.survey_definition_id = c.survey_definition_id
        AND q.response_type = 'open_ended'
      WHERE c.id = ${cohortId} AND c.tenant_id = ${tenantId}
      ORDER BY q.display_order
    `) as unknown as QuestionRow[];
    return rows.map((row) => ({
      stableKey: row.stableKey,
      title: row.title,
      group: row.group,
      working: row.working,
      ready: row.ready,
      noData: row.noData,
      confirmed: row.confirmed,
      finalScored: row.finalScored,
      finalInsufficient: row.finalInsufficient,
    }));
  }
}

export function projectPilotCycle(row: CycleRow, questions: AdminV2PilotQuestion[]): AdminV2PilotCycle {
  return {
    cohortId: row.cohortId,
    definitionVersion: row.definitionVersion,
    scoringPolicyVersion: row.scoringPolicyVersion,
    periodStart: new Date(row.periodStart).toISOString(),
    periodEnd: new Date(row.periodEnd).toISOString(),
    rosterSize: row.rosterSize,
    managerTargetConfigured: row.managerTargetConfigured,
    participants: row.participants,
    inbound: row.inbound,
    processed: row.processed,
    lastInboundAt: row.lastInboundAt ? new Date(row.lastInboundAt).toISOString() : null,
    windows: row.windows,
    readyMeanings: row.readyMeanings,
    completeGroups: row.completeGroups,
    noDataMeanings: row.noDataMeanings,
    bundles: row.bundles,
    awaitingBundles: row.awaitingBundles,
    resolvedBundles: row.resolvedBundles,
    finalScored: row.finalScored,
    finalInsufficient: row.finalInsufficient,
    reportSnapshots: row.reportSnapshots,
    sentReports: row.sentReports,
    questions,
  };
}
