import { describe, it, expect, vi } from 'vitest';
import { ConversationOrchestrator } from './conversation-orchestrator';
import type { GoalRepositoryPort } from '../ports/goal.repository.port';
import type { UserGoalRecord } from '../types/records';

function baseMocks() {
  const conversationRepo = {
    findById: vi.fn().mockResolvedValue({
      id: 'c-1', tenantId: 't-1', userId: 'u-1', channelType: 'slack',
      userDisplayName: 'Sam', userLocale: 'en', userTimezone: 'UTC',
    }),
    findRecentMessages: vi.fn().mockResolvedValue([
      { id: 'm-1', direction: 'inbound', text: 'hey', occurredAt: new Date(), metadata: undefined },
    ]),
    saveMessage: vi.fn().mockResolvedValue({ id: 'out-1' }),
    updateActiveTopic: vi.fn().mockResolvedValue(undefined),
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

function goalRecord(id: string, title: string): UserGoalRecord {
  const now = new Date();
  return {
    id,
    tenantId: 't-1',
    userId: 'u-1',
    title,
    category: 'delivery',
    status: 'active',
    priority: 'medium',
    sourceMessageIds: [],
    confidence: 0.9,
    createdAt: now,
    updatedAt: now,
  };
}

function goalRepository(
  findActiveByUser: () => Promise<UserGoalRecord[]>,
): GoalRepositoryPort {
  return {
    findActiveByUser: vi.fn(findActiveByUser),
    findById: vi.fn().mockResolvedValue(null),
    save: vi.fn(),
    updateStatus: vi.fn().mockResolvedValue(undefined),
  };
}

function orchestratorWithGoals(
  m: ReturnType<typeof baseMocks>,
  goalRepo?: GoalRepositoryPort,
  memoryRepo?: unknown,
): ConversationOrchestrator {
  return new ConversationOrchestrator(
    m.conversationRepo,
    m.aiProvider,
    m.outbox,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    memoryRepo as any,
    m.surveyRepo,
    undefined,
    undefined,
    m.featureFlags,
    undefined,
    undefined,
    undefined,
    goalRepo,
  );
}

describe('ConversationOrchestrator group confirmation — surface (Phase A)', () => {
  it('surfaces confirmation with confirmationRequest, no probe, and sets awaiting_confirmation', async () => {
    const m = baseMocks();
    m.surveyRepo.findPendingConfirmationGroups.mockResolvedValue([
      { surveyWindowId: 'w-1', userId: 'u-1', tenantId: 't-1', questionGroup: 'autonomy', aiSummary: 's' },
    ]);
    m.aiProvider.generateResponse.mockResolvedValue({
      text: 'Did I get that right?', confidence: 0.9, containsSurveyProbe: false,
    });
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    await orch.orchestrate(INPUT);

    const ctxArg = m.aiProvider.generateResponse.mock.calls[0][2];
    expect(ctxArg.confirmationRequest).toMatchObject({ questionGroup: 'autonomy' });
    expect(ctxArg.surveyProbeQuestion).toBeUndefined();
    const metadata = m.conversationRepo.saveMessage.mock.calls[0][0].metadata;
    expect(metadata.replyShape).toMatchObject({
      askedQuestion: true,
      maxQuestions: 1,
      questionPolicyReason: 'confirmation_requires_question',
    });
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

  it('keeps safety support authoritative when the dialogue act is closing', async () => {
    const m = baseMocks();
    m.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent: 'potential_crisis', secondaryIntents: [], urgency: 'critical',
      emotionalState: ['unsafe'], confidence: 0.9, reasoningSummary: 'risk',
      surveyAllowed: false, requiresSafetyCheck: false, reminderRequest: null,
      dialogueAct: 'closing', latestUserSubstance: null, topicAnchor: 'immediate danger',
    });
    m.aiProvider.detectRisk.mockResolvedValue({
      severity: 'critical', riskType: 'self_harm', confidence: 0.9,
      surveyMustBeBlocked: true, immediateResponseRequired: true,
      escalationRecommended: true, proactiveMessagesMustBePaused: true,
      evidence: [], reasoningSummary: 'risk',
    });
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    await orch.orchestrate(INPUT);

    const strategyArg = m.aiProvider.generateResponse.mock.calls[0][1];
    const ctxArg = m.aiProvider.generateResponse.mock.calls[0][2];
    expect(strategyArg.mode).toBe('crisis');
    expect(ctxArg.replyPlan).toMatchObject({
      dialogueAct: 'closing',
      responseMove: 'support_emotion',
      questionPolicy: { maxQuestions: 0, reason: 'strategy_disallows_questions' },
    });
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
      topicAnchor: null,
      mayInferFromBrevity: false,
      questionPolicy: { maxQuestions: 1, reason: 'new_substance_allows_question' },
    });
    expect(ctxArg.replyBrief).toBe(ctxArg.replyPlan);
    const strategyArg = m.aiProvider.generateResponse.mock.calls[0][1];
    expect(strategyArg.includeFollowUpQuestion).toBe(true);
  });

  it.each(['acknowledgement', 'closing'] as const)(
    'does not surface a new survey interaction on a %s turn',
    async (dialogueAct) => {
      const m = baseMocks();
      m.conversationRepo.findRecentMessages.mockResolvedValue([
        { id: 'm-0', direction: 'inbound', text: 'one', occurredAt: new Date(), metadata: undefined },
        { id: 'm-1', direction: 'inbound', text: 'two', occurredAt: new Date(), metadata: undefined },
        { id: 'm-2', direction: 'inbound', text: 'done', occurredAt: new Date(), metadata: undefined },
      ]);
      m.aiProvider.classifySituation.mockResolvedValue({
        primaryIntent: 'casual_conversation',
        secondaryIntents: [],
        emotionalState: [],
        urgency: 'low',
        confidence: 0.9,
        surveyAllowed: true,
        requiresSafetyCheck: false,
        reasoningSummary: 'pause',
        reminderRequest: null,
        dialogueAct,
        latestUserSubstance: null,
        topicAnchor: 'the release',
      });
      m.surveyRepo.findPendingConfirmationGroups.mockResolvedValue([
        { surveyWindowId: 'w-1', userId: 'u-1', tenantId: 't-1', questionGroup: 'autonomy', aiSummary: 'summary' },
      ]);
      const pulseBacklog = {
        getNextProbeQuestion: vi.fn().mockResolvedValue({
          question: { id: 'probe-1', probeStrategies: ['ask about autonomy'] },
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;
      m.aiProvider.generateResponse.mockResolvedValue({
        text: 'Done.',
        confidence: 0.9,
        containsSurveyProbe: true,
        surveyProbeQuestionId: 'hallucinated-probe',
      });
      const orch = new ConversationOrchestrator(
        m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
        undefined, undefined, m.featureFlags, undefined, pulseBacklog,
      );

      await orch.orchestrate(INPUT);

      const ctxArg = m.aiProvider.generateResponse.mock.calls[0][2];
      expect(ctxArg.confirmationRequest).toBeUndefined();
      expect(ctxArg.surveyProbeQuestion).toBeUndefined();
      expect(m.surveyRepo.findPendingConfirmationGroups).not.toHaveBeenCalled();
      expect(pulseBacklog.getNextProbeQuestion).not.toHaveBeenCalled();
      const metadata = m.conversationRepo.saveMessage.mock.calls[0][0].metadata;
      expect(metadata.containsSurveyProbe).toBe(false);
      expect(metadata.surveyProbeQuestionId).toBeUndefined();
    },
  );
});

describe('ConversationOrchestrator persisted continuity and real goals', () => {
  const parkedTopic = {
    summary: 'Ship Atlas',
    status: 'parked' as const,
    startedAt: '2026-08-01T10:00:00.000Z',
  };

  it('rejects a queue user that does not own the conversation', async () => {
    const m = baseMocks();
    m.conversationRepo.findById.mockResolvedValue({
      id: 'c-1', tenantId: 't-1', userId: 'u-other', channelType: 'slack',
    });

    await expect(orchestratorWithGoals(m).orchestrate(INPUT))
      .rejects.toThrow('does not belong to user u-1');
    expect(m.aiProvider.classifySituation).not.toHaveBeenCalled();
  });

  it('passes bounded continuity to classification and reactivates an exact re-entry', async () => {
    const m = baseMocks();
    m.conversationRepo.findById.mockResolvedValue({
      id: 'c-1',
      tenantId: 't-1',
      userId: 'u-1',
      channelType: 'slack',
      userDisplayName: 'Sam',
      userLocale: 'en',
      userTimezone: 'UTC',
      activeTopic: parkedTopic,
    });
    m.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent: 'coaching', secondaryIntents: [], emotionalState: [], urgency: 'low',
      confidence: 0.9, surveyAllowed: true, requiresSafetyCheck: false, reasoningSummary: 're-entry',
      reminderRequest: null, dialogueAct: 'continuation', latestUserSubstance: 'I made progress',
      topicAnchor: 'Ship Atlas',
    });

    await orchestratorWithGoals(m).orchestrate(INPUT);

    expect(m.aiProvider.classifySituation.mock.calls[0][1].continuitySummary).toBe('Ship Atlas');
    expect(m.aiProvider.generateResponse.mock.calls[0][2].replyPlan.topicAnchor).toBe('Ship Atlas');
    expect(m.conversationRepo.updateActiveTopic).toHaveBeenCalledWith(
      'c-1',
      't-1',
      'u-1',
      { ...parkedTopic, status: 'active' },
    );
    expect(m.conversationRepo.updateActiveTopic.mock.invocationCallOrder[0])
      .toBeLessThan(m.conversationRepo.saveMessage.mock.invocationCallOrder[0]);
  });

  it('does not treat a whitespace-variant anchor as exact persisted re-entry', async () => {
    const m = baseMocks();
    m.conversationRepo.findById.mockResolvedValue({
      id: 'c-1', tenantId: 't-1', userId: 'u-1', channelType: 'slack',
      userDisplayName: 'Sam', userLocale: 'en', userTimezone: 'UTC', activeTopic: parkedTopic,
    });
    m.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent: 'coaching', secondaryIntents: [], emotionalState: [], urgency: 'low',
      confidence: 0.9, surveyAllowed: true, requiresSafetyCheck: false, reasoningSummary: 'not exact',
      reminderRequest: null, dialogueAct: 'continuation', latestUserSubstance: 'A different update',
      topicAnchor: ' Ship Atlas ',
    });

    await orchestratorWithGoals(m).orchestrate(INPUT);

    expect(m.aiProvider.generateResponse.mock.calls[0][2].replyPlan.topicAnchor).toBe('A different update');
    expect(m.conversationRepo.updateActiveTopic).toHaveBeenCalledWith(
      'c-1',
      't-1',
      'u-1',
      expect.objectContaining({ summary: 'A different update', status: 'active' }),
    );
  });

  it('replaces an unrelated thread and keeps the prior topic and goal out of generation metadata', async () => {
    const m = baseMocks();
    const inboundAt = new Date('2026-08-20T08:30:00.000Z');
    m.conversationRepo.findRecentMessages.mockResolvedValue([
      { id: 'm-1', direction: 'inbound', text: 'roadmap update', occurredAt: inboundAt },
    ]);
    m.conversationRepo.findById.mockResolvedValue({
      id: 'c-1', tenantId: 't-1', userId: 'u-1', channelType: 'slack',
      userDisplayName: 'Sam', userLocale: 'en', userTimezone: 'UTC', activeTopic: parkedTopic,
    });
    m.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent: 'progress_update', secondaryIntents: [], emotionalState: [], urgency: 'low',
      confidence: 0.9, surveyAllowed: true, requiresSafetyCheck: false, reasoningSummary: 'new topic',
      reminderRequest: null, dialogueAct: 'new_substance',
      latestUserSubstance: 'I drafted the roadmap', topicAnchor: 'Prepare roadmap',
    });
    const goalRepo = goalRepository(async () => [goalRecord('goal-old', 'Ship Atlas')]);

    await orchestratorWithGoals(m, goalRepo).orchestrate(INPUT);

    const responseContext = m.aiProvider.generateResponse.mock.calls[0][2];
    expect(responseContext.replyPlan.topicAnchor).toBe('I drafted the roadmap');
    expect(responseContext.memoryContext).toBeUndefined();
    expect(m.conversationRepo.updateActiveTopic).toHaveBeenCalledWith(
      'c-1',
      't-1',
      'u-1',
      {
        summary: 'I drafted the roadmap',
        status: 'active',
        startedAt: inboundAt.toISOString(),
      },
    );
    const metadata = m.conversationRepo.saveMessage.mock.calls[0][0].metadata;
    expect(JSON.stringify(metadata)).not.toContain('Ship Atlas');
  });

  it('preserves a stored thread on acknowledgement without grounding it', async () => {
    const m = baseMocks();
    m.conversationRepo.findById.mockResolvedValue({
      id: 'c-1', tenantId: 't-1', userId: 'u-1', channelType: 'slack',
      userDisplayName: 'Sam', userLocale: 'en', userTimezone: 'UTC', activeTopic: parkedTopic,
    });
    m.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent: 'casual_conversation', secondaryIntents: [], emotionalState: [], urgency: 'low',
      confidence: 0.9, surveyAllowed: true, requiresSafetyCheck: false, reasoningSummary: 'ack',
      reminderRequest: null, dialogueAct: 'acknowledgement', latestUserSubstance: null,
      topicAnchor: 'Ship Atlas',
    });

    await orchestratorWithGoals(m).orchestrate(INPUT);

    expect(m.conversationRepo.updateActiveTopic).not.toHaveBeenCalled();
    expect(m.aiProvider.generateResponse.mock.calls[0][2].replyPlan.topicAnchor).toBeNull();
  });

  it('parks a stored thread on closing without grounding it', async () => {
    const m = baseMocks();
    m.conversationRepo.findById.mockResolvedValue({
      id: 'c-1', tenantId: 't-1', userId: 'u-1', channelType: 'slack',
      userDisplayName: 'Sam', userLocale: 'en', userTimezone: 'UTC',
      activeTopic: { ...parkedTopic, status: 'active' },
    });
    m.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent: 'casual_conversation', secondaryIntents: [], emotionalState: [], urgency: 'low',
      confidence: 0.9, surveyAllowed: true, requiresSafetyCheck: false, reasoningSummary: 'closing',
      reminderRequest: null, dialogueAct: 'closing', latestUserSubstance: null,
      topicAnchor: 'Ship Atlas',
    });

    await orchestratorWithGoals(m).orchestrate(INPUT);

    expect(m.aiProvider.generateResponse.mock.calls[0][2].replyPlan.topicAnchor).toBeNull();
    expect(m.conversationRepo.updateActiveTopic).toHaveBeenCalledWith(
      'c-1', 't-1', 'u-1', { ...parkedTopic, status: 'parked' },
    );
  });

  it('exposes at most one active goal on an exact normalized progress-topic match', async () => {
    const m = baseMocks();
    m.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent: 'progress_update', secondaryIntents: [], emotionalState: [], urgency: 'low',
      confidence: 0.9, surveyAllowed: true, requiresSafetyCheck: false, reasoningSummary: 'progress',
      reminderRequest: null, dialogueAct: 'continuation', latestUserSubstance: 'I shipped it',
      topicAnchor: '  SHIP   Atlas  ',
    });
    const older = goalRecord('goal-1', 'Ship Atlas');
    const newer = goalRecord('goal-2', 'ship atlas');
    older.updatedAt = new Date('2026-08-19T10:00:00.000Z');
    newer.updatedAt = new Date('2026-08-20T10:00:00.000Z');
    const goalRepo = goalRepository(async () => [older, newer, goalRecord('goal-3', 'Prepare roadmap')]);

    await orchestratorWithGoals(m, goalRepo).orchestrate(INPUT);

    expect(m.aiProvider.generateResponse.mock.calls[0][2].memoryContext.goals).toEqual([
      { id: 'goal-2', title: 'ship atlas', status: 'active' },
    ]);
    expect(goalRepo.findActiveByUser).toHaveBeenCalledWith('u-1', 't-1');
  });

  it('omits goals when the exact match fails or the goal read fails', async () => {
    const classifications = {
      primaryIntent: 'progress_update', secondaryIntents: [], emotionalState: [], urgency: 'low',
      confidence: 0.9, surveyAllowed: true, requiresSafetyCheck: false, reasoningSummary: 'progress',
      reminderRequest: null, dialogueAct: 'continuation', latestUserSubstance: 'I shipped it',
      topicAnchor: 'Ship Atlas',
    } as const;

    for (const goalRepo of [
      goalRepository(async () => [goalRecord('goal-1', 'Prepare roadmap')]),
      goalRepository(async () => { throw new Error('goal store unavailable'); }),
    ]) {
      const m = baseMocks();
      m.aiProvider.classifySituation.mockResolvedValue(classifications);

      await expect(orchestratorWithGoals(m, goalRepo).orchestrate(INPUT)).resolves.toBeDefined();
      expect(m.aiProvider.generateResponse.mock.calls[0][2].memoryContext).toBeUndefined();
    }
  });

  it('omits an exact goal on safety and confirmation turns', async () => {
    const goalRepo = goalRepository(async () => [goalRecord('goal-1', 'Ship Atlas')]);

    const safety = baseMocks();
    safety.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent: 'burnout_signal', secondaryIntents: [], emotionalState: ['exhausted'], urgency: 'high',
      confidence: 0.9, surveyAllowed: false, requiresSafetyCheck: false, reasoningSummary: 'safety',
      reminderRequest: null, dialogueAct: 'emotional_disclosure', latestUserSubstance: 'I cannot go on',
      topicAnchor: 'Ship Atlas',
    });
    safety.aiProvider.detectRisk.mockResolvedValue({
      riskType: 'burnout', severity: 'high', confidence: 0.9, evidence: [],
      immediateResponseRequired: false, escalationRecommended: false,
      surveyMustBeBlocked: true, proactiveMessagesMustBePaused: true, reasoningSummary: 'high risk',
    });

    await orchestratorWithGoals(safety, goalRepo).orchestrate(INPUT);
    expect(safety.aiProvider.generateResponse.mock.calls[0][2].memoryContext).toBeUndefined();

    const confirmation = baseMocks();
    confirmation.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent: 'progress_update', secondaryIntents: [], emotionalState: [], urgency: 'low',
      confidence: 0.9, surveyAllowed: true, requiresSafetyCheck: false, reasoningSummary: 'progress',
      reminderRequest: null, dialogueAct: 'continuation', latestUserSubstance: 'I shipped it',
      topicAnchor: 'Ship Atlas',
    });
    confirmation.surveyRepo.findPendingConfirmationGroups.mockResolvedValue([
      { surveyWindowId: 'w-1', userId: 'u-1', tenantId: 't-1', questionGroup: 'autonomy' },
    ]);

    await orchestratorWithGoals(confirmation, goalRepo).orchestrate(INPUT);
    expect(confirmation.aiProvider.generateResponse.mock.calls[0][2].confirmationRequest).toBeDefined();
    expect(confirmation.aiProvider.generateResponse.mock.calls[0][2].memoryContext).toBeUndefined();
  });

  it('treats secondary safety intent as authoritative and clears continuity and goals', async () => {
    const m = baseMocks();
    m.conversationRepo.findById.mockResolvedValue({
      id: 'c-1', tenantId: 't-1', userId: 'u-1', channelType: 'slack',
      userDisplayName: 'Sam', userLocale: 'en', userTimezone: 'UTC', activeTopic: parkedTopic,
    });
    m.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent: 'progress_update', secondaryIntents: ['burnout_signal'],
      emotionalState: ['exhausted'], urgency: 'high', confidence: 0.9,
      surveyAllowed: false, requiresSafetyCheck: false, reasoningSummary: 'secondary safety',
      reminderRequest: null, dialogueAct: 'emotional_disclosure',
      latestUserSubstance: 'I cannot keep going', topicAnchor: 'ship atlas',
    });
    m.aiProvider.detectRisk.mockResolvedValue({
      riskType: 'burnout', severity: 'high', confidence: 0.9, evidence: [],
      immediateResponseRequired: false, escalationRecommended: false,
      surveyMustBeBlocked: true, proactiveMessagesMustBePaused: true,
      reasoningSummary: 'high risk',
    });
    const goalRepo = goalRepository(async () => [goalRecord('goal-1', 'Ship Atlas')]);

    await orchestratorWithGoals(m, goalRepo).orchestrate(INPUT);

    expect(m.aiProvider.detectRisk).toHaveBeenCalled();
    const responseContext = m.aiProvider.generateResponse.mock.calls[0][2];
    expect(responseContext.replyPlan.topicAnchor).toBeNull();
    expect(responseContext.memoryContext).toBeUndefined();
  });

  it('does not forward legacy goal-category memory as real goal context', async () => {
    const m = baseMocks();
    m.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent: 'casual_conversation', secondaryIntents: [], emotionalState: [], urgency: 'low',
      confidence: 0.9, surveyAllowed: true, requiresSafetyCheck: false, reasoningSummary: 'unrelated',
      reminderRequest: null, dialogueAct: 'new_substance',
      latestUserSubstance: 'A new subject', topicAnchor: null,
    });
    const memoryRepo = {
      findActiveByUser: vi.fn().mockResolvedValue([{
        id: 'memory-goal', category: 'goal', content: 'Old pseudo-goal', importance: 1,
      }]),
    };

    await orchestratorWithGoals(m, undefined, memoryRepo).orchestrate(INPUT);

    expect(m.aiProvider.generateResponse.mock.calls[0][2].memoryContext).toBeUndefined();
  });

  it('keeps stored memory out of a correction response', async () => {
    const m = baseMocks();
    m.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent: 'clarification', secondaryIntents: [], emotionalState: [], urgency: 'low',
      confidence: 0.9, surveyAllowed: true, requiresSafetyCheck: false, reasoningSummary: 'correction',
      reminderRequest: null, dialogueAct: 'correction',
      latestUserSubstance: 'I wanted criteria for evaluating chatbot answers',
      topicAnchor: 'manager-facing pulse report',
    });
    const memoryRepo = {
      findActiveByUser: vi.fn().mockResolvedValue([{
        id: 'memory-stale', category: 'project_context',
        content: 'Employee wants a manager-facing pulse report', importance: 1,
      }]),
    };

    await orchestratorWithGoals(m, undefined, memoryRepo).orchestrate(INPUT);

    const [strategy, responseContext] = [
      m.aiProvider.generateResponse.mock.calls[0][1],
      m.aiProvider.generateResponse.mock.calls[0][2],
    ];
    expect(strategy.includeFollowUpQuestion).toBe(false);
    expect(responseContext.memoryContext).toBeUndefined();
    expect(responseContext.replyPlan.memoryAnchors).toEqual([]);
    expect(responseContext.replyPlan.questionPolicy).toEqual({
      maxQuestions: 0,
      reason: 'strategy_disallows_questions',
    });
  });

  it('keeps stored framing out for two replies after a correction', async () => {
    const m = baseMocks();
    m.conversationRepo.findRecentMessages.mockResolvedValue([
      {
        id: 'out-correction', direction: 'outbound', text: 'I was overreading that.',
        occurredAt: new Date('2026-08-28T10:00:00.000Z'), metadata: { dialogueAct: 'correction' },
      },
      {
        id: 'm-middle', direction: 'inbound', text: 'Natural and relevant.',
        occurredAt: new Date('2026-08-28T10:01:00.000Z'), metadata: undefined,
      },
      {
        id: 'out-middle', direction: 'outbound', text: 'Those need separate checks.',
        occurredAt: new Date('2026-08-28T10:02:00.000Z'), metadata: { dialogueAct: 'continuation' },
      },
      {
        id: 'm-1', direction: 'inbound', text: 'Give me the criteria.',
        occurredAt: new Date('2026-08-28T10:03:00.000Z'), metadata: undefined,
      },
    ]);
    m.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent: 'clarification', secondaryIntents: [], emotionalState: [], urgency: 'low',
      confidence: 0.9, surveyAllowed: true, requiresSafetyCheck: false, reasoningSummary: 'request',
      reminderRequest: null, dialogueAct: 'request', latestUserSubstance: 'Give me the criteria',
      topicAnchor: 'chatbot answer quality',
    });
    const memoryRepo = {
      findActiveByUser: vi.fn().mockResolvedValue([{
        id: 'memory-stale', category: 'project_context',
        content: 'manager-facing pulse report', importance: 1,
      }]),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    await orchestratorWithGoals(m, undefined, memoryRepo).orchestrate(INPUT);

    const responseContext = m.aiProvider.generateResponse.mock.calls[0][2];
    expect(responseContext.memoryContext).toBeUndefined();
    expect(responseContext.replyPlan.correctionCarryover).toBe(true);
    expect(responseContext.replyPlan.memoryAnchors).toEqual([]);
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

  it('ignores Slack connector attribution when resolving an ambiguous current turn', async () => {
    const m = baseMocks();
    m.conversationRepo.findRecentMessages.mockResolvedValue([
      { id: 'm-0', direction: 'inbound', text: 'Я переживаю из-за Atlas-9', occurredAt: new Date(), metadata: undefined },
      { id: 'out-0', direction: 'outbound', text: 'Понимаю.', occurredAt: new Date(), metadata: undefined },
      { id: 'm-1', direction: 'inbound', text: 'ok *Sent using* <@U0BPHHA21GC>', occurredAt: new Date(), metadata: undefined },
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
      tenantId: 't-1',
      userId: 'u-1',
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
      tenantId: 't-1',
      userId: 'u-1',
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
      tenantId: 't-1',
      userId: 'u-1',
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

  it('keeps one follow-up available for a terse user while the topic remains open', async () => {
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
    expect(strategyArg.includeFollowUpQuestion).toBe(true);
    expect(ctxArg.replyPlan.questionPolicy).toEqual({ maxQuestions: 1, reason: 'new_substance_allows_question' });
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

  it('persists privacy-safe decision metadata from the typed reply plan', async () => {
    const m = baseMocks();
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );
    await orch.orchestrate(INPUT);
    expect(m.conversationRepo.saveMessage).toHaveBeenCalledWith(expect.objectContaining({
      metadata: {
        measurementVersion: 'ts-conversation-decision-v1',
        dialogueAct: 'new_substance',
        responseMove: 'address_new_substance',
        replyShape: {
          askedQuestion: false,
          maxQuestions: 1,
          questionPolicyReason: 'new_substance_allows_question',
        },
        languagePolicy: {
          responseLanguage: 'en',
          source: 'user_profile',
        },
        isSessionStart: true,
        memoryGrounding: {
          used: false,
          count: 0,
        },
        containsSurveyProbe: false,
        continuityDecision: {
          action: 'replace',
          anchorSource: 'new',
          hasSubstance: true,
        },
        goalDecision: {
          selected: false,
          candidateGoalCount: 0,
          reason: 'not_selected',
        },
      },
    }));
  });

  it('records an Armenian question mark in decision metadata', async () => {
    const m = baseMocks();
    m.aiProvider.generateResponse.mockResolvedValue({
      text: 'What changes next՞',
      confidence: 0.9,
      containsSurveyProbe: false,
    });
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    await orch.orchestrate(INPUT);

    const metadata = m.conversationRepo.saveMessage.mock.calls[0][0].metadata;
    expect(metadata.replyShape).toMatchObject({ askedQuestion: true, maxQuestions: 1 });
  });

  it('records memory grounding usage without persisting memory or topic text', async () => {
    const m = baseMocks();
    const memoryRepo = {
      findActiveByUser: vi.fn().mockResolvedValue([
        {
          id: 'memory-1',
          tenantId: 't-1',
          userId: 'u-1',
          category: 'concern',
          content: 'Private Project Atlas concern',
          importance: 0.9,
          status: 'active',
        },
      ]),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    m.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent: 'casual_conversation',
      secondaryIntents: [],
      emotionalState: ['worried'],
      urgency: 'low',
      confidence: 0.9,
      surveyAllowed: true,
      requiresSafetyCheck: false,
      reasoningSummary: 'test-only classifier output',
      reminderRequest: null,
      dialogueAct: 'emotional_disclosure',
      latestUserSubstance: 'I am worried',
      topicAnchor: 'Private topic anchor',
    });
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, memoryRepo, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    await orch.orchestrate(INPUT);

    const metadata = m.conversationRepo.saveMessage.mock.calls[0][0].metadata;
    expect(metadata.memoryGrounding).toEqual({ used: true, count: 1 });
    expect(Object.keys(metadata).sort()).toEqual([
      'containsSurveyProbe',
      'continuityDecision',
      'dialogueAct',
      'goalDecision',
      'isSessionStart',
      'languagePolicy',
      'measurementVersion',
      'memoryGrounding',
      'replyShape',
      'responseMove',
    ]);
    expect(JSON.stringify(metadata)).not.toContain('Private Project Atlas concern');
    expect(JSON.stringify(metadata)).not.toContain('Private topic anchor');
    expect(JSON.stringify(metadata)).not.toContain('test-only classifier output');
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
    m.conversationRepo.findById.mockResolvedValue({
      id: 'c-1', tenantId: 't-1', userId: 'u-1', channelType: 'slack',
      userDisplayName: 'Sam', userTimezone: undefined,
    });
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
