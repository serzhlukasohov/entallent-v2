import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { and, desc, eq } from 'drizzle-orm';
import type { OnboardingEffectsPort } from '@entalent/application';
import { SlackAdapter } from '@entalent/channel-slack';
import type { OnboardingReminderJob } from '@entalent/contracts';
import { channelAccounts, conversations, messages } from '@entalent/database';
import { DatabaseService } from '../database/database.service';
import { QUEUE_NAMES } from '../queue/queue.module';
import type { MessageSendJob } from '../message-send/message-send.processor';
import type { CheckInJob } from '../conversation/conversation.processor';
import { WorkspaceConnectionRepository } from '../conversation/repositories/workspace-connection.repository';
import { stableId } from './stable-id';

@Injectable()
export class OnboardingEffectsService implements OnboardingEffectsPort {
  private readonly logger = new Logger(OnboardingEffectsService.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.ONBOARDING_REMINDER) private readonly reminderQueue: Queue<OnboardingReminderJob>,
    @InjectQueue(QUEUE_NAMES.CONVERSATION) private readonly conversationQueue: Queue<CheckInJob>,
    private readonly db: DatabaseService,
    @InjectQueue(QUEUE_NAMES.MESSAGE_SEND) private readonly messageSendQueue: Queue<MessageSendJob>,
    private readonly workspaceRepo: WorkspaceConnectionRepository,
  ) {}

  async scheduleReminder(input: { tenantId: string; personId: string; dueAt: Date }): Promise<void> {
    await this.reminderQueue.add('remind', {
      tenantId: input.tenantId, personId: input.personId, dueAt: input.dueAt.toISOString(),
    }, {
      delay: Math.max(0, input.dueAt.getTime() - Date.now()),
      jobId: `onb-rem:${input.personId}:${input.dueAt.getTime()}`,
    });
  }

  /** Rewrites the intro message without buttons. Failures are logged, never thrown (the state change is already committed). */
  async replaceIntroActions(input: { tenantId: string; personId: string; channelId: string; messageTs: string; text: string }): Promise<void> {
    try {
      const account = await this.workspaceRepo.findSlackAccountByUserId(input.personId, input.tenantId);
      const connection = account
        ? await this.workspaceRepo.findByExternalWorkspace('slack', account.externalWorkspaceId, input.tenantId)
        : null;
      if (!connection) {
        this.logger.warn(`No Slack workspace connection to replace intro actions person=${input.personId}`);
        return;
      }
      await new SlackAdapter({ botToken: connection.botToken }).updateMessage({
        tenantId: input.tenantId,
        externalChannelId: input.channelId,
        externalMessageId: input.messageTs,
        text: input.text,
      });
    } catch (error) {
      this.logger.error(`replaceIntroActions failed person=${input.personId}: ${(error as Error).message}`);
    }
  }

  async sendAcknowledgement(input: { tenantId: string; personId: string; text: string; dedupeKey: string }): Promise<void> {
    const target = await this.findTarget(input.tenantId, input.personId);
    if (!target) {
      this.logger.warn(`No active conversation for onboarding ack person=${input.personId}`);
      return;
    }
    const messageId = stableId('onb-ack', input.dedupeKey);
    await this.db.client.insert(messages).values({
      id: messageId, tenantId: input.tenantId, conversationId: target.conversationId, userId: input.personId,
      direction: 'outbound', senderType: 'agent', text: input.text, messageType: 'onboarding_ack',
      occurredAt: new Date(), metadata: {},
    }).onConflictDoNothing();
    // Same job name/payload as OutboxService.enqueueMessageSend.
    await this.messageSendQueue.add('send', {
      messageId, tenantId: input.tenantId, conversationId: target.conversationId,
      channelType: target.channelType, externalWorkspaceId: target.externalWorkspaceId,
      externalChannelId: target.externalConversationId, text: input.text,
      replyToExternalThreadId: undefined,
    });
  }

  async startConversation(input: { tenantId: string; personId: string; dedupeKey: string }): Promise<void> {
    const target = await this.findTarget(input.tenantId, input.personId);
    if (!target) {
      this.logger.warn(`No active conversation to start onboarding person=${input.personId}`);
      return;
    }
    await this.conversationQueue.add('check-in', {
      conversationId: target.conversationId, userId: input.personId, tenantId: input.tenantId,
      externalWorkspaceId: target.externalWorkspaceId, externalConversationId: target.externalConversationId,
      traceId: `onboarding-start:${input.dedupeKey}`, onboardingStart: true,
    }, { jobId: `onb-start:${input.dedupeKey}` });
  }

  private async findTarget(tenantId: string, personId: string) {
    const [conversation] = await this.db.client.select({
      conversationId: conversations.id, channelType: conversations.channelType,
      externalConversationId: conversations.externalConversationId,
    }).from(conversations).where(and(
      eq(conversations.tenantId, tenantId), eq(conversations.userId, personId), eq(conversations.status, 'active'),
    )).orderBy(desc(conversations.updatedAt)).limit(1);
    if (!conversation) return null;
    const [account] = await this.db.client.select({ externalWorkspaceId: channelAccounts.externalWorkspaceId })
      .from(channelAccounts).where(and(
        eq(channelAccounts.tenantId, tenantId), eq(channelAccounts.userId, personId),
        eq(channelAccounts.channelType, conversation.channelType), eq(channelAccounts.linkStatus, 'linked'),
      )).limit(1);
    if (!account) return null;
    return { ...conversation, externalWorkspaceId: account.externalWorkspaceId };
  }
}
