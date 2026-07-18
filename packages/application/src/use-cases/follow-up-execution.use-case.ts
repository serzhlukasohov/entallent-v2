import type { ReplyStrategy } from '@entalent/contracts';
import type { AiProviderPort, ConversationTurn } from '../ports/ai-provider.port';
import type { ConversationRepositoryPort } from '../ports/conversation.repository.port';
import type { ScheduledActionRepositoryPort } from '../ports/scheduled-action.repository.port';
import type { FollowUpContextPort } from '../ports/follow-up-context.port';
import type { OutboxPort, FollowUpExecutionPayload } from '../ports/outbox.port';
import { isInQuietHours, getLocalHour } from '../utils/quiet-hours';

export interface FollowUpExecutionInput {
  scheduledActionId: string;
  tenantId: string;
  userId: string;
}

export type PolicyDecision =
  | { decision: 'send'; reason: string }
  | { decision: 'postpone'; reason: string }
  | { decision: 'cancel'; reason: string }
  | { decision: 'skip'; reason: string };

// Daily proactive contact limit
const DAILY_PROACTIVE_LIMIT = 1;
// Minimum gap since last inbound before sending proactively (ms)
const MIN_INBOUND_GAP_MS = 2 * 60 * 60 * 1000; // 2 hours

type ScheduledActionContext = {
  channelType: string;
  externalConversationId: string;
  messageStrategy?: string;
  topic?: string;
  originalReason?: string;
  /** Present for user-requested reminders (type === 'user_reminder') */
  reminderIntent?: string;
};

export class FollowUpExecutionUseCase {
  constructor(
    private readonly actionRepo: ScheduledActionRepositoryPort,
    private readonly contextPort: FollowUpContextPort,
    private readonly conversationRepo: ConversationRepositoryPort,
    private readonly outbox: OutboxPort,
    private readonly ai: AiProviderPort,
  ) {}

