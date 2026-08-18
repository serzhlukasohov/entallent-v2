import { describe, it, expect, vi } from 'vitest';
import { ConversationOrchestrator } from './conversation-orchestrator';

function baseMocks() {
  const conversationRepo = {
    findById: vi.fn().mockResolvedValue({ id: 'c-1', channelType: 'slack', userDisplayName: 'Sam', userLocale: 'en', userTimezone: 'UTC' }),
    findRecentMessages: vi.fn().mockResolvedValue([
      { id: 'm-1', direction: 'inbound', text: 'hey', occurredAt: new Date(), metadata: undefined },
    ]),
    saveMessage: vi.fn().mockResolvedValue({ id: 'out-1' }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  const aiProvider = {
    classifySituation: vi.fn().mockResolvedValue({
      primaryIntent: 'casual_conversation',
      secondaryIntents: [],
      emotionalState: [],
      urgency: 'low',
      confidence: 0.9,
      surveyAllowed: true,
      requiresSafetyCheck: false,
      reasoningSummary: 'test',
      reminderRequest: null,
      dialogueAct: 'new_substance',
      latestUserSubstance: 'hey',
      topicAnchor: null,
    }),
    detectRisk: vi.fn(),
    generateResponse: vi.fn().mockResolvedValue({ text: 'reply', confidence: 0.9, containsSurveyProbe: false }),
    interpretConfirmationResponse: vi.fn(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const outbox = { enqueueMessageSend: vi.fn(), enqueueMemoryExtraction: vi.fn(), enqueueSurveyEvidence: vi.fn(), enqueueGroupReport: vi.fn(), enqueueStyleAnalysis: vi.fn(), enqueueProfileHydration: vi.fn() } as any;
  const surveyRepo = {
    findPendingConfirmationGroups: vi.fn().mockResolvedValue([]),
    findAwaitingConfirmationGroups: vi.fn().mockResolvedValue([]),
    findOrCreateActiveWindow: vi.fn().mockResolvedValue({ id: 'w-1' }),
    findQuestionsForWindow: vi.fn().mockResolvedValue([{ id: 'q-1', stableKey: 'q12', questionGroup: 'autonomy' }]),
    findEvidenceForQuestion: vi.fn().mockResolvedValue([{ evidenceSummary: 'values ownership', polarity: 'positive', createdAt: new Date() }]),
    upsertGroupState: vi.fn().mockResolvedValue({}),
    findTeamByMemberId: vi.fn().mockResolvedValue(null),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

describe('ConversationOrchestrator deterministic safety pass', () => {
  it('forces the safety pass for a burnout_signal even when the classifier left requiresSafetyCheck false', async () => {
    const m = baseMocks();
    m.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent: 'burnout_signal', secondaryIntents: [], urgency: 'medium',
      emotionalState: ['exhausted'], confidence: 0.9, reasoningSummary: 'burnout',
      surveyAllowed: true, requiresSafetyCheck: false, reminderRequest: null,
      dialogueAct: 'emotional_disclosure', latestUserSubstance: 'burned out', topicAnchor: 'release',
    });
    m.aiProvider.detectRisk.mockResolvedValue({
      severity: 'none', riskType: undefined, confidence: 0,
      surveyMustBeBlocked: false, immediateResponseRequired: false,
    });
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    const result = await orch.orchestrate(INPUT);

    expect(m.aiProvider.detectRisk).toHaveBeenCalled();
    expect(result.classification.requiresSafetyCheck).toBe(true);
  });

  it('does not force a safety pass for a benign intent', async () => {
    const m = baseMocks(); // default classification: casual_conversation, requiresSafetyCheck false
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    const result = await orch.orchestrate(INPUT);

    expect(m.aiProvider.detectRisk).not.toHaveBeenCalled();
    expect(result.classification.requiresSafetyCheck).toBe(false);
  });
});

describe('ConversationOrchestrator reply plan', () => {
  it('passes acknowledgement dialogue state to response generation', async () => {
    const m = baseMocks();
    m.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent: 'casual_conversation',
      secondaryIntents: [],
      emotionalState: [],
      urgency: 'low',
      confidence: 0.9,
      surveyAllowed: true,
      requiresSafetyCheck: false,
      reasoningSummary: 'ack',
      reminderRequest: null,
      dialogueAct: 'acknowledgement',
      latestUserSubstance: null,
      topicAnchor: 'the release shipped over the weekend',
    });
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    await orch.orchestrate(INPUT);

    const ctxArg = m.aiProvider.generateResponse.mock.calls[0][2];
    expect(ctxArg.replyPlan).toMatchObject({
      dialogueAct: 'acknowledgement',
      responseMove: 'continue_existing_thread',
      latestUserSubstance: null,
      topicAnchor: 'the release shipped over the weekend',
      mayInferFromBrevity: false,
      questionPolicy: { maxQuestions: 0, reason: 'acknowledgement_no_new_substance' },
    });
    expect(ctxArg.replyBrief).toBe(ctxArg.replyPlan);
    const strategyArg = m.aiProvider.generateResponse.mock.calls[0][1];
    expect(strategyArg.includeFollowUpQuestion).toBe(false);
  });
});

describe('ConversationOrchestrator language policy', () => {
  it('uses the current Russian inbound turn over an English user profile locale', async () => {
    const m = baseMocks();
    m.conversationRepo.findRecentMessages.mockResolvedValue([
      { id: 'm-1', direction: 'inbound', text: 'Привет', occurredAt: new Date(), metadata: undefined },
    ]);
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    await orch.orchestrate(INPUT);

    const ctxArg = m.aiProvider.generateResponse.mock.calls[0][2];
    expect(ctxArg.languagePolicy).toMatchObject({
      responseLanguage: 'ru',
      source: 'current_turn',
      shouldUpdateUserLocale: true,
    });
  });

  it('uses recent Russian user turns when the current turn is ambiguous', async () => {
    const m = baseMocks();
    m.conversationRepo.findRecentMessages.mockResolvedValue([
      { id: 'm-0', direction: 'inbound', text: 'Я переживаю из-за Atlas-9', occurredAt: new Date(), metadata: undefined },
      { id: 'out-0', direction: 'outbound', text: 'Понимаю.', occurredAt: new Date(), metadata: undefined },
      { id: 'm-1', direction: 'inbound', text: 'ok', occurredAt: new Date(), metadata: undefined },
    ]);
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    await orch.orchestrate(INPUT);

    const ctxArg = m.aiProvider.generateResponse.mock.calls[0][2];
    expect(ctxArg.languagePolicy).toMatchObject({
      responseLanguage: 'ru',
      source: 'recent_turns',
      shouldUpdateUserLocale: true,
    });
  });

  it('treats a Latin product token as ambiguous and keeps recent Russian context', async () => {
    const m = baseMocks();
    m.conversationRepo.findRecentMessages.mockResolvedValue([
      { id: 'm-0', direction: 'inbound', text: 'Я переживаю из-за автономии', occurredAt: new Date(), metadata: undefined },
      { id: 'out-0', direction: 'outbound', text: 'Понимаю.', occurredAt: new Date(), metadata: undefined },
      { id: 'm-1', direction: 'inbound', text: 'Atlas-9', occurredAt: new Date(), metadata: undefined },
    ]);
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    await orch.orchestrate(INPUT);

    const ctxArg = m.aiProvider.generateResponse.mock.calls[0][2];
    expect(ctxArg.languagePolicy).toMatchObject({
      responseLanguage: 'ru',
      source: 'recent_turns',
    });
  });

  it('preserves Ukrainian profile language for Cyrillic current turns', async () => {
    const m = baseMocks();
    m.conversationRepo.findById.mockResolvedValue({
      id: 'c-1',
      channelType: 'slack',
      userDisplayName: 'Sam',
      userLocale: 'uk',
      userTimezone: 'UTC',
    });
    m.conversationRepo.findRecentMessages.mockResolvedValue([
      { id: 'm-1', direction: 'inbound', text: 'я думаю що це важливо', occurredAt: new Date(), metadata: undefined },
    ]);
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    await orch.orchestrate(INPUT);

    const ctxArg = m.aiProvider.generateResponse.mock.calls[0][2];
    expect(ctxArg.languagePolicy).toMatchObject({
      responseLanguage: 'uk',
      source: 'current_turn',
      shouldUpdateUserLocale: false,
    });
  });

  it('uses other valid stored profile languages', async () => {
    const m = baseMocks();
    m.conversationRepo.findById.mockResolvedValue({
      id: 'c-1',
      channelType: 'slack',
      userDisplayName: 'Sam',
      userLocale: 'pt-BR',
      userTimezone: 'UTC',
    });
    m.conversationRepo.findRecentMessages.mockResolvedValue([
      { id: 'm-1', direction: 'inbound', text: '...', occurredAt: new Date(), metadata: undefined },
    ]);
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    await orch.orchestrate(INPUT);

    const ctxArg = m.aiProvider.generateResponse.mock.calls[0][2];
    expect(ctxArg.languagePolicy).toMatchObject({
      responseLanguage: 'pt',
      source: 'user_profile',
    });
  });

  it('ignores malformed stored locale values', async () => {
    const m = baseMocks();
    m.conversationRepo.findById.mockResolvedValue({
      id: 'c-1',
      channelType: 'slack',
      userDisplayName: 'Sam',
      userLocale: '123',
      userTimezone: 'UTC',
    });
    m.conversationRepo.findRecentMessages.mockResolvedValue([
      { id: 'm-1', direction: 'inbound', text: '...', occurredAt: new Date(), metadata: undefined },
    ]);
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    await orch.orchestrate(INPUT);

    const ctxArg = m.aiProvider.generateResponse.mock.calls[0][2];
    expect(ctxArg.languagePolicy).toMatchObject({
      responseLanguage: 'en',
      source: 'tenant_default',
    });
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

  it('terse user is shortened while reply plan skips the question when reply metadata says the agent just asked one', async () => {
    const m = baseMocks();
    m.conversationRepo.findRecentMessages.mockResolvedValue([
      { id: 'i-1', direction: 'inbound', text: 'yeah', occurredAt: new Date(), metadata: undefined },
      {
        id: 'o-1',
        direction: 'outbound',
        text: 'what exactly is holding you back?',
        occurredAt: new Date(),
        metadata: { replyShape: { askedQuestion: true, maxQuestions: 1, questionPolicyReason: 'new_substance_allows_question' } },
      },
    ]);
    m.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent: 'casual_conversation',
      secondaryIntents: [],
      emotionalState: [],
      urgency: 'low',
      confidence: 0.9,
      surveyAllowed: true,
      requiresSafetyCheck: false,
      reasoningSummary: 'continuing same thread',
      reminderRequest: null,
      dialogueAct: 'continuation',
      latestUserSubstance: 'same thing is still blocked',
      topicAnchor: 'recurring blocker',
    });
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined, profile(0.27, 0.3),
    );
    await orch.orchestrate(INPUT);
    const strategyArg = m.aiProvider.generateResponse.mock.calls[0][1];
    const ctxArg = m.aiProvider.generateResponse.mock.calls[0][2];
    expect(strategyArg.maxResponseLength).toBe('short');
    expect(strategyArg.includeFollowUpQuestion).toBe(false);
    expect(ctxArg.replyPlan.questionPolicy).toEqual({ maxQuestions: 0, reason: 'asked_recently' });
  });

  it('ignores legacy punctuation when previous reply has no reply-shape metadata', async () => {
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
    expect(strategyArg.includeFollowUpQuestion).toBe(true);
  });

  it('persists reply-shape metadata from the typed reply plan', async () => {
    const m = baseMocks();
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );
    await orch.orchestrate(INPUT);
    expect(m.conversationRepo.saveMessage).toHaveBeenCalledWith(expect.objectContaining({
      metadata: {
        replyShape: {
          askedQuestion: true,
          maxQuestions: 1,
          questionPolicyReason: 'new_substance_allows_question',
        },
      },
    }));
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
