import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { SlackAdapter } from '@entalent/channel-slack';
import type { OutgoingMessage } from '@entalent/contracts';
import { WorkspaceConnectionRepository } from '../conversation/repositories/workspace-connection.repository';
import { ConversationRepository } from '../conversation/repositories/conversation.repository';
import { GroupStateRepository } from '../survey/repositories/group-state.repository';
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
    private readonly groupStateRepo: GroupStateRepository,
  ) {
    super();
  }

  async process(job: Job<MessageSendJob>): Promise<void> {
    const { messageId, channelType, externalWorkspaceId, externalChannelId, tenantId, conversationId, replyToExternalThreadId } = job.data;

    const persisted = await this.conversationRepo.findOutboundMessageForDelivery(
      messageId,
      tenantId,
      conversationId,
    );
    if (!persisted) throw new Error(`Outbound delivery scope mismatch: ${messageId}`);
    if (
      persisted.channelType !== channelType ||
      persisted.externalConversationId !== externalChannelId
    ) {
      throw new Error(`Outbound delivery route mismatch: ${messageId}`);
    }
    const onboarding = await this.conversationRepo.findOnboardingDelivery(messageId, tenantId, persisted.userId);
    if (onboarding && persisted.onboardingDeliveryId !== messageId) {
      throw new Error(`Onboarding message binding mismatch: ${messageId}`);
    }
    if (onboarding && onboarding.externalWorkspaceId !== externalWorkspaceId) {
      throw new Error(`Onboarding workspace mismatch: ${messageId}`);
    }
    const onboardingControl = persisted.metadata?.['onboardingControl'] === true;
    if (persisted.metadata?.['onboardingReminder'] === true && !await this.conversationRepo.isOnboardingReminderAllowed(tenantId, persisted.userId)) return;
    const eligible = onboarding || onboardingControl
      ? await this.conversationRepo.isUserOnboardingEligible(tenantId, persisted.userId, externalWorkspaceId)
      : await this.conversationRepo.isUserRuntimeEligible(tenantId, persisted.userId) ||
        await this.conversationRepo.isUserOnboardingEligible?.(tenantId, persisted.userId, externalWorkspaceId);
    if (!eligible) {
      this.logger.warn(`Skipping outbound delivery for inactive runtime user ${persisted.userId}`);
      return;
    }
    if (persisted.sentAt) {
      if (onboarding && persisted.externalMessageId) {
        await this.conversationRepo.completeOnboardingDelivery(messageId, tenantId, persisted.userId, persisted.sentAt, persisted.externalMessageId);
      }
      await this.activateDelivery(messageId, tenantId, conversationId, persisted.sentAt);
      return;
    }
    const text = persisted.text;

    this.logger.log(`Sending message ${messageId} via ${channelType}`);

    // Dev channel: log the AI response instead of sending it anywhere.
    if (channelType === 'dev') {
      this.logger.log(`[DEV RESPONSE] messageId=${messageId}\n${text}`);
      await this.recordDelivery(messageId, {
        tenantId,
        conversationId,
        externalMessageId: `dev:${messageId}`,
        sentAt: new Date(),
      });
      return;
    }

    const wsConn = await this.workspaceRepo.findByExternalWorkspace(
      channelType,
      externalWorkspaceId,
      tenantId,
    );
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
      metadata: persisted.metadata,
    };

    if (channelType === 'slack') {
      const adapter = new SlackAdapter({ botToken: wsConn.botToken });
      if (onboarding && !await this.conversationRepo.claimOnboardingDelivery(messageId, tenantId, persisted.userId)) {
        this.logger.warn(`Onboarding delivery ${messageId} is already sending or delivered; manual reconciliation may be required`);
        return;
      }
      const result = await adapter.sendMessage(outgoing);

      await this.recordDelivery(messageId, {
        tenantId,
        conversationId,
        externalMessageId: result.externalMessageId,
        externalThreadId: result.externalThreadId,
        sentAt: result.sentAt,
      });
      if (onboarding) {
        await this.conversationRepo.completeOnboardingDelivery(messageId, tenantId, persisted.userId, result.sentAt, result.externalMessageId);
      }

      this.logger.log(`Message ${messageId} delivered — ts=${result.externalMessageId}`);
      return;
    }

    throw new Error(`Unsupported channel type: ${channelType}`);
  }

  private async recordDelivery(
    messageId: string,
    params: Parameters<ConversationRepository['updateMessageDelivery']>[1],
  ): Promise<void> {
    const deliveredAt = await this.conversationRepo.updateMessageDelivery(messageId, params);
    await this.activateDelivery(messageId, params.tenantId, params.conversationId, deliveredAt);
  }

  private async activateDelivery(
    messageId: string,
    tenantId: string,
    conversationId: string,
    deliveredAt: Date,
  ): Promise<void> {
    await this.groupStateRepo.activateDeliveredConfirmation({
      confirmationPromptMessageId: messageId,
      tenantId,
      conversationId,
      deliveredAt,
    });
  }
}
