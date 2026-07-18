import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { SlackAdapter } from '@entalent/channel-slack';
import type { OutgoingMessage } from '@entalent/contracts';
import { WorkspaceConnectionRepository } from '../conversation/repositories/workspace-connection.repository';
import { ConversationRepository } from '../conversation/repositories/conversation.repository';
import { QUEUE_NAMES } from '../queue/queue.module';

export type MessageSendJob = {
  messageId: string;
  tenantId: string;
  conversationId: string;
  channelType: string;
  externalWorkspaceId: string;
  externalChannelId: string;
  text: string;
  replyToExternalThreadId?: string;
};

@Processor(QUEUE_NAMES.MESSAGE_SEND)
export class MessageSendProcessor extends WorkerHost {
  private readonly logger = new Logger(MessageSendProcessor.name);

  constructor(
    private readonly workspaceRepo: WorkspaceConnectionRepository,
    private readonly conversationRepo: ConversationRepository,
  ) {
    super();
  }

  async process(job: Job<MessageSendJob>): Promise<void> {
    const { messageId, channelType, externalWorkspaceId, externalChannelId, tenantId, conversationId, text, replyToExternalThreadId } = job.data;

    this.logger.log(`Sending message ${messageId} via ${channelType}`);

    // Dev channel: log the AI response instead of sending it anywhere.
    if (channelType === 'dev') {
      this.logger.log(`[DEV RESPONSE] messageId=${messageId}\n${text}`);
      return;
    }

    const wsConn = await this.workspaceRepo.findByExternalWorkspace(channelType, externalWorkspaceId);
    if (!wsConn) {
      throw new Error(`Workspace connection not found: channelType=${channelType} workspaceId=${externalWorkspaceId}`);
    }

    const outgoing: OutgoingMessage = {
      tenantId,
      conversationId,
      text,
      channel: channelType as OutgoingMessage['channel'],
      externalWorkspaceId,
      externalChannelId,
      replyToExternalThreadId,
    };

    if (channelType === 'slack') {
      const adapter = new SlackAdapter({ botToken: wsConn.botToken });
      const result = await adapter.sendMessage(outgoing);

      await this.conversationRepo.updateMessageDelivery(messageId, {
        externalMessageId: result.externalMessageId,
        externalThreadId: result.externalThreadId,
        sentAt: result.sentAt,
      });

      this.logger.log(`Message ${messageId} delivered — ts=${result.externalMessageId}`);
      return;
    }

    throw new Error(`Unsupported channel type: ${channelType}`);
  }
}
