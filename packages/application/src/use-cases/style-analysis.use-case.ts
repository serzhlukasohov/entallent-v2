import type { AiProviderPort } from '../ports/ai-provider.port';
import type { ConversationRepositoryPort } from '../ports/conversation.repository.port';
import type { StyleProfileRepositoryPort } from '../ports/style-profile.repository.port';
import { DEFAULT_STYLE_PROFILE, updateStyleProfile, MIN_USER_TURNS } from '../utils/style-adaptation';

export interface StyleAnalysisInput {
  conversationId: string;
  userId: string;
  tenantId: string;
}

export class StyleAnalysisUseCase {
  constructor(
    private readonly ai: AiProviderPort,
    private readonly conversationRepo: ConversationRepositoryPort,
    private readonly styleRepo: StyleProfileRepositoryPort,
  ) {}

  async execute(input: StyleAnalysisInput): Promise<void> {
    const messages = await this.conversationRepo.findRecentMessages(input.conversationId, 30);
    const userTurns = messages
      .filter((m) => m.direction === 'inbound' && m.text !== '__init__')
      .map((m) => m.text);
    if (userTurns.length < MIN_USER_TURNS) return;

    const observed = await this.ai.analyzeStyle(userTurns);
    const current = (await this.styleRepo.findByUser(input.userId, input.tenantId))
      ?? DEFAULT_STYLE_PROFILE(input.userId, input.tenantId);
    const next = updateStyleProfile(current, observed, userTurns.length);
    await this.styleRepo.upsert(next);
  }
}
