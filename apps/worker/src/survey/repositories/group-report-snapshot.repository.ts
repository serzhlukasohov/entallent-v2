import { Injectable } from '@nestjs/common';
import { and, desc, eq, ne } from 'drizzle-orm';
import { surveyReportSnapshots } from '@entalent/database';
import { DatabaseService } from '../../database/database.service';

type SnapshotStatus = 'pending_delivery' | 'delivered' | 'cancelled' | 'delivery_unknown';

interface SnapshotPayload {
  reportKind?: 'intermediate' | 'final';
  message: string;
  teamScore: number;
  confirmedCount: number;
}

interface CreatePendingSnapshotParams {
  tenantId: string;
  reportingCohortId: string;
  teamId: string;
  questionGroup: string;
  snapshotVersion: number;
  payload: SnapshotPayload;
  contributorUserIds: string[];
  sourceGroupStateIds: string[];
  policyVersion: string;
  workspaceConnectionId: string;
  managerSlackUserId: string;
}

interface FindLatestSnapshotParams {
  tenantId: string;
  reportingCohortId: string;
  questionGroup: string;
}

interface LatestSnapshot {
  snapshotVersion: number;
  status: SnapshotStatus;
  reportKind: 'intermediate' | 'final';
  contributorUserIds: string[];
  sourceGroupStateIds: string[];
}

interface RecordCancelledSnapshotParams {
  tenantId: string;
  reportingCohortId: string;
  teamId: string;
  questionGroup: string;
  snapshotVersion: number;
  payload: SnapshotPayload;
  contributorUserIds: string[];
  sourceGroupStateIds: string[];
  policyVersion: string;
  workspaceConnectionId?: string | null;
  managerSlackUserId?: string | null;
  failureReason: string;
}

@Injectable()
export class GroupReportSnapshotRepository {
  constructor(private readonly db: DatabaseService) {}

  async findLatestNonCancelledSnapshot(params: FindLatestSnapshotParams): Promise<LatestSnapshot | null> {
    const [snapshot] = await this.db.client
      .select({
        snapshotVersion: surveyReportSnapshots.snapshotVersion,
        status: surveyReportSnapshots.status,
        managerPayload: surveyReportSnapshots.managerPayload,
        contributorUserIds: surveyReportSnapshots.contributorUserIds,
        sourceGroupStateIds: surveyReportSnapshots.sourceGroupStateIds,
      })
      .from(surveyReportSnapshots)
      .where(and(
        eq(surveyReportSnapshots.tenantId, params.tenantId),
        eq(surveyReportSnapshots.reportingCohortId, params.reportingCohortId),
        eq(surveyReportSnapshots.questionGroup, params.questionGroup),
        ne(surveyReportSnapshots.status, 'cancelled'),
      ))
      .orderBy(desc(surveyReportSnapshots.snapshotVersion))
      .limit(1);
    return snapshot ? {
      snapshotVersion: snapshot.snapshotVersion,
      status: snapshot.status as SnapshotStatus,
      reportKind: snapshotReportKind(snapshot.managerPayload),
      contributorUserIds: snapshot.contributorUserIds,
      sourceGroupStateIds: snapshot.sourceGroupStateIds,
    } : null;
  }

  async createPendingSnapshot(params: CreatePendingSnapshotParams): Promise<string | null> {
    const [snapshot] = await this.db.client
      .insert(surveyReportSnapshots)
      .values({
        tenantId: params.tenantId,
        reportingCohortId: params.reportingCohortId,
        teamId: params.teamId,
        questionGroup: params.questionGroup,
        snapshotVersion: params.snapshotVersion,
        status: 'pending_delivery' satisfies SnapshotStatus,
        managerPayload: params.payload,
        contributorUserIds: params.contributorUserIds,
        sourceGroupStateIds: params.sourceGroupStateIds,
        policyVersion: params.policyVersion,
        workspaceConnectionId: params.workspaceConnectionId,
        managerSlackUserId: params.managerSlackUserId,
      })
      .onConflictDoNothing()
      .returning({ id: surveyReportSnapshots.id });
    return snapshot?.id ?? null;
  }

  async recordCancelledSnapshot(params: RecordCancelledSnapshotParams): Promise<void> {
    await this.db.client
      .insert(surveyReportSnapshots)
      .values({
        tenantId: params.tenantId,
        reportingCohortId: params.reportingCohortId,
        teamId: params.teamId,
        questionGroup: params.questionGroup,
        snapshotVersion: params.snapshotVersion,
        status: 'cancelled' satisfies SnapshotStatus,
        managerPayload: params.payload,
        contributorUserIds: params.contributorUserIds,
        sourceGroupStateIds: params.sourceGroupStateIds,
        policyVersion: params.policyVersion,
        workspaceConnectionId: params.workspaceConnectionId ?? null,
        managerSlackUserId: params.managerSlackUserId ?? null,
        failureReason: params.failureReason,
        statusUpdatedAt: new Date(),
      });
  }

  async markDelivered(snapshotId: string, externalMessageId: string, deliveredAt: Date): Promise<void> {
    await this.updateStatus(snapshotId, 'delivered', {
      slackExternalMessageId: externalMessageId,
      deliveryAttemptedAt: deliveredAt,
      statusUpdatedAt: deliveredAt,
    });
  }

  async markDeliveryUnknown(snapshotId: string, failureReason: string, attemptedAt: Date): Promise<void> {
    await this.updateStatus(snapshotId, 'delivery_unknown', {
      failureReason,
      deliveryAttemptedAt: attemptedAt,
      statusUpdatedAt: new Date(),
    });
  }

  async markCancelled(snapshotId: string, failureReason: string): Promise<void> {
    await this.db.client
      .update(surveyReportSnapshots)
      .set({
        status: 'cancelled' satisfies SnapshotStatus,
        failureReason,
        statusUpdatedAt: new Date(),
      })
      .where(eq(surveyReportSnapshots.id, snapshotId));
  }

  private async updateStatus(
    snapshotId: string,
    status: Exclude<SnapshotStatus, 'pending_delivery' | 'cancelled'>,
    values: Partial<typeof surveyReportSnapshots.$inferInsert>,
  ): Promise<void> {
    await this.db.client
      .update(surveyReportSnapshots)
      .set({ ...values, status })
      .where(eq(surveyReportSnapshots.id, snapshotId));
  }
}

function snapshotReportKind(payload: unknown): 'intermediate' | 'final' {
  return typeof payload === 'object'
    && payload !== null
    && (payload as { reportKind?: unknown }).reportKind === 'final'
    ? 'final'
    : 'intermediate';
}
