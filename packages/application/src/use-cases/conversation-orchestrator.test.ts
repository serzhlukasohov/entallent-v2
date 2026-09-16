import { describe, it, expect, vi } from 'vitest';
import { ConversationOrchestrator } from './conversation-orchestrator';
import {
  REPORTING_DISCLOSURE_VERSION,
  getReportingDisclosureText,
  getReportingExplanationText,
} from '../utils/reporting-disclosure';
import type { GoalRepositoryPort } from '../ports/goal.repository.port';
import type { UserGoalRecord } from '../types/records';

const INBOUND_OCCURRED_AT = new Date('2026-09-03T10:00:00.000Z');
const OWNERSHIP = { conversationId: 'c-1', tenantId: 't-1', userId: 'u-1' };

function baseMocks() {
  const conversationRepo = {
    findById: vi.fn().mockResolvedValue({ id: 'c-1', tenantId: 't-1', userId: 'u-1', channelType: 'slack', userDisplayName: 'Sam', userLocale: 'en', userTimezone: 'UTC' }),
    findRecentMessages: vi.fn().mockResolvedValue([
      { id: 'm-1', ...OWNERSHIP, direction: 'inbound', text: 'hey', occurredAt: INBOUND_OCCURRED_AT, metadata: undefined },
    ]),
    findLatestDeliveredReportingDisclosure: vi.fn().mockResolvedValue({
      messageId: 'disclosure-1',
      version: REPORTING_DISCLOSURE_VERSION,
      shownAt: new Date('2026-09-03T09:00:00.000Z'),
    }),
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
    scoreSentiment: vi.fn().mockResolvedValue(0.9),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const outbox = { enqueueMessageSend: vi.fn(), enqueueMemoryExtraction: vi.fn(), enqueueSurveyEvidence: vi.fn(), enqueueGroupReport: vi.fn(), enqueueStyleAnalysis: vi.fn(), enqueueProfileHydration: vi.fn() } as any;
  const surveyRepo = {
    findPendingConfirmationGroups: vi.fn().mockResolvedValue([]),
    findAwaitingConfirmationGroups: vi.fn().mockResolvedValue([]),
    findOrCreateActiveWindow: vi.fn().mockResolvedValue({ id: 'w-1' }),
    findQuestionsForWindow: vi.fn().mockResolvedValue([{ id: 'q-1', stableKey: 'q12', questionGroup: 'autonomy' }]),
    findEvidenceForQuestion: vi.fn().mockResolvedValue([{
      evidenceSummary: 'values ownership',
      polarity: 'positive',
      createdAt: new Date(),
      sourceMessageIds: ['m-1'],
    }]),
    findAssessmentsForWindow: vi.fn().mockResolvedValue([]),
    upsertGroupState: vi.fn().mockResolvedValue({}),
    recordGroupDeidentificationDecision: vi.fn().mockResolvedValue(true),
    stageGroupConfirmation: vi.fn().mockResolvedValue(true),
    transitionAwaitingGroupState: vi.fn().mockResolvedValue(true),
    withdrawGroupState: vi.fn().mockResolvedValue(true),
    confirmGroupState: vi.fn().mockResolvedValue(true),
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

const ACCEPTED_DEIDENTIFICATION = {
  status: 'accepted' as const,
  policyVersion: 'deidentification-v1' as const,
  reasons: [],
};

function surveyReadyHistory() {
  return [
    { id: 'm-prior-1', ...OWNERSHIP, direction: 'inbound', text: 'first', occurredAt: new Date('2026-09-03T09:58:00.000Z'), metadata: undefined },
    { id: 'm-prior-2', ...OWNERSHIP, direction: 'inbound', text: 'second', occurredAt: new Date('2026-09-03T09:59:00.000Z'), metadata: undefined },
    { id: 'm-1', ...OWNERSHIP, direction: 'inbound', text: 'hey', occurredAt: INBOUND_OCCURRED_AT, metadata: undefined },
  ];
}

function d05ReadyHistory(text: string) {
  return [
    { id: 'm-prior-1', ...OWNERSHIP, direction: 'inbound', text: 'first', occurredAt: new Date('2026-09-03T09:58:00.000Z'), metadata: undefined },
    { id: 'm-prior-2', ...OWNERSHIP, direction: 'inbound', text: 'second', occurredAt: new Date('2026-09-03T09:59:00.000Z'), metadata: undefined },
    { id: 'm-1', ...OWNERSHIP, direction: 'inbound', text, occurredAt: INBOUND_OCCURRED_AT, metadata: undefined },
  ];
}

function d05RepeatedTeamScoreHistory(text: string) {
  return [
    { id: 'm-prior-1', ...OWNERSHIP, direction: 'inbound', text: 'first', occurredAt: new Date('2026-09-03T09:57:00.000Z'), metadata: undefined },
    { id: 'm-prior-2', ...OWNERSHIP, direction: 'inbound', text: 'second', occurredAt: new Date('2026-09-03T09:58:00.000Z'), metadata: undefined },
    { id: 'm-prior-3', ...OWNERSHIP, direction: 'inbound', text: 'What are the engagement scores for my team this quarter?', occurredAt: new Date('2026-09-03T09:59:00.000Z'), metadata: undefined },
    { id: 'm-1', ...OWNERSHIP, direction: 'inbound', text, occurredAt: INBOUND_OCCURRED_AT, metadata: undefined },
  ];
}

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

describe('ConversationOrchestrator reporting disclosure gate', () => {
  it('rejects a conversation owned by another user before reading disclosure proof', async () => {
    const m = baseMocks();
    m.conversationRepo.findById.mockResolvedValue({
      id: 'c-1', tenantId: 't-1', userId: 'u-other', channelType: 'slack',
    });
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    await expect(orch.orchestrate(INPUT)).rejects.toThrow('Conversation ownership mismatch');
    expect(m.conversationRepo.findRecentMessages).not.toHaveBeenCalled();
  });

  it('rejects a confirming message outside the conversation ownership before reading disclosure proof', async () => {
    const m = baseMocks();
    m.conversationRepo.findRecentMessages.mockResolvedValue([
      {
        id: 'm-1',
        ...OWNERSHIP,
        userId: 'u-other',
        direction: 'inbound',
        text: 'yes',
        occurredAt: INBOUND_OCCURRED_AT,
      },
    ]);
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    await expect(orch.orchestrate(INPUT)).rejects.toThrow('Inbound message ownership mismatch');
    expect(m.conversationRepo.findLatestDeliveredReportingDisclosure).not.toHaveBeenCalled();
  });

  it('keeps a fresh first safe turn free of reporting disclosure', async () => {
    const m = baseMocks();
    m.conversationRepo.findLatestDeliveredReportingDisclosure.mockResolvedValue(null);
    m.aiProvider.generateResponse.mockResolvedValue({
      text: 'Я рядом.', confidence: 0.9, containsSurveyProbe: false,
    });
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    const result = await orch.orchestrate(INPUT);

    expect(result.responseText).toBe('Я рядом.');
    expect(m.aiProvider.generateResponse.mock.calls[0][2]).toMatchObject({
      confirmationRequest: undefined,
      surveyProbeQuestion: undefined,
      reportingDisclosure: undefined,
    });
    expect(m.conversationRepo.saveMessage.mock.calls[0][0].metadata)
      .not.toHaveProperty('reportingDisclosureVersion');
  });

  it('keeps a chatbot consultation free of reporting disclosure when survey pacing is ready', async () => {
    const m = baseMocks();
    m.conversationRepo.findRecentMessages.mockResolvedValue(surveyReadyHistory());
    m.conversationRepo.findLatestDeliveredReportingDisclosure.mockResolvedValue(null);
    m.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent: 'feedback_request', secondaryIntents: [], urgency: 'low',
      emotionalState: [], confidence: 0.95, reasoningSummary: 'chatbot evaluation consultation',
      surveyAllowed: true, requiresSafetyCheck: false, reminderRequest: null,
      dialogueAct: 'new_substance',
      latestUserSubstance: 'Give criteria for human-like and relevant chatbot answers.',
      topicAnchor: 'chatbot answer quality',
    });
    m.aiProvider.generateResponse.mockResolvedValue({
      text: 'Use relevance, specificity, continuity, and natural phrasing.',
      confidence: 0.9,
      containsSurveyProbe: false,
    });
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    const result = await orch.orchestrate(INPUT);

    expect(result.responseText).toBe('Use relevance, specificity, continuity, and natural phrasing.');
    expect(m.aiProvider.generateResponse.mock.calls[0][2].reportingDisclosure).toBeUndefined();
    expect(m.conversationRepo.saveMessage.mock.calls[0][0].metadata)
      .not.toHaveProperty('reportingDisclosureVersion');
  });

  it.each([
    [
      'D05-01 onboarding statement',
      'you know, the onboarding in this company is great',
      'casual_conversation',
      'new_substance',
      'Onboarding sounds like a good start.',
      null,
    ],
    [
      'D05-02 reminder request',
      'Can you help me set a reminder to finish the Q3 report by Friday?',
      'support',
      'request',
      'I can help with that reminder.',
      { intent: 'finish the Q3 report', dueAt: '2026-09-15T09:00:00.000Z' },
    ],
    [
      'D05-02 change-detail question',
      'What and where exactly did you change? Because you didn’t ask me about the client specifically?',
      'clarification',
      'request',
      'I changed the requested details and can clarify the client part.',
      null,
    ],
    [
      'D05-02 client-deck question',
      'Can you remind me what exact client deck I have on Monday? Email, name, etc?',
      'clarification',
      'request',
      'I do not have enough information to identify that deck.',
      null,
    ],
    [
      'D05-02 first team-score question',
      'What are the engagement scores for my team this quarter?',
      'clarification',
      'request',
      'I cannot access your team scores here.',
      null,
    ],
    [
      'D05-02 repeated team-score question',
      'What are the engagement scores for my team this quarter?',
      'clarification',
      'request',
      'I cannot access your team scores here.',
      null,
    ],
  ] as const)('keeps %s answer free of unrelated reporting disclosure', async (
    _case,
    text,
    primaryIntent,
    dialogueAct,
    requestedReply,
    reminderRequest,
  ) => {
    const m = baseMocks();
    m.conversationRepo.findRecentMessages.mockResolvedValue(
      _case === 'D05-02 repeated team-score question'
        ? d05RepeatedTeamScoreHistory(text)
        : d05ReadyHistory(text),
    );
    m.conversationRepo.findLatestDeliveredReportingDisclosure.mockResolvedValue(null);
    m.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent,
      secondaryIntents: [],
      urgency: 'low',
      emotionalState: [],
      confidence: 0.95,
      surveyAllowed: true,
      requiresSafetyCheck: false,
      reasoningSummary: 'CAP-7 regression classification',
      reminderRequest,
      dialogueAct,
      latestUserSubstance: text,
      topicAnchor: null,
    });
    m.aiProvider.generateResponse.mockResolvedValue({
      text: requestedReply,
      confidence: 0.9,
      containsSurveyProbe: false,
    });
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    const result = await orch.orchestrate(INPUT);
    const context = m.aiProvider.generateResponse.mock.calls[0][2];
    const metadata = m.conversationRepo.saveMessage.mock.calls[0][0].metadata;

    expect(result.responseText).toBe(requestedReply);
    expect(result.responseText).not.toContain(getReportingDisclosureText('en'));
    expect(context.reportingDisclosure).toBeUndefined();
    expect(metadata).not.toHaveProperty('reportingDisclosureVersion');
  });

  it('recovers persisted awaiting confirmation with the localized disclosure', async () => {
    const m = baseMocks();
    m.conversationRepo.findRecentMessages.mockResolvedValue(surveyReadyHistory());
    m.conversationRepo.findLatestDeliveredReportingDisclosure.mockResolvedValue(null);
    m.conversationRepo.findById.mockResolvedValue({
      id: 'c-1', tenantId: 't-1', userId: 'u-1', channelType: 'slack', userDisplayName: 'Sam', userLocale: 'ru', userTimezone: 'UTC',
    });
    m.surveyRepo.findAwaitingConfirmationGroups.mockResolvedValue([
      {
        surveyWindowId: 'w-1', userId: 'u-1', tenantId: 't-1', questionGroup: 'autonomy', aiSummary: 's',
        confirmationPromptMessageId: 'out-confirmation-1',
      },
    ]);
    m.aiProvider.generateResponse.mockResolvedValue({
      text: 'Я рядом.', confidence: 0.9, containsSurveyProbe: true, surveyProbeQuestionId: 'q-1',
    });
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    const result = await orch.orchestrate(INPUT);

    const expectedText = `Я рядом.\n\n${getReportingDisclosureText('ru')}`;
    expect(result.responseText).toBe(expectedText);
    expect(m.aiProvider.generateResponse.mock.calls[0][2]).toMatchObject({
      confirmationRequest: undefined,
      surveyProbeQuestion: undefined,
      reportingDisclosure: getReportingDisclosureText('ru'),
    });
    expect(m.conversationRepo.saveMessage).toHaveBeenCalledWith(expect.objectContaining({
      text: expectedText,
      metadata: expect.objectContaining({
        reportingDisclosureVersion: REPORTING_DISCLOSURE_VERSION,
        containsSurveyProbe: false,
      }),
    }));
    expect(m.outbox.enqueueMessageSend).toHaveBeenCalledWith(expect.objectContaining({ text: expectedText }));
    expect(m.surveyRepo.transitionAwaitingGroupState).toHaveBeenCalledWith(
      expect.objectContaining({
        questionGroup: 'autonomy',
        status: 'pending_confirmation',
      }),
    );
  });

  it('does not append a second disclosure when the generated response already contains it', async () => {
    const m = baseMocks();
    const disclosure = getReportingDisclosureText('en');
    m.conversationRepo.findRecentMessages.mockResolvedValue(surveyReadyHistory());
    m.conversationRepo.findLatestDeliveredReportingDisclosure.mockResolvedValue(null);
    m.surveyRepo.findAwaitingConfirmationGroups.mockResolvedValue([
      {
        surveyWindowId: 'w-1', userId: 'u-1', tenantId: 't-1', questionGroup: 'growth', aiSummary: 's',
        confirmationPromptMessageId: 'out-confirmation-1',
      },
    ]);
    m.aiProvider.generateResponse.mockResolvedValue({
      text: disclosure,
      confidence: 0.9,
      containsSurveyProbe: false,
    });
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    const result = await orch.orchestrate(INPUT);

    expect(result.responseText).toBe(disclosure);
    expect(m.conversationRepo.saveMessage.mock.calls[0][0].metadata)
      .toHaveProperty('reportingDisclosureVersion', REPORTING_DISCLOSURE_VERSION);
  });

  it('does not disclose when pacing is ready but only a pending group exists without a receipt', async () => {
    const m = baseMocks();
    m.conversationRepo.findRecentMessages.mockResolvedValue(surveyReadyHistory());
    m.conversationRepo.findLatestDeliveredReportingDisclosure.mockResolvedValue(null);
    m.surveyRepo.findPendingConfirmationGroups.mockResolvedValue([
      { surveyWindowId: 'w-1', userId: 'u-1', tenantId: 't-1', questionGroup: 'growth', aiSummary: 's' },
    ]);
    m.aiProvider.generateResponse.mockResolvedValue({
      text: 'Requested ordinary answer.',
      confidence: 0.9,
      containsSurveyProbe: false,
    });
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    const result = await orch.orchestrate(INPUT);

    expect(result.responseText).toBe('Requested ordinary answer.');
    expect(m.aiProvider.generateResponse.mock.calls[0][2].reportingDisclosure).toBeUndefined();
    expect(m.conversationRepo.saveMessage.mock.calls[0][0].metadata)
      .not.toHaveProperty('reportingDisclosureVersion');
    expect(m.surveyRepo.findPendingConfirmationGroups).not.toHaveBeenCalled();
  });

  it('answers a reporting explanation request deterministically without confirming or probing', async () => {
    const m = baseMocks();
    m.conversationRepo.findById.mockResolvedValue({
      id: 'c-1', tenantId: 't-1', userId: 'u-1', channelType: 'slack',
      userDisplayName: 'Sam', userLocale: 'ru', userTimezone: 'UTC',
    });
    m.conversationRepo.findRecentMessages.mockResolvedValue([
      {
        id: 'm-1', ...OWNERSHIP, direction: 'inbound',
        text: 'Куда пойдёт подтверждённая информация?',
        occurredAt: INBOUND_OCCURRED_AT,
      },
    ]);
    m.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent: 'reporting_explanation', secondaryIntents: [], urgency: 'low',
      emotionalState: [], confidence: 0.95, reasoningSummary: 'explicit reporting question',
      surveyAllowed: true, requiresSafetyCheck: false, reminderRequest: null,
      dialogueAct: 'request', latestUserSubstance: 'reporting question', topicAnchor: null,
    });
    m.surveyRepo.findAwaitingConfirmationGroups.mockResolvedValue([
      { surveyWindowId: 'w-1', userId: 'u-1', tenantId: 't-1', questionGroup: 'growth', aiSummary: 's' },
    ]);
    m.aiProvider.interpretConfirmationResponse.mockResolvedValue({ verdict: 'agree' });
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    const result = await orch.orchestrate(INPUT);

    expect(result.responseText).toBe(getReportingExplanationText('ru'));
    expect(m.aiProvider.interpretConfirmationResponse).not.toHaveBeenCalled();
    expect(m.aiProvider.generateResponse).not.toHaveBeenCalled();
    expect(m.surveyRepo.transitionAwaitingGroupState).toHaveBeenCalledWith(
      expect.objectContaining({ questionGroup: 'growth', status: 'pending_confirmation' }),
    );
    expect(m.surveyRepo.confirmGroupState).not.toHaveBeenCalled();
    expect(m.outbox.enqueueGroupReport).not.toHaveBeenCalled();
  });

  it('explains that pulse confirmation does not grant HR individual access', async () => {
    const m = baseMocks();
    const question = 'If I confirm a pulse summary, does that let HR read my own answers?';
    m.conversationRepo.findRecentMessages.mockResolvedValue([
      {
        id: 'm-1', ...OWNERSHIP, direction: 'inbound',
        text: question,
        occurredAt: INBOUND_OCCURRED_AT,
      },
    ]);
    m.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent: 'reporting_explanation', secondaryIntents: [], urgency: 'low',
      emotionalState: [], confidence: 0.95, reasoningSummary: 'individual access question',
      surveyAllowed: true, requiresSafetyCheck: false, reminderRequest: null,
      dialogueAct: 'request', latestUserSubstance: question, topicAnchor: null,
    });
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    const result = await orch.orchestrate(INPUT);
    const answer = result.responseText.toLowerCase();

    expect(answer).toContain('approves only the exact de-identified summary shown');
    expect(answer).toContain('does not change access permissions');
    expect(answer).toContain('managers or hr');
    expect(answer).toContain('individual messages, answers, personal summary, tasks, goals, or identity');
    expect(result.responseText).toContain(getReportingDisclosureText('en'));
    expect(answer).not.toMatch(/assume admins may see|visible to (?:the )?people who administer|depending on (?:the )?setup/);
    expect(m.aiProvider.generateResponse).not.toHaveBeenCalled();
  });

  it('explains that unconfirmed answers may be retained but cannot enter reports', async () => {
    const m = baseMocks();
    const question = "And if I don't confirm it, can my answers still be used in team reports?";
    m.conversationRepo.findRecentMessages.mockResolvedValue([
      {
        id: 'm-1', ...OWNERSHIP, direction: 'inbound',
        text: question,
        occurredAt: INBOUND_OCCURRED_AT,
      },
    ]);
    m.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent: 'reporting_explanation', secondaryIntents: [], urgency: 'low',
      emotionalState: [], confidence: 0.95, reasoningSummary: 'unconfirmed reporting question',
      surveyAllowed: false, requiresSafetyCheck: false, reminderRequest: null,
      dialogueAct: 'request', latestUserSubstance: question, topicAnchor: null,
    });
    m.surveyRepo.findAwaitingConfirmationGroups.mockResolvedValue([
      {
        surveyWindowId: 'w-1', userId: 'u-1', tenantId: 't-1', questionGroup: 'growth',
        aiSummary: 's', confirmationPromptMessageId: 'out-confirmation-1',
      },
    ]);
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    const result = await orch.orchestrate(INPUT);
    const answer = result.responseText.toLowerCase();

    expect(answer).toContain('may still be retained under product retention rules');
    expect(answer).toContain('storage alone never makes it reportable');
    expect(answer).toContain('unconfirmed pulse answers and temporary summaries');
    expect(answer).toContain('scoring, aggregation, themes, recommendations, intermediate reports, or final reports');
    expect(answer).toContain('confirmed, de-identified, and non-withdrawn');
    expect(answer).not.toMatch(
      /possibly|depending on (?:the )?setup|rolled up into reports|may be rolled into reporting|\bdeleted\b|never stored/,
    );
    expect(m.aiProvider.generateResponse).not.toHaveBeenCalled();
    expect(m.aiProvider.interpretConfirmationResponse).not.toHaveBeenCalled();
    expect(m.surveyRepo.findAwaitingConfirmationGroups).not.toHaveBeenCalled();
    expect(m.surveyRepo.upsertGroupState).not.toHaveBeenCalled();
    expect(m.surveyRepo.stageGroupConfirmation).not.toHaveBeenCalled();
    expect(m.surveyRepo.transitionAwaitingGroupState).not.toHaveBeenCalled();
    expect(m.surveyRepo.withdrawGroupState).not.toHaveBeenCalled();
    expect(m.surveyRepo.confirmGroupState).not.toHaveBeenCalled();
    expect(m.outbox.enqueueGroupReport).not.toHaveBeenCalled();
  });

  it('answers exact D02-03 with complete product data use and no survey mutation', async () => {
    const m = baseMocks();
    const question = 'What do you use my messages for? Are you a real person?';
    m.conversationRepo.findRecentMessages.mockResolvedValue([
      {
        id: 'm-1', ...OWNERSHIP, direction: 'inbound',
        text: question,
        occurredAt: INBOUND_OCCURRED_AT,
      },
    ]);
    m.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent: 'data_use_explanation', secondaryIntents: [], urgency: 'low',
      emotionalState: [], confidence: 0.95, reasoningSummary: 'product data-use question',
      surveyAllowed: true, requiresSafetyCheck: false, reminderRequest: null,
      dialogueAct: 'request', latestUserSubstance: question, topicAnchor: null,
    });
    m.surveyRepo.findAwaitingConfirmationGroups.mockResolvedValue([
      {
        surveyWindowId: 'w-1', userId: 'u-1', tenantId: 't-1', questionGroup: 'growth',
        aiSummary: 's', confirmationPromptMessageId: 'out-confirmation-1',
      },
    ]);
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    const result = await orch.orchestrate(INPUT);
    const answer = result.responseText.toLowerCase();

    expect(answer).toContain('i am an ai assistant, not a human');
    expect(answer).toContain('respond in this conversation');
    expect(answer).toContain('private memory');
    expect(answer).toContain('goals, tasks, or reminders');
    expect(answer).toContain('pulse measurement');
    expect(answer).toContain('confirmed, de-identified, and non-withdrawn');
    expect(answer).toContain('safety checks');
    expect(answer).toContain('product retention rules');
    expect(answer).toContain('audited internal admin and debugging access');
    expect(answer).not.toMatch(/only to reply|depending on (?:the )?setup|human review|model training/);
    expect(m.aiProvider.generateResponse).not.toHaveBeenCalled();
    expect(m.aiProvider.interpretConfirmationResponse).not.toHaveBeenCalled();
    expect(m.surveyRepo.findAwaitingConfirmationGroups).not.toHaveBeenCalled();
    expect(m.surveyRepo.upsertGroupState).not.toHaveBeenCalled();
    expect(m.surveyRepo.stageGroupConfirmation).not.toHaveBeenCalled();
    expect(m.surveyRepo.transitionAwaitingGroupState).not.toHaveBeenCalled();
    expect(m.surveyRepo.withdrawGroupState).not.toHaveBeenCalled();
    expect(m.surveyRepo.confirmGroupState).not.toHaveBeenCalled();
    expect(m.outbox.enqueueGroupReport).not.toHaveBeenCalled();
    expect(m.conversationRepo.saveMessage.mock.calls[0][0].metadata)
      .not.toHaveProperty('reportingDisclosureVersion');
  });

  it.each([
    ['en-US', [
      'i am an ai assistant, not a human', 'respond in this conversation', 'private memory',
      'goals, tasks, or reminders', 'pulse measurement', 'confirmed, de-identified, and non-withdrawn',
      'safety checks', 'product retention rules', 'audited internal admin and debugging access',
    ], /only to reply|depending on (?:the )?setup|human review|model training/],
    ['ru-RU', [
      'я — ии-помощник, а не человек', 'отвечать в этом разговоре', 'личной памяти',
      'целей, задач или напоминаний', 'измерения пульса команды', 'после подтверждения и обезличивания',
      'если оно не отозвано', 'проверок безопасности', 'правилам хранения продукта',
      'внутренний административный доступ', 'аудируется',
    ], /только для ответ|в зависимости от настроек|провер(?:ка|яется) человеком|обучени[ея] модел/],
    ['uk-UA', [
      'я — ші-помічник, а не людина', 'відповідати в цій розмові', 'приватної пам’яті',
      'цілей, завдань або нагадувань', 'вимірювання пульсу команди', 'після підтвердження й знеособлення',
      'якщо його не відкликано', 'перевірок безпеки', 'правилами зберігання продукту',
      'внутрішній адміністративний доступ', 'аудитується',
    ], /лише для відпов|залежно від налаштувань|перевір(?:ка|яється) людиною|навчанн[яі] модел/],
    ['fr-FR', [
      'i am an ai assistant, not a human', 'respond in this conversation', 'private memory',
      'goals, tasks, or reminders', 'pulse measurement', 'confirmed, de-identified, and non-withdrawn',
      'safety checks', 'product retention rules', 'audited internal admin and debugging access',
    ], /only to reply|depending on (?:the )?setup|human review|model training/],
  ] as const)('localizes the complete CAP-5 policy for %s', async (locale, required, forbidden) => {
    const m = baseMocks();
    m.conversationRepo.findById.mockResolvedValue({
      id: 'c-1', tenantId: 't-1', userId: 'u-1', channelType: 'slack',
      userDisplayName: 'Sam', userLocale: locale, userTimezone: 'UTC',
    });
    m.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent: 'data_use_explanation', secondaryIntents: [], urgency: 'low',
      emotionalState: [], confidence: 0.95, reasoningSummary: 'product data-use question',
      surveyAllowed: false, requiresSafetyCheck: false, reminderRequest: null,
      dialogueAct: 'request', latestUserSubstance: 'data use', topicAnchor: null,
    });
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    const result = await orch.orchestrate(INPUT);

    const answer = result.responseText.toLowerCase();
    for (const phrase of required) expect(answer).toContain(phrase);
    expect(answer).not.toMatch(forbidden);
    expect(m.aiProvider.generateResponse).not.toHaveBeenCalled();
    expect(m.conversationRepo.saveMessage.mock.calls[0][0].metadata)
      .not.toHaveProperty('reportingDisclosureVersion');
  });

  it('suppresses the CAP-5 answer on a survey-blocking safety turn', async () => {
    const m = baseMocks();
    m.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent: 'potential_crisis', secondaryIntents: ['data_use_explanation'], urgency: 'critical',
      emotionalState: ['unsafe'], confidence: 0.9, reasoningSummary: 'risk',
      surveyAllowed: false, requiresSafetyCheck: true, reminderRequest: null,
      dialogueAct: 'emotional_disclosure', latestUserSubstance: 'unsafe data-use question', topicAnchor: null,
    });
    m.aiProvider.detectRisk.mockResolvedValue({
      severity: 'critical', riskType: 'self_harm', confidence: 0.9,
      surveyMustBeBlocked: true, immediateResponseRequired: true,
    });
    m.aiProvider.generateResponse.mockResolvedValue({
      text: 'Please contact emergency support now.', confidence: 0.9, containsSurveyProbe: false,
    });
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    const result = await orch.orchestrate(INPUT);

    expect(result.responseText).toBe('Please contact emergency support now.');
    expect(m.aiProvider.generateResponse).toHaveBeenCalledTimes(1);
    expect(m.conversationRepo.saveMessage.mock.calls[0][0].metadata)
      .not.toHaveProperty('reportingDisclosureVersion');
  });

  it.each([
    ['en-US', 'storage alone never makes it reportable', 'confirmed, de-identified, and non-withdrawn'],
    ['ru-RU', 'само хранение никогда не делает их доступными для отчётности', 'если оно не отозвано'],
    ['uk-UA', 'саме зберігання ніколи не робить їх придатними для звітності', 'якщо його не відкликано'],
    ['fr-FR', 'storage alone never makes it reportable', 'confirmed, de-identified, and non-withdrawn'],
  ])('localizes the CAP-4 boundary for %s', (locale, retentionBoundary, eligibilityBoundary) => {
    const answer = getReportingExplanationText(locale).toLowerCase();

    expect(answer).toContain(retentionBoundary);
    expect(answer).toContain(eligibilityBoundary);
    expect(answer).toContain(getReportingDisclosureText(locale).toLowerCase());
  });

  it('answers reporting access deterministically when surveyAllowed is falsely disabled', async () => {
    const m = baseMocks();
    const question = 'If I confirm a pulse summary, does that let HR read my own answers?';
    m.conversationRepo.findRecentMessages.mockResolvedValue([
      {
        id: 'm-1', ...OWNERSHIP, direction: 'inbound', text: question,
        occurredAt: INBOUND_OCCURRED_AT,
      },
    ]);
    m.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent: 'reporting_explanation', secondaryIntents: [], urgency: 'low',
      emotionalState: [], confidence: 0.95, reasoningSummary: 'individual access question',
      surveyAllowed: false, requiresSafetyCheck: false, reminderRequest: null,
      dialogueAct: 'request', latestUserSubstance: question, topicAnchor: null,
    });
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    const result = await orch.orchestrate(INPUT);

    expect(result.responseText).toBe(getReportingExplanationText('en'));
    expect(m.aiProvider.generateResponse).not.toHaveBeenCalled();
  });

  it('answers a reporting explanation defaulted to new substance deterministically', async () => {
    const m = baseMocks();
    m.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent: 'reporting_explanation', secondaryIntents: [], urgency: 'low',
      emotionalState: [], confidence: 0.95, reasoningSummary: 'reporting question',
      surveyAllowed: true, requiresSafetyCheck: false, reminderRequest: null,
      dialogueAct: 'new_substance', latestUserSubstance: 'reporting question', topicAnchor: null,
    });
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    const result = await orch.orchestrate(INPUT);

    expect(result.responseText).toBe(getReportingExplanationText('en'));
    expect(m.aiProvider.generateResponse).not.toHaveBeenCalled();
  });

  it.each([
    ['after disclosure when the acknowledgement has substantive privacy text', true, 'Where will this information go?'],
    ['when no earlier disclosure was delivered', false, null],
  ] as const)('answers reporting explanation %s', async (_case, hasReceipt, latestUserSubstance) => {
    const m = baseMocks();
    if (!hasReceipt) m.conversationRepo.findLatestDeliveredReportingDisclosure.mockResolvedValue(null);
    m.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent: 'reporting_explanation', secondaryIntents: [], urgency: 'low',
      emotionalState: [], confidence: 0.95, reasoningSummary: 'reporting question',
      surveyAllowed: true, requiresSafetyCheck: false, reminderRequest: null,
      dialogueAct: 'acknowledgement', latestUserSubstance, topicAnchor: 'reporting privacy',
    });
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    const result = await orch.orchestrate(INPUT);

    expect(result.responseText).toBe(getReportingExplanationText('en'));
    expect(m.aiProvider.generateResponse).not.toHaveBeenCalled();
  });

  it.each([
    ['individual access', 'I might hurt myself. Can my manager open my messages?'],
    ['unconfirmed reporting', "I might hurt myself. And if I don't confirm it, can my answers still be used in team reports?"],
  ])('keeps a survey-blocking safety response free of reporting disclosure for %s', async (_case, question) => {
    const m = baseMocks();
    m.conversationRepo.findRecentMessages.mockResolvedValue([
      {
        id: 'm-1', ...OWNERSHIP, direction: 'inbound', text: question,
        occurredAt: INBOUND_OCCURRED_AT,
      },
    ]);
    m.conversationRepo.findLatestDeliveredReportingDisclosure.mockResolvedValue(null);
    m.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent: 'potential_crisis', secondaryIntents: ['reporting_explanation'], urgency: 'critical',
      emotionalState: ['unsafe'], confidence: 0.9, reasoningSummary: 'risk',
      surveyAllowed: false, requiresSafetyCheck: true, reminderRequest: null,
      dialogueAct: 'emotional_disclosure', latestUserSubstance: question, topicAnchor: null,
    });
    m.aiProvider.detectRisk.mockResolvedValue({
      severity: 'critical', riskType: 'self_harm', confidence: 0.9,
      surveyMustBeBlocked: true, immediateResponseRequired: true,
    });
    m.aiProvider.generateResponse.mockResolvedValue({
      text: 'Please contact emergency support now.', confidence: 0.9, containsSurveyProbe: false,
    });
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    const result = await orch.orchestrate(INPUT);

    expect(result.responseText).toBe('Please contact emergency support now.');
    expect(m.aiProvider.generateResponse.mock.calls[0][2].reportingDisclosure).toBeUndefined();
    expect(m.conversationRepo.saveMessage.mock.calls[0][0].metadata)
      .not.toHaveProperty('reportingDisclosureVersion');
  });

  it('does not confirm an awaiting group on a survey-blocking safety turn', async () => {
    const m = baseMocks();
    m.surveyRepo.findAwaitingConfirmationGroups.mockResolvedValue([
      { surveyWindowId: 'w-1', userId: 'u-1', tenantId: 't-1', questionGroup: 'growth', aiSummary: 's' },
    ]);
    m.aiProvider.interpretConfirmationResponse.mockResolvedValue({ verdict: 'agree' });
    m.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent: 'potential_crisis', secondaryIntents: [], urgency: 'critical',
      emotionalState: ['unsafe'], confidence: 0.9, reasoningSummary: 'risk',
      surveyAllowed: false, requiresSafetyCheck: true, reminderRequest: null,
      dialogueAct: 'emotional_disclosure', latestUserSubstance: 'unsafe', topicAnchor: null,
    });
    m.aiProvider.detectRisk.mockResolvedValue({
      severity: 'critical', riskType: 'self_harm', confidence: 0.9,
      surveyMustBeBlocked: true, immediateResponseRequired: true,
    });
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    await orch.orchestrate(INPUT);

    expect(m.aiProvider.interpretConfirmationResponse).not.toHaveBeenCalled();
    expect(m.surveyRepo.upsertGroupState).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: 'confirmed' }),
    );
    expect(m.outbox.enqueueGroupReport).not.toHaveBeenCalled();
  });

  it('does not surface a pending confirmation on a survey-blocking safety turn', async () => {
    const m = baseMocks();
    m.surveyRepo.findPendingConfirmationGroups.mockResolvedValue([
      { surveyWindowId: 'w-1', userId: 'u-1', tenantId: 't-1', questionGroup: 'growth', aiSummary: 's' },
    ]);
    m.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent: 'potential_crisis', secondaryIntents: [], urgency: 'critical',
      emotionalState: ['unsafe'], confidence: 0.9, reasoningSummary: 'risk',
      surveyAllowed: false, requiresSafetyCheck: true, reminderRequest: null,
      dialogueAct: 'emotional_disclosure', latestUserSubstance: 'unsafe', topicAnchor: null,
    });
    m.aiProvider.detectRisk.mockResolvedValue({
      severity: 'critical', riskType: 'self_harm', confidence: 0.9,
      surveyMustBeBlocked: true, immediateResponseRequired: true,
    });
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    await orch.orchestrate(INPUT);

    expect(m.aiProvider.generateResponse.mock.calls[0][2].confirmationRequest).toBeUndefined();
    expect(m.surveyRepo.upsertGroupState).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: 'awaiting_confirmation' }),
    );
  });

  it('returns all legacy awaiting groups to pending when no earlier delivered receipt exists', async () => {
    const m = baseMocks();
    m.conversationRepo.findLatestDeliveredReportingDisclosure.mockResolvedValue(null);
    m.surveyRepo.findAwaitingConfirmationGroups.mockResolvedValue([
      { surveyWindowId: 'w-1', userId: 'u-1', tenantId: 't-1', questionGroup: 'growth', aiSummary: 's' },
      { surveyWindowId: 'w-1', userId: 'u-1', tenantId: 't-1', questionGroup: 'purpose', aiSummary: 's2' },
    ]);
    m.aiProvider.interpretConfirmationResponse.mockResolvedValue({ verdict: 'agree' });
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    const result = await orch.orchestrate(INPUT);

    expect(m.aiProvider.interpretConfirmationResponse).not.toHaveBeenCalled();
    expect(m.surveyRepo.transitionAwaitingGroupState).toHaveBeenCalledTimes(2);
    expect(m.surveyRepo.transitionAwaitingGroupState).toHaveBeenCalledWith(
      expect.objectContaining({ questionGroup: 'growth', status: 'pending_confirmation' }),
    );
    expect(m.surveyRepo.transitionAwaitingGroupState).toHaveBeenCalledWith(
      expect.objectContaining({ questionGroup: 'purpose', status: 'pending_confirmation' }),
    );
    expect(m.outbox.enqueueGroupReport).not.toHaveBeenCalled();
    expect(result.responseText).toContain(getReportingDisclosureText('en'));
  });

  it('treats a stale disclosure version as missing and sends the current version', async () => {
    const m = baseMocks();
    m.conversationRepo.findRecentMessages.mockResolvedValue(surveyReadyHistory());
    m.conversationRepo.findLatestDeliveredReportingDisclosure.mockResolvedValue({
      messageId: 'disclosure-old',
      version: 'reporting-disclosure-v0',
      shownAt: new Date('2026-09-03T09:00:00.000Z'),
    });
    m.surveyRepo.findAwaitingConfirmationGroups.mockResolvedValue([
      {
        surveyWindowId: 'w-1', userId: 'u-1', tenantId: 't-1', questionGroup: 'growth', aiSummary: 's',
        confirmationPromptMessageId: 'out-confirmation-1',
      },
    ]);
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    const result = await orch.orchestrate(INPUT);

    expect(m.aiProvider.generateResponse.mock.calls[0][2].confirmationRequest).toBeUndefined();
    expect(m.conversationRepo.saveMessage.mock.calls[0][0].metadata)
      .toHaveProperty('reportingDisclosureVersion', REPORTING_DISCLOSURE_VERSION);
    expect(result.responseText).toContain(getReportingDisclosureText('en'));
  });

  it('uses the exact confirming inbound timestamp rather than a later conversation message', async () => {
    const m = baseMocks();
    m.conversationRepo.findRecentMessages.mockResolvedValue([
      { id: 'm-1', ...OWNERSHIP, direction: 'inbound', text: 'ok', occurredAt: INBOUND_OCCURRED_AT, metadata: undefined },
      { id: 'm-later', ...OWNERSHIP, direction: 'inbound', text: 'later', occurredAt: new Date('2026-09-03T12:00:00.000Z'), metadata: undefined },
    ]);
    m.conversationRepo.findLatestDeliveredReportingDisclosure.mockResolvedValue({
      messageId: 'disclosure-late',
      version: REPORTING_DISCLOSURE_VERSION,
      shownAt: new Date('2026-09-03T11:00:00.000Z'),
    });
    m.surveyRepo.findAwaitingConfirmationGroups.mockResolvedValue([
      { surveyWindowId: 'w-1', userId: 'u-1', tenantId: 't-1', questionGroup: 'growth', aiSummary: 's' },
    ]);
    m.aiProvider.interpretConfirmationResponse.mockResolvedValue({ verdict: 'agree' });
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    const result = await orch.orchestrate(INPUT);

    expect(m.aiProvider.interpretConfirmationResponse).not.toHaveBeenCalled();
    expect(m.surveyRepo.transitionAwaitingGroupState).toHaveBeenCalledWith(expect.objectContaining({
      status: 'pending_confirmation',
    }));
    expect(m.outbox.enqueueGroupReport).not.toHaveBeenCalled();
    expect(result.responseText).toBe('reply');
  });

  it('interprets confirmation only through the exact inbound message for an out-of-order job', async () => {
    const m = baseMocks();
    m.conversationRepo.findRecentMessages.mockResolvedValue([
      { id: 'm-1', ...OWNERSHIP, direction: 'inbound', text: 'not sure', occurredAt: INBOUND_OCCURRED_AT, metadata: undefined },
      { id: 'm-later', ...OWNERSHIP, direction: 'inbound', text: 'yes', occurredAt: new Date('2026-09-03T12:00:00.000Z'), metadata: undefined },
    ]);
    m.surveyRepo.findAwaitingConfirmationGroups.mockResolvedValue([
      {
        surveyWindowId: 'w-1', userId: 'u-1', tenantId: 't-1', questionGroup: 'growth',
        aiSummary: 's', confirmationSummary: 's', confirmationPromptMessageId: 'out-1',
        deidentificationDecision: ACCEPTED_DEIDENTIFICATION,
      },
    ]);
    m.aiProvider.interpretConfirmationResponse.mockResolvedValue({ verdict: 'unclear' });
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    await orch.orchestrate(INPUT);

    const interpretedTurns = m.aiProvider.interpretConfirmationResponse.mock.calls[0][0];
    expect(interpretedTurns.at(-1)?.content).toBe('not sure');
    expect(interpretedTurns).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ content: 'yes' }),
    ]));
  });

  it('rejects a disclosure delivered at the same instant as the confirmation', async () => {
    const m = baseMocks();
    m.conversationRepo.findLatestDeliveredReportingDisclosure.mockResolvedValue({
      messageId: 'disclosure-equal',
      version: REPORTING_DISCLOSURE_VERSION,
      shownAt: INBOUND_OCCURRED_AT,
    });
    m.surveyRepo.findAwaitingConfirmationGroups.mockResolvedValue([
      { surveyWindowId: 'w-1', userId: 'u-1', tenantId: 't-1', questionGroup: 'growth', aiSummary: 's' },
    ]);
    m.aiProvider.interpretConfirmationResponse.mockResolvedValue({ verdict: 'agree' });
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    await orch.orchestrate(INPUT);

    expect(m.aiProvider.interpretConfirmationResponse).not.toHaveBeenCalled();
    expect(m.surveyRepo.confirmGroupState).not.toHaveBeenCalled();
    expect(m.outbox.enqueueGroupReport).not.toHaveBeenCalled();
  });
});

