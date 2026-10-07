import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { and, desc, eq } from 'drizzle-orm';
import type { OnboardingEffectsPort } from '@entalent/application';
import type { OnboardingReminderJob } from '@entalent/contracts';
import { channelAccounts, conversations, messages } from '@entalent/database';
import { DatabaseService } from '../database/database.service';
import { QUEUE_NAMES } from '../queue/queue.module';
import { OutboxService } from '../conversation/outbox.service';
import type { CheckInJob } from '../conversation/conversation.processor';
import { stableId } from './stable-id';

@Injectable()
export class OnboardingEffectsService implements OnboardingEffectsPort {
  private readonly logger = new Logger(OnboardingEffectsService.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.ONBOARDING_REMINDER) private readonly reminderQueue: Queue<OnboardingReminderJob>,
    @InjectQueue(QUEUE_NAMES.CONVERSATION) private readonly conversationQueue: Queue<CheckInJob>,
    private readonly db: DatabaseService,
    private readonly outbox: OutboxService,
  ) {}

  async scheduleReminder(input: { tenantId: string; personId: string; dueAt: Date }): Promise<void> {
    await this.reminderQueue.add('remind', {
      tenantId: input.tenantId, personId: input.personId, dueAt: input.dueAt.toISOString(),
    }, {
      delay: Math.max(0, input.dueAt.getTime() - Date.now()),
      jobId: `onb-rem:${input.personId}:${input.dueAt.getTime()}`,
    });
  }

  async replaceIntroActions(input: { tenantId: string; personId: string; channelId: string; messageTs: string; text: string }): Promise<void> {
    // Slack implementation lands with the interactive-actions task.
    this.logger.log(`replaceIntroActions deferred person=${input.personId} channel=${input.channelId}`);
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
    await this.outbox.enqueueMessageSend({
      messageId, tenantId: input.tenantId, conversationId: target.conversationId,
      channelType: target.channelType, externalWorkspaceId: target.externalWorkspaceId,
      externalChannelId: target.externalConversationId, text: input.text,
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
