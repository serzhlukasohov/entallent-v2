import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { buildV2IndexReport, selectV2CohortReportInputs, V2_REPORT_CALCULATION_VERSION } from '@entalent/application';
import type { V2IndexReport } from '@entalent/application';
import { SlackAdapter } from '@entalent/channel-slack';
import type { OutgoingMessage } from '@entalent/contracts';
import type { Env } from '@entalent/config';
import { QUEUE_NAMES } from '../queue/queue.module';
import { WorkspaceConnectionRepository } from '../conversation/repositories/workspace-connection.repository';
import { TeamRepository } from './repositories/team.repository';
import { V2CohortReportInputRepository } from './repositories/v2-cohort-report-input.repository';
import { V2ReportSnapshotRepository } from './repositories/v2-report-snapshot.repository';

const V2_GROUPS = ['autonomy', 'growth', 'purpose', 'belonging'] as const;

export interface V2ReportJob {
  tenantId: string;
  reportingCohortId: string;
  teamId: string;
  questionGroup: string;
  reportKind: 'intermediate' | 'final';
}

@Processor(QUEUE_NAMES.V2_REPORT)
export class V2ReportProcessor extends WorkerHost {
  private readonly logger = new Logger(V2ReportProcessor.name);

  constructor(
    private readonly inputs: V2CohortReportInputRepository,
    private readonly snapshots: V2ReportSnapshotRepository,
    private readonly teams: TeamRepository,
    private readonly workspaces: WorkspaceConnectionRepository,
    private readonly config: ConfigService<Env, true>,
  ) { super(); }

  async process(job: Job<V2ReportJob>): Promise<void> {
    const payload = job.data;
    if (!payload.tenantId?.trim() || !payload.reportingCohortId?.trim() || !payload.teamId?.trim()
      || !['intermediate', 'final'].includes(payload.reportKind)
      || (payload.reportKind === 'final' ? payload.questionGroup !== 'cycle'
        : !V2_GROUPS.includes(payload.questionGroup as typeof V2_GROUPS[number]))) {
      throw new Error('v2_report_job_invalid_scope');
    }
    if (this.config.get('V2_REPORT_SEND_TENANT_ID', { infer: true }) !== payload.tenantId
      || this.config.get('V2_REPORT_SEND_CALCULATION_VERSION', { infer: true }) !== V2_REPORT_CALCULATION_VERSION) {
      this.logger.warn(`V2 report delivery is disabled for tenant=${payload.tenantId}`);
      return;
    }
    const now = new Date();
    const report = await this.collect(payload, now);
    if (!report) return;
    const latest = await this.snapshots.findLatest(payload);
    // ponytail: publish only the first intermediate snapshot; add versioned updates if product needs them.
    if (latest) return;

    const [team, workspace] = await Promise.all([
      this.teams.findTeamById(payload.teamId, payload.tenantId, payload.reportingCohortId),
      this.workspaces.findFirstByTenant(payload.tenantId, 'slack'),
    ]);
    if (!team?.managerSlackUserId || !workspace) return;
    const fresh = await this.collect(payload, new Date());
    if (!fresh || fresh.fingerprint !== report.fingerprint) return;
    const snapshotId = await this.snapshots.createPending({
      ...payload, snapshotVersion: 1, managerPayload: { message: report.message },
      contributorUserIds: report.contributorUserIds,
      sourceQuestionInsightIds: report.sourceQuestionInsightIds,
      policyVersion: report.policyVersion,
      calculationVersion: V2_REPORT_CALCULATION_VERSION,
      workspaceConnectionId: workspace.id,
      managerSlackChannelId: team.managerSlackUserId,
    });
    if (!snapshotId) return;

    const [currentTeam, currentWorkspace, currentReport] = await Promise.all([
      this.teams.findTeamById(payload.teamId, payload.tenantId, payload.reportingCohortId),
      this.workspaces.findFirstByTenant(payload.tenantId, 'slack'),
      this.collect(payload, new Date()),
    ]);
    if (currentTeam?.managerSlackUserId !== team.managerSlackUserId
      || currentWorkspace?.id !== workspace.id
      || currentReport?.fingerprint !== report.fingerprint) {
      await this.snapshots.markCancelled(snapshotId, 'v2_report_scope_or_target_changed');
      return;
    }
    const outgoing: OutgoingMessage = {
      tenantId: payload.tenantId,
      conversationId: `v2-report-${payload.teamId}-${payload.questionGroup}`,
      text: report.message,
      channel: 'slack',
      externalWorkspaceId: currentWorkspace.externalWorkspaceId,
      externalChannelId: team.managerSlackUserId,
    };
    const adapter = new SlackAdapter({ botToken: currentWorkspace.botToken });
    const attemptedAt = new Date();
    try {
      const receipt = await adapter.sendMessage(outgoing);
      await this.snapshots.markDelivered(snapshotId, receipt.externalMessageId, receipt.sentAt);
    } catch {
      await this.snapshots.markDeliveryUnknown(snapshotId, attemptedAt);
      this.logger.warn(`V2 report delivery unknown for snapshot=${snapshotId}`);
    }
  }

  private async collect(payload: V2ReportJob, now: Date): Promise<{
    message: string;
    contributorUserIds: string[];
    sourceQuestionInsightIds: string[];
    policyVersion: string;
    fingerprint: string;
  } | null> {
    const groups = payload.reportKind === 'final' ? V2_GROUPS : [payload.questionGroup];
    const reports: V2IndexReport[] = [];
    let periodEnd: number | null = null;
    for (const group of groups) {
      const scope = await this.inputs.load({
        tenantId: payload.tenantId, reportingCohortId: payload.reportingCohortId, questionGroup: group,
      });
      if (!scope || scope.teamId !== payload.teamId || (periodEnd !== null && scope.periodEnd.getTime() !== periodEnd)) {
        return null;
      }
      periodEnd = scope.periodEnd.getTime();
      if (payload.reportKind === 'intermediate' && now >= scope.periodEnd) return null;
      const selection = selectV2CohortReportInputs(scope, payload.reportKind, now);
      const report = buildV2IndexReport({ scope, selection, questionGroup: group, reportKind: payload.reportKind });
      if (report) reports.push(report);
    }
    if (!reports.length || new Set(reports.map((report) => report.policyVersion)).size !== 1) return null;
    const contributorUserIds = [...new Set(reports.flatMap((report) => report.contributorUserIds))].sort();
    const sourceQuestionInsightIds = [...new Set(reports.flatMap((report) => report.sourceQuestionInsightIds))].sort();
    const policyVersion = reports[0]!.policyVersion;
    return {
      message: reports.map((report) => report.message).join('\n\n'),
      contributorUserIds, sourceQuestionInsightIds, policyVersion,
      fingerprint: JSON.stringify([contributorUserIds, sourceQuestionInsightIds, policyVersion]),
    };
  }
}
