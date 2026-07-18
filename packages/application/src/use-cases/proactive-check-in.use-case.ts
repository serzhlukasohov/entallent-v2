import type { ReplyStrategy } from '@entalent/contracts';
import type { AiProviderPort, ConversationTurn } from '../ports/ai-provider.port';
import type { ConversationRepositoryPort } from '../ports/conversation.repository.port';
import type { MemoryRepositoryPort } from '../ports/memory.repository.port';
import type { SurveyRepositoryPort } from '../ports/survey.repository.port';
import type { OutboxPort } from '../ports/outbox.port';
import type { FeatureFlagPort } from '../ports/feature-flag.port';
import { FEATURE_FLAGS } from '../ports/feature-flag.port';
import type { SurveyQuestionRecord } from '../types/records';

export interface ProactiveCheckInInput {
  conversationId: string;
  userId: string;
  tenantId: string;
  externalWorkspaceId: string;
  externalConversationId: string;
  traceId: string;
}

export interface ProactiveCheckInResult {
  outboundMessageId: string;
  responseText: string;
  probeQuestionId: string | null;
}

/**
 * Agent-initiated check-in. Unlike scheduled follow-ups (which react to past
 * conversation commitments), this opener is driven by the survey state: it picks
 * a pending pulse-check question and lets the AI open a conversation whose
 * natural territory overlaps that topic. The AI may also ignore the topic and
 * just open warmly — collecting evidence is a marathon, not a sprint.
 */
export class ProactiveCheckInUseCase {
  constructor(
    private readonly conversationRepo: ConversationRepositoryPort,
    private readonly aiProvider: AiProviderPort,
    private readonly outbox: OutboxPort,
    private readonly memoryRepo?: MemoryRepositoryPort,
    private readonly surveyRepo?: SurveyRepositoryPort,
    private readonly featureFlags?: FeatureFlagPort,
  ) {}

  async execute(input: ProactiveCheckInInput): Promise<ProactiveCheckInResult> {
    const { conversationId, tenantId, userId } = input;

    const conversation = await this.conversationRepo.findById(conversationId, tenantId);
    if (!conversation) throw new Error(`Conversation ${conversationId} not found`);

    const dbMessages = await this.conversationRepo.findRecentMessages(conversationId, 10);
    const turns: ConversationTurn[] = dbMessages
      .filter((m) => m.text !== '__init__')
      .map((m) => ({
        role: m.direction === 'inbound' ? 'user' : 'assistant',
        content: m.text,
        timestamp: m.occurredAt,
      }));

    const userName = conversation.userDisplayName ?? 'there';
    const flagCtx = { tenantId, userId };

    const [memoryEnabled, surveyEnabled] = await Promise.all([
      this.featureFlags ? this.featureFlags.isEnabled(FEATURE_FLAGS.MEMORY_EXTRACTION, flagCtx) : Promise.resolve(true),
      this.featureFlags ? this.featureFlags.isEnabled(FEATURE_FLAGS.CONVERSATIONAL_SURVEY, flagCtx) : Promise.resolve(true),
    ]);

    const memoryItems =
      memoryEnabled && this.memoryRepo
        ? await this.memoryRepo.findActiveByUser(userId, tenantId, 20)
        : [];

    // First contact (no history, no memory): earn trust first, never steer toward a survey topic
    const isFirstContact = turns.length === 0 && memoryItems.length === 0;

    const probeQuestion =
      surveyEnabled && !isFirstContact ? await this.findPendingProbe(userId, tenantId) : null;

    const strategy: ReplyStrategy = {
      mode: 'proactive_follow_up',
      tone: 'warm',
      includeFollowUpQuestion: true,
      maxResponseLength: 'short',
      forbiddenPatterns: ['checking in', 'просто решил узнать', 'reminder'],
    };

    const generated = await this.aiProvider.generateResponse(turns, strategy, {
      userName,
      memoryContext:
        memoryItems.length > 0
          ? {
              items: memoryItems.map((i) => ({
                id: i.id,
                category: i.category,
                content: i.content,
                importance: i.importance,
              })),
              goals: memoryItems
                .filter((i) => i.category === 'goal')
                .map((i) => ({ id: i.id, title: i.content, status: i.status })),
            }
          : undefined,
      proactiveCheckIn: {
        probeQuestion: probeQuestion
          ? { id: probeQuestion.id, probeStrategies: probeQuestion.probeStrategies }
          : undefined,
      },
    });

    const outbound = await this.conversationRepo.saveMessage({
      conversationId,
      tenantId,
      userId,
      direction: 'outbound',
      text: generated.text,
      occurredAt: new Date(),
      traceId: input.traceId,
      messageType: 'proactive_check_in',
      metadata: generated.containsSurveyProbe
        ? { containsSurveyProbe: true, surveyProbeQuestionId: generated.surveyProbeQuestionId }
        : undefined,
    });

    await this.outbox.enqueueMessageSend({
      messageId: outbound.id,
      tenantId,
      conversationId,
      channelType: conversation.channelType,
      externalWorkspaceId: input.externalWorkspaceId,
      externalChannelId: input.externalConversationId,
      text: generated.text,
    });

    return {
      outboundMessageId: outbound.id,
      responseText: generated.text,
      probeQuestionId: generated.containsSurveyProbe ? (generated.surveyProbeQuestionId ?? null) : null,
    };
  }

  private async findPendingProbe(userId: string, tenantId: string): Promise<SurveyQuestionRecord | null> {
    if (!this.surveyRepo) return null;
    const window = await this.surveyRepo.findOrCreateActiveWindow(userId, tenantId);
    if (!window) return null;
    return this.surveyRepo.findPendingProbeQuestion(userId, tenantId, window.id);
  }
}
