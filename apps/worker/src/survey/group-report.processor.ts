import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { SlackAdapter } from '@entalent/channel-slack';
import type { OutgoingMessage } from '@entalent/contracts';
import type { GroupReportPayload, GroupReportResult } from '@entalent/application';
import { GroupReportUseCase } from '@entalent/application';
import { QUEUE_NAMES } from '../queue/queue.module';
import { WorkspaceConnectionRepository } from '../conversation/repositories/workspace-connection.repository';
import { GroupReportSnapshotRepository } from './repositories/group-report-snapshot.repository';
import { TeamRepository } from './repositories/team.repository';

const MIN_CHANGED_INPUTS_FOR_NEXT_INTERMEDIATE_SNAPSHOT = 5;

@Processor(QUEUE_NAMES.GROUP_REPORT)
export class GroupReportProcessor extends WorkerHost {
  private readonly logger = new Logger(GroupReportProcessor.name);

  constructor(
    private readonly useCase: GroupReportUseCase,
    private readonly wsRepo: WorkspaceConnectionRepository,
    private readonly snapshotRepo: GroupReportSnapshotRepository,
    private readonly teamRepo: TeamRepository,
  ) {
    super();
  }

  async process(job: Job<GroupReportPayload>): Promise<void> {
    const { reportingCohortId, tenantId, teamId, questionGroup, traceId } = job.data;
    const reportKind = job.data.reportKind ?? 'intermediate';
    if (!reportingCohortId || !tenantId || !teamId || !questionGroup) {
      this.logger.warn(`Group report job ${job.id ?? 'unknown'} is missing tenant/team/cycle scope`);
      return;
    }
    this.logger.debug(`Group report for team ${teamId} group ${questionGroup} [${traceId}]`);

    const reportGroups = reportKind === 'final' && questionGroup === 'cycle' && job.data.questionGroups?.length
      ? job.data.questionGroups
      : [questionGroup];
    const results: GroupReportResult[] = [];
    for (const group of reportGroups) {
      results.push(await this.useCase.execute({
        reportingCohortId,
        tenantId,
        teamId,
        questionGroup: group,
        ...(reportKind === 'final' ? { reportKind } : {}),
      }));
    }
    const sendableResults = results.filter((candidate) => candidate.shouldSend);
    const result = reportGroups.length === 1
      ? results[0]
      : sendableResults.length > 0
        ? aggregateFinalCycleResults(sendableResults)
        : results[0];

    if (!result.shouldSend) {
      this.logger.debug(
        `Threshold not met for team=${teamId} group=${questionGroup}: ${result.confirmedCount} confirmed`,
      );
      return;
    }

    const latestSnapshot = await this.snapshotRepo.findLatestNonCancelledSnapshot({
      tenantId,
      reportingCohortId,
      questionGroup,
    });
    const snapshotVersion = nextSnapshotVersion(reportKind, latestSnapshot, result);
    if (!snapshotVersion) {
      this.logger.debug(
        `Group report snapshot blocked for team=${teamId} group=${questionGroup} [${traceId}]`,
      );
      return;
    }

    if (!result.managerSlackUserId) {
      this.logger.warn(`Team ${teamId} has no manager_slack_user_id — report not sent`);
      await this.recordCancelled(job.data, result, snapshotVersion, 'manager_target_missing');
      return;
    }

    const wsConn = await this.wsRepo.findFirstByTenant(tenantId, 'slack');
    if (!wsConn) {
      this.logger.warn(`No Slack workspace connection for tenantId=${tenantId} — report not sent`);
      await this.recordCancelled(job.data, result, snapshotVersion, 'workspace_connection_missing');
      return;
    }

    const snapshotId = await this.snapshotRepo.createPendingSnapshot({
      tenantId,
      reportingCohortId,
      teamId,
      questionGroup,
      snapshotVersion,
      payload: {
        reportKind,
        message: result.message,
        teamScore: result.teamScore,
        confirmedCount: result.confirmedCount,
      },
      contributorUserIds: result.contributorUserIds,
      sourceGroupStateIds: result.sourceGroupStateIds,
      policyVersion: result.policyVersion,
      workspaceConnectionId: wsConn.id,
      managerSlackUserId: result.managerSlackUserId,
    });
    if (!snapshotId) {
      this.logger.debug(
        `Group report snapshot already exists for team=${teamId} group=${questionGroup} [${traceId}]`,
      );
      return;
    }

    const currentWsConn = await this.wsRepo.findFirstByTenant(tenantId, 'slack');
    if (!currentWsConn || currentWsConn.id !== wsConn.id) {
      await this.snapshotRepo.markCancelled(snapshotId, 'workspace_connection_changed');
      this.logger.warn(`Slack workspace binding changed for tenantId=${tenantId} — report not sent`);
      return;
    }
    const currentTeam = await this.teamRepo.findTeamById(teamId, tenantId, reportingCohortId);
    if (currentTeam?.managerSlackUserId !== result.managerSlackUserId) {
      await this.snapshotRepo.markCancelled(snapshotId, 'manager_target_changed');
      this.logger.warn(`Manager Slack binding changed for team=${teamId} — report not sent`);
      return;
    }
    const outgoing: OutgoingMessage = {
      tenantId,
      conversationId: `group-report-${teamId}-${questionGroup}`,
      text: result.message,
      channel: 'slack',
      externalWorkspaceId: currentWsConn.externalWorkspaceId,
      externalChannelId: result.managerSlackUserId,
    };

    const adapter = new SlackAdapter({ botToken: currentWsConn.botToken });
    const deliveryAttemptedAt = new Date();
    try {
      const receipt = await adapter.sendMessage(outgoing);
      if (!receipt.externalMessageId.trim()) throw new Error('slack_external_message_id_missing');
      await this.snapshotRepo.markDelivered(snapshotId, receipt.externalMessageId, receipt.sentAt);
    } catch (error) {
      await this.snapshotRepo.markDeliveryUnknown(snapshotId, errorMessage(error), deliveryAttemptedAt);
      this.logger.warn(
        `Group report delivery unknown for snapshot=${snapshotId} team=${teamId} group=${questionGroup} [${traceId}]`,
      );
      return;
    }

    this.logger.log(
      `Group report sent to manager=${result.managerSlackUserId} for team=${teamId} group=${questionGroup} [${traceId}]`,
    );
  }

