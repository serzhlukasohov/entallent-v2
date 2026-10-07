import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { initialOnboardingState, introMessages, type PrimaryOrgRole } from '@entalent/application';
import { messages, onboardingStates } from '@entalent/database';
import { DatabaseService } from '../database/database.service';
import { QUEUE_NAMES } from '../queue/queue.module';
import type { MessageSendJob } from '../message-send/message-send.processor';
import { stableId } from './stable-id';

export interface SendIntroInput {
  tenantId: string;
  personId: string;
  role: PrimaryOrgRole;
  conversation: {
    id: string;
    channelType: string;
    externalConversationId: string;
    externalWorkspaceId: string;
  };
  /**
   * Rollout first contact: the `org_onboarding_deliveries` row id. It becomes the id of the first message,
   * so the existing claim/complete/reconciliation of that row keeps working untouched.
   */
  deliveryId?: string;
  /**
   * State version the intro belongs to; keys the stable ids. Role-change intros (no delivery row) pass the
   * version of the state they just wrote. Defaults to the current version of the person's state row.
   */
  version?: number;
}

export interface SendIntroResult {
  introMessageId: string;
  trustMessageId: string;
}

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/**
 * Approved two-message introduction (Q23). Both messages are persisted up front with deterministic ids;
 * only the first is enqueued. The second (with the buttons) is enqueued by message-send once the first is
 * delivered, so Slack shows them in order.
 */
@Injectable()
export class OnboardingIntroService {
  constructor(
    private readonly db: DatabaseService,
    @InjectQueue(QUEUE_NAMES.MESSAGE_SEND) private readonly messageSendQueue: Queue<MessageSendJob>,
  ) {}

  async sendIntro(input: SendIntroInput): Promise<SendIntroResult> {
    const { tenantId, personId, role, conversation } = input;
    const copy = introMessages(role);
    const initial = initialOnboardingState(role);

    await this.db.client.insert(onboardingStates).values({
      tenantId, personId, track: initial.track, introStatus: initial.introStatus,
      participation: initial.participation, buttonsActive: false,
    }).onConflictDoNothing();

    const version = input.version ?? await this.readVersion(tenantId, personId);
    const introId = input.deliveryId ?? stableId('onb-intro', personId, String(version), 'intro');
    let trustId = stableId('onb-intro', personId, String(version), 'trust');

    // A retried delivery must reuse the trust message its first attempt created, even if the state moved on.
    const [existing] = await this.db.client.select({ metadata: messages.metadata }).from(messages).where(and(
      eq(messages.id, introId), eq(messages.tenantId, tenantId), eq(messages.conversationId, conversation.id),
    )).limit(1);
    const storedTrustId = asRecord(existing?.metadata)['onboardingTrustMessageId'];
    if (typeof storedTrustId === 'string') trustId = storedTrustId;

    const introMetadata = {
      ...(input.deliveryId ? { onboardingDeliveryId: input.deliveryId } : {}),
      onboardingIntroPart: 'intro',
      onboardingTrustMessageId: trustId,
    };
    const trustMetadata = {
      onboardingIntroPart: 'trust',
      onboardingActions: copy.actions.map((a) => ({
        actionId: `onboarding:${a.action}`, label: a.label, value: a.action,
      })),
    };
    const now = new Date();
    const base = {
      tenantId, conversationId: conversation.id, userId: personId,
      direction: 'outbound' as const, senderType: 'agent' as const, messageType: 'onboarding_intro',
    };
    await this.db.client.insert(messages).values({
      ...base, id: introId, text: copy.intro, occurredAt: now, metadata: introMetadata,
    }).onConflictDoNothing();
    await this.db.client.insert(messages).values({
      ...base, id: trustId, text: copy.trust, occurredAt: new Date(now.getTime() + 1), metadata: trustMetadata,
    }).onConflictDoNothing();
    // A rollout message prepared by the previous model-generated flow but never sent becomes the approved intro.
    if (input.deliveryId) {
      await this.db.client.update(messages).set({
        text: copy.intro, messageType: 'onboarding_intro', metadata: introMetadata,
      }).where(and(
        eq(messages.id, introId), eq(messages.tenantId, tenantId), isNull(messages.sentAt),
        sql`${messages.metadata}->>'onboardingIntroPart' IS NULL`,
      ));
    }

    await this.messageSendQueue.add('send', this.job(introId, copy.intro, input));
    return { introMessageId: introId, trustMessageId: trustId };
  }

  /**
   * Called by message-send after the first intro message was delivered: queue the persisted second message
   * if it has not been sent yet. The deterministic job id makes a retried caller harmless.
   */
  async enqueueTrustAfterIntro(input: {
    tenantId: string;
    conversationId: string;
    channelType: string;
    externalWorkspaceId: string;
    externalChannelId: string;
    introMetadata: unknown;
  }): Promise<void> {
    const meta = asRecord(input.introMetadata);
    if (meta['onboardingIntroPart'] !== 'intro' || typeof meta['onboardingTrustMessageId'] !== 'string') return;
    const trustId = meta['onboardingTrustMessageId'];
    const [trust] = await this.db.client.select({ text: messages.text, sentAt: messages.sentAt }).from(messages).where(and(
      eq(messages.id, trustId), eq(messages.tenantId, input.tenantId),
      eq(messages.conversationId, input.conversationId), eq(messages.direction, 'outbound'),
    )).limit(1);
    if (!trust || trust.sentAt) return;
    await this.messageSendQueue.add('send', {
      messageId: trustId, tenantId: input.tenantId, conversationId: input.conversationId,
      channelType: input.channelType, externalWorkspaceId: input.externalWorkspaceId,
      externalChannelId: input.externalChannelId, text: trust.text,
    }, { jobId: `onb-trust-${trustId}` });
  }

  private job(messageId: string, text: string, input: SendIntroInput): MessageSendJob {
    return {
      messageId, tenantId: input.tenantId, conversationId: input.conversation.id,
      channelType: input.conversation.channelType,
      externalWorkspaceId: input.conversation.externalWorkspaceId,
      externalChannelId: input.conversation.externalConversationId, text,
    };
  }

  private async readVersion(tenantId: string, personId: string): Promise<number> {
    const [row] = await this.db.client.select({ version: onboardingStates.version }).from(onboardingStates).where(and(
      eq(onboardingStates.tenantId, tenantId), eq(onboardingStates.personId, personId),
    )).limit(1);
    if (!row) throw new Error('onboarding_state_missing');
    return row.version;
  }
}
