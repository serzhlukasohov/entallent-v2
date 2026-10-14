import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type {
  AdminV2PilotCohortState, AdminV2PilotCycle, AdminV2PilotPeopleResponse, AdminV2PilotPersonQuestion,
  AdminV2PilotQuestion, AdminV2PilotResponse,
} from '@entalent/contracts';
import { DatabaseService } from '../database/database.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MAX_CYCLES = 5;

export type PilotCohortCandidate = { cohortId: string; periodStart: Date | string; periodEnd: Date | string };

type CycleRow = Omit<AdminV2PilotCycle, 'state' | 'periodStart' | 'periodEnd' | 'lastInboundAt' | 'questions'> & {
  periodStart: Date;
  periodEnd: Date;
  lastInboundAt: Date | null;
};

type QuestionRow = AdminV2PilotQuestion;

type PersonQuestionRow = {
  userId: string;
  displayName: string;
  inbound: number;
  stableKey: string;
  title: string;
  group: string;
  workingStatus: string | null;
  ready: boolean | null;
  workingSummary: string | null;
  finalSummary: string | null;
  outcome: string | null;
  score: string | null;
};

@Injectable()
export class V2PilotReadModel {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Without an explicit cohortId the cohort is resolved from the tenant's V2
   * cohorts by period: the running one, else the most recently started one,
   * reported with state 'closed' so callers never label it as current.
   */
  async getPeople(tenantId: unknown, cohortIdRaw: unknown): Promise<AdminV2PilotPeopleResponse> {
    if (typeof tenantId !== 'string' || !UUID.test(tenantId)
      || (cohortIdRaw !== undefined && (typeof cohortIdRaw !== 'string' || !UUID.test(cohortIdRaw)))) {
      throw new BadRequestException('tenantId and cohortId must be UUIDs');
    }
    const now = new Date();
    const candidates = await this.listCohorts(tenantId);
    const cohort = cohortIdRaw === undefined
      ? selectCurrentPilotCohort(candidates, now)
      : candidates.find((candidate) => candidate.cohortId === cohortIdRaw) ?? null;
    if (!cohort) throw new NotFoundException('No V2 pilot cohort for this tenant');
    const cohortId = cohort.cohortId;

    // The frozen cohort is the only source of members. Never select message text,
    // source IDs, Bundle text, or summaries from another tenant or cycle.
    const rows = await this.db.client.execute(sql`
      SELECT member.user_id AS "userId",
             coalesce(account.display_name, 'Participant ' || member.position::text) AS "displayName",
             activity.inbound,
             q.stable_key AS "stableKey", q.title, q.question_group AS "group",
             wi.status AS "workingStatus", wi.ready_for_confirmation AS ready,
             CASE WHEN wi.purged_at IS NULL THEN coalesce(wi.confirmed_semantic_summary, wi.working_summary)
               ELSE NULL END AS "workingSummary",
             insight.deidentified_summary AS "finalSummary",
             insight.outcome, insight.score
      FROM survey_reporting_cohorts c
      CROSS JOIN LATERAL unnest(c.roster_user_ids) WITH ORDINALITY AS member(user_id, position)
      JOIN survey_questions q ON q.survey_definition_id = c.survey_definition_id
        AND q.response_type = 'open_ended'
      LEFT JOIN LATERAL (
        SELECT a.display_name FROM channel_accounts a
        WHERE a.tenant_id = c.tenant_id AND a.user_id = member.user_id
          AND a.channel_type = 'slack' AND a.link_status = 'linked'
        ORDER BY a.updated_at DESC LIMIT 1
      ) account ON true
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS inbound FROM messages m
        WHERE m.tenant_id = c.tenant_id AND m.user_id = member.user_id
          AND m.direction = 'inbound' AND m.deleted_at IS NULL
          AND m.occurred_at >= c.period_start AND m.occurred_at < c.period_end
      ) activity ON true
      LEFT JOIN LATERAL (
        SELECT w.id FROM survey_windows w
        WHERE w.tenant_id = c.tenant_id AND w.user_id = member.user_id
          AND w.reporting_cohort_id = c.id
        ORDER BY w.period_start DESC LIMIT 1
      ) window_row ON true
      LEFT JOIN LATERAL (
        SELECT wi.status, wi.ready_for_confirmation, wi.working_summary,
               wi.confirmed_semantic_summary, wi.purged_at
        FROM survey_question_working_insights wi
        WHERE wi.tenant_id = c.tenant_id AND wi.user_id = member.user_id
          AND wi.survey_window_id = window_row.id AND wi.survey_question_id = q.id
        ORDER BY wi.updated_at DESC LIMIT 1
      ) wi ON true
      LEFT JOIN LATERAL (
        SELECT i.deidentified_summary, i.outcome, i.score
        FROM survey_question_insights i
        WHERE i.tenant_id = c.tenant_id AND i.user_id = member.user_id
          AND i.survey_window_id = window_row.id AND i.survey_question_id = q.id
          AND i.is_current AND i.withdrawn_at IS NULL
        ORDER BY i.scored_at DESC LIMIT 1
      ) insight ON true
      WHERE c.tenant_id = ${tenantId} AND c.id = ${cohortId}
      ORDER BY member.position, q.display_order
    `) as unknown as PersonQuestionRow[];

    return projectPilotPeople(cohort, rows, now);
  }