describe('ConversationOrchestrator group confirmation — surface (Phase A)', () => {
  it('surfaces one pending group when a real acknowledgement retains stale reporting intent', async () => {
    const m = baseMocks();
    m.conversationRepo.findRecentMessages.mockResolvedValue([
      {
        id: 'm-1',
        ...OWNERSHIP,
        direction: 'inbound',
        text: 'Got it, thanks.',
        occurredAt: INBOUND_OCCURRED_AT,
        metadata: undefined,
      },
    ]);
    m.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent: 'reporting_explanation',
      secondaryIntents: [],
      emotionalState: [],
      urgency: 'low',
      confidence: 0.9,
      surveyAllowed: true,
      requiresSafetyCheck: false,
      reasoningSummary: 'acknowledged reporting disclosure',
      reminderRequest: null,
      dialogueAct: 'acknowledgement',
      latestUserSubstance: null,
      topicAnchor: 'how pulse summaries are shared',
    });
    m.surveyRepo.findPendingConfirmationGroups.mockResolvedValue([
      {
        surveyWindowId: 'w-1',
        userId: 'u-1',
        tenantId: 't-1',
        questionGroup: 'belonging',
        updatedAt: new Date('2026-09-03T09:59:00.000Z'),
      },
      {
        surveyWindowId: 'w-1',
        userId: 'u-1',
        tenantId: 't-1',
        questionGroup: 'engagement',
        updatedAt: new Date('2026-09-03T09:59:30.000Z'),
      },
    ]);
    m.surveyRepo.findQuestionsForWindow.mockResolvedValue([
      { id: 'q-belonging', stableKey: 'q-belonging', questionGroup: 'belonging' },
    ]);
    m.aiProvider.generateResponse.mockResolvedValue({
      text: 'You feel supported by your team. Did I get that right?',
      confirmationSummary: 'You feel supported by your team.',
      confidence: 0.9,
      containsSurveyProbe: false,
    });
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    const result = await orch.orchestrate(INPUT);

    expect(m.aiProvider.generateResponse).toHaveBeenCalledTimes(1);
    expect(m.aiProvider.generateResponse.mock.calls[0][2]).toMatchObject({
      confirmationRequest: { questionGroup: 'belonging' },
      reportingDisclosure: undefined,
    });
    expect(result.responseText).not.toContain(getReportingDisclosureText('en'));
    expect(m.conversationRepo.saveMessage.mock.calls[0][0].metadata.confirmationSummary)
      .toBe('You feel supported by your team.');
    expect(m.surveyRepo.stageGroupConfirmation).toHaveBeenCalledTimes(1);
    expect(m.surveyRepo.stageGroupConfirmation).toHaveBeenCalledWith(expect.objectContaining({
      questionGroup: 'belonging',
      confirmationPromptMessageId: 'out-1',
      deidentificationDecision: {
        status: 'accepted',
        policyVersion: 'deidentification-v1',
        reasons: [],
      },
    }));
  });

  it('surfaces pending confirmation after delivered disclosure even on acknowledgement turn', async () => {
    const m = baseMocks();
    m.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent: 'casual_conversation',
      secondaryIntents: [],
      emotionalState: [],
      urgency: 'low',
      confidence: 0.9,
      surveyAllowed: true,
      requiresSafetyCheck: false,
      reasoningSummary: 'acknowledged disclosure',
      reminderRequest: null,
      dialogueAct: 'acknowledgement',
      latestUserSubstance: null,
      topicAnchor: null,
    });
    m.surveyRepo.findPendingConfirmationGroups.mockResolvedValue([
      {
        surveyWindowId: 'w-1',
        userId: 'u-1',
        tenantId: 't-1',
        questionGroup: 'autonomy',
        updatedAt: new Date('2026-09-03T09:59:00.000Z'),
      },
    ]);
    m.aiProvider.generateResponse.mockResolvedValue({
      text: 'You want more ownership over the work. Did I get that right?',
      confirmationSummary: 'You want more ownership over the work.',
      confidence: 0.9,
      containsSurveyProbe: false,
    });
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    const result = await orch.orchestrate(INPUT);

    const ctxArg = m.aiProvider.generateResponse.mock.calls[0][2];
    expect(ctxArg.confirmationRequest).toMatchObject({ questionGroup: 'autonomy' });
    expect(ctxArg.reportingDisclosure).toBeUndefined();
    expect(result.responseText).toContain('Did I get that right?');
    expect(m.surveyRepo.stageGroupConfirmation).toHaveBeenCalledWith(expect.objectContaining({
      questionGroup: 'autonomy',
      confirmationPromptMessageId: 'out-1',
      deidentificationDecision: {
        status: 'accepted',
        policyVersion: 'deidentification-v1',
        reasons: [],
      },
    }));
  });

  it('persists the displayed summary and stages its outbound receipt without activating it', async () => {
    const m = baseMocks();
    m.surveyRepo.findPendingConfirmationGroups.mockResolvedValue([
      {
        surveyWindowId: 'w-1',
        userId: 'u-1',
        tenantId: 't-1',
        questionGroup: 'autonomy',
        aiSummary: 'Mutable legacy summary that was never displayed.',
        updatedAt: new Date('2026-09-03T09:59:00.000Z'),
      },
    ]);
    m.aiProvider.generateResponse.mockResolvedValue({
      text: 'You value ownership. Did I get that right?',
      confirmationSummary: 'You value ownership.',
      confidence: 0.9,
      containsSurveyProbe: false,
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
    expect(metadata.confirmationSummary).toBe('You value ownership.');
    expect(metadata.deidentificationDecision).toEqual({
      status: 'accepted',
      policyVersion: 'deidentification-v1',
      reasons: [],
    });
    expect(m.surveyRepo.stageGroupConfirmation).toHaveBeenCalledWith({
      surveyWindowId: 'w-1',
      conversationId: 'c-1',
      userId: 'u-1',
      tenantId: 't-1',
      questionGroup: 'autonomy',
      expectedUpdatedAt: new Date('2026-09-03T09:59:00.000Z'),
      confirmationPromptMessageId: 'out-1',
      deidentificationDecision: {
        status: 'accepted',
        policyVersion: 'deidentification-v1',
        reasons: [],
      },
    });
    expect(m.surveyRepo.upsertGroupState).not.toHaveBeenCalled();
  });

  it('records rejected de-identification and does not stage an identifying confirmation candidate', async () => {
    const m = baseMocks();
    const updatedAt = new Date('2026-09-03T09:59:00.000Z');
    m.surveyRepo.findPendingConfirmationGroups.mockResolvedValue([
      {
        surveyWindowId: 'w-1',
        userId: 'u-1',
        tenantId: 't-1',
        questionGroup: 'autonomy',
        updatedAt,
      },
    ]);
    m.aiProvider.generateResponse
      .mockResolvedValueOnce({
        text: 'Alice is blocked by Project Apollo on 2026-09-03. Did I get that right?',
        confirmationSummary: 'Alice is blocked by Project Apollo on 2026-09-03.',
        confidence: 0.9,
        containsSurveyProbe: false,
      })
      .mockResolvedValueOnce({
        text: 'I hear you. We can keep talking through what would help.',
        confidence: 0.9,
        containsSurveyProbe: false,
      });
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    const result = await orch.orchestrate(INPUT);

    expect(result.responseText).toBe('I hear you. We can keep talking through what would help.');
    expect(m.surveyRepo.recordGroupDeidentificationDecision).toHaveBeenCalledWith({
      surveyWindowId: 'w-1',
      userId: 'u-1',
      tenantId: 't-1',
      questionGroup: 'autonomy',
      expectedUpdatedAt: updatedAt,
      deidentificationDecision: {
        status: 'rejected',
        policyVersion: 'deidentification-v1',
        reasons: ['exact_date_or_time', 'project_or_customer_identifier'],
      },
    });
    expect(m.surveyRepo.stageGroupConfirmation).not.toHaveBeenCalled();
    expect(m.outbox.enqueueGroupReport).not.toHaveBeenCalled();
    expect(m.conversationRepo.saveMessage.mock.calls[0][0].metadata.confirmationSummary).toBeUndefined();
  });

  it('rejects a confirmation candidate containing the known team identifier', async () => {
    const m = baseMocks();
    const updatedAt = new Date('2026-09-03T09:59:00.000Z');
    m.surveyRepo.findPendingConfirmationGroups.mockResolvedValue([
      {
        surveyWindowId: 'w-1',
        userId: 'u-1',
        tenantId: 't-1',
        questionGroup: 'autonomy',
        updatedAt,
      },
    ]);
    m.surveyRepo.findTeamByMemberId.mockResolvedValue({
      teamId: 'team-1',
      teamName: 'Platform Team',
      managerSlackUserId: 'U_MANAGER',
      activeTeamSize: 3,
      memberUserIds: ['u-1', 'u-2', 'u-3'],
    });
    m.aiProvider.generateResponse
      .mockResolvedValueOnce({
        text: 'Platform Team feels blocked by unclear ownership. Did I get that right?',
        confirmationSummary: 'Platform Team feels blocked by unclear ownership.',
        confidence: 0.9,
        containsSurveyProbe: false,
      })
      .mockResolvedValueOnce({
        text: 'I hear you. We can keep working through ownership.',
        confidence: 0.9,
        containsSurveyProbe: false,
      });
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    await orch.orchestrate(INPUT);

    expect(m.surveyRepo.recordGroupDeidentificationDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        deidentificationDecision: {
          status: 'rejected',
          policyVersion: 'deidentification-v1',
          reasons: ['known_identifier'],
        },
      }),
    );
    expect(m.surveyRepo.stageGroupConfirmation).not.toHaveBeenCalled();
  });

  it('rejects confirmation text that exposes the confirmationSummary label', async () => {
    const m = baseMocks();
    m.surveyRepo.findPendingConfirmationGroups.mockResolvedValue([
      {
        surveyWindowId: 'w-1',
        userId: 'u-1',
        tenantId: 't-1',
        questionGroup: 'autonomy',
        updatedAt: new Date('2026-09-03T09:59:00.000Z'),
      },
    ]);
    m.aiProvider.generateResponse.mockResolvedValue({
      text: 'confirmationSummary: You value ownership. Did I get that right?',
      confirmationSummary: 'You value ownership.',
      confidence: 0.9,
      containsSurveyProbe: false,
    });
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    await expect(orch.orchestrate(INPUT)).rejects.toThrow(/confirmationSummary/);
    expect(m.conversationRepo.saveMessage).not.toHaveBeenCalled();
    expect(m.surveyRepo.stageGroupConfirmation).not.toHaveBeenCalled();
  });

  it('rejects a whole reply presented as its own reportable summary', async () => {
    const m = baseMocks();
    m.surveyRepo.findPendingConfirmationGroups.mockResolvedValue([
      {
        surveyWindowId: 'w-1',
        userId: 'u-1',
        tenantId: 't-1',
        questionGroup: 'autonomy',
        updatedAt: new Date('2026-09-03T09:59:00.000Z'),
      },
    ]);
    const wholeReply = 'You value ownership. Did I get that right?';
    m.aiProvider.generateResponse.mockResolvedValue({
      text: wholeReply,
      confirmationSummary: wholeReply,
      confidence: 0.9,
      containsSurveyProbe: false,
    });
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    await expect(orch.orchestrate(INPUT)).rejects.toThrow(/confirmationSummary/);
    expect(m.conversationRepo.saveMessage).not.toHaveBeenCalled();
    expect(m.surveyRepo.stageGroupConfirmation).not.toHaveBeenCalled();
  });
});

