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
  const outbox = { enqueueMessageSend: vi.fn(), enqueueMemoryExtraction: vi.fn(), enqueueSurveyEvidence: vi.fn(), enqueueGroupReport: vi.fn(), enqueueStyleAnalysis: vi.fn(), enqueueProfileHydration: vi.fn() } as any;
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

describe('ConversationOrchestrator group confirmation — interpret (Phase B)', () => {
  it('agree → confirms group and enqueues report', async () => {
    const m = baseMocks();
    m.surveyRepo.findAwaitingConfirmationGroups.mockResolvedValue([
      { surveyWindowId: 'w-1', userId: 'u-1', tenantId: 't-1', questionGroup: 'growth', aiSummary: 'You want more ownership.' },
    ]);
    m.surveyRepo.findTeamByMemberId.mockResolvedValue({ teamId: 'team-1' });
    m.aiProvider.interpretConfirmationResponse.mockResolvedValue({ verdict: 'agree' });
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    await orch.orchestrate(INPUT);

    expect(m.surveyRepo.upsertGroupState).toHaveBeenCalledWith(
      expect.objectContaining({ questionGroup: 'growth', status: 'confirmed' }),
    );
    expect(m.outbox.enqueueGroupReport).toHaveBeenCalled();
    const ctxArg = m.aiProvider.generateResponse.mock.calls[0][2];
    expect(ctxArg.topicConfirmed).toMatchObject({ questionGroup: 'growth' });
  });

  it('correct → reopens group to in_progress and does not report', async () => {
    const m = baseMocks();
    m.surveyRepo.findAwaitingConfirmationGroups.mockResolvedValue([
      { surveyWindowId: 'w-1', userId: 'u-1', tenantId: 't-1', questionGroup: 'growth', aiSummary: 's' },
    ]);
    m.aiProvider.interpretConfirmationResponse.mockResolvedValue({ verdict: 'correct', correctionNote: 'not about promotion' });
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    await orch.orchestrate(INPUT);

    expect(m.surveyRepo.upsertGroupState).toHaveBeenCalledWith(
      expect.objectContaining({ questionGroup: 'growth', status: 'in_progress' }),
    );
    expect(m.outbox.enqueueGroupReport).not.toHaveBeenCalled();
  });

  it('unclear verdict with an awaiting group present → Phase A does NOT surface a new pending confirmation', async () => {
    const m = baseMocks();
    // A group is awaiting a reply; the employee's reply is unclear.
    m.surveyRepo.findAwaitingConfirmationGroups.mockResolvedValue([
      { surveyWindowId: 'w-1', userId: 'u-1', tenantId: 't-1', questionGroup: 'growth', aiSummary: 's' },
    ]);
    m.aiProvider.interpretConfirmationResponse.mockResolvedValue({ verdict: 'unclear' });
    // A DIFFERENT group is ripe for surfacing — Phase A must NOT pick it up this turn.
    m.surveyRepo.findPendingConfirmationGroups.mockResolvedValue([
      { surveyWindowId: 'w-1', userId: 'u-1', tenantId: 't-1', questionGroup: 'autonomy', aiSummary: 's2' },
    ]);
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    await orch.orchestrate(INPUT);

    const ctxArg = m.aiProvider.generateResponse.mock.calls[0][2];
    expect(ctxArg.confirmationRequest).toBeUndefined();
    expect(m.surveyRepo.upsertGroupState).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: 'awaiting_confirmation' }),
    );
  });
});

describe('ConversationOrchestrator style adaptation — structural verbosity', () => {
  const profile = (verbosity: number, weight: number) => ({
    findByUser: vi.fn().mockResolvedValue({
      userId: 'u-1', tenantId: 't-1',
      dimensions: { register: 0.72, humor: 0.29, verbosity, emoji: 0.11 },
      phrases: [], adaptationWeight: weight, conversationsAnalyzed: 4, updatedAt: new Date(),
    }),
    upsert: vi.fn(),
  }) as any;

  it('terse user is always shortened; skips the question when the agent just asked one', async () => {
    const m = baseMocks();
    m.conversationRepo.findRecentMessages.mockResolvedValue([
      { id: 'i-1', direction: 'inbound', text: 'yeah', occurredAt: new Date(), metadata: undefined },
      { id: 'o-1', direction: 'outbound', text: 'what exactly is holding you back?', occurredAt: new Date(), metadata: undefined },
    ]);
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined, profile(0.27, 0.3),
    );
    await orch.orchestrate(INPUT);
    const strategyArg = m.aiProvider.generateResponse.mock.calls[0][1];
    expect(strategyArg.maxResponseLength).toBe('short');
    expect(strategyArg.includeFollowUpQuestion).toBe(false); // just asked → skip this turn
  });

  it('terse user asks a follow-up when the previous reply had no question', async () => {
    const m = baseMocks();
    m.conversationRepo.findRecentMessages.mockResolvedValue([
      { id: 'i-1', direction: 'inbound', text: 'yeah', occurredAt: new Date(), metadata: undefined },
      { id: 'o-1', direction: 'outbound', text: 'got it, sounds draining.', occurredAt: new Date(), metadata: undefined },
    ]);
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined, profile(0.27, 0.3),
    );
    await orch.orchestrate(INPUT);
    const strategyArg = m.aiProvider.generateResponse.mock.calls[0][1];
    expect(strategyArg.maxResponseLength).toBe('short');
    expect(strategyArg.includeFollowUpQuestion).toBe(true); // didn't just ask → may ask
  });

  it('does not shorten for a non-terse user (verbosity near base)', async () => {
    const m = baseMocks();
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined, profile(0.5, 0.3),
    );
    await orch.orchestrate(INPUT);
    const strategyArg = m.aiProvider.generateResponse.mock.calls[0][1];
    expect(strategyArg.maxResponseLength).not.toBe('short');
  });

  it('does not shorten below the confidence floor (low weight)', async () => {
    const m = baseMocks();
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined, profile(0.27, 0.1),
    );
    await orch.orchestrate(INPUT);
    const strategyArg = m.aiProvider.generateResponse.mock.calls[0][1];
    expect(strategyArg.maxResponseLength).not.toBe('short');
  });
});

describe('ConversationOrchestrator local time', () => {
  it('passes a human-readable local time into the response context', async () => {
    const m = baseMocks();
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );
    await orch.orchestrate(INPUT);
    const ctxArg = m.aiProvider.generateResponse.mock.calls[0][2];
    expect(typeof ctxArg.localTime).toBe('string');
    expect(ctxArg.localTime).toMatch(/morning|afternoon|evening|night/);
  });

  it('marks session start when only the current inbound exists (no prior messages)', async () => {
    const m = baseMocks();
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );
    await orch.orchestrate(INPUT);
    const ctxArg = m.aiProvider.generateResponse.mock.calls[0][2];
    expect(ctxArg.isSessionStart).toBe(true);
  });

  it('marks session start and omits localTime when tz is unknown', async () => {
    const m = baseMocks();
    m.conversationRepo.findById.mockResolvedValue({ id: 'c-1', channelType: 'slack', userDisplayName: 'Sam', userTimezone: undefined });
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );
    await orch.orchestrate(INPUT);
    const ctxArg = m.aiProvider.generateResponse.mock.calls[0][2];
    expect(ctxArg.isSessionStart).toBe(true);
    expect(ctxArg.localTime).toBeUndefined();
  });
});
