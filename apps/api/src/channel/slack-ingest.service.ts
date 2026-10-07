import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { normalizeSlackEvent } from '@entalent/channel-slack';
import { IngestionService } from './ingestion.service';
import { EventIdempotencyService } from './event-idempotency.service';
import { QUEUE_NAMES } from '../queue/queue.module';
import type { OnboardingActionJob, OnboardingSystemJob } from '@entalent/contracts';
import type { ConversationJob } from '../queue/queue.types';
import { handleSlackInteraction } from './slack-interaction';

const CONVERSATION_DELAY_MS = 2_000;

/**
 * Shared pipeline consumed by both the HTTP webhook controller and the
 * Socket Mode service. Handles idempotency, user/conversation bootstrap,
 * message persistence, and job enqueueing.
 */
@Injectable()
export class SlackIngestService {
  private readonly logger = new Logger(SlackIngestService.name);

  constructor(
    private readonly ingestion: IngestionService,
    private readonly idempotency: EventIdempotencyService,
    @InjectQueue(QUEUE_NAMES.CONVERSATION) private readonly conversationQueue: Queue<ConversationJob>,
    @InjectQueue(QUEUE_NAMES.ONBOARDING_ACTION) private readonly onboardingActionQueue: Queue<OnboardingActionJob | OnboardingSystemJob>,
  ) {}

  async processBody(body: Record<string, unknown>): Promise<void> {
    // Interactions carry no event_id; their dedupe is the onboarding action jobId.
    const isInteraction = body['type'] === 'block_actions';
    const eventId = body['event_id'] as string | undefined;
    if (!isInteraction && eventId && !(await this.idempotency.isNew(eventId))) {
      this.logger.debug(`Duplicate Slack event — skipping: ${eventId}`);
      return;
    }

    const teamId = (body['team_id'] as string | undefined)
      ?? ((body['team'] as { id?: string } | undefined)?.id)
      ?? '';
    const workspaceIdentity = await this.ingestion.findWorkspaceIdentity('slack', teamId);
    if (!workspaceIdentity) {
      this.logger.warn(`Unknown Slack workspace: ${teamId}`);
      return;
    }

    const rawEvent = body['event'] as Record<string, unknown> | undefined;
    const events = normalizeSlackEvent({ body, tenantId: workspaceIdentity.tenantId });

    for (const event of events) {
      if (event.type === 'interaction') {
        await handleSlackInteraction(event, {
          findWorkspaceIdentity: (channelType, workspaceId) => this.ingestion.findWorkspaceIdentity(channelType, workspaceId),
          findLinkedPersonId: (params) => this.ingestion.findLinkedPersonId(params),
          findOnboardingIntroTarget: (tenantId, personId) => this.ingestion.findOnboardingIntroTarget(tenantId, personId),
          queue: this.onboardingActionQueue,
          debug: (message) => this.logger.debug(message),
        });
        continue;
      }
      if (event.type !== 'message') continue;

      if (rawEvent?.['bot_id'] || rawEvent?.['subtype'] === 'bot_message') continue;

      const payload = event.payload;
      const requestId = randomUUID();
      const traceId = randomUUID();

      const { userId, runtimeEligible } = await this.ingestion.findOrCreateUser({
        tenantId: workspaceIdentity.tenantId,
        channelType: 'slack',
        externalWorkspaceId: payload.externalWorkspaceId,
        externalUserId: payload.externalUserId,
      });
      if (!runtimeEligible) {
        this.logger.debug(`Inbound Slack user is not active for runtime: ${userId}`);
        continue;
      }

      const { conversationId } = await this.ingestion.findOrCreateConversation({
        tenantId: workspaceIdentity.tenantId,
        userId,
        channelType: 'slack',
        externalConversationId: payload.externalConversationId,
      });

      const { messageId } = await this.ingestion.saveInboundMessage({
        conversationId,
        tenantId: workspaceIdentity.tenantId,
        userId,
        text: payload.text,
        externalMessageId: rawEvent?.['ts'] as string | undefined,
        externalThreadId: payload.externalThreadId,
        occurredAt: payload.timestamp,
        traceId,
      });

      await this.conversationQueue.add(
        'process',
        {
          requestId,
          eventId: eventId ?? String(rawEvent?.['ts'] ?? requestId),
          messageId,
          conversationId,
          userId,
          tenantId: workspaceIdentity.tenantId,
          externalWorkspaceId: payload.externalWorkspaceId,
          externalConversationId: payload.externalConversationId,
          traceId,
          rapidMessageCoalescing: true,
        },
        { delay: CONVERSATION_DELAY_MS },
      );

      this.logger.log(`Enqueued conversation job traceId=${traceId} messageId=${messageId}`);
    }
  }
}
