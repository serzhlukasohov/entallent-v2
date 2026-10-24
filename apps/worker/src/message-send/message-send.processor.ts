import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, Optional } from '@nestjs/common';
import { Job } from 'bullmq';
import { SlackAdapter } from '@entalent/channel-slack';
import { OutgoingMessageSchema, type OutgoingMessage } from '@entalent/contracts';
import { WorkspaceConnectionRepository } from '../conversation/repositories/workspace-connection.repository';
import { ConversationRepository } from '../conversation/repositories/conversation.repository';
import { GroupStateRepository } from '../survey/repositories/group-state.repository';
import { OnboardingIntroService } from '../onboarding/onboarding-intro.service';
import { OnboardingService } from '../onboarding/onboarding.service';
import { QuestionInsightRepository } from '../survey/repositories/question-insight.repository';
import { QUEUE_NAMES } from '../queue/queue.module';

/** Onboarding-originated messages go to people (incl. management) who are not pulse participants. */
const ONBOARDING_MESSAGE_TYPES = new Set(['onboarding_ack', 'onboarding_intro', 'onboarding_reminder']);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export type MessageSendJob = {
  messageId: string;
  tenantId: string;
  conversationId: string;
  channelType: string;
  externalWorkspaceId: string;
  externalChannelId: string;
  replyToExternalThreadId?: string;
};

@Processor(QUEUE_NAMES.MESSAGE_SEND)
export class MessageSendProcessor extends WorkerHost {
  private readonly logger = new Logger(MessageSendProcessor.name);

  constructor(
    private readonly workspaceRepo: WorkspaceConnectionRepository,
    private readonly conversationRepo: ConversationRepository,
    private readonly groupStateRepo: GroupStateRepository,
    private readonly onboardingService: OnboardingService,
    private readonly onboardingIntro: OnboardingIntroService,
    @Optional() private readonly questionInsightRepo?: QuestionInsightRepository,
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
    const eligible = onboarding || (persisted.messageType !== undefined && ONBOARDING_MESSAGE_TYPES.has(persisted.messageType))
      ? await this.conversationRepo.isUserOnboardingEligible(
        tenantId, persisted.userId, externalWorkspaceId, channelType === 'dev' ? 'dev' : 'slack',
      )
      : await this.conversationRepo.isUserRuntimeEligible(tenantId, persisted.userId);
    if (!eligible) {
      this.logger.warn(`Skipping outbound delivery for inactive runtime user ${persisted.userId}`);
      return;
    }
    // Send-time re-check: the user may have refused or started since the reminder was queued (Q13).
    if (persisted.messageType === 'onboarding_reminder' && !persisted.sentAt) {
      const state = await this.onboardingService.contextFor(tenantId, persisted.userId);
      const participation = state?.state.participation;
      if ((participation !== 'undecided' && participation !== 'deferred') || state?.state.track === 'management') {
        this.logger.warn(`Skipping onboarding reminder ${messageId}: participation=${participation ?? 'none'}`);
        return;
      }
    }
    if (persisted.sentAt) {
      if (onboarding && persisted.externalMessageId) {
        await this.conversationRepo.completeOnboardingDelivery(messageId, tenantId, persisted.userId, persisted.sentAt, persisted.externalMessageId);
      }
      await this.activateDelivery(messageId, tenantId, conversationId, persisted.sentAt);
      // Retry after a crash between the Slack send and the onboarding transition (idempotent).
      if (persisted.externalMessageId && this.introActions(persisted.metadata)) {
        await this.onboardingService.recordIntroDelivered(
          tenantId, persisted.userId, externalChannelId, persisted.externalMessageId, persisted.sentAt,
          this.isRoleChangeIntro(persisted.metadata),
        );
      }
      await this.chainTrustMessage(job.data, persisted.metadata);
      return;
    }
    const text = persisted.text;

    this.logger.log(`Sending message ${messageId} via ${channelType}`);

    // Dev channel records delivery without writing private conversation text to logs.
    if (channelType === 'dev') {
      if (!await this.claimCommittedDelivery(messageId, tenantId, persisted.userId, conversationId)) return;
      this.logger.log(`Dev message ${messageId} delivered`);
      const devButtons = this.introActions(persisted.metadata);
      // Buttons activate like a Slack delivery: the message gets a Slack-like ts the dev console clicks against.
      const devTs = (Date.now() / 1000).toFixed(6);
      const sentAt = new Date();
      await this.recordDelivery(messageId, {
        tenantId,
        conversationId,
        externalMessageId: devButtons ? devTs : `dev:${messageId}`,
        sentAt,
      });
      if (devButtons) {
        this.logger.log(`[DEV BUTTONS] ${devButtons.map((a) => a.label).join(' | ')}`);
        await this.onboardingService.recordIntroDelivered(
          tenantId, persisted.userId, externalChannelId, devTs, sentAt, this.isRoleChangeIntro(persisted.metadata),
        );
      }
      await this.chainTrustMessage(job.data, persisted.metadata);
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
      ...(this.messageActions(persisted.metadata) ? { actions: this.messageActions(persisted.metadata) } : {}),
    };

    if (channelType === 'slack') {
      const adapter = new SlackAdapter({ botToken: wsConn.botToken });
      if (onboarding && !await this.conversationRepo.claimOnboardingDelivery(messageId, tenantId, persisted.userId)) {
        this.logger.warn(`Onboarding delivery ${messageId} is already sending or delivered; manual reconciliation may be required`);
        return;
      }
      if (!await this.claimCommittedDelivery(messageId, tenantId, persisted.userId, conversationId)) return;
      let result: Awaited<ReturnType<SlackAdapter['sendMessage']>>;
      try {
        result = await adapter.sendMessage(outgoing);
      } catch {
        // BullMQ persists failure reasons; provider errors can contain request text.
        throw new Error('outbound_delivery_failed');
      }

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
      if (this.introActions(persisted.metadata)) {
        await this.onboardingService.recordIntroDelivered(
          tenantId, persisted.userId, externalChannelId, result.externalMessageId, result.sentAt,
          this.isRoleChangeIntro(persisted.metadata),
        );
      }

      await this.chainTrustMessage(job.data, persisted.metadata);

      this.logger.log(`Message ${messageId} delivered — ts=${result.externalMessageId}`);
      return;
    }

    throw new Error(`Unsupported channel type: ${channelType}`);
  }

