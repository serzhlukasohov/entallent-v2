import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { SlackAdapter } from '@entalent/channel-slack';
import type { OutgoingMessage } from '@entalent/contracts';
import type { GroupReportPayload } from '@entalent/application';
import { GroupReportUseCase } from '@entalent/application';
import { QUEUE_NAMES } from '../queue/queue.module';
import { TeamRepository } from './repositories/team.repository';
import { WorkspaceConnectionRepository } from '../conversation/repositories/workspace-connection.repository';

@Processor(QUEUE_NAMES.GROUP_REPORT)
export class GroupReportProcessor extends WorkerHost {
  private readonly logger = new Logger(GroupReportProcessor.name);

  constructor(
    private readonly useCase: GroupReportUseCase,
    private readonly teamRepo: TeamRepository,
    private readonly wsRepo: WorkspaceConnectionRepository,
  ) {
    super();
  }

  async process(job: Job<GroupReportPayload>): Promise<void> {
    const { teamId, questionGroup, traceId } = job.data;
    this.logger.debug(`Group report for team ${teamId} group ${questionGroup} [${traceId}]`);

    const result = await this.useCase.execute({ teamId, questionGroup });

    if (!result.shouldSend) {
      this.logger.debug(
        `Threshold not met for team=${teamId} group=${questionGroup}: ${result.confirmedCount} confirmed`,
      );
      return;
    }

    if (!result.managerSlackUserId) {
      this.logger.warn(`Team ${teamId} has no manager_slack_user_id — report not sent`);
      return;
    }

    // Look up tenant for this team to find the workspace connection
    const tenantId = await this.teamRepo.findTeamTenantId(teamId);
    if (!tenantId) {
      this.logger.warn(`Cannot resolve tenantId for team=${teamId} — report not sent`);
      return;
    }

    const wsConn = await this.wsRepo.findFirstByTenant(tenantId, 'slack');
    if (!wsConn) {
      this.logger.warn(`No Slack workspace connection for tenantId=${tenantId} — report not sent`);
      return;
    }

    const outgoing: OutgoingMessage = {
      tenantId,
      conversationId: `group-report-${teamId}-${questionGroup}`,
      text: result.message,
      channel: 'slack',
      externalWorkspaceId: wsConn.externalWorkspaceId,
      externalChannelId: result.managerSlackUserId,
    };

    const adapter = new SlackAdapter({ botToken: wsConn.botToken });
    await adapter.sendMessage(outgoing);

    this.logger.log(
      `Group report sent to manager=${result.managerSlackUserId} for team=${teamId} group=${questionGroup} [${traceId}]`,
    );
  }
}
