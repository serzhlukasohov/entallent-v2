import type { AiProviderPort } from '../ports/ai-provider.port';
import type { ConversationRepositoryPort } from '../ports/conversation.repository.port';
import type {
  CommittedStyleProfileRepositoryPort,
  StyleProfileRepositoryPort,
} from '../ports/style-profile.repository.port';
import { DEFAULT_STYLE_PROFILE, updateStyleProfile, MIN_USER_TURNS } from '../utils/style-adaptation';

export interface StyleAnalysisInput {
  conversationId: string;
  userId: string;
  tenantId: string;
  inboundMessageId?: string;
}

export class StyleAnalysisUseCase {
  constructor(
    private readonly ai: AiProviderPort,
    private readonly conversationRepo: ConversationRepositoryPort,
    private readonly styleRepo: StyleProfileRepositoryPort,
  ) {}

  async execute(input: StyleAnalysisInput): Promise<void> {
    const committedRepo = input.inboundMessageId ? this.committedRepository() : null;
    const committedInput = input.inboundMessageId
      ? { ...input, inboundMessageId: input.inboundMessageId } : null;
    if (committedRepo && committedInput
      && await committedRepo.isCommittedStyleAnalysisComplete(committedInput)) return;
    if (committedInput && !this.conversationRepo.findMessagesThrough) {
      throw new Error('committed_style_source_lookup_missing');
    }
    const messages = committedInput
      ? await this.conversationRepo.findMessagesThrough!({ ...committedInput, limit: 30 })
      : await this.conversationRepo.findRecentMessages(input.conversationId, 30);
    const userTurns = messages
      .filter((m) => m.direction === 'inbound' && m.text !== '__init__')
      .map((m) => m.text);
    if (userTurns.length < MIN_USER_TURNS) {
      if (committedRepo && committedInput) {
        await committedRepo.completeCommittedStyleAnalysis(committedInput, null);
      }
      return;
    }

    const observed = await this.ai.analyzeStyle(userTurns);
    if (committedRepo && committedInput) {
      await committedRepo.completeCommittedStyleAnalysis(committedInput, (existing) =>
        updateStyleProfile(existing ?? DEFAULT_STYLE_PROFILE(input.userId, input.tenantId),
          observed, userTurns.length));
    } else {
      const current = (await this.styleRepo.findByUser(input.userId, input.tenantId))
        ?? DEFAULT_STYLE_PROFILE(input.userId, input.tenantId);
      const next = updateStyleProfile(current, observed, userTurns.length);
      await this.styleRepo.upsert(next);
    }
  }

  private committedRepository(): CommittedStyleProfileRepositoryPort {
    const repo = this.styleRepo as Partial<CommittedStyleProfileRepositoryPort>;
    if (typeof repo.isCommittedStyleAnalysisComplete !== 'function'
      || typeof repo.completeCommittedStyleAnalysis !== 'function') {
      throw new Error('committed_style_repository_missing');
    }
    return repo as CommittedStyleProfileRepositoryPort;
  }
}
