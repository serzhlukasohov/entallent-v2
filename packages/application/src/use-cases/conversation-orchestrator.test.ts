import { describe, it, expect, vi } from 'vitest';
import { ConversationOrchestrator } from './conversation-orchestrator';

function baseMocks() {
  const conversationRepo = {
    findById: vi.fn().mockResolvedValue({ id: 'c-1', channelType: 'slack', userDisplayName: 'Sam', userTimezone: 'UTC' }),
    findRecentMessages: vi.fn().mockResolvedValue([
      { id: 'm-1', direction: 'inbound', text: 'hey', occurredAt: new Date(), metadata: undefined },
    ]),
    saveMessage: vi.fn().mockResolvedValue({ id: 'out-1' }),
  } as any;
  const aiProvider = {
    classifySituation: vi.fn().mockResolvedValue({ primaryIntent: 'casual_conversation', urgency: 'low', surveyAllowed: true, requiresSafetyCheck: false, reminderRequest: null }),
    detectRisk: vi.fn(),
    generateResponse: vi.fn().mockResolvedValue({ text: 'reply', confidence: 0.9, containsSurveyProbe: false }),
    interpretConfirmationResponse: vi.fn(),
  } as any;
  const outbox = { enqueueMessageSend: vi.fn(), enqueueMemoryExtraction: vi.fn(), enqueueSurveyEvidence: vi.fn(), enqueueGroupReport: vi.fn() } as any;
  const surveyRepo = {
    findPendingConfirmationGroups: vi.fn().mockResolvedValue([]),
    findAwaitingConfirmationGroups: vi.fn().mockResolvedValue([]),
    findOrCreateActiveWindow: vi.fn().mockResolvedValue({ id: 'w-1' }),
    findQuestionsForWindow: vi.fn().mockResolvedValue([{ id: 'q-1', stableKey: 'q12', questionGroup: 'autonomy' }]),
    findEvidenceForQuestion: vi.fn().mockResolvedValue([{ evidenceSummary: 'values ownership', polarity: 'positive', createdAt: new Date() }]),
    upsertGroupState: vi.fn().mockResolvedValue({}),
    findTeamByMemberId: vi.fn().mockResolvedValue(null),
  } as any;
  const featureFlags = { isEnabled: vi.fn().mockResolvedValue(true) } as any;
  return { conversationRepo, aiProvider, outbox, surveyRepo, featureFlags };
}

const INPUT = {
  messageId: 'm-1', conversationId: 'c-1', userId: 'u-1', tenantId: 't-1',
  externalWorkspaceId: 'ws', externalConversationId: 'ec', traceId: 'tr',
};

describe('ConversationOrchestrator group confirmation — surface (Phase A)', () => {
  it('surfaces confirmation with confirmationRequest, no probe, and sets awaiting_confirmation', async () => {
    const m = baseMocks();
    m.surveyRepo.findPendingConfirmationGroups.mockResolvedValue([
      { surveyWindowId: 'w-1', userId: 'u-1', tenantId: 't-1', questionGroup: 'autonomy', aiSummary: 's' },
    ]);
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    await orch.orchestrate(INPUT);

    const ctxArg = m.aiProvider.generateResponse.mock.calls[0][2];
    expect(ctxArg.confirmationRequest).toMatchObject({ questionGroup: 'autonomy' });
    expect(ctxArg.surveyProbeQuestion).toBeUndefined();
    expect(m.surveyRepo.upsertGroupState).toHaveBeenCalledWith(
      expect.objectContaining({ questionGroup: 'autonomy', status: 'awaiting_confirmation' }),
    );
  });
});
