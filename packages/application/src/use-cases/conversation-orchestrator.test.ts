import { describe, it, expect, vi } from 'vitest';
import { ConversationOrchestrator } from './conversation-orchestrator';
import {
  REPORTING_DISCLOSURE_VERSION,
  getReportingDisclosureText,
} from '../utils/reporting-disclosure';

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
    stageGroupConfirmation: vi.fn().mockResolvedValue(true),
    transitionAwaitingGroupState: vi.fn().mockResolvedValue(true),
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

function surveyReadyHistory() {
  return [
    { id: 'm-prior-1', ...OWNERSHIP, direction: 'inbound', text: 'first', occurredAt: new Date('2026-09-03T09:58:00.000Z'), metadata: undefined },
    { id: 'm-prior-2', ...OWNERSHIP, direction: 'inbound', text: 'second', occurredAt: new Date('2026-09-03T09:59:00.000Z'), metadata: undefined },
    { id: 'm-1', ...OWNERSHIP, direction: 'inbound', text: 'hey', occurredAt: INBOUND_OCCURRED_AT, metadata: undefined },
  ];
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

  it('appends the localized disclosure once survey pacing is ready and blocks confirmation and probes', async () => {
    const m = baseMocks();
    m.conversationRepo.findRecentMessages.mockResolvedValue(surveyReadyHistory());
    m.conversationRepo.findLatestDeliveredReportingDisclosure.mockResolvedValue(null);
    m.conversationRepo.findById.mockResolvedValue({
      id: 'c-1', tenantId: 't-1', userId: 'u-1', channelType: 'slack', userDisplayName: 'Sam', userLocale: 'ru', userTimezone: 'UTC',
    });
    m.surveyRepo.findPendingConfirmationGroups.mockResolvedValue([
      { surveyWindowId: 'w-1', userId: 'u-1', tenantId: 't-1', questionGroup: 'autonomy', aiSummary: 's' },
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
    expect(m.surveyRepo.upsertGroupState).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: 'awaiting_confirmation' }),
    );
  });

  it('does not append a second disclosure when the generated response already contains it', async () => {
    const m = baseMocks();
    const disclosure = getReportingDisclosureText('en');
    m.conversationRepo.findRecentMessages.mockResolvedValue(surveyReadyHistory());
    m.conversationRepo.findLatestDeliveredReportingDisclosure.mockResolvedValue(null);
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

    expect(result.responseText).toBe(getReportingDisclosureText('ru'));
    expect(m.aiProvider.interpretConfirmationResponse).not.toHaveBeenCalled();
    expect(m.aiProvider.generateResponse).not.toHaveBeenCalled();
    expect(m.surveyRepo.transitionAwaitingGroupState).toHaveBeenCalledWith(
      expect.objectContaining({ questionGroup: 'growth', status: 'pending_confirmation' }),
    );
    expect(m.surveyRepo.confirmGroupState).not.toHaveBeenCalled();
    expect(m.outbox.enqueueGroupReport).not.toHaveBeenCalled();
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

    expect(result.responseText).toBe(getReportingDisclosureText('en'));
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

    expect(result.responseText).toBe(getReportingDisclosureText('en'));
    expect(m.aiProvider.generateResponse).not.toHaveBeenCalled();
  });

  it('keeps a survey-blocking safety response free of reporting disclosure', async () => {
    const m = baseMocks();
    m.conversationRepo.findLatestDeliveredReportingDisclosure.mockResolvedValue(null);
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
    m.surveyRepo.findPendingConfirmationGroups.mockResolvedValue([
      { surveyWindowId: 'w-1', userId: 'u-1', tenantId: 't-1', questionGroup: 'growth', aiSummary: 's' },
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
      { id: 'm-later', direction: 'inbound', text: 'later', occurredAt: new Date('2026-09-03T12:00:00.000Z'), metadata: undefined },
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
    expect(m.surveyRepo.stageGroupConfirmation).toHaveBeenCalledWith({
      surveyWindowId: 'w-1',
      conversationId: 'c-1',
      userId: 'u-1',
      tenantId: 't-1',
      questionGroup: 'autonomy',
      expectedUpdatedAt: new Date('2026-09-03T09:59:00.000Z'),
      confirmationPromptMessageId: 'out-1',
    });
    expect(m.surveyRepo.upsertGroupState).not.toHaveBeenCalled();
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
      topicAnchor: 'the release shipped over the weekend',
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
      { id: 'm-1', ...OWNERSHIP, direction: 'inbound', text: 'two', occurredAt: new Date(), metadata: undefined },
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
      { id: 'm-0', direction: 'inbound', text: 'Я переживаю из-за Atlas-9', occurredAt: new Date(), metadata: undefined },
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
      { id: 'm-0', direction: 'inbound', text: 'Я переживаю из-за Atlas-9', occurredAt: new Date(), metadata: undefined },
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
      { id: 'm-0', direction: 'inbound', text: 'Я переживаю из-за автономии', occurredAt: new Date(), metadata: undefined },
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
      },
    ]);
    m.surveyRepo.findTeamByMemberId.mockResolvedValue({ teamId: 'team-1' });
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
    expect(m.outbox.enqueueGroupReport).toHaveBeenCalled();
    expect(m.surveyRepo.findTeamByMemberId).toHaveBeenCalledWith('u-1', 't-1');
    const strategyArg = m.aiProvider.generateResponse.mock.calls[0][1];
    const ctxArg = m.aiProvider.generateResponse.mock.calls[0][2];
    expect(ctxArg.topicConfirmed).toMatchObject({ questionGroup: 'growth' });
    expect(strategyArg.includeFollowUpQuestion).toBe(false);
    expect(ctxArg.replyPlan.questionPolicy.maxQuestions).toBe(0);
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

  it('correct → reopens group to in_progress and does not report', async () => {
    const m = baseMocks();
    m.surveyRepo.findAwaitingConfirmationGroups.mockResolvedValue([
      {
        surveyWindowId: 'w-1', userId: 'u-1', tenantId: 't-1', questionGroup: 'growth',
        aiSummary: 's', confirmationSummary: 's', confirmationPromptMessageId: 'out-1',
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
      { id: 'm-1', ...OWNERSHIP, direction: 'inbound', text: 'yeah', occurredAt: new Date(), metadata: undefined },
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
      'dialogueAct',
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
    m.conversationRepo.findById.mockResolvedValue({ id: 'c-1', tenantId: 't-1', userId: 'u-1', channelType: 'slack', userDisplayName: 'Sam', userTimezone: undefined });
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