  /** V2 cohorts only: a cohort without a cycle scoring policy is not part of the pilot. */
  private async listCohorts(tenantId: string): Promise<PilotCohortCandidate[]> {
    return await this.db.client.execute(sql`
      SELECT c.id AS "cohortId", c.period_start AS "periodStart", c.period_end AS "periodEnd"
      FROM survey_reporting_cohorts c
      WHERE c.tenant_id = ${tenantId}
        AND EXISTS (
          SELECT 1 FROM survey_cycle_scoring_policies cp
          WHERE cp.tenant_id = c.tenant_id AND cp.survey_definition_id = c.survey_definition_id
            AND cp.period_start = c.period_start AND cp.period_end = c.period_end
        )
      ORDER BY c.period_start DESC, c.id
    `) as unknown as PilotCohortCandidate[];
  }

  async getStatus(tenantId: unknown, cohortIdsRaw: unknown): Promise<AdminV2PilotResponse> {
    if (typeof tenantId !== 'string' || !UUID.test(tenantId)) {
      throw new BadRequestException('tenantId query param must be a UUID');
    }
    let cohortIds: string[];
    if (cohortIdsRaw === undefined) {
      const now = new Date();
      cohortIds = (await this.listCohorts(tenantId))
        .filter((cohort) => cohortState(cohort, now) !== 'upcoming')
        .slice(0, MAX_CYCLES)
        .map((cohort) => cohort.cohortId);
      if (cohortIds.length === 0) return { tenantId, checkedAt: now.toISOString(), cycles: [] };
    } else {
      cohortIds = typeof cohortIdsRaw === 'string' ? cohortIdsRaw.split(',') : [];
      if (cohortIds.length < 1 || cohortIds.length > MAX_CYCLES
        || new Set(cohortIds).size !== cohortIds.length || cohortIds.some((id) => !UUID.test(id))) {
        throw new BadRequestException('cohortIds must contain one to five distinct UUIDs');
      }
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
             (SELECT count(DISTINCT m.id)::int FROM messages m
               JOIN survey_windows w ON w.tenant_id = m.tenant_id AND w.user_id = m.user_id
               WHERE w.reporting_cohort_id = c.id AND m.tenant_id = c.tenant_id
                 AND m.direction = 'outbound' AND m.sent_at IS NOT NULL AND m.deleted_at IS NULL
                 AND m.occurred_at >= c.period_start AND m.occurred_at < c.period_end
                 AND m.metadata->>'reportingDisclosureVersion' = 'reporting-disclosure-v1') AS "deliveredDisclosures",
             (SELECT count(DISTINCT m.id)::int FROM messages m
               JOIN survey_windows w ON w.tenant_id = m.tenant_id AND w.user_id = m.user_id
               WHERE w.reporting_cohort_id = c.id AND m.tenant_id = c.tenant_id
                 AND m.direction = 'outbound' AND m.sent_at IS NOT NULL AND m.deleted_at IS NULL
                 AND m.occurred_at >= c.period_start AND m.occurred_at < c.period_end
                 AND m.metadata->>'v2ConfirmationBundle' = 'true') AS "deliveredBundles",
             (SELECT count(*)::int FROM survey_question_verdict_receipts r
               JOIN survey_question_confirmation_bundles b ON b.id = r.bundle_id AND b.tenant_id = r.tenant_id
               JOIN survey_windows w ON w.id = b.survey_window_id AND w.tenant_id = b.tenant_id
               WHERE r.tenant_id = c.tenant_id AND w.reporting_cohort_id = c.id
                 AND r.question_group = 'autonomy'
                 AND r.verdict_kind IN ('agree', 'partial', 'reject')) AS "autonomyVerdicts",
             (SELECT count(DISTINCT eligible.user_id)::int FROM (
               SELECT i.user_id
               FROM survey_question_insights i
               JOIN survey_windows w ON w.id = i.survey_window_id AND w.tenant_id = i.tenant_id
               WHERE i.tenant_id = c.tenant_id AND w.reporting_cohort_id = c.id
                 AND i.question_group = 'autonomy' AND i.is_current AND i.outcome = 'scored'
                 AND i.withdrawn_at IS NULL AND i.scoring_policy_version = p.version
               GROUP BY i.user_id, i.survey_window_id
               HAVING count(DISTINCT i.survey_question_id) = 3
             ) eligible) AS "autonomyScoredParticipants",
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

    const now = new Date();
    const cycles: AdminV2PilotCycle[] = await Promise.all(rows.map(async (row) =>
      projectPilotCycle(row, await this.getQuestions(tenantId, row.cohortId), now)));

    return { tenantId, checkedAt: now.toISOString(), cycles };
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

export function cohortState(cohort: Pick<PilotCohortCandidate, 'periodStart' | 'periodEnd'>, now: Date): AdminV2PilotCohortState {
  if (now.getTime() < new Date(cohort.periodStart).getTime()) return 'upcoming';
  return now.getTime() < new Date(cohort.periodEnd).getTime() ? 'active' : 'closed';
}

/**
 * The current cohort is the one whose period contains `now` (latest start wins
 * if periods ever overlap). Only when none is running does the most recently
 * started cohort stand in; data volume never influences the choice.
 */
export function selectCurrentPilotCohort(
  cohorts: PilotCohortCandidate[],
  now: Date,
): PilotCohortCandidate | null {
  const started = cohorts
    .filter((cohort) => cohortState(cohort, now) !== 'upcoming')
    .sort((a, b) => new Date(b.periodStart).getTime() - new Date(a.periodStart).getTime());
  return started.find((cohort) => cohortState(cohort, now) === 'active') ?? started[0] ?? null;
}

export function projectPilotPeople(
  cohort: PilotCohortCandidate,
  rows: PersonQuestionRow[],
  now: Date = new Date(),
): AdminV2PilotPeopleResponse {
  const people = new Map<string, AdminV2PilotPeopleResponse['people'][number]>();
  for (const row of rows) {
    let person = people.get(row.userId);
    if (!person) {
      person = { userId: row.userId, displayName: row.displayName, inbound: row.inbound, questions: [] };
      people.set(row.userId, person);
    }
    const question: AdminV2PilotPersonQuestion = {
      stableKey: row.stableKey,
      title: row.title,
      group: row.group,
      status: row.outcome ?? row.workingStatus ?? 'no_data',
      ready: row.ready === true && row.outcome === null,
      workingSummary: row.outcome === null ? row.workingSummary : null,
      finalSummary: row.finalSummary,
      outcome: row.outcome,
      score: row.score === null ? null : Number(row.score),
    };
    person.questions.push(question);
  }
  return {
    cohortId: cohort.cohortId,
    periodStart: new Date(cohort.periodStart).toISOString(),
    periodEnd: new Date(cohort.periodEnd).toISOString(),
    state: cohortState(cohort, now),
    checkedAt: now.toISOString(),
    people: [...people.values()],
  };
}

export function projectPilotCycle(
  row: CycleRow,
  questions: AdminV2PilotQuestion[],
  now: Date = new Date(),
): AdminV2PilotCycle {
  return {
    cohortId: row.cohortId,
    state: cohortState(row, now),
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
    deliveredDisclosures: row.deliveredDisclosures,
    deliveredBundles: row.deliveredBundles,
    autonomyVerdicts: row.autonomyVerdicts,
    autonomyScoredParticipants: row.autonomyScoredParticipants,
    finalScored: row.finalScored,
    finalInsufficient: row.finalInsufficient,
    reportSnapshots: row.reportSnapshots,
    sentReports: row.sentReports,
    questions,
  };
}