  private async recordCancelled(
    payload: GroupReportPayload,
    result: Awaited<ReturnType<GroupReportUseCase['execute']>>,
    snapshotVersion: number,
    failureReason: string,
    workspaceConnectionId?: string,
  ): Promise<void> {
    await this.snapshotRepo.recordCancelledSnapshot({
      tenantId: payload.tenantId,
      reportingCohortId: payload.reportingCohortId,
      teamId: payload.teamId,
      questionGroup: payload.questionGroup,
      snapshotVersion,
      payload: {
        reportKind: payload.reportKind ?? 'intermediate',
        message: result.message,
        teamScore: result.teamScore,
        confirmedCount: result.confirmedCount,
      },
      contributorUserIds: result.contributorUserIds,
      sourceGroupStateIds: result.sourceGroupStateIds,
      policyVersion: result.policyVersion,
      workspaceConnectionId,
      managerSlackUserId: result.managerSlackUserId,
      failureReason,
    });
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function aggregateFinalCycleResults(results: GroupReportResult[]): GroupReportResult {
  const managerSlackUserId = results.every((result) => result.managerSlackUserId === results[0].managerSlackUserId)
    ? results[0].managerSlackUserId
    : null;
  return {
    shouldSend: true,
    managerSlackUserId,
    message: results.map((result) => result.message).join('\n\n'),
    teamScore: Math.round((results.reduce((sum, result) => sum + result.teamScore, 0) / results.length) * 100) / 100,
    confirmedCount: results.reduce((sum, result) => sum + result.confirmedCount, 0),
    contributorUserIds: [...new Set(results.flatMap((result) => result.contributorUserIds))],
    sourceGroupStateIds: results.flatMap((result) => result.sourceGroupStateIds),
    policyVersion: results[0].policyVersion,
  };
}

function nextSnapshotVersion(
  reportKind: 'intermediate' | 'final',
  latestSnapshot: {
    snapshotVersion: number;
    status: string;
    reportKind?: 'intermediate' | 'final';
    contributorUserIds: string[];
    sourceGroupStateIds: string[];
  } | null,
  result: Pick<GroupReportResult, 'contributorUserIds' | 'sourceGroupStateIds'>,
): number | null {
  if (!latestSnapshot) return 1;
  if (latestSnapshot.status !== 'delivered') return null;
  if (latestSnapshot.reportKind === 'final') return null;
  if (reportKind === 'final') return latestSnapshot.snapshotVersion + 1;

  const previousInputByUser = new Map(
    latestSnapshot.contributorUserIds.map((userId, index) => [
      userId,
      latestSnapshot.sourceGroupStateIds[index],
    ]),
  );
  const changedUserIds = result.contributorUserIds.filter(
    (userId, index) => previousInputByUser.get(userId) !== result.sourceGroupStateIds[index],
  );

  if (new Set(changedUserIds).size < MIN_CHANGED_INPUTS_FOR_NEXT_INTERMEDIATE_SNAPSHOT) return null;
  return latestSnapshot.snapshotVersion + 1;
}
