import type { MemoryItemProposal, GoalProposal, FollowUpCandidate } from '@entalent/contracts';
import type { AiProviderPort } from '../ports/ai-provider.port';
import type { ConversationRepositoryPort } from '../ports/conversation.repository.port';
import type { MemoryRepositoryPort, SaveMemoryItemParams } from '../ports/memory.repository.port';
import type { GoalRepositoryPort } from '../ports/goal.repository.port';
import type { MemoryItemRecord } from '../types/records';
import { contentSimilarity } from '../utils/text-similarity';

/** Above this, a proposed item is considered the same fact as an existing one */
const DUPLICATE_SIMILARITY_THRESHOLD = 0.6;

export interface MemoryExtractionInput {
  conversationId: string;
  userId: string;
  tenantId: string;
  inboundMessageId: string;
  outboundMessageId: string;
  channelType: string;
  externalConversationId: string;
}

export interface MemoryExtractionResult {
  followUpCandidates: FollowUpCandidate[];
}

export class MemoryExtractionUseCase {
  constructor(
    private readonly conversationRepo: ConversationRepositoryPort,
    private readonly memoryRepo: MemoryRepositoryPort,
    private readonly goalRepo: GoalRepositoryPort,
    private readonly ai: AiProviderPort,
  ) {}

  async execute(input: MemoryExtractionInput): Promise<MemoryExtractionResult> {
    const dbMessages = await this.conversationRepo.findRecentMessages(input.conversationId, 20);
    const turns = dbMessages.map((m) => ({
      role: m.direction === 'inbound' ? ('user' as const) : ('assistant' as const),
      content: m.text,
      timestamp: m.occurredAt,
    }));

    const [activeItems, activeGoals] = await Promise.all([
      this.memoryRepo.findActiveByUser(input.userId, input.tenantId, 30),
      this.goalRepo.findActiveByUser(input.userId, input.tenantId),
    ]);

    const proposal = await this.ai.extractMemory(turns, {
      items: activeItems.map((i) => ({
        id: i.id,
        category: i.category,
        content: i.content,
        importance: i.importance,
      })),
      goals: activeGoals.map((g) => ({ id: g.id, title: g.title, status: g.status })),
    });

    await this.applyMemoryItems(input, proposal.memoryItems, activeItems);
    await this.applyGoalProposals(input, proposal.goalProposals);

    return { followUpCandidates: proposal.followUpCandidates };
  }

  private async applyMemoryItems(
    input: MemoryExtractionInput,
    proposals: MemoryItemProposal[],
    activeItems: MemoryItemRecord[],
  ): Promise<void> {
    const sourceMessageIds = [input.inboundMessageId, input.outboundMessageId];
    // Tracks content saved in this run so one extraction batch can't self-duplicate
    const savedThisRun: Array<{ category: string; content: string }> = [];

    for (const p of proposals) {
      if (p.action === 'ignore') continue;

      const base: SaveMemoryItemParams = {
        tenantId: input.tenantId,
        userId: input.userId,
        category: p.category,
        canonicalKey: p.canonicalKey,
        content: p.content,
        structuredValue: p.structuredValue,
        confidence: p.confidence,
        importance: p.importance,
        sensitivity: p.sensitivity,
        sourceMessageIds,
        expiresAt: lifetimeToExpiry(p.expectedLifetime),
        extractorVersion: 'v1',
      };

      if (p.action === 'supersede' && p.existingItemId) {
        const newItem = await this.memoryRepo.save(base);
        await this.memoryRepo.supersede(p.existingItemId, newItem.id);
        savedThisRun.push({ category: p.category, content: p.content });
        continue;
      }

      if (p.action === 'update') {
        // Prefer the explicit item reference; fall back to canonicalKey lookup
        const existing = p.existingItemId
          ? await this.memoryRepo.findById(p.existingItemId, input.tenantId)
          : p.canonicalKey
            ? await this.memoryRepo.findByCanonicalKey(input.userId, p.canonicalKey, input.tenantId)
            : null;
        if (existing) {
          const newItem = await this.memoryRepo.save(base);
          await this.memoryRepo.supersede(existing.id, newItem.id);
          savedThisRun.push({ category: p.category, content: p.content });
          continue;
        }
      }

      // action === 'create' (or 'update' with no resolvable existing item).
      // Safety net: the extractor re-reads the same transcript every message and
      // often re-proposes a fact it was already shown — drop near-duplicates.
      const duplicate =
        activeItems.find(
          (i) =>
            i.category === p.category &&
            contentSimilarity(i.content, p.content) >= DUPLICATE_SIMILARITY_THRESHOLD,
        ) ??
        savedThisRun.find(
          (s) =>
            s.category === p.category &&
            contentSimilarity(s.content, p.content) >= DUPLICATE_SIMILARITY_THRESHOLD,
        );
      if (duplicate) continue;

      await this.memoryRepo.save(base);
      savedThisRun.push({ category: p.category, content: p.content });
    }
  }

  private async applyGoalProposals(
    input: MemoryExtractionInput,
    proposals: GoalProposal[],
  ): Promise<void> {
    for (const p of proposals) {
      if (p.action === 'create') {
        await this.goalRepo.save({
          tenantId: input.tenantId,
          userId: input.userId,
          title: p.title,
          description: p.description,
          category: p.category,
          targetDate: p.targetDate,
          sourceMessageIds: [input.inboundMessageId],
          confidence: p.confidence,
        });
      } else if (p.action === 'complete' && p.existingGoalId) {
        await this.goalRepo.updateStatus(p.existingGoalId, 'completed', input.tenantId);
      } else if (p.action === 'cancel' && p.existingGoalId) {
        await this.goalRepo.updateStatus(p.existingGoalId, 'cancelled', input.tenantId);
      }
    }
  }
}

function lifetimeToExpiry(lifetime: string): Date | undefined {
  const daysMap: Record<string, number> = {
    days: 7,
    weeks: 30,
    months: 90,
    long_term: 0,
  };
  const days = daysMap[lifetime] ?? 0;
  if (days === 0) return undefined;
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}
