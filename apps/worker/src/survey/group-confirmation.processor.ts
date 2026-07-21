import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { SlackAdapter } from '@entalent/channel-slack';
import type { OutgoingMessage } from '@entalent/contracts';
import type { GroupConfirmationPayload } from '@entalent/application';
import { QUEUE_NAMES } from '../queue/queue.module';
import { GroupStateRepository } from './repositories/group-state.repository';
import { WorkspaceConnectionRepository } from '../conversation/repositories/workspace-connection.repository';

@Processor(QUEUE_NAMES.GROUP_CONFIRMATION)
export class GroupConfirmationProcessor extends WorkerHost {
  private readonly logger = new Logger(GroupConfirmationProcessor.name);

  constructor(
    private readonly groupStateRepo: GroupStateRepository,
    private readonly wsRepo: WorkspaceConnectionRepository,
  ) {
    super();
  }

  async process(job: Job<GroupConfirmationPayload>): Promise<void> {
    const { surveyWindowId, userId, tenantId, questionGroup, traceId } = job.data;
    this.logger.debug(
      `Group confirmation for user ${userId} group ${questionGroup} [${traceId}]`,
    );

    // 1. Load the saved AI summary from the group state
    const groupState = await this.groupStateRepo.findGroupState(userId, surveyWindowId, questionGroup);
    if (!groupState?.aiSummary) {
      this.logger.warn(
        `No group state / aiSummary for user=${userId} window=${surveyWindowId} group=${questionGroup} — skipping`,
      );
      return;
    }

    // 2. Get user's Slack account
    const slackAccount = await this.wsRepo.findSlackAccountByUserId(userId, tenantId);
    if (!slackAccount) {
      this.logger.warn(`No Slack account for user=${userId} tenantId=${tenantId} — skipping`);
      return;
    }

    // 3. Get workspace connection (bot token)
    const wsConn = await this.wsRepo.findByExternalWorkspace('slack', slackAccount.externalWorkspaceId);
    if (!wsConn) {
      this.logger.warn(
        `No workspace connection for externalWorkspaceId=${slackAccount.externalWorkspaceId} — skipping`,
      );
      return;
    }

    // 4. Send DM via SlackAdapter — Slack accepts user IDs as DM channel targets
    const outgoing: OutgoingMessage = {
      tenantId,
      conversationId: `group-confirm-${surveyWindowId}-${questionGroup}`,
      text: groupState.aiSummary,
      channel: 'slack',
      externalWorkspaceId: slackAccount.externalWorkspaceId,
      externalChannelId: slackAccount.externalUserId,
    };

    const adapter = new SlackAdapter({ botToken: wsConn.botToken });
    await adapter.sendMessage(outgoing);

    this.logger.log(
      `Group confirmation sent to user=${userId} group=${questionGroup} [${traceId}]`,
    );
  }
}
