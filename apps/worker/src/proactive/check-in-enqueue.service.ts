import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type { CheckInEnqueuePort, CheckInEnqueuePayload } from '@entalent/application';
import { QUEUE_NAMES } from '../queue/queue.module';
import type { CheckInJob } from '../conversation/conversation.processor';

/** Places agent-initiated check-ins onto the conversation queue (job name 'check-in'). */
@Injectable()
export class CheckInEnqueueService implements CheckInEnqueuePort {
  constructor(
    @InjectQueue(QUEUE_NAMES.CONVERSATION) private readonly queue: Queue<CheckInJob>,
  ) {}

  async enqueueCheckIn(payload: CheckInEnqueuePayload): Promise<void> {
    await this.queue.add('check-in', {
      conversationId: payload.conversationId,
      userId: payload.userId,
      tenantId: payload.tenantId,
      externalWorkspaceId: payload.externalWorkspaceId,
      externalConversationId: payload.externalConversationId,
      traceId: payload.traceId,
    });
  }
}
