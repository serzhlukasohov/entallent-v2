import { describe, it, expect, vi } from 'vitest';
import { StyleAnalysisUseCase } from './style-analysis.use-case';

const msgs = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `m${i}`, direction: i % 2 === 0 ? 'inbound' : 'outbound', text: `msg ${i}`, occurredAt: new Date(), conversationId: 'c', tenantId: 't', userId: 'u', createdAt: new Date() }));

function deps(userMsgs: number) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const conversationRepo = { findRecentMessages: vi.fn().mockResolvedValue(msgs(userMsgs * 2)) } as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ai = { analyzeStyle: vi.fn().mockResolvedValue({ dimensions: { register: 1, humor: 1, verbosity: 1, emoji: 1 }, phrases: ['eh, so-so'] }) } as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const styleRepo = { findByUser: vi.fn().mockResolvedValue(null), upsert: vi.fn().mockImplementation(async (p) => p) } as any;
  return { conversationRepo, ai, styleRepo };
}
const INPUT = { conversationId: 'c', userId: 'u', tenantId: 't' };

describe('StyleAnalysisUseCase', () => {
  it('analyzes user turns and upserts an updated profile', async () => {
    const d = deps(5);
    await new StyleAnalysisUseCase(d.ai, d.conversationRepo, d.styleRepo).execute(INPUT);
    expect(d.ai.analyzeStyle).toHaveBeenCalled();
    const saved = d.styleRepo.upsert.mock.calls[0][0];
    expect(saved.conversationsAnalyzed).toBe(1);
    expect(saved.adaptationWeight).toBeCloseTo(0.075, 5);
  });

  it('skips when there are too few user turns (no AI call, no upsert)', async () => {
    const d = deps(2);
    await new StyleAnalysisUseCase(d.ai, d.conversationRepo, d.styleRepo).execute(INPUT);
    expect(d.ai.analyzeStyle).not.toHaveBeenCalled();
    expect(d.styleRepo.upsert).not.toHaveBeenCalled();
  });
});
