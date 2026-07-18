import type { FollowUpCandidate } from '@entalent/contracts';
import type { ScheduledActionRepositoryPort } from '../ports/scheduled-action.repository.port';
import type { OutboxPort } from '../ports/outbox.port';

export interface FollowUpScheduleInput {
  candidates: FollowUpCandidate[];
  userId: string;
  tenantId: string;
  conversationId: string;
  channelType: string;
  externalConversationId: string;
  inboundMessageId: string;
}

/** Minimum confidence required to create a scheduled action from an AI candidate */
const MIN_CONFIDENCE = 0.6;

export class FollowUpSchedulerUseCase {
  constructor(
    private readonly actionRepo: ScheduledActionRepositoryPort,
    private readonly outbox: OutboxPort,
  ) {}

  async schedule(input: FollowUpScheduleInput): Promise<void> {
    for (const candidate of input.candidates) {
      if (candidate.confidence < MIN_CONFIDENCE) continue;

      const dedupKey = buildDeduplicationKey(input.userId, candidate.type, candidate.topic);

      const exists = await this.actionRepo.existsByDeduplicationKey(dedupKey);
      if (exists) continue;

      const dueAt = daysFromNow(candidate.recommendedDelayDays);

      const action = await this.actionRepo.save({
        tenantId: input.tenantId,
        userId: input.userId,
        conversationId: input.conversationId,
        type: candidate.type,
        intent: candidate.topic,
        context: {
          channelType: input.channelType,
          externalConversationId: input.externalConversationId,
          messageStrategy: candidate.messageStrategy,
          topic: candidate.topic,
          originalReason: candidate.reason,
        },
        reason: candidate.reason,
        dueAt,
        timezone: 'UTC',
        cancellationConditions: candidate.cancellationConditions,
        deduplicationKey: dedupKey,
        sourceMessageIds: [input.inboundMessageId],
      });

      await this.outbox.enqueueFollowUpExecution({
        scheduledActionId: action.id,
        tenantId: input.tenantId,
        userId: input.userId,
        traceId: `sched-${action.id}`,
        dueAt,
      });
    }
  }
}

function buildDeduplicationKey(userId: string, type: string, topic: string): string {
  const slug = topic.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 32);
  return `${userId}:${type}:${slug}`;
}

function daysFromNow(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + Math.max(1, days));
  return d;
}