  /** The first intro message was delivered: release the second one (Q23 ordering). Idempotent. */
  private async chainTrustMessage(data: MessageSendJob, metadata: unknown): Promise<void> {
    if (asRecord(metadata)['onboardingIntroPart'] !== 'intro') return;
    await this.onboardingIntro.enqueueTrustAfterIntro({
      tenantId: data.tenantId, conversationId: data.conversationId, channelType: data.channelType,
      externalWorkspaceId: data.externalWorkspaceId, externalChannelId: data.externalChannelId,
      introMetadata: metadata,
    });
  }

  private messageActions(metadata: unknown): OutgoingMessage['actions'] {
    const parsed = OutgoingMessageSchema.shape.actions.safeParse(asRecord(metadata)['onboardingActions']);
    return parsed.success && parsed.data?.length ? parsed.data : undefined;
  }

  /** The trust half of an onboarding intro carries the buttons; its delivery moves onboarding forward. */
  private introActions(metadata: unknown): OutgoingMessage['actions'] {
    return asRecord(metadata)['onboardingIntroPart'] === 'trust' ? this.messageActions(metadata) : undefined;
  }

  private isRoleChangeIntro(metadata: unknown): boolean {
    return asRecord(metadata)['onboardingRoleChange'] === true;
  }

  private async claimCommittedDelivery(
    messageId: string, tenantId: string, userId: string, conversationId: string,
  ): Promise<boolean> {
    const result = await this.conversationRepo.claimCommittedMessageSendAttempt?.({
      messageId, tenantId, userId, conversationId,
    });
    if (result === 'already_started') {
      this.logger.warn(`Conversation delivery requires reconciliation: messageId=${messageId}`);
      return false;
    }
    return true;
  }

  private async recordDelivery(
    messageId: string,
    params: Parameters<ConversationRepository['updateMessageDelivery']>[1],
  ): Promise<void> {
    try {
      const deliveredAt = await this.conversationRepo.updateMessageDelivery(messageId, params);
      await this.activateDelivery(messageId, params.tenantId, params.conversationId, deliveredAt);
    } catch {
      // BullMQ persists failure reasons; repository errors may contain private message content.
      throw new Error('outbound_delivery_state_unknown');
    }
  }

  private async activateDelivery(
    messageId: string,
    tenantId: string,
    conversationId: string,
    deliveredAt: Date,
  ): Promise<void> {
    try {
      await this.groupStateRepo.activateDeliveredConfirmation({
        confirmationPromptMessageId: messageId,
        tenantId,
        conversationId,
        deliveredAt,
      });
      await this.questionInsightRepo?.activateDeliveredQuestionBundle({
        promptMessageId: messageId,
        tenantId,
        conversationId,
        deliveredAt,
      });
    } catch {
      throw new Error('outbound_delivery_state_unknown');
    }
  }
}