describe('ConversationOrchestrator numeric survey probes', () => {
  it('passes the numeric response type to generation when probe pacing allows a question', async () => {
    const m = baseMocks();
    m.conversationRepo.findRecentMessages.mockResolvedValue([
      { id: 'm-0', ...OWNERSHIP, direction: 'inbound', text: 'one', occurredAt: new Date(), metadata: undefined },
      { id: 'm-x', ...OWNERSHIP, direction: 'inbound', text: 'two', occurredAt: new Date(), metadata: undefined },
      { id: 'm-1', ...OWNERSHIP, direction: 'inbound', text: 'three', occurredAt: new Date(), metadata: undefined },
    ]);
    const pulseBacklog = {
      getNextProbeQuestion: vi.fn().mockResolvedValue({
        question: {
          id: 'engagement-current',
          responseType: 'numeric_0_10',
          probeStrategies: ['Ask for current engagement from 0 to 10.'],
        },
      }),
    };
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, pulseBacklog as never,
    );

    await orch.orchestrate(INPUT);

    const [strategyArg, contextArg] = [
      m.aiProvider.generateResponse.mock.calls[0][1],
      m.aiProvider.generateResponse.mock.calls[0][2],
    ];
    expect(strategyArg.includeFollowUpQuestion).toBe(true);
    expect(contextArg.surveyProbeQuestion).toEqual({
      id: 'engagement-current',
      responseType: 'numeric_0_10',
      probeStrategies: ['Ask for current engagement from 0 to 10.'],
    });
  });

  it('keeps a hard zero-question correction turn authoritative over a selected numeric probe', async () => {
    const m = baseMocks();
    m.conversationRepo.findRecentMessages.mockResolvedValue([
      { id: 'm-0', ...OWNERSHIP, direction: 'inbound', text: 'one', occurredAt: new Date(), metadata: undefined },
      { id: 'm-x', ...OWNERSHIP, direction: 'inbound', text: 'two', occurredAt: new Date(), metadata: undefined },
      { id: 'm-1', ...OWNERSHIP, direction: 'inbound', text: 'No, I meant this week.', occurredAt: new Date(), metadata: undefined },
    ]);
    m.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent: 'casual_conversation', secondaryIntents: [], emotionalState: [],
      urgency: 'low', confidence: 0.9, surveyAllowed: true, requiresSafetyCheck: false,
      reasoningSummary: 'correction', reminderRequest: null, dialogueAct: 'correction',
      latestUserSubstance: 'this week', topicAnchor: null,
    });
    const pulseBacklog = {
      getNextProbeQuestion: vi.fn().mockResolvedValue({
        question: {
          id: 'engagement-current', responseType: 'numeric_0_10',
          probeStrategies: ['Ask for current engagement from 0 to 10.'],
        },
      }),
    };
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, pulseBacklog as never,
    );

    await orch.orchestrate(INPUT);

    const strategyArg = m.aiProvider.generateResponse.mock.calls[0][1];
    const contextArg = m.aiProvider.generateResponse.mock.calls[0][2];
    expect(strategyArg.includeFollowUpQuestion).toBe(false);
    expect(contextArg.replyPlan.questionPolicy.maxQuestions).toBe(0);
    expect(contextArg.surveyProbeQuestion).toBeUndefined();
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
      topicAnchor: null,
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
        { id: 'm-0', ...OWNERSHIP, direction: 'inbound', text: 'one', occurredAt: new Date(), metadata: undefined },
        { id: 'm-1', ...OWNERSHIP, direction: 'inbound', text: 'two', occurredAt: new Date(), metadata: undefined },
        { id: 'm-2', ...OWNERSHIP, direction: 'inbound', text: 'done', occurredAt: new Date(), metadata: undefined },
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
    m.surveyRepo.findPendingConfirmationGroups.mockResolvedValue([]);
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
      if (dialogueAct === 'closing') {
        expect(m.surveyRepo.findPendingConfirmationGroups).not.toHaveBeenCalled();
      } else {
        expect(m.surveyRepo.findPendingConfirmationGroups).toHaveBeenCalledTimes(1);
      }
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
      .rejects.toThrow('Conversation ownership mismatch');
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
      { id: 'm-1', ...OWNERSHIP, direction: 'inbound', text: 'roadmap update', occurredAt: inboundAt },
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
    confirmation.aiProvider.generateResponse.mockResolvedValue({
      text: 'Ship Atlas is ready. Did I get that right?',
      confirmationSummary: 'Ship Atlas is ready.',
      confidence: 0.9,
      containsSurveyProbe: false,
    });

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
        id: 'm-middle', ...OWNERSHIP, direction: 'inbound', text: 'Natural and relevant.',
        occurredAt: new Date('2026-08-28T10:01:00.000Z'), metadata: undefined,
      },
      {
        id: 'out-middle', direction: 'outbound', text: 'Those need separate checks.',
        occurredAt: new Date('2026-08-28T10:02:00.000Z'), metadata: { dialogueAct: 'continuation' },
      },
      {
        id: 'm-1', ...OWNERSHIP, direction: 'inbound', text: 'Give me the criteria.',
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
      { id: 'm-1', ...OWNERSHIP, direction: 'inbound', text: 'Привет', occurredAt: new Date(), metadata: undefined },
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
      { id: 'm-0', ...OWNERSHIP, direction: 'inbound', text: 'Я переживаю из-за Atlas-9', occurredAt: new Date(), metadata: undefined },
      { id: 'out-0', direction: 'outbound', text: 'Понимаю.', occurredAt: new Date(), metadata: undefined },
      { id: 'm-1', ...OWNERSHIP, direction: 'inbound', text: 'ok', occurredAt: new Date(), metadata: undefined },
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
      { id: 'm-0', ...OWNERSHIP, direction: 'inbound', text: 'Я переживаю из-за Atlas-9', occurredAt: new Date(), metadata: undefined },
      { id: 'out-0', direction: 'outbound', text: 'Понимаю.', occurredAt: new Date(), metadata: undefined },
      { id: 'm-1', ...OWNERSHIP, direction: 'inbound', text: 'ok *Sent using* <@U0BPHHA21GC>', occurredAt: new Date(), metadata: undefined },
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
      { id: 'm-0', ...OWNERSHIP, direction: 'inbound', text: 'Я переживаю из-за автономии', occurredAt: new Date(), metadata: undefined },
      { id: 'out-0', direction: 'outbound', text: 'Понимаю.', occurredAt: new Date(), metadata: undefined },
      { id: 'm-1', ...OWNERSHIP, direction: 'inbound', text: 'Atlas-9', occurredAt: new Date(), metadata: undefined },
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
      { id: 'm-1', ...OWNERSHIP, direction: 'inbound', text: 'я думаю що це важливо', occurredAt: new Date(), metadata: undefined },
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
      { id: 'm-1', ...OWNERSHIP, direction: 'inbound', text: '...', occurredAt: new Date(), metadata: undefined },
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
      { id: 'm-1', ...OWNERSHIP, direction: 'inbound', text: '...', occurredAt: new Date(), metadata: undefined },
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
    m.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent: 'casual_conversation',
      secondaryIntents: [],
      emotionalState: [],
      urgency: 'low',
      confidence: 0.9,
      surveyAllowed: true,
      requiresSafetyCheck: false,
      reasoningSummary: 'test',
      reminderRequest: null,
      dialogueAct: 'acknowledgement',
      latestUserSubstance: null,
      topicAnchor: 'growth',
    });
    m.surveyRepo.findAwaitingConfirmationGroups.mockResolvedValue([
      {
        surveyWindowId: 'w-1',
        userId: 'u-1',
        tenantId: 't-1',
        questionGroup: 'growth',
        aiSummary: 'A mutable legacy summary.',
        confirmationSummary: 'The exact summary shown to the employee.',
        confirmationPromptMessageId: 'out-confirmation-1',
        deidentificationDecision: ACCEPTED_DEIDENTIFICATION,
      },
    ]);
    m.surveyRepo.findTeamByMemberId.mockResolvedValue({ teamId: 'team-1', reportingCohortId: 'cohort-1' });
    m.aiProvider.interpretConfirmationResponse.mockResolvedValue({ verdict: 'agree' });
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    await orch.orchestrate(INPUT);

    expect(m.surveyRepo.findAwaitingConfirmationGroups)
      .toHaveBeenCalledWith('u-1', 't-1', 'c-1');
    expect(m.aiProvider.interpretConfirmationResponse)
      .toHaveBeenCalledWith(expect.any(Array), 'The exact summary shown to the employee.');
    expect(m.surveyRepo.confirmGroupState).toHaveBeenCalledWith(
      expect.objectContaining({
        questionGroup: 'growth',
        confirmationPromptMessageId: 'out-confirmation-1',
        reportingDisclosureVersion: REPORTING_DISCLOSURE_VERSION,
        reportingDisclosureShownAt: new Date('2026-09-03T09:00:00.000Z'),
        confirmationMessageId: 'm-1',
        confirmedAt: INBOUND_OCCURRED_AT,
      }),
    );
    expect(m.surveyRepo.confirmGroupState.mock.calls[0][0]).not.toHaveProperty('aiSummary');
    expect(m.conversationRepo.findLatestDeliveredReportingDisclosure)
      .toHaveBeenCalledWith(
        't-1',
        'u-1',
        REPORTING_DISCLOSURE_VERSION,
        INBOUND_OCCURRED_AT,
      );
    expect(m.outbox.enqueueGroupReport).toHaveBeenCalledWith({
      reportingCohortId: 'cohort-1',
      tenantId: 't-1',
      teamId: 'team-1',
      questionGroup: 'growth',
      traceId: 'group-report-cohort-1-growth',
    });
    expect(m.surveyRepo.findTeamByMemberId).toHaveBeenCalledWith('u-1', 't-1', 'w-1');
    const strategyArg = m.aiProvider.generateResponse.mock.calls[0][1];
    const ctxArg = m.aiProvider.generateResponse.mock.calls[0][2];
    expect(ctxArg.topicConfirmed).toMatchObject({ questionGroup: 'growth' });
    expect(strategyArg.includeFollowUpQuestion).toBe(false);
    expect(ctxArg.replyPlan.questionPolicy.maxQuestions).toBe(0);
  });

  it('uses persisted explicit 1-10 answers for engagement employee score', async () => {
    const m = baseMocks();
    m.surveyRepo.findAwaitingConfirmationGroups.mockResolvedValue([
      {
        surveyWindowId: 'w-1',
        userId: 'u-1',
        tenantId: 't-1',
        questionGroup: 'engagement',
        aiSummary: null,
        confirmationSummary: 'Your engagement answers are ready.',
        confirmationPromptMessageId: 'out-confirmation-1',
        deidentificationDecision: ACCEPTED_DEIDENTIFICATION,
      },
    ]);
    m.surveyRepo.findQuestionsForWindow.mockResolvedValue([
      { id: 'q-eng-1', stableKey: 'eng_1', questionGroup: 'engagement', responseType: 'numeric_0_10' },
      { id: 'q-eng-2', stableKey: 'eng_2', questionGroup: 'engagement', responseType: 'numeric_0_10' },
      { id: 'q-eng-3', stableKey: 'eng_3', questionGroup: 'engagement', responseType: 'numeric_0_10' },
    ]);
    m.surveyRepo.findAssessmentsForWindow.mockResolvedValue([
      { surveyQuestionId: 'q-eng-1', status: 'scored', score: 4 },
      { surveyQuestionId: 'q-eng-2', status: 'scored', score: 7 },
      { surveyQuestionId: 'q-eng-3', status: 'scored', score: 10 },
    ]);
    m.aiProvider.interpretConfirmationResponse.mockResolvedValue({ verdict: 'agree' });
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    await orch.orchestrate(INPUT);

    expect(m.surveyRepo.confirmGroupState).toHaveBeenCalledWith(
      expect.objectContaining({
        questionGroup: 'engagement',
        employeeScore: 7,
      }),
    );
    expect(m.aiProvider.scoreSentiment).not.toHaveBeenCalled();
  });

  it('clears an awaiting confirmation that lacks accepted de-identification proof', async () => {
    const m = baseMocks();
    m.surveyRepo.findAwaitingConfirmationGroups.mockResolvedValue([
      {
        surveyWindowId: 'w-1',
        userId: 'u-1',
        tenantId: 't-1',
        questionGroup: 'growth',
        aiSummary: 's',
        confirmationSummary: 's',
        confirmationPromptMessageId: 'out-1',
        deidentificationDecision: null,
      },
    ]);
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    await orch.orchestrate(INPUT);

    expect(m.surveyRepo.transitionAwaitingGroupState).toHaveBeenCalledWith({
      surveyWindowId: 'w-1',
      userId: 'u-1',
      tenantId: 't-1',
      questionGroup: 'growth',
      confirmationPromptMessageId: 'out-1',
      status: 'pending_confirmation',
    });
    expect(m.aiProvider.interpretConfirmationResponse).not.toHaveBeenCalled();
    expect(m.outbox.enqueueGroupReport).not.toHaveBeenCalled();
  });

  it('uses the interpreted displayed summary as the confirmation compare-and-set token', async () => {
    const m = baseMocks();
    let storedSummary = 'Summary A';
    m.surveyRepo.findAwaitingConfirmationGroups.mockResolvedValue([
      {
        surveyWindowId: 'w-1',
        userId: 'u-1',
        tenantId: 't-1',
        questionGroup: 'growth',
        aiSummary: null,
        confirmationSummary: storedSummary,
        confirmationPromptMessageId: 'out-confirmation-1',
        deidentificationDecision: ACCEPTED_DEIDENTIFICATION,
      },
    ]);
    m.surveyRepo.findTeamByMemberId.mockResolvedValue({ teamId: 'team-1' });
    m.aiProvider.interpretConfirmationResponse.mockImplementation(async () => {
      storedSummary = 'Summary B';
      return { verdict: 'agree' };
    });
    m.surveyRepo.confirmGroupState.mockImplementation(async (
      params: { expectedConfirmationSummary?: string },
    ) => params.expectedConfirmationSummary === storedSummary);
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    await orch.orchestrate(INPUT);

    expect(m.surveyRepo.confirmGroupState).toHaveBeenCalledWith(
      expect.objectContaining({ expectedConfirmationSummary: 'Summary A' }),
    );
    expect(m.outbox.enqueueGroupReport).not.toHaveBeenCalled();
  });

  it('does not enqueue a report when another worker already won the confirmation transition', async () => {
    const m = baseMocks();
    m.surveyRepo.findAwaitingConfirmationGroups.mockResolvedValue([
      {
        surveyWindowId: 'w-1', userId: 'u-1', tenantId: 't-1', questionGroup: 'growth',
        aiSummary: null, confirmationSummary: 'Summary A', confirmationPromptMessageId: 'out-1',
        deidentificationDecision: ACCEPTED_DEIDENTIFICATION,
      },
    ]);
    m.surveyRepo.confirmGroupState.mockResolvedValue(false);
    m.surveyRepo.findTeamByMemberId.mockResolvedValue({ teamId: 'team-1' });
    m.aiProvider.interpretConfirmationResponse.mockResolvedValue({ verdict: 'agree' });
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    await orch.orchestrate(INPUT);

    expect(m.surveyRepo.confirmGroupState).toHaveBeenCalled();
    expect(m.outbox.enqueueGroupReport).not.toHaveBeenCalled();
    const strategyArg = m.aiProvider.generateResponse.mock.calls[0][1];
    const ctxArg = m.aiProvider.generateResponse.mock.calls[0][2];
    expect(ctxArg.topicConfirmed).toBeUndefined();
    expect(strategyArg.includeFollowUpQuestion).toBe(true);
    expect(ctxArg.replyPlan.questionPolicy.maxQuestions).toBe(1);
  });

  it('computes engagement from three distinct stored assessment scores', async () => {
    const m = baseMocks();
    m.surveyRepo.findAwaitingConfirmationGroups.mockResolvedValue([
      {
        surveyWindowId: 'w-1',
        userId: 'u-1',
        tenantId: 't-1',
        questionGroup: 'engagement',
        aiSummary: null,
        confirmationSummary: 'Ratings captured.',
        confirmationPromptMessageId: 'out-confirmation-1',
        deidentificationDecision: ACCEPTED_DEIDENTIFICATION,
      },
    ]);
    m.surveyRepo.findQuestionsForWindow.mockResolvedValue([
      { id: 'e-1', questionGroup: 'engagement', responseType: 'numeric_0_10' },
      { id: 'e-2', questionGroup: 'engagement', responseType: 'numeric_0_10' },
      { id: 'e-3', questionGroup: 'engagement', responseType: 'numeric_0_10' },
      { id: 'e-legacy', questionGroup: 'engagement', responseType: 'open_ended' },
    ]);
    m.surveyRepo.findAssessmentsForWindow.mockResolvedValue([
      { surveyQuestionId: 'e-1', status: 'scored', score: 6 },
      { surveyQuestionId: 'e-2', status: 'scored', score: 8 },
      { surveyQuestionId: 'e-3', status: 'scored', score: 10 },
      { surveyQuestionId: 'e-legacy', status: 'scored', score: 1 },
    ]);
    m.aiProvider.interpretConfirmationResponse.mockResolvedValue({ verdict: 'agree' });
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    await orch.orchestrate(INPUT);

    expect(m.surveyRepo.confirmGroupState).toHaveBeenCalledWith(
      expect.objectContaining({
        questionGroup: 'engagement',
        employeeScore: 8,
      }),
    );
  });

  it('does not synthesize an engagement index from fewer than three scored questions', async () => {
    const m = baseMocks();
    m.surveyRepo.findAwaitingConfirmationGroups.mockResolvedValue([
      {
        surveyWindowId: 'w-1',
        userId: 'u-1',
        tenantId: 't-1',
        questionGroup: 'engagement',
        aiSummary: null,
        confirmationSummary: 'Partial ratings.',
        confirmationPromptMessageId: 'out-confirmation-1',
        deidentificationDecision: ACCEPTED_DEIDENTIFICATION,
      },
    ]);
    m.surveyRepo.findQuestionsForWindow.mockResolvedValue([
      { id: 'e-1', questionGroup: 'engagement', responseType: 'numeric_0_10' },
      { id: 'e-2', questionGroup: 'engagement', responseType: 'numeric_0_10' },
      { id: 'e-3', questionGroup: 'engagement', responseType: 'numeric_0_10' },
    ]);
    m.surveyRepo.findAssessmentsForWindow.mockResolvedValue([
      { surveyQuestionId: 'e-1', status: 'scored', score: 8 },
      { surveyQuestionId: 'e-2', status: 'scored', score: 10 },
      { surveyQuestionId: 'e-3', status: 'partially_covered', score: null },
    ]);
    m.aiProvider.interpretConfirmationResponse.mockResolvedValue({ verdict: 'agree' });
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    await orch.orchestrate(INPUT);

    expect(m.surveyRepo.confirmGroupState).toHaveBeenCalledWith(
      expect.objectContaining({
        questionGroup: 'engagement',
        employeeScore: undefined,
      }),
    );
  });

  it('correct → reopens group to in_progress and does not report', async () => {
    const m = baseMocks();
    m.surveyRepo.findAwaitingConfirmationGroups.mockResolvedValue([
      {
        surveyWindowId: 'w-1', userId: 'u-1', tenantId: 't-1', questionGroup: 'growth',
        aiSummary: 's', confirmationSummary: 's', confirmationPromptMessageId: 'out-1',
        deidentificationDecision: ACCEPTED_DEIDENTIFICATION,
      },
    ]);
    m.aiProvider.interpretConfirmationResponse.mockResolvedValue({ verdict: 'correct', correctionNote: 'not about promotion' });
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    await orch.orchestrate(INPUT);

    expect(m.surveyRepo.transitionAwaitingGroupState).toHaveBeenCalledWith(
      expect.objectContaining({ questionGroup: 'growth', status: 'in_progress' }),
    );
    expect(m.outbox.enqueueGroupReport).not.toHaveBeenCalled();
  });

  it('exclude → withdraws group state and does not confirm or report', async () => {
    const m = baseMocks();
    m.surveyRepo.findAwaitingConfirmationGroups.mockResolvedValue([
      {
        surveyWindowId: 'w-1', userId: 'u-1', tenantId: 't-1', questionGroup: 'growth',
        aiSummary: 's', confirmationSummary: 's', confirmationPromptMessageId: 'out-1',
        deidentificationDecision: ACCEPTED_DEIDENTIFICATION,
      },
    ]);
    m.aiProvider.interpretConfirmationResponse.mockResolvedValue({ verdict: 'exclude' });
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    await orch.orchestrate(INPUT);

    expect(m.surveyRepo.withdrawGroupState).toHaveBeenCalledWith({
      surveyWindowId: 'w-1',
      userId: 'u-1',
      tenantId: 't-1',
      questionGroup: 'growth',
      confirmationPromptMessageId: 'out-1',
      conversationId: 'c-1',
      withdrawalMessageId: 'm-1',
      withdrawnAt: INBOUND_OCCURRED_AT,
    });
    expect(m.surveyRepo.confirmGroupState).not.toHaveBeenCalled();
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

  it('drops the follow-up on every second terse user turn', async () => {
    const m = baseMocks();
    m.conversationRepo.findRecentMessages.mockResolvedValue([
      { id: 'm-0', ...OWNERSHIP, direction: 'inbound', text: 'same issue', occurredAt: new Date('2026-09-03T09:58:00.000Z'), metadata: undefined },
      {
        id: 'o-1',
        ...OWNERSHIP,
        direction: 'outbound',
        text: 'what exactly is holding you back?',
        occurredAt: new Date('2026-09-03T09:59:00.000Z'),
        metadata: { replyShape: { askedQuestion: true, maxQuestions: 1, questionPolicyReason: 'new_substance_allows_question' } },
      },
      { id: 'm-1', ...OWNERSHIP, direction: 'inbound', text: 'yeah', occurredAt: INBOUND_OCCURRED_AT, metadata: undefined },
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
    expect(ctxArg.replyPlan.questionPolicy).toEqual({ maxQuestions: 0, reason: 'strategy_disallows_questions' });
  });

  it('continues terse question alternation after the recent-message window fills', async () => {
    const m = baseMocks();
    const priorPairs = Array.from({ length: 9 }, (_, index) => [
      {
        id: `m-prior-${index}`, ...OWNERSHIP, direction: 'inbound', text: 'ok',
        occurredAt: new Date(INBOUND_OCCURRED_AT.getTime() - (20 - index * 2) * 1_000), metadata: undefined,
      },
      {
        id: `o-prior-${index}`, ...OWNERSHIP, direction: 'outbound', text: 'reply',
        occurredAt: new Date(INBOUND_OCCURRED_AT.getTime() - (19 - index * 2) * 1_000),
        metadata: { replyShape: { askedQuestion: index % 2 === 0, maxQuestions: 1, questionPolicyReason: 'new_substance_allows_question' } },
      },
    ]).flat();
    m.conversationRepo.findRecentMessages.mockResolvedValue([
      ...priorPairs,
      {
        id: 'o-latest', ...OWNERSHIP, direction: 'outbound', text: 'got it',
        occurredAt: new Date(INBOUND_OCCURRED_AT.getTime() - 1_000),
        metadata: { replyShape: { askedQuestion: false, maxQuestions: 0, questionPolicyReason: 'strategy_disallows_questions' } },
      },
      { id: 'm-1', ...OWNERSHIP, direction: 'inbound', text: 'yeah', occurredAt: INBOUND_OCCURRED_AT, metadata: undefined },
    ]);
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined, profile(0.27, 0.3),
    );

    await orch.orchestrate(INPUT);

    expect(m.aiProvider.generateResponse.mock.calls[0][1]).toMatchObject({
      maxResponseLength: 'short',
      includeFollowUpQuestion: true,
    });
  });

  it('ignores legacy punctuation when previous reply has no reply-shape metadata', async () => {
    const m = baseMocks();
    m.conversationRepo.findRecentMessages.mockResolvedValue([
      { id: 'm-1', ...OWNERSHIP, direction: 'inbound', text: 'yeah', occurredAt: new Date(), metadata: undefined },
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
