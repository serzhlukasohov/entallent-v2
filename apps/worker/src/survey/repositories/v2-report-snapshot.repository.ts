import { Injectable } from '@nestjs/common';
import { and, desc, eq, lt, ne, sql } from 'drizzle-orm';
import { surveyV2ReportSnapshots } from '@entalent/database';
import { DatabaseService } from '../../database/database.service';

export type V2ReportSnapshotStatus = 'pending_delivery' | 'delivered' | 'cancelled' | 'delivery_unknown';

export interface V2ReportSnapshotInput {
  tenantId: string;
  reportingCohortId: string;
  teamId: string;
  questionGroup: string;
  reportKind: 'intermediate' | 'final';
  snapshotVersion: number;
  managerPayload: {
    message: string;
    sourceQuestionInsightIdsByGroupAndUser: Record<string, Record<string, string[]>>;
    preSendRecoveryVersion: 1;
  };
  contributorUserIds: string[];
  sourceQuestionInsightIds: string[];
  policyVersion: string;
  calculationVersion: string;
  workspaceConnectionId: string;
  managerSlackChannelId: string;
}

@Injectable()
export class V2ReportSnapshotRepository {
  constructor(private readonly db: DatabaseService) {}

  async findLatest(input: Pick<V2ReportSnapshotInput, 'tenantId' | 'reportingCohortId' | 'questionGroup'>) {
    const [row] = await this.db.client.select({
      snapshotVersion: surveyV2ReportSnapshots.snapshotVersion,
      status: surveyV2ReportSnapshots.status,
      reportKind: surveyV2ReportSnapshots.reportKind,
      contributorUserIds: surveyV2ReportSnapshots.contributorUserIds,
      sourceQuestionInsightIds: surveyV2ReportSnapshots.sourceQuestionInsightIds,
      managerPayload: surveyV2ReportSnapshots.managerPayload,
      createdAt: surveyV2ReportSnapshots.createdAt,
      deliveryAttemptedAt: surveyV2ReportSnapshots.deliveryAttemptedAt,
    }).from(surveyV2ReportSnapshots).where(and(
      eq(surveyV2ReportSnapshots.tenantId, input.tenantId),
      eq(surveyV2ReportSnapshots.reportingCohortId, input.reportingCohortId),
      eq(surveyV2ReportSnapshots.questionGroup, input.questionGroup),
      ne(surveyV2ReportSnapshots.status, 'cancelled'),
    )).orderBy(desc(surveyV2ReportSnapshots.snapshotVersion)).limit(1);
    return row ? {
      ...row,
      status: row.status as V2ReportSnapshotStatus,
      reportKind: row.reportKind as V2ReportSnapshotInput['reportKind'],
    } : null;
  }

  async createPending(input: V2ReportSnapshotInput): Promise<string | null> {
    if (!input.managerPayload.message.trim() || !input.managerSlackChannelId.trim()
      || input.contributorUserIds.length < 5 || input.sourceQuestionInsightIds.length < 5
      || new Set(input.contributorUserIds).size !== input.contributorUserIds.length
      || new Set(input.sourceQuestionInsightIds).size !== input.sourceQuestionInsightIds.length) {
      throw new Error('v2_report_snapshot_invalid_input');
    }
    const [row] = await this.db.client.insert(surveyV2ReportSnapshots).values({
      ...input,
      status: 'pending_delivery' satisfies V2ReportSnapshotStatus,
    }).onConflictDoNothing().returning({ id: surveyV2ReportSnapshots.id });
    return row?.id ?? null;
  }

  async cancelStaleUnattempted(
    input: Pick<V2ReportSnapshotInput, 'tenantId' | 'reportingCohortId' | 'questionGroup'>,
    olderThan: Date,
  ): Promise<boolean> {
    const rows = await this.db.client.update(surveyV2ReportSnapshots).set({
      status: 'cancelled', failureReason: 'v2_report_stale_before_send', statusUpdatedAt: new Date(),
    }).where(and(
      eq(surveyV2ReportSnapshots.tenantId, input.tenantId),
      eq(surveyV2ReportSnapshots.reportingCohortId, input.reportingCohortId),
      eq(surveyV2ReportSnapshots.questionGroup, input.questionGroup),
      eq(surveyV2ReportSnapshots.status, 'pending_delivery'),
      lt(surveyV2ReportSnapshots.createdAt, olderThan),
      sql`${surveyV2ReportSnapshots.deliveryAttemptedAt} is null`,
      sql`${surveyV2ReportSnapshots.managerPayload}->>'preSendRecoveryVersion' = '1'`,
    )).returning({ id: surveyV2ReportSnapshots.id });
    return rows.length > 0;
  }

  async markAttemptStarted(id: string, attemptedAt: Date): Promise<void> {
    const rows = await this.db.client.update(surveyV2ReportSnapshots).set({
      deliveryAttemptedAt: attemptedAt, statusUpdatedAt: attemptedAt,
    }).where(and(
      eq(surveyV2ReportSnapshots.id, id), eq(surveyV2ReportSnapshots.status, 'pending_delivery'),
      sql`${surveyV2ReportSnapshots.deliveryAttemptedAt} is null`,
    )).returning({ id: surveyV2ReportSnapshots.id });
    if (rows.length !== 1) throw new Error('v2_report_snapshot_transition_failed');
  }

  async markDelivered(id: string, externalMessageId: string, sentAt: Date): Promise<void> {
    if (!externalMessageId.trim()) throw new Error('v2_report_slack_receipt_missing');
    const rows = await this.db.client.update(surveyV2ReportSnapshots).set({
      status: 'delivered', slackExternalMessageId: externalMessageId,
      deliveryAttemptedAt: sentAt, statusUpdatedAt: sentAt,
    }).where(and(eq(surveyV2ReportSnapshots.id, id),
      eq(surveyV2ReportSnapshots.status, 'pending_delivery'))).returning({ id: surveyV2ReportSnapshots.id });
    if (rows.length !== 1) throw new Error('v2_report_snapshot_transition_failed');
  }

  async markDeliveryUnknown(id: string, attemptedAt: Date): Promise<void> {
    await this.transition(id, 'delivery_unknown', 'v2_report_delivery_unknown', attemptedAt);
  }

  async markCancelled(id: string, reason: string): Promise<void> {
    await this.transition(id, 'cancelled', reason);
  }

  private async transition(
    id: string, status: 'cancelled' | 'delivery_unknown', reason: string, attemptedAt?: Date,
  ): Promise<void> {
    const rows = await this.db.client.update(surveyV2ReportSnapshots).set({
      status, failureReason: reason,
      ...(attemptedAt ? { deliveryAttemptedAt: attemptedAt } : {}),
      statusUpdatedAt: new Date(),
    }).where(and(eq(surveyV2ReportSnapshots.id, id),
      eq(surveyV2ReportSnapshots.status, 'pending_delivery'))).returning({ id: surveyV2ReportSnapshots.id });
    if (rows.length !== 1) throw new Error('v2_report_snapshot_transition_failed');
  }
}