  async execute(input: FollowUpExecutionInput): Promise<PolicyDecision> {
    const action = await this.actionRepo.findById(input.scheduledActionId, input.tenantId);
    if (!action || action.status !== 'pending') {
      return { decision: 'skip', reason: 'not_pending' };
    }

    // Guard: job fired before dueAt (stale BullMQ job after a postpone)
    if (new Date() < action.dueAt) {
      await this.reschedule(action as { id: string; tenantId: string; userId: string; dueAt: Date; attemptCount: number }, action.dueAt);
      return { decision: 'skip', reason: 'not_due_yet' };
    }

    const newAttemptCount = action.attemptCount + 1;

    if (newAttemptCount > action.maxAttempts) {
      await this.actionRepo.cancel(action.id, input.tenantId);
      return { decision: 'cancel', reason: 'max_attempts_exceeded' };
    }

    const actionCtx = action.context as ScheduledActionContext;

    // User-requested reminders are explicitly asked for, so they bypass the
    // proactive-messaging opt-out, the daily proactive cap, and the "conversation
    // is active" suppression. Quiet hours and active-crisis guards still apply —
    // a reminder should still wait for morning and never land mid-crisis.
    const isReminder = action.type === 'user_reminder';

    const ctx = await this.contextPort.load({
      userId: action.userId,
      tenantId: action.tenantId,
      conversationId: action.conversationId,
      channelType: actionCtx.channelType,
    });

    // Policy: proactive messaging disabled (skipped for explicit reminders)
    if (!isReminder && !ctx.user.proactiveMessagingEnabled) {
      await this.actionRepo.cancel(action.id, input.tenantId);
      return { decision: 'cancel', reason: 'proactive_disabled' };
    }

    // Policy: quiet hours
    if (isInQuietHours(ctx.user.timezone, ctx.user.quietHours)) {
      const delayMs = msUntilEndOfQuietHours(ctx.user.timezone, ctx.user.quietHours);
      await this.postpone(action, input.tenantId, delayMs, newAttemptCount);
      return { decision: 'postpone', reason: 'quiet_hours' };
    }

    // Policy: daily proactive contact limit (skipped for explicit reminders)
    if (!isReminder && ctx.recentProactiveCount24h >= DAILY_PROACTIVE_LIMIT) {
      await this.postpone(action, input.tenantId, 12 * 60 * 60 * 1000, newAttemptCount);
      return { decision: 'postpone', reason: 'daily_limit_reached' };
    }

    // Policy: active high/critical risk — don't interrupt (applies to reminders too)
    if (ctx.hasActiveHighRisk) {
      await this.postpone(action, input.tenantId, 4 * 60 * 60 * 1000, newAttemptCount);
      return { decision: 'postpone', reason: 'active_risk_signal' };
    }

    // Policy: recent incoming message — conversation is active (skipped for reminders,
    // which are time-bound and fine to deliver even mid-conversation)
    if (!isReminder && ctx.lastInboundAt && Date.now() - ctx.lastInboundAt.getTime() < MIN_INBOUND_GAP_MS) {
      await this.postpone(action, input.tenantId, 60 * 60 * 1000, newAttemptCount);
      return { decision: 'postpone', reason: 'recent_inbound_activity' };
    }

    // Need channel to send. The 'dev' channel is a local test sink that needs no
    // workspace connection (mirrors the message-send processor's dev handling).
    const isDevChannel = ctx.conversation?.channelType === 'dev';
    if (!ctx.conversation || (!ctx.workspaceConnection && !isDevChannel)) {
      await this.actionRepo.cancel(action.id, input.tenantId);
      return { decision: 'cancel', reason: 'missing_channel_context' };
    }

    // Generate personalized follow-up message
    const recentMessages = await this.conversationRepo.findRecentMessages(ctx.conversation.id, 8);
    const turns: ConversationTurn[] = recentMessages.map((m) => ({
      role: m.direction === 'inbound' ? 'user' : 'assistant',
      content: m.text,
      timestamp: m.occurredAt,
    }));

    const strategy: ReplyStrategy = isReminder
      ? {
          mode: 'proactive_follow_up',
          tone: 'warm',
          includeFollowUpQuestion: false,
          maxResponseLength: 'short',
          forbiddenPatterns: [],
        }
      : {
          mode: 'proactive_follow_up',
          tone: 'warm',
          includeFollowUpQuestion: true,
          maxResponseLength: 'medium',
          forbiddenPatterns: ['reminder:', 'notification:', 'following up on'],
        };

    const generated = await this.ai.generateResponse(turns, strategy, {
      userName: ctx.user.preferredName ?? 'there',
      ...(isReminder
        ? { reminderIntent: actionCtx.reminderIntent ?? action.intent }
        : { followUpIntent: `${actionCtx.originalReason} — ${actionCtx.messageStrategy}` }),
    });

    // Persist outbound message
    const outbound = await this.conversationRepo.saveMessage({
      conversationId: ctx.conversation.id,
      tenantId: input.tenantId,
      userId: action.userId,
      direction: 'outbound',
      text: generated.text,
      occurredAt: new Date(),
      messageType: isReminder ? 'reminder' : 'proactive_follow_up',
    });

    // Enqueue channel send
    await this.outbox.enqueueMessageSend({
      messageId: outbound.id,
      tenantId: input.tenantId,
      conversationId: ctx.conversation.id,
      channelType: ctx.conversation.channelType,
      externalWorkspaceId: ctx.workspaceConnection?.externalWorkspaceId ?? '',
      externalChannelId: actionCtx.externalConversationId,
      text: generated.text,
    });

    await this.actionRepo.markSent(action.id, input.tenantId, newAttemptCount);

    return { decision: 'send', reason: 'all_checks_passed' };
  }

  private async postpone(
    action: { id: string; tenantId: string; userId: string; dueAt: Date; attemptCount: number },
    tenantId: string,
    delayMs: number,
    attemptCount: number,
  ): Promise<void> {
    const newDueAt = new Date(Date.now() + delayMs);
    await this.actionRepo.postpone(action.id, tenantId, newDueAt, attemptCount);
    await this.reschedule(action, newDueAt);
  }

  private async reschedule(
    action: { id: string; tenantId: string; userId: string },
    dueAt: Date,
  ): Promise<void> {
    const payload: FollowUpExecutionPayload = {
      scheduledActionId: action.id,
      tenantId: action.tenantId,
      userId: action.userId,
      traceId: `reschedule-${action.id}-${dueAt.getTime()}`,
      dueAt,
    };
    await this.outbox.enqueueFollowUpExecution(payload);
  }
}

function msUntilEndOfQuietHours(
  timezone: string,
  quietHours: { enabled: boolean; startHour?: number; endHour?: number },
): number {
  const endHour = quietHours.endHour ?? 8;
  const localHour = getLocalHour(timezone);
  const localMinute = getLocalMinute(timezone);
  let hoursRemaining = endHour - localHour;
  if (hoursRemaining <= 0) hoursRemaining += 24;
  return (hoursRemaining * 60 - localMinute) * 60 * 1000;
}

function getLocalMinute(timezone: string): number {
  return Number(
    new Intl.DateTimeFormat('en-US', { minute: 'numeric', timeZone: timezone }).format(new Date()),
  );
}
