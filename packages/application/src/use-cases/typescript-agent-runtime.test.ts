import { describe, expect, it, vi } from 'vitest';
import { TypeScriptAgentRuntime } from './typescript-agent-runtime';
import type { ConversationOrchestrator } from './conversation-orchestrator';

describe('TypeScriptAgentRuntime archived-contract adapter', () => {
  it('maps unassessed risk without claiming safety', async () => {
    const orchestrator = {
      orchestrate: vi.fn().mockResolvedValue({
        outboundMessageId: 'o-1', responseText: 'r', mode: 'sensitive', classification: {},
        risk: {
          assessed: false, reason: 'moderation_blocked', riskType: 'potential_self_harm', severity: 'critical',
          immediateResponseRequired: true, tripwireRaised: true,
        },
      }),
    } as unknown as ConversationOrchestrator;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await new TypeScriptAgentRuntime(orchestrator).processMessage({} as any);

    expect(result.risk).toMatchObject({
      severity: 'critical', confidence: 0, surveyMustBeBlocked: true, immediateResponseRequired: true,
      reasoningSummary: 'unassessed:moderation_blocked',
    });
    expect(result.risk).not.toHaveProperty('assessed');
  });
});
