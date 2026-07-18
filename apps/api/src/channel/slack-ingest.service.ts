import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { normalizeSlackEvent } from '@entalent/channel-slack';
import { IngestionService } from './ingestion.service';
import { EventIdempotencyService } from './event-idempotency.service';
import { QUEUE_NAMES } from '../queue/queue.module';
import type { ConversationJob } from '../queue/queue.types';

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
  ) {}

  async processBody(body: Record<string, unknown>): Promise<void> {
    const eventId = body['event_id'] as string | undefined;
    if (eventId && !(await this.idempotency.isNew(eventId))) {
      this.logger.debug(`Duplicate Slack event — skipping: ${eventId}`);
      return;
    }

    const teamId = (body['team_id'] as string | undefined) ?? '';
    const workspaceIdentity = await this.ingestion.findWorkspaceIdentity('slack', teamId);
    if (!workspaceIdentity) {
      this.logger.warn(`Unknown Slack workspace: ${teamId}`);
      return;
    }

    const events = normalizeSlackEvent({ body, tenantId: workspaceIdentity.tenantId });

    for (const event of events) {
      if (event.type !== 'message') continue;

      const rawEvent = body['event'] as Record<string, unknown> | undefined;
      if (rawEvent?.['bot_id'] || rawEvent?.['subtype'] === 'bot_message') continue;

      const payload = event.payload;
      const traceId = randomUUID();

      const { userId } = await this.ingestion.findOrCreateUser({
        tenantId: workspaceIdentity.tenantId,
        channelType: 'slack',
        externalWorkspaceId: payload.externalWorkspaceId,
        externalUserId: payload.externalUserId,
      });

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

      await this.conversationQueue.add('process', {
        messageId,
        conversationId,
        userId,
        tenantId: workspaceIdentity.tenantId,
        externalWorkspaceId: payload.externalWorkspaceId,
        externalConversationId: payload.externalConversationId,
        traceId,
      });

      this.logger.log(`Enqueued conversation job traceId=${traceId} messageId=${messageId}`);
    }
  }
}
