import { describe, it, expect, vi } from 'vitest';
import { ModerationSignalError } from '@entalent/contracts';
import { ConversationOrchestrator } from './conversation-orchestrator';
import { ProviderContentFilterError } from '../ports/provider-error';
import { BundleCompositionInvalidError, BundleReplyInvalidError } from '../utils/question-bundle-composition';
import { TopicQuestionReplyInvalidError } from '../utils/topic-question-reply';
import {
  REPORTING_DISCLOSURE_VERSION,
  getDataUseExplanationText,
  getReportingDisclosureText,
  getReportingExplanationText,
} from '../utils/reporting-disclosure';
import type { GoalRepositoryPort } from '../ports/goal.repository.port';
import type { StyleProfileRepositoryPort } from '../ports/style-profile.repository.port';
import type { UserGoalRecord } from '../types/records';

const INBOUND_OCCURRED_AT = new Date('2026-09-03T10:00:00.000Z');
const OWNERSHIP = { conversationId: 'c-1', tenantId: 't-1', userId: 'u-1' };
const CAP8_SOURCE_ID = '11111111-1111-4111-8111-111111111111';

const NO_RISK = {
  riskType: null,
  severity: 'none',
  confidence: 0.9,
  evidence: [],
  immediateResponseRequired: false,
  escalationRecommended: false,
  surveyMustBeBlocked: false,
  proactiveMessagesMustBePaused: false,
  reasoningSummary: 'no risk',
};

function baseMocks() {
  const conversationRepo = {
    findById: vi.fn().mockResolvedValue({ id: 'c-1', tenantId: 't-1', userId: 'u-1', channelType: 'slack', externalConversationId: 'ec', userDisplayName: 'Sam', userLocale: 'en', userTimezone: 'UTC' }),
    findRecentMessages: vi.fn().mockResolvedValue([
      { id: 'm-1', ...OWNERSHIP, direction: 'inbound', text: 'hey', occurredAt: INBOUND_OCCURRED_AT, metadata: undefined },
    ]),
    findLatestDeliveredReportingDisclosure: vi.fn().mockResolvedValue({
      messageId: 'disclosure-1',
      version: REPORTING_DISCLOSURE_VERSION,
      shownAt: new Date('2026-09-03T09:00:00.000Z'),
    }),
    saveMessage: vi.fn().mockImplementation(async (params: { text: string }) => ({ ...params, id: 'out-1' })),
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
    detectRisk: vi.fn().mockResolvedValue(NO_RISK),
    generateResponse: vi.fn().mockResolvedValue({ text: 'reply', confidence: 0.9, containsSurveyProbe: false }),
    interpretConfirmationResponse: vi.fn(),
    scoreSentiment: vi.fn().mockResolvedValue(0.9),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const outbox = { enqueueMessageSend: vi.fn(), enqueueMemoryExtraction: vi.fn(), enqueueSurveyEvidence: vi.fn(), enqueueGroupReport: vi.fn(), enqueueFollowUpExecution: vi.fn(), enqueueStyleAnalysis: vi.fn(), enqueueProfileHydration: vi.fn() } as any;
  const surveyRepo = {
    findPulseCaptureForConversation: vi.fn().mockResolvedValue([]),
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
    findCurrentHierarchyIdentifiers: vi.fn().mockResolvedValue([]),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const featureFlags = { isEnabled: vi.fn().mockResolvedValue(true) } as any;
  const scheduledActionRepo = {
    existsByDeduplicationKey: vi.fn().mockResolvedValue(false),
    save: vi.fn().mockResolvedValue({ id: 'reminder-1' }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return { conversationRepo, aiProvider, outbox, surveyRepo, featureFlags, scheduledActionRepo };
}

const INPUT = {
  messageId: 'm-1', conversationId: 'c-1', userId: 'u-1', tenantId: 't-1',
  externalWorkspaceId: 'ws', externalConversationId: 'ec', traceId: 'tr',
};

function makeOrchestrator(m: ReturnType<typeof baseMocks>): ConversationOrchestrator {
  return new ConversationOrchestrator(
    m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
    undefined, undefined, m.featureFlags, m.scheduledActionRepo, undefined,
  );
}

/** Grounded facts handed to the reply model on the latest generation call (GC round 3 CAP-5). */
function captureFactsOf(m: ReturnType<typeof baseMocks>) {
  const calls = m.aiProvider.generateResponse.mock.calls;
  return calls[calls.length - 1]?.[2]?.captureFacts;
}

function reminderConfirmationOf(m: ReturnType<typeof baseMocks>) {
  const calls = m.aiProvider.generateResponse.mock.calls;
  return calls[calls.length - 1]?.[2]?.reminderConfirmation;
}

const UNRESOLVED_FACTS = { scope: 'unresolved', captures: [] };

const ACCEPTED_DEIDENTIFICATION = {
  status: 'accepted' as const,
  policyVersion: 'deidentification-v1' as const,
  reasons: [],
};

describe('ConversationOrchestrator failed-turn fallback (GC round 2 CAP-1)', () => {
  const committedTurnMocks = (m: ReturnType<typeof baseMocks>, existing: unknown = null) => {
    m.conversationRepo.findCommittedTurnForInbound = vi.fn().mockResolvedValue(existing);
    m.conversationRepo.recordCommittedTurn = vi.fn().mockResolvedValue(undefined);
    m.conversationRepo.findUnqueuedCommittedDispatchKinds = vi.fn().mockResolvedValue(['message_send']);
    m.conversationRepo.markCommittedDispatchQueued = vi.fn().mockResolvedValue(undefined);
  };

  it('commits one English fallback with the failure code and only its send dispatch', async () => {
    const m = baseMocks();
    committedTurnMocks(m);

    const result = await makeOrchestrator(m).commitFailedTurn(INPUT, 'conversation_app_v2_confirmation_bundle_stale');

    expect(result.responseText).toContain('could not process your last message');
    expect(m.conversationRepo.saveMessage).toHaveBeenCalledWith(expect.objectContaining({
      direction: 'outbound',
      metadata: {
        conversationOutcome: 'processing_failed',
        sourceInboundMessageId: 'm-1',
        failureCode: 'conversation_app_v2_confirmation_bundle_stale',
        languagePolicy: { responseLanguage: 'en', source: 'product_default' },
      },
    }));
    expect(m.conversationRepo.recordCommittedTurn).toHaveBeenCalledWith(expect.objectContaining({
      inboundMessageId: 'm-1', dispatchKinds: ['message_send'], followUpActions: [], groupReportStateIds: [],
    }));
    expect(m.outbox.enqueueMessageSend).toHaveBeenCalledTimes(1);
    expect(m.outbox.enqueueMemoryExtraction).not.toHaveBeenCalled();
    expect(m.outbox.enqueueSurveyEvidence).not.toHaveBeenCalled();
    expect(m.aiProvider.generateResponse).not.toHaveBeenCalled();
  });

  it('reuses an already committed turn instead of saving a second reply', async () => {
    const m = baseMocks();
    committedTurnMocks(m, {
      id: 'out-1', ...OWNERSHIP, direction: 'outbound', text: 'previous fallback',
      occurredAt: INBOUND_OCCURRED_AT,
      metadata: { conversationOutcome: 'processing_failed', sourceInboundMessageId: 'm-1' },
    });

    const result = await makeOrchestrator(m).commitFailedTurn(INPUT, 'conversation_unclassified_error');

    expect(result.outboundMessageId).toBe('out-1');
    expect(m.conversationRepo.saveMessage).not.toHaveBeenCalled();
  });
});

describe('ConversationOrchestrator provider input filter', () => {
  it('explains in English and records the language policy whatever the profile locale', async () => {
    const m = baseMocks();
    m.conversationRepo.findById.mockResolvedValue({
      id: 'c-1', tenantId: 't-1', userId: 'u-1', channelType: 'slack', externalConversationId: 'ec',
      userDisplayName: 'Sam', userLocale: 'uk', userTimezone: 'UTC',
    });
    m.aiProvider.classifySituation.mockRejectedValue(new ProviderContentFilterError('input'));
    m.conversationRepo.findCommittedTurnForInbound = vi.fn().mockResolvedValue(null);
    m.conversationRepo.recordCommittedTurn = vi.fn().mockResolvedValue(undefined);
    m.conversationRepo.findUnqueuedCommittedDispatchKinds = vi.fn().mockResolvedValue(['message_send']);
    m.conversationRepo.markCommittedDispatchQueued = vi.fn().mockResolvedValue(undefined);

    const result = await makeOrchestrator(m).orchestrate(INPUT);

    expect(result.responseText).toContain('model service rejected');
    expect(m.conversationRepo.saveMessage).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ languagePolicy: { responseLanguage: 'en', source: 'product_default' } }),
    }));
  });

  it('commits one explanatory outbound and only its send dispatch', async () => {
    const m = baseMocks();
    m.aiProvider.classifySituation.mockRejectedValue(new ProviderContentFilterError('input'));
    m.conversationRepo.findCommittedTurnForInbound = vi.fn().mockResolvedValue(null);
    m.conversationRepo.recordCommittedTurn = vi.fn().mockResolvedValue(undefined);
    m.conversationRepo.findUnqueuedCommittedDispatchKinds = vi.fn().mockResolvedValue(['message_send']);
    m.conversationRepo.markCommittedDispatchQueued = vi.fn().mockResolvedValue(undefined);

    const result = await makeOrchestrator(m).orchestrate(INPUT);

    expect(result.outcome).toBe('input_filtered');
    expect(result.responseText).toContain('model service rejected');
    expect(m.conversationRepo.saveMessage).toHaveBeenCalledWith(expect.objectContaining({
      id: expect.any(String),
      metadata: {
        conversationOutcome: 'input_filtered',
        sourceInboundMessageId: 'm-1',
        languagePolicy: { responseLanguage: 'en', source: 'product_default' },
      },
    }));
    expect(m.conversationRepo.recordCommittedTurn).toHaveBeenCalledWith(expect.objectContaining({
      inboundMessageId: 'm-1', dispatchKinds: ['message_send'], followUpActions: [], groupReportStateIds: [],
    }));
    expect(m.outbox.enqueueMessageSend).toHaveBeenCalledTimes(1);
    expect(m.outbox.enqueueMemoryExtraction).not.toHaveBeenCalled();
    expect(m.outbox.enqueueSurveyEvidence).not.toHaveBeenCalled();
    expect(m.outbox.enqueueStyleAnalysis).not.toHaveBeenCalled();
    expect(m.aiProvider.generateResponse).not.toHaveBeenCalled();
  });

  it('reuses a committed outcome after a retry', async () => {
    const m = baseMocks();
    m.aiProvider.classifySituation.mockRejectedValue(new ProviderContentFilterError('input'));
    const existing = {
      id: 'out-1', ...OWNERSHIP, direction: 'outbound', text: 'previous explanation',
      occurredAt: INBOUND_OCCURRED_AT,
      metadata: { conversationOutcome: 'input_filtered', sourceInboundMessageId: 'm-1' },
    };
    m.conversationRepo.findCommittedTurnForInbound = vi.fn().mockResolvedValue(existing);
    m.conversationRepo.findUnqueuedCommittedDispatchKinds = vi.fn().mockResolvedValue(['message_send']);
    m.conversationRepo.markCommittedDispatchQueued = vi.fn().mockResolvedValue(undefined);

    const result = await makeOrchestrator(m).orchestrate(INPUT);

    expect(result.responseText).toBe('previous explanation');
    expect(m.conversationRepo.saveMessage).not.toHaveBeenCalled();
    expect(m.outbox.enqueueMessageSend).toHaveBeenCalledTimes(1);
  });

  it('does not convert an output filter into an input explanation', async () => {
    const m = baseMocks();
    m.aiProvider.classifySituation.mockRejectedValue(new ProviderContentFilterError('output'));

    await expect(makeOrchestrator(m).orchestrate(INPUT)).rejects.toThrow(ProviderContentFilterError);
    expect(m.conversationRepo.saveMessage).not.toHaveBeenCalled();
  });

  it('commits the one filtered-input explanation when the reply call trips the input filter (GC round 3 CAP-11)', async () => {
    const m = baseMocks();
    m.aiProvider.generateResponse.mockRejectedValue(new ProviderContentFilterError('input', [], ['jailbreak']));
    m.conversationRepo.findCommittedTurnForInbound = vi.fn().mockResolvedValue(null);
    m.conversationRepo.recordCommittedTurn = vi.fn().mockResolvedValue(undefined);
    m.conversationRepo.findUnqueuedCommittedDispatchKinds = vi.fn().mockResolvedValue(['message_send']);
    m.conversationRepo.markCommittedDispatchQueued = vi.fn().mockResolvedValue(undefined);

    const result = await makeOrchestrator(m).orchestrate(INPUT);

    expect(result.outcome).toBe('input_filtered');
    expect(result.contentFilterCategories).toEqual(['jailbreak']);
    expect(result.responseText).toContain('model service rejected');
    expect(m.aiProvider.generateResponse).toHaveBeenCalledTimes(1);
    expect(m.conversationRepo.saveMessage).toHaveBeenCalledTimes(1);
    expect(m.conversationRepo.saveMessage).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({
        conversationOutcome: 'input_filtered', sourceInboundMessageId: 'm-1', contentFilterCategories: ['jailbreak'],
      }),
    }));
    expect(m.outbox.enqueueMessageSend).toHaveBeenCalledTimes(1);
    expect(m.outbox.enqueueMemoryExtraction).not.toHaveBeenCalled();
    expect(m.outbox.enqueueSurveyEvidence).not.toHaveBeenCalled();
  });

  it('records the provider filter categories on a classification-time input filter too', async () => {
    const m = baseMocks();
    m.aiProvider.classifySituation.mockRejectedValue(new ProviderContentFilterError('input', [], ['jailbreak', 'hate']));
    m.conversationRepo.findCommittedTurnForInbound = vi.fn().mockResolvedValue(null);
    m.conversationRepo.recordCommittedTurn = vi.fn().mockResolvedValue(undefined);
    m.conversationRepo.findUnqueuedCommittedDispatchKinds = vi.fn().mockResolvedValue(['message_send']);
    m.conversationRepo.markCommittedDispatchQueued = vi.fn().mockResolvedValue(undefined);

    const result = await makeOrchestrator(m).orchestrate(INPUT);

    expect(result.outcome).toBe('input_filtered');
    expect(result.contentFilterCategories).toEqual(['jailbreak', 'hate']);
  });

  it('starts the next model request after the persisted recovery boundary', async () => {
    const m = baseMocks();
    m.conversationRepo.findById.mockResolvedValue({
      id: 'c-1', tenantId: 't-1', userId: 'u-1', channelType: 'slack',
      externalConversationId: 'ec', userDisplayName: 'Sam', userLocale: 'en', userTimezone: 'UTC',
      activeTopic: { summary: 'old private topic', status: 'active', updatedAt: INBOUND_OCCURRED_AT },
    });
    m.conversationRepo.findMessagesThrough = vi.fn().mockResolvedValue([
      { id: 'recovery', ...OWNERSHIP, direction: 'outbound', text: 'Please restate',
        occurredAt: new Date('2026-09-03T10:00:02Z'),
        metadata: { conversationOutcome: 'input_filtered', sourceInboundMessageId: 'blocked' } },
      { id: 'blocked', ...OWNERSHIP, direction: 'inbound', text: 'old private topic',
        occurredAt: INBOUND_OCCURRED_AT, metadata: undefined },
      { id: 'm-1', ...OWNERSHIP, direction: 'inbound', text: 'Hello',
        occurredAt: new Date('2026-09-03T10:00:01Z'), metadata: undefined },
    ]);

    await makeOrchestrator(m).orchestrate(INPUT);

    expect(m.aiProvider.classifySituation.mock.calls[0][0].map((turn: { content: string }) => turn.content))
      .toEqual(['Please restate', 'Hello']);
    expect(m.aiProvider.classifySituation.mock.calls[0][1].continuitySummary).toBeUndefined();
    expect(m.aiProvider.generateResponse.mock.calls[0][0].map((turn: { content: string }) => turn.content))
      .toEqual(['Please restate', 'Hello']);
  });
});

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
  it('does not queue profile hydration when response preparation fails', async () => {
    const m = baseMocks();
    m.conversationRepo.findById.mockResolvedValue({
      id: 'c-1', tenantId: 't-1', userId: 'u-1', channelType: 'slack',
      externalConversationId: 'ec', userDisplayName: null, userLocale: 'en', userTimezone: 'UTC',
    });
    m.aiProvider.generateResponse.mockRejectedValue(new Error('synthetic_model_failure'));

    await expect(makeOrchestrator(m).orchestrate(INPUT)).rejects.toThrow('synthetic_model_failure');

    expect(m.outbox.enqueueProfileHydration).not.toHaveBeenCalled();
    expect(m.conversationRepo.saveMessage).not.toHaveBeenCalled();
  });

  it('commits and dispatches profile hydration with the source inbound', async () => {
    const m = baseMocks();
    m.conversationRepo.findById.mockResolvedValue({
      id: 'c-1', tenantId: 't-1', userId: 'u-1', channelType: 'slack',
      externalConversationId: 'ec', userDisplayName: null, userLocale: 'en', userTimezone: 'UTC',
    });
    m.conversationRepo.findCommittedTurnForInbound = vi.fn().mockResolvedValue(null);
    m.conversationRepo.recordCommittedTurn = vi.fn().mockResolvedValue(undefined);
    m.conversationRepo.findUnqueuedCommittedDispatchKinds = vi.fn().mockResolvedValue([
      'message_send', 'profile_hydration',
    ]);
    m.conversationRepo.markCommittedDispatchQueued = vi.fn().mockResolvedValue(undefined);

    await makeOrchestrator(m).orchestrate(INPUT);

    expect(m.conversationRepo.recordCommittedTurn).toHaveBeenCalledWith(expect.objectContaining({
      inboundMessageId: 'm-1',
      dispatchKinds: expect.arrayContaining(['profile_hydration']),
    }));
    expect(m.outbox.enqueueProfileHydration).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'u-1', tenantId: 't-1', inboundMessageId: 'm-1',
    }));
    expect(m.conversationRepo.markCommittedDispatchQueued).toHaveBeenCalledWith(expect.objectContaining({
      inboundMessageId: 'm-1', kind: 'profile_hydration',
    }));
  });

  it('does not persist or queue a reminder when response preparation fails', async () => {
    const m = baseMocks();
    m.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent: 'casual_conversation', secondaryIntents: [], emotionalState: [],
      urgency: 'low', confidence: 0.9, surveyAllowed: true, requiresSafetyCheck: false,
      reasoningSummary: 'test', reminderRequest: {
        intent: 'send the report', dueAt: '2026-09-04T09:00:00.000Z',
      }, dialogueAct: 'request', latestUserSubstance: 'remind me', topicAnchor: null,
    });
    m.aiProvider.generateResponse.mockRejectedValue(new Error('synthetic_model_failure'));

    await expect(makeOrchestrator(m).orchestrate(INPUT)).rejects.toThrow('synthetic_model_failure');

    expect(m.scheduledActionRepo.save).not.toHaveBeenCalled();
    expect(m.outbox.enqueueFollowUpExecution).not.toHaveBeenCalled();
  });

  it('persists a reminder with the committed turn and queues its scoped action', async () => {
    const m = baseMocks();
    const dueAt = new Date(Date.now() + 86_400_000);
    m.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent: 'casual_conversation', secondaryIntents: [], emotionalState: [],
      urgency: 'low', confidence: 0.9, surveyAllowed: true, requiresSafetyCheck: false,
      reasoningSummary: 'test', reminderRequest: {
        intent: 'send the report', dueAt: dueAt.toISOString(),
      }, dialogueAct: 'request', latestUserSubstance: 'remind me', topicAnchor: null,
    });
    m.conversationRepo.findCommittedTurnForInbound = vi.fn().mockResolvedValue(null);
    m.conversationRepo.recordCommittedTurn = vi.fn().mockResolvedValue(undefined);
    m.conversationRepo.findUnqueuedCommittedDispatchKinds = vi.fn().mockResolvedValue(['message_send']);
    m.conversationRepo.findUnqueuedCommittedFollowUps = vi.fn().mockResolvedValue([{
      scheduledActionId: 'reminder-1', dueAt,
    }]);
    m.conversationRepo.markCommittedDispatchQueued = vi.fn().mockResolvedValue(undefined);

    await makeOrchestrator(m).orchestrate(INPUT);

    expect(m.conversationRepo.recordCommittedTurn).toHaveBeenCalledWith(expect.objectContaining({
      followUpActions: [{ id: 'reminder-1', dueAt }],
    }));
    expect(m.outbox.enqueueFollowUpExecution).toHaveBeenCalledWith(expect.objectContaining({
      scheduledActionId: 'reminder-1', tenantId: 't-1', userId: 'u-1',
    }));
    expect(m.conversationRepo.markCommittedDispatchQueued).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'follow_up_execution', targetId: 'reminder-1',
    }));
  });

  it('records enabled dispatch intents and marks each accepted enqueue', async () => {
    const m = baseMocks();
    m.conversationRepo.findCommittedTurnForInbound = vi.fn().mockResolvedValue(null);
    m.conversationRepo.recordCommittedTurn = vi.fn().mockResolvedValue(undefined);
    m.conversationRepo.findUnqueuedCommittedDispatchKinds = vi.fn().mockResolvedValue([
      'message_send', 'memory_extraction', 'style_analysis', 'survey_evidence',
    ]);
    m.conversationRepo.markCommittedDispatchQueued = vi.fn().mockResolvedValue(undefined);

    await makeOrchestrator(m).orchestrate(INPUT);

    expect(m.conversationRepo.recordCommittedTurn).toHaveBeenCalledWith(expect.objectContaining({
      inboundMessageId: 'm-1', outboundMessageId: 'out-1',
      dispatchKinds: ['message_send', 'memory_extraction', 'style_analysis', 'survey_evidence'],
    }));
    expect(m.conversationRepo.markCommittedDispatchQueued.mock.calls.map((call: Array<{kind: string}>) => call[0].kind))
      .toEqual(['message_send', 'memory_extraction', 'style_analysis', 'survey_evidence']);
  });

  it('resumes an already dispatched turn without a model call or duplicate enqueue', async () => {
    const m = baseMocks();
    m.conversationRepo.findCommittedTurnForInbound = vi.fn().mockResolvedValue({
      id: 'out-1', ...OWNERSHIP, direction: 'outbound', text: 'stored reply',
    });
    m.conversationRepo.findUnqueuedCommittedDispatchKinds = vi.fn().mockResolvedValue([]);

    expect(await makeOrchestrator(m).resumeCommittedTurn(INPUT)).toBe(true);
    expect(m.aiProvider.classifySituation).not.toHaveBeenCalled();
    expect(m.outbox.enqueueMessageSend).not.toHaveBeenCalled();
    expect(m.outbox.enqueueSurveyEvidence).not.toHaveBeenCalled();
  });

  it('rejects a conversation owned by another user before reading disclosure proof', async () => {
    const m = baseMocks();
    m.conversationRepo.findById.mockResolvedValue({
      id: 'c-1', tenantId: 't-1', userId: 'u-other', channelType: 'slack', externalConversationId: 'ec',
    });
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    await expect(orch.orchestrate(INPUT)).rejects.toThrow('Conversation ownership mismatch');
    expect(m.conversationRepo.findRecentMessages).not.toHaveBeenCalled();
  });

  it('rejects a queue destination that differs from the stored conversation before side effects', async () => {
    const m = baseMocks();
    m.conversationRepo.findById.mockResolvedValue({
      id: 'c-1', tenantId: 't-1', userId: 'u-1', channelType: 'slack',
      externalConversationId: 'stored-channel', userDisplayName: null, userTimezone: null,
    });

    await expect(makeOrchestrator(m).orchestrate(INPUT))
      .rejects.toThrow('Conversation destination mismatch');
    expect(m.conversationRepo.findRecentMessages).not.toHaveBeenCalled();
    expect(m.outbox.enqueueProfileHydration).not.toHaveBeenCalled();
    expect(m.outbox.enqueueMessageSend).not.toHaveBeenCalled();
  });

  it('rejects a confirming message outside the conversation ownership before reading disclosure proof', async () => {
    const m = baseMocks();
    m.conversationRepo.findById.mockResolvedValue({
      id: 'c-1', tenantId: 't-1', userId: 'u-1', channelType: 'slack', externalConversationId: 'ec',
      userDisplayName: null, userTimezone: null,
    });
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
    expect(m.outbox.enqueueProfileHydration).not.toHaveBeenCalled();
  });

  it('processes a delayed inbound from source-bound history after newer messages arrive', async () => {
    const m = baseMocks();
    const inbound = {
      id: 'm-1', ...OWNERSHIP, direction: 'inbound', text: 'hey',
      occurredAt: INBOUND_OCCURRED_AT, metadata: undefined,
    };
    m.conversationRepo.findRecentMessages.mockResolvedValue(
      Array.from({ length: 20 }, (_, index) => ({
        ...inbound, id: `newer-${index}`, text: 'newer',
      })),
    );
    m.conversationRepo.findMessagesThrough = vi.fn().mockResolvedValue([inbound]);

    await expect(makeOrchestrator(m).orchestrate(INPUT)).resolves.toBeDefined();
    expect(m.conversationRepo.findMessagesThrough).toHaveBeenCalledWith({
      conversationId: 'c-1', tenantId: 't-1', userId: 'u-1',
      inboundMessageId: 'm-1', limit: 20,
    });
    expect(m.conversationRepo.findRecentMessages).not.toHaveBeenCalled();
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
    expect(m.conversationRepo.saveMessage.mock.calls[0][0]).toMatchObject({
      id: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f-]{27}$/),
      metadata: { sourceInboundMessageId: INPUT.messageId },
    });
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

  it('recovers persisted awaiting confirmation with the English disclosure (product default)', async () => {
    const m = baseMocks();
    m.conversationRepo.findRecentMessages.mockResolvedValue(surveyReadyHistory());
    m.conversationRepo.findLatestDeliveredReportingDisclosure.mockResolvedValue(null);
    m.conversationRepo.findById.mockResolvedValue({
      id: 'c-1', tenantId: 't-1', userId: 'u-1', channelType: 'slack', externalConversationId: 'ec', userDisplayName: 'Sam', userLocale: 'ru', userTimezone: 'UTC',
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

    const expectedText = `Я рядом.\n\n${getReportingDisclosureText('en')}`;
    expect(result.responseText).toBe(expectedText);
    expect(m.aiProvider.generateResponse.mock.calls[0][2]).toMatchObject({
      confirmationRequest: undefined,
      surveyProbeQuestion: undefined,
      reportingDisclosure: getReportingDisclosureText('en'),
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
      id: 'c-1', tenantId: 't-1', userId: 'u-1', channelType: 'slack', externalConversationId: 'ec',
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

    expect(result.responseText).toBe(getReportingExplanationText('en'));
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

  it('answers exact D05-03 with a scoped absent result and no survey side effects', async () => {
    const m = baseMocks();
    const question = 'but i don’t understand what exact information you already picked from our discussion?';
    m.conversationRepo.findRecentMessages.mockResolvedValue([
      {
        id: 'm-prior', ...OWNERSHIP, direction: 'inbound', text: 'The onboarding is great.',
        occurredAt: new Date('2026-09-03T09:59:00.000Z'),
      },
      { id: 'm-1', ...OWNERSHIP, direction: 'inbound', text: question, occurredAt: INBOUND_OCCURRED_AT },
    ]);
    m.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent: 'pulse_capture_explanation', secondaryIntents: [], urgency: 'low',
      emotionalState: [], confidence: 0.95, reasoningSummary: 'pulse capture transparency',
      surveyAllowed: false, requiresSafetyCheck: false, reminderRequest: null,
      dialogueAct: 'request', latestUserSubstance: question, topicAnchor: null,
      pulseCaptureScope: { type: 'conversation' },
    });
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    await orch.orchestrate(INPUT);

    expect(m.surveyRepo.findPulseCaptureForConversation).toHaveBeenCalledWith({
      tenantId: 't-1', userId: 'u-1', conversationId: 'c-1', beforeOccurredAt: INBOUND_OCCURRED_AT,
    });
    expect(captureFactsOf(m)).toEqual({ scope: 'conversation', captures: [] });
    expect(m.aiProvider.generateResponse).toHaveBeenCalledTimes(1);
    expect(m.aiProvider.interpretConfirmationResponse).not.toHaveBeenCalled();
    expect(m.surveyRepo.findAwaitingConfirmationGroups).not.toHaveBeenCalled();
    expect(m.outbox.enqueueSurveyEvidence).not.toHaveBeenCalled();
  });

  it('selects only the indexed owned prior inbound message and persists its exact-target receipt', async () => {
    const m = baseMocks();
    const question = 'What did you capture from my onboarding message?';
    m.conversationRepo.findRecentMessages.mockResolvedValue([
      { id: CAP8_SOURCE_ID, ...OWNERSHIP, direction: 'inbound', text: 'The onboarding is great.', occurredAt: new Date('2026-09-03T09:57:00.000Z') },
      { id: 'm-other', ...OWNERSHIP, direction: 'inbound', text: 'The roadmap is unclear.', occurredAt: new Date('2026-09-03T09:58:00.000Z') },
      { id: 'm-1', ...OWNERSHIP, direction: 'inbound', text: question, occurredAt: INBOUND_OCCURRED_AT },
    ]);
    m.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent: 'pulse_capture_explanation', secondaryIntents: [], urgency: 'low',
      emotionalState: [], confidence: 0.95, reasoningSummary: 'named prior message',
      surveyAllowed: false, requiresSafetyCheck: false, reminderRequest: null,
      dialogueAct: 'request', latestUserSubstance: question, topicAnchor: null,
      pulseCaptureScope: { type: 'message', messageIndex: 0 },
    });
    m.surveyRepo.findPulseCaptureForConversation.mockResolvedValue([{
      evidenceSummary: 'Onboarding feels positive.',
      questionGroup: 'belonging',
      sourceMessageIds: [CAP8_SOURCE_ID],
      status: 'temporary',
    }]);

    await makeOrchestrator(m).orchestrate(INPUT);

    expect(captureFactsOf(m)).toEqual({
      scope: 'exact', captures: [{ evidenceSummary: 'Onboarding feels positive.', status: 'temporary' }],
    });
    expect(m.surveyRepo.findPulseCaptureForConversation).toHaveBeenCalledWith({
      tenantId: 't-1', userId: 'u-1', conversationId: 'c-1',
      beforeOccurredAt: INBOUND_OCCURRED_AT, sourceMessageId: CAP8_SOURCE_ID,
    });
    expect(m.conversationRepo.saveMessage.mock.calls[0][0].metadata)
      .toHaveProperty('pulseCaptureSourceMessageId', CAP8_SOURCE_ID);
    expect(m.aiProvider.generateResponse).toHaveBeenCalledTimes(1);
    expect(m.outbox.enqueueSurveyEvidence).not.toHaveBeenCalled();
  });

  it.each([
    ['English', 'What did you capture from onboarding, and remind me tomorrow to send the report?'],
    ['Russian', 'Что ты сохранил из сообщения об онбординге, и напомни мне завтра об отчёте?'],
    ['Ukrainian', 'Що ти зберіг з повідомлення про онбординг, і нагадай мені завтра про звіт?'],
  ])('grounds a mixed CAP-8 reminder for the model and schedules it, for a question in %s', async (_language, question) => {
    const m = baseMocks();
    const reminderRequest = { intent: 'send the report', dueAt: '2026-09-04T09:00:00.000Z' };
    m.conversationRepo.findRecentMessages.mockResolvedValue([
      { id: CAP8_SOURCE_ID, ...OWNERSHIP, direction: 'inbound', text: 'The onboarding is great.', occurredAt: new Date('2026-09-03T09:57:00.000Z') },
      { id: 'm-1', ...OWNERSHIP, direction: 'inbound', text: question, occurredAt: INBOUND_OCCURRED_AT },
    ]);
    m.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent: 'pulse_capture_explanation', secondaryIntents: [], urgency: 'low',
      emotionalState: [], confidence: 0.95, reasoningSummary: 'exact status plus reminder',
      surveyAllowed: false, requiresSafetyCheck: false, reminderRequest,
      dialogueAct: 'new_substance', latestUserSubstance: question, topicAnchor: null,
      pulseCaptureScope: { type: 'message', messageIndex: 0 },
    });
    m.surveyRepo.findPulseCaptureForConversation.mockResolvedValue([{
      evidenceSummary: 'Onboarding feels positive.', questionGroup: 'belonging',
      sourceMessageIds: [CAP8_SOURCE_ID], status: 'temporary',
    }]);

    const result = await makeOrchestrator(m).orchestrate(INPUT);

    expect(captureFactsOf(m)).toEqual({
      scope: 'exact', captures: [{ evidenceSummary: 'Onboarding feels positive.', status: 'temporary' }],
    });
    expect(reminderConfirmationOf(m)).toEqual(expect.objectContaining({ intent: 'send the report' }));
    expect(result.classification.reminderRequest).toEqual(reminderRequest);
    expect(m.scheduledActionRepo.save).toHaveBeenCalledWith(expect.objectContaining({
      type: 'user_reminder',
      intent: 'send the report',
      sourceMessageIds: ['m-1'],
    }));
    expect(m.outbox.enqueueFollowUpExecution).toHaveBeenCalledWith(expect.objectContaining({
      scheduledActionId: 'reminder-1',
      tenantId: 't-1',
      userId: 'u-1',
    }));
    expect(m.aiProvider.generateResponse).toHaveBeenCalledTimes(1);
    expect(m.outbox.enqueueSurveyEvidence).not.toHaveBeenCalled();
  });

  it('acknowledges an already-scheduled CAP-8 reminder without duplicating it', async () => {
    const m = baseMocks();
    const question = 'What did you capture from onboarding, and remind me tomorrow to send the report?';
    const reminderRequest = { intent: 'send the report', dueAt: '2026-09-04T09:00:00.000Z' };
    m.scheduledActionRepo.existsByDeduplicationKey.mockResolvedValue(true);
    m.conversationRepo.findRecentMessages.mockResolvedValue([
      { id: CAP8_SOURCE_ID, ...OWNERSHIP, direction: 'inbound', text: 'The onboarding is great.', occurredAt: new Date('2026-09-03T09:57:00.000Z') },
      { id: 'm-1', ...OWNERSHIP, direction: 'inbound', text: question, occurredAt: INBOUND_OCCURRED_AT },
    ]);
    m.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent: 'pulse_capture_explanation', secondaryIntents: [], urgency: 'low',
      emotionalState: [], confidence: 0.95, reasoningSummary: 'exact status plus reminder',
      surveyAllowed: false, requiresSafetyCheck: false, reminderRequest,
      dialogueAct: 'request', latestUserSubstance: question, topicAnchor: null,
      pulseCaptureScope: { type: 'message', messageIndex: 0 },
    });

    await makeOrchestrator(m).orchestrate(INPUT);

    expect(reminderConfirmationOf(m)).toEqual(expect.objectContaining({ intent: 'send the report' }));
    expect(m.scheduledActionRepo.save).not.toHaveBeenCalled();
    expect(m.outbox.enqueueFollowUpExecution).not.toHaveBeenCalled();
    expect(m.aiProvider.generateResponse).toHaveBeenCalledTimes(1);
  });

  it('reports exact-message absence without widening to unrelated conversation evidence', async () => {
    const m = baseMocks();
    const question = 'What did you capture from my onboarding message?';
    m.conversationRepo.findRecentMessages.mockResolvedValue([
      { id: CAP8_SOURCE_ID, ...OWNERSHIP, direction: 'inbound', text: 'The onboarding is great.', occurredAt: new Date('2026-09-03T09:59:00.000Z') },
      { id: 'm-1', ...OWNERSHIP, direction: 'inbound', text: question, occurredAt: INBOUND_OCCURRED_AT },
    ]);
    m.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent: 'pulse_capture_explanation', secondaryIntents: [], urgency: 'low',
      emotionalState: [], confidence: 0.95, reasoningSummary: 'named prior message',
      surveyAllowed: false, requiresSafetyCheck: false, reminderRequest: null,
      dialogueAct: 'request', latestUserSubstance: question, topicAnchor: null,
      pulseCaptureScope: { type: 'message', messageIndex: 0 },
    });

    await makeOrchestrator(m).orchestrate(INPUT);

    expect(captureFactsOf(m)).toEqual({ scope: 'exact', captures: [] });
    expect(m.surveyRepo.findPulseCaptureForConversation).toHaveBeenCalledWith(expect.objectContaining({
      sourceMessageId: CAP8_SOURCE_ID,
    }));
    expect(m.aiProvider.generateResponse).toHaveBeenCalledTimes(1);
  });

  it.each(['unresolved', 'conversation'] as const)('resolves a uniquely quoted prior message when the CAP-8 classifier says %s', async (scope) => {
    const m = baseMocks();
    const sourceText = 'I am onboarding a new teammate next week. The introduction meeting is scheduled.';
    const question = `I mean this exact earlier message: “${sourceText}” Was that message captured as Pulse evidence?`;
    m.conversationRepo.findRecentMessages.mockResolvedValue([
      { id: CAP8_SOURCE_ID, ...OWNERSHIP, direction: 'inbound', text: `${sourceText}\n\n*Sent using* <@U123>`, occurredAt: new Date('2026-09-03T09:59:00.000Z') },
      { id: 'm-1', ...OWNERSHIP, direction: 'inbound', text: question, occurredAt: INBOUND_OCCURRED_AT },
    ]);
    m.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent: 'pulse_capture_explanation', secondaryIntents: [], urgency: 'low',
      emotionalState: [], confidence: 0.95, reasoningSummary: 'quote but unresolved',
      surveyAllowed: false, requiresSafetyCheck: false, reminderRequest: null,
      dialogueAct: 'request', latestUserSubstance: question, topicAnchor: null,
      pulseCaptureScope: { type: scope },
    });
    m.surveyRepo.findPulseCaptureForConversation.mockResolvedValue([{
      evidenceSummary: 'The onboarding meeting was scheduled.', questionGroup: 'growth',
      sourceMessageIds: [CAP8_SOURCE_ID], status: 'temporary',
    }]);

    await makeOrchestrator(m).orchestrate(INPUT);

    expect(captureFactsOf(m)).toEqual({
      scope: 'exact', captures: [{ evidenceSummary: 'The onboarding meeting was scheduled.', status: 'temporary' }],
    });
    expect(m.surveyRepo.findPulseCaptureForConversation).toHaveBeenCalledWith(expect.objectContaining({
      sourceMessageId: CAP8_SOURCE_ID,
    }));
    expect(m.conversationRepo.saveMessage.mock.calls[0][0].metadata)
      .toHaveProperty('pulseCaptureSourceMessageId', CAP8_SOURCE_ID);
  });

  it.each([
    'Did my exact message about onboarding a new teammate get captured as Pulse evidence? I mean only that message, not this whole conversation.',
    'Did my exact message about onboarding a new teammate get captured as Pulse evidence?',
  ])('does not widen a specifically scoped request when the classifier says conversation: %s', async (question) => {
    const m = baseMocks();
    m.conversationRepo.findRecentMessages.mockResolvedValue([
      { id: CAP8_SOURCE_ID, ...OWNERSHIP, direction: 'inbound', text: 'I am onboarding a new teammate.', occurredAt: new Date('2026-09-03T09:59:00.000Z') },
      { id: 'm-1', ...OWNERSHIP, direction: 'inbound', text: question, occurredAt: INBOUND_OCCURRED_AT },
    ]);
    m.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent: 'pulse_capture_explanation', secondaryIntents: [], urgency: 'low',
      emotionalState: [], confidence: 0.95, reasoningSummary: 'wrong broad scope',
      surveyAllowed: false, requiresSafetyCheck: false, reminderRequest: null,
      dialogueAct: 'request', latestUserSubstance: question, topicAnchor: null,
      pulseCaptureScope: { type: 'conversation' },
    });

    await makeOrchestrator(m).orchestrate(INPUT);

    expect(captureFactsOf(m)).toEqual(UNRESOLVED_FACTS);
    expect(m.surveyRepo.findPulseCaptureForConversation).not.toHaveBeenCalled();
    expect(m.conversationRepo.saveMessage.mock.calls[0][0].metadata)
      .not.toHaveProperty('pulseCaptureSourceMessageId');
  });

  it('keeps a quoted CAP-8 request unresolved when two prior messages contain the quote', async () => {
    const m = baseMocks();
    const quote = 'The introduction meeting is already scheduled for next week.';
    const question = `I mean this exact earlier message: “${quote}” Was that message captured as Pulse evidence?`;
    m.conversationRepo.findRecentMessages.mockResolvedValue([
      { id: CAP8_SOURCE_ID, ...OWNERSHIP, direction: 'inbound', text: quote, occurredAt: new Date('2026-09-03T09:58:00.000Z') },
      { id: '11111111-1111-4111-8111-111111111111', ...OWNERSHIP, direction: 'inbound', text: quote, occurredAt: new Date('2026-09-03T09:59:00.000Z') },
      { id: 'm-1', ...OWNERSHIP, direction: 'inbound', text: question, occurredAt: INBOUND_OCCURRED_AT },
    ]);
    m.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent: 'pulse_capture_explanation', secondaryIntents: [], urgency: 'low',
      emotionalState: [], confidence: 0.95, reasoningSummary: 'ambiguous quote',
      surveyAllowed: false, requiresSafetyCheck: false, reminderRequest: null,
      dialogueAct: 'request', latestUserSubstance: question, topicAnchor: null,
      pulseCaptureScope: { type: 'unresolved' },
    });

    await makeOrchestrator(m).orchestrate(INPUT);

    expect(captureFactsOf(m)).toEqual(UNRESOLVED_FACTS);
    expect(m.surveyRepo.findPulseCaptureForConversation).not.toHaveBeenCalled();
    expect(m.conversationRepo.saveMessage.mock.calls[0][0].metadata)
      .not.toHaveProperty('pulseCaptureSourceMessageId');
  });

  it.each([
    ['missing scope', undefined, 'The introduction meeting is scheduled.', true],
    ['partial quote', { type: 'unresolved' } as const, 'The introduction meeting is scheduled.', true],
    ['illustrative quote', { type: 'unresolved' } as const, 'I am onboarding next week. The introduction meeting is scheduled.', false],
  ])('does not resolve a %s', async (_label, pulseCaptureScope, quote, pointsToQuote) => {
    const m = baseMocks();
    const sourceText = 'I am onboarding next week. The introduction meeting is scheduled.';
    const question = pointsToQuote
      ? `I mean this exact earlier message: “${quote}” Was that message captured as Pulse evidence?`
      : `Did that onboarding message enter Pulse? For context: “${quote}”`;
    m.conversationRepo.findRecentMessages.mockResolvedValue([
      { id: CAP8_SOURCE_ID, ...OWNERSHIP, direction: 'inbound', text: sourceText, occurredAt: new Date('2026-09-03T09:59:00.000Z') },
      { id: 'm-1', ...OWNERSHIP, direction: 'inbound', text: question, occurredAt: INBOUND_OCCURRED_AT },
    ]);
    m.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent: 'pulse_capture_explanation', secondaryIntents: [], urgency: 'low',
      emotionalState: [], confidence: 0.95, reasoningSummary: 'quote is insufficient',
      surveyAllowed: false, requiresSafetyCheck: false, reminderRequest: null,
      dialogueAct: 'request', latestUserSubstance: question, topicAnchor: null,
      ...(pulseCaptureScope ? { pulseCaptureScope } : {}),
    });

    await makeOrchestrator(m).orchestrate(INPUT);

    expect(captureFactsOf(m)).toEqual(UNRESOLVED_FACTS);
    expect(m.surveyRepo.findPulseCaptureForConversation).not.toHaveBeenCalled();
  });

  it.each([
    ['missing scope', undefined],
    ['explicit unresolved scope', { type: 'unresolved' }],
    ['out-of-range target', { type: 'message', messageIndex: 99 }],
    ['current inbound target', { type: 'message', messageIndex: 1 }],
  ])('fails closed for %s and asks the employee to identify the message', async (_label, pulseCaptureScope) => {
    const m = baseMocks();
    const question = 'What did you capture from that message?';
    m.conversationRepo.findRecentMessages.mockResolvedValue([
      { id: 'm-prior', ...OWNERSHIP, direction: 'inbound', text: 'Earlier context.', occurredAt: new Date('2026-09-03T09:59:00.000Z') },
      { id: 'm-1', ...OWNERSHIP, direction: 'inbound', text: question, occurredAt: INBOUND_OCCURRED_AT },
    ]);
    m.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent: 'pulse_capture_explanation', secondaryIntents: [], urgency: 'low',
      emotionalState: [], confidence: 0.95, reasoningSummary: 'ambiguous reference',
      surveyAllowed: false, requiresSafetyCheck: false, reminderRequest: null,
      dialogueAct: 'request', latestUserSubstance: question, topicAnchor: null,
      ...(pulseCaptureScope === undefined ? {} : { pulseCaptureScope }),
    });

    await makeOrchestrator(m).orchestrate(INPUT);

    expect(captureFactsOf(m)).toEqual(UNRESOLVED_FACTS);
    expect(m.surveyRepo.findPulseCaptureForConversation).not.toHaveBeenCalled();
    expect(m.aiProvider.generateResponse).toHaveBeenCalledTimes(1);
    expect(m.conversationRepo.saveMessage.mock.calls[0][0].metadata)
      .not.toHaveProperty('pulseCaptureSourceMessageId');
  });

  it('fails closed when a message index points outside the visible last-15 transcript window', async () => {
    const m = baseMocks();
    const question = 'What did you capture from that older message?';
    const priorMessages = Array.from({ length: 19 }, (_, index) => ({
      id: `m-prior-${index}`,
      ...OWNERSHIP,
      direction: 'inbound',
      text: `Prior message ${index}`,
      occurredAt: new Date(INBOUND_OCCURRED_AT.getTime() - (19 - index) * 1_000),
    }));
    m.conversationRepo.findRecentMessages.mockResolvedValue([
      ...priorMessages,
      { id: 'm-1', ...OWNERSHIP, direction: 'inbound', text: question, occurredAt: INBOUND_OCCURRED_AT },
    ]);
    m.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent: 'pulse_capture_explanation', secondaryIntents: [], urgency: 'low',
      emotionalState: [], confidence: 0.95, reasoningSummary: 'out-of-window model index',
      surveyAllowed: false, requiresSafetyCheck: false, reminderRequest: null,
      dialogueAct: 'request', latestUserSubstance: question, topicAnchor: null,
      pulseCaptureScope: { type: 'message', messageIndex: 4 },
    });

    await makeOrchestrator(m).orchestrate(INPUT);

    expect(captureFactsOf(m)).toEqual(UNRESOLVED_FACTS);
    expect(m.surveyRepo.findPulseCaptureForConversation).not.toHaveBeenCalled();
    expect(m.conversationRepo.saveMessage.mock.calls[0][0].metadata)
      .not.toHaveProperty('pulseCaptureSourceMessageId');
  });

  it('rejects an indexed prior inbound row outside the queued ownership scope', async () => {
    const m = baseMocks();
    const question = 'What did you capture from that message?';
    m.conversationRepo.findRecentMessages.mockResolvedValue([
      { id: 'm-foreign', conversationId: 'c-1', tenantId: 't-foreign', userId: 'u-foreign', direction: 'inbound', text: 'Foreign message.', occurredAt: new Date('2026-09-03T09:59:00.000Z') },
      { id: 'm-1', ...OWNERSHIP, direction: 'inbound', text: question, occurredAt: INBOUND_OCCURRED_AT },
    ]);
    m.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent: 'pulse_capture_explanation', secondaryIntents: [], urgency: 'low',
      emotionalState: [], confidence: 0.95, reasoningSummary: 'bad indexed target',
      surveyAllowed: false, requiresSafetyCheck: false, reminderRequest: null,
      dialogueAct: 'request', latestUserSubstance: question, topicAnchor: null,
      pulseCaptureScope: { type: 'message', messageIndex: 0 },
    });

    await makeOrchestrator(m).orchestrate(INPUT);

    expect(captureFactsOf(m)).toEqual(UNRESOLVED_FACTS);
    expect(m.surveyRepo.findPulseCaptureForConversation).not.toHaveBeenCalled();
  });

  it('fails closed when an indexed source row has a malformed persisted id', async () => {
    const m = baseMocks();
    const question = 'What did you capture from that message?';
    m.conversationRepo.findRecentMessages.mockResolvedValue([
      { id: 'not-a-uuid', ...OWNERSHIP, direction: 'inbound', text: 'Earlier context.', occurredAt: new Date('2026-09-03T09:59:00.000Z') },
      { id: 'm-1', ...OWNERSHIP, direction: 'inbound', text: question, occurredAt: INBOUND_OCCURRED_AT },
    ]);
    m.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent: 'pulse_capture_explanation', secondaryIntents: [], urgency: 'low',
      emotionalState: [], confidence: 0.95, reasoningSummary: 'malformed indexed target',
      surveyAllowed: false, requiresSafetyCheck: false, reminderRequest: null,
      dialogueAct: 'request', latestUserSubstance: question, topicAnchor: null,
      pulseCaptureScope: { type: 'message', messageIndex: 0 },
    });

    await makeOrchestrator(m).orchestrate(INPUT);

    expect(captureFactsOf(m)).toEqual(UNRESOLVED_FACTS);
    expect(m.surveyRepo.findPulseCaptureForConversation).not.toHaveBeenCalled();
    expect(m.aiProvider.generateResponse).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['corrupt receipt UUID', [
      { id: CAP8_SOURCE_ID, ...OWNERSHIP, direction: 'inbound', text: 'The onboarding is great.', occurredAt: new Date('2026-09-03T09:57:00.000Z') },
      { id: 'out-cap8', ...OWNERSHIP, direction: 'outbound', text: 'Exact answer.', occurredAt: new Date('2026-09-03T09:59:00.000Z'), sentAt: new Date('2026-09-03T09:59:01.000Z'), metadata: { pulseCaptureSourceMessageId: 'not-a-uuid' } },
    ]],
    ['undelivered receipt', [
      { id: CAP8_SOURCE_ID, ...OWNERSHIP, direction: 'inbound', text: 'The onboarding is great.', occurredAt: new Date('2026-09-03T09:57:00.000Z') },
      { id: 'out-cap8', ...OWNERSHIP, direction: 'outbound', text: 'Exact answer.', occurredAt: new Date('2026-09-03T09:59:00.000Z'), metadata: { pulseCaptureSourceMessageId: CAP8_SOURCE_ID } },
    ]],
    ['receipt delivered after the current inbound', [
      { id: CAP8_SOURCE_ID, ...OWNERSHIP, direction: 'inbound', text: 'The onboarding is great.', occurredAt: new Date('2026-09-03T09:57:00.000Z') },
      { id: 'out-cap8', ...OWNERSHIP, direction: 'outbound', text: 'Exact answer.', occurredAt: new Date('2026-09-03T09:59:00.000Z'), sentAt: new Date('2026-09-03T10:00:01.000Z'), metadata: { pulseCaptureSourceMessageId: CAP8_SOURCE_ID } },
    ]],
    ['receipt delivered before its source message', [
      { id: CAP8_SOURCE_ID, ...OWNERSHIP, direction: 'inbound', text: 'The onboarding is great.', occurredAt: new Date('2026-09-03T09:59:30.000Z') },
      { id: 'out-cap8', ...OWNERSHIP, direction: 'outbound', text: 'Impossible exact answer.', occurredAt: new Date('2026-09-03T09:59:00.000Z'), sentAt: new Date('2026-09-03T09:59:01.000Z'), metadata: { pulseCaptureSourceMessageId: CAP8_SOURCE_ID } },
    ]],
    ['deleted target omitted from recent messages', [
      { id: 'out-cap8', ...OWNERSHIP, direction: 'outbound', text: 'Exact answer.', occurredAt: new Date('2026-09-03T09:59:00.000Z'), sentAt: new Date('2026-09-03T09:59:01.000Z'), metadata: { pulseCaptureSourceMessageId: CAP8_SOURCE_ID } },
    ]],
    ['stale delivered receipt', [
      { id: CAP8_SOURCE_ID, ...OWNERSHIP, direction: 'inbound', text: 'The onboarding is great.', occurredAt: new Date('2026-09-03T03:57:00.000Z') },
      { id: 'out-cap8', ...OWNERSHIP, direction: 'outbound', text: 'Exact answer.', occurredAt: new Date('2026-09-03T04:00:00.000Z'), sentAt: new Date('2026-09-03T04:00:01.000Z'), metadata: { pulseCaptureSourceMessageId: CAP8_SOURCE_ID } },
    ]],
    ['foreign target row', [
      { id: CAP8_SOURCE_ID, conversationId: 'c-1', tenantId: 't-foreign', userId: 'u-foreign', direction: 'inbound', text: 'Foreign source.', occurredAt: new Date('2026-09-03T09:57:00.000Z') },
      { id: 'out-cap8', ...OWNERSHIP, direction: 'outbound', text: 'Exact answer.', occurredAt: new Date('2026-09-03T09:59:00.000Z'), sentAt: new Date('2026-09-03T09:59:01.000Z'), metadata: { pulseCaptureSourceMessageId: CAP8_SOURCE_ID } },
    ]],
  ] as const)('fails closed for a %s', async (_label, priorMessages) => {
    const m = baseMocks();
    const question = 'And what is the status of that exact one now?';
    m.conversationRepo.findRecentMessages.mockResolvedValue([
      ...priorMessages,
      { id: 'm-1', ...OWNERSHIP, direction: 'inbound', text: question, occurredAt: INBOUND_OCCURRED_AT },
    ]);
    m.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent: 'pulse_capture_explanation', secondaryIntents: [], urgency: 'low',
      emotionalState: [], confidence: 0.95, reasoningSummary: 'same exact target',
      surveyAllowed: false, requiresSafetyCheck: false, reminderRequest: null,
      dialogueAct: 'continuation', latestUserSubstance: question, topicAnchor: null,
      pulseCaptureScope: { type: 'previous_exact' },
    });

    await makeOrchestrator(m).orchestrate(INPUT);

    expect(captureFactsOf(m)).toEqual(UNRESOLVED_FACTS);
    expect(m.surveyRepo.findPulseCaptureForConversation).not.toHaveBeenCalled();
    expect(m.conversationRepo.saveMessage.mock.calls[0][0].metadata)
      .not.toHaveProperty('pulseCaptureSourceMessageId');
  });

  it('reuses only the latest valid exact-target receipt for a request-style follow-up', async () => {
    const m = baseMocks();
    const question = 'And what is its status now?';
    m.conversationRepo.findRecentMessages.mockResolvedValue([
      { id: CAP8_SOURCE_ID, ...OWNERSHIP, direction: 'inbound', text: 'The onboarding is great.', occurredAt: new Date('2026-09-03T09:57:00.000Z') },
      { id: 'out-cap8', ...OWNERSHIP, direction: 'outbound', text: 'Onboarding feels positive.', occurredAt: new Date('2026-09-03T04:00:00.000Z'), sentAt: new Date('2026-09-03T09:59:01.000Z'), metadata: { pulseCaptureSourceMessageId: CAP8_SOURCE_ID } },
      { id: 'm-1', ...OWNERSHIP, direction: 'inbound', text: question, occurredAt: INBOUND_OCCURRED_AT },
    ]);
    m.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent: 'pulse_capture_explanation', secondaryIntents: [], urgency: 'low',
      emotionalState: [], confidence: 0.95, reasoningSummary: 'same exact target',
      surveyAllowed: false, requiresSafetyCheck: false, reminderRequest: null,
      dialogueAct: 'request', latestUserSubstance: question, topicAnchor: null,
      pulseCaptureScope: { type: 'previous_exact' },
    });
    m.surveyRepo.findPulseCaptureForConversation.mockResolvedValue([{
      evidenceSummary: 'Current onboarding status.', questionGroup: 'belonging',
      sourceMessageIds: [CAP8_SOURCE_ID], status: 'confirmed',
    }]);

    await makeOrchestrator(m).orchestrate(INPUT);

    expect(captureFactsOf(m)).toEqual({
      scope: 'exact', captures: [{ evidenceSummary: 'Current onboarding status.', status: 'confirmed' }],
    });
    expect(m.surveyRepo.findPulseCaptureForConversation).toHaveBeenCalledWith(expect.objectContaining({
      sourceMessageId: CAP8_SOURCE_ID,
    }));
    expect(m.conversationRepo.saveMessage.mock.calls[0][0].metadata)
      .toHaveProperty('pulseCaptureSourceMessageId', CAP8_SOURCE_ID);
    expect(m.aiProvider.generateResponse).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['missing receipt', [
      { id: 'm-onboarding', ...OWNERSHIP, direction: 'inbound', text: 'The onboarding is great.', occurredAt: new Date('2026-09-03T09:57:00.000Z') },
      { id: 'out-cap8', ...OWNERSHIP, direction: 'outbound', text: 'Prior answer.', occurredAt: new Date('2026-09-03T09:59:00.000Z'), metadata: {} },
    ]],
    ['blank receipt', [
      { id: 'm-onboarding', ...OWNERSHIP, direction: 'inbound', text: 'The onboarding is great.', occurredAt: new Date('2026-09-03T09:57:00.000Z') },
      { id: 'out-cap8', ...OWNERSHIP, direction: 'outbound', text: 'Prior answer.', occurredAt: new Date('2026-09-03T09:59:00.000Z'), metadata: { pulseCaptureSourceMessageId: '   ' } },
    ]],
    ['intervening outbound', [
      { id: 'm-onboarding', ...OWNERSHIP, direction: 'inbound', text: 'The onboarding is great.', occurredAt: new Date('2026-09-03T09:56:00.000Z') },
      { id: 'out-cap8', ...OWNERSHIP, direction: 'outbound', text: 'Exact answer.', occurredAt: new Date('2026-09-03T09:57:00.000Z'), metadata: { pulseCaptureSourceMessageId: 'm-onboarding' } },
      { id: 'out-other', ...OWNERSHIP, direction: 'outbound', text: 'Unrelated answer.', occurredAt: new Date('2026-09-03T09:59:00.000Z'), metadata: {} },
    ]],
    ['intervening inbound', [
      { id: 'm-onboarding', ...OWNERSHIP, direction: 'inbound', text: 'The onboarding is great.', occurredAt: new Date('2026-09-03T09:56:00.000Z') },
      { id: 'out-cap8', ...OWNERSHIP, direction: 'outbound', text: 'Exact answer.', occurredAt: new Date('2026-09-03T09:57:00.000Z'), metadata: { pulseCaptureSourceMessageId: 'm-onboarding' } },
      { id: 'm-other', ...OWNERSHIP, direction: 'inbound', text: 'Unrelated follow-up.', occurredAt: new Date('2026-09-03T09:59:00.000Z'), metadata: {} },
    ]],
    ['stale receipt', [
      { id: 'm-onboarding', ...OWNERSHIP, direction: 'inbound', text: 'The onboarding is great.', occurredAt: new Date('2026-09-03T03:57:00.000Z') },
      { id: 'out-cap8', ...OWNERSHIP, direction: 'outbound', text: 'Exact answer.', occurredAt: new Date('2026-09-03T04:00:00.000Z'), metadata: { pulseCaptureSourceMessageId: 'm-onboarding' } },
    ]],
  ])('fails closed for a previous-exact follow-up with %s', async (_label, priorMessages) => {
    const m = baseMocks();
    const question = 'What about that exact one now?';
    m.conversationRepo.findRecentMessages.mockResolvedValue([
      ...priorMessages,
      { id: 'm-1', ...OWNERSHIP, direction: 'inbound', text: question, occurredAt: INBOUND_OCCURRED_AT },
    ]);
    m.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent: 'pulse_capture_explanation', secondaryIntents: [], urgency: 'low',
      emotionalState: [], confidence: 0.95, reasoningSummary: 'same exact target',
      surveyAllowed: false, requiresSafetyCheck: false, reminderRequest: null,
      dialogueAct: 'continuation', latestUserSubstance: question, topicAnchor: null,
      pulseCaptureScope: { type: 'previous_exact' },
    });

    await makeOrchestrator(m).orchestrate(INPUT);

    expect(captureFactsOf(m)).toEqual(UNRESOLVED_FACTS);
    expect(m.surveyRepo.findPulseCaptureForConversation).not.toHaveBeenCalled();
    expect(m.conversationRepo.saveMessage.mock.calls[0][0].metadata)
      .not.toHaveProperty('pulseCaptureSourceMessageId');
  });

  it('fails closed when a previous-exact source row has left recent history', async () => {
    const m = baseMocks();
    const question = 'What is the status of that exact one now?';
    m.conversationRepo.findRecentMessages.mockResolvedValue([
      {
        id: 'out-cap8', ...OWNERSHIP, direction: 'outbound', text: 'Exact answer.',
        occurredAt: new Date('2026-09-03T09:59:00.000Z'),
        sentAt: new Date('2026-09-03T09:59:01.000Z'),
        metadata: { pulseCaptureSourceMessageId: CAP8_SOURCE_ID },
      },
      { id: 'm-1', ...OWNERSHIP, direction: 'inbound', text: question, occurredAt: INBOUND_OCCURRED_AT },
    ]);
    m.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent: 'pulse_capture_explanation', secondaryIntents: [], urgency: 'low',
      emotionalState: [], confidence: 0.95, reasoningSummary: 'same exact target',
      surveyAllowed: false, requiresSafetyCheck: false, reminderRequest: null,
      dialogueAct: 'continuation', latestUserSubstance: question, topicAnchor: null,
      pulseCaptureScope: { type: 'previous_exact' },
    });
    m.surveyRepo.findPulseCaptureForConversation.mockResolvedValue([{
      evidenceSummary: 'Evicted source still resolves in PostgreSQL.', questionGroup: 'growth',
      sourceMessageIds: ['m-evicted-source'], status: 'confirmed',
    }]);

    await makeOrchestrator(m).orchestrate(INPUT);

    expect(captureFactsOf(m)).toEqual(UNRESOLVED_FACTS);
    expect(m.surveyRepo.findPulseCaptureForConversation).not.toHaveBeenCalled();
    expect(m.conversationRepo.saveMessage.mock.calls[0][0].metadata)
      .not.toHaveProperty('pulseCaptureSourceMessageId');
  });

  it('re-reads changed DB status in a sequential exact request and previous-exact follow-up', async () => {
    const m = baseMocks();
    const initialQuestion = 'What did you capture from my onboarding message?';
    const followUpQuestion = 'And what is the status of that exact one now?';
    const initialHistory = [
      {
        id: CAP8_SOURCE_ID, ...OWNERSHIP, direction: 'inbound', text: 'The onboarding is great.',
        occurredAt: new Date('2026-09-03T09:59:00.000Z'),
      },
      { id: 'm-1', ...OWNERSHIP, direction: 'inbound', text: initialQuestion, occurredAt: INBOUND_OCCURRED_AT },
    ];
    m.conversationRepo.findRecentMessages.mockImplementation(async () => {
      if (m.conversationRepo.findRecentMessages.mock.calls.length === 1) return initialHistory;
      return [
        {
          id: CAP8_SOURCE_ID, ...OWNERSHIP, direction: 'inbound', text: 'The onboarding is great.',
          occurredAt: new Date('2026-09-03T09:59:00.000Z'),
        },
        {
          id: 'out-initial', ...OWNERSHIP, direction: 'outbound', text: 'Initial exact answer.',
          occurredAt: new Date('2026-09-03T10:01:00.000Z'),
          sentAt: new Date('2026-09-03T10:01:01.000Z'),
          metadata: m.conversationRepo.saveMessage.mock.calls[0][0].metadata,
        },
        {
          id: 'm-2', ...OWNERSHIP, direction: 'inbound', text: followUpQuestion,
          occurredAt: new Date('2026-09-03T10:02:00.000Z'),
        },
      ];
    });
    m.conversationRepo.saveMessage
      .mockImplementationOnce(async (params: { text: string }) => ({ ...params, id: 'out-initial' }))
      .mockImplementationOnce(async (params: { text: string }) => ({ ...params, id: 'out-followup' }));
    m.aiProvider.classifySituation
      .mockResolvedValueOnce({
        primaryIntent: 'pulse_capture_explanation', secondaryIntents: [], urgency: 'low',
        emotionalState: [], confidence: 0.95, reasoningSummary: 'named exact target',
        surveyAllowed: false, requiresSafetyCheck: false, reminderRequest: null,
        dialogueAct: 'request', latestUserSubstance: initialQuestion, topicAnchor: null,
        pulseCaptureScope: { type: 'message', messageIndex: 0 },
      })
      .mockResolvedValueOnce({
        primaryIntent: 'pulse_capture_explanation', secondaryIntents: [], urgency: 'low',
        emotionalState: [], confidence: 0.95, reasoningSummary: 'same exact target',
        surveyAllowed: false, requiresSafetyCheck: false, reminderRequest: null,
        dialogueAct: 'continuation', latestUserSubstance: followUpQuestion, topicAnchor: null,
        pulseCaptureScope: { type: 'previous_exact' },
      });
    m.surveyRepo.findPulseCaptureForConversation
      .mockResolvedValueOnce([{
        evidenceSummary: 'Onboarding is a temporary interpretation.', questionGroup: 'belonging',
        sourceMessageIds: [CAP8_SOURCE_ID], status: 'temporary',
      }])
      .mockResolvedValueOnce([{
        evidenceSummary: 'Onboarding is now confirmed.', questionGroup: 'belonging',
        sourceMessageIds: [CAP8_SOURCE_ID], status: 'confirmed',
      }]);
    const orchestrator = makeOrchestrator(m);

    await orchestrator.orchestrate(INPUT);
    await orchestrator.orchestrate({
      ...INPUT,
      messageId: 'm-2',
      traceId: 'tr-followup',
    });

    expect(m.aiProvider.generateResponse.mock.calls[0][2].captureFacts).toEqual({
      scope: 'exact', captures: [{ evidenceSummary: 'Onboarding is a temporary interpretation.', status: 'temporary' }],
    });
    expect(m.aiProvider.generateResponse.mock.calls[1][2].captureFacts).toEqual({
      scope: 'exact', captures: [{ evidenceSummary: 'Onboarding is now confirmed.', status: 'confirmed' }],
    });
    expect(m.surveyRepo.findPulseCaptureForConversation).toHaveBeenNthCalledWith(1, expect.objectContaining({
      sourceMessageId: CAP8_SOURCE_ID,
    }));
    expect(m.surveyRepo.findPulseCaptureForConversation).toHaveBeenNthCalledWith(2, expect.objectContaining({
      sourceMessageId: CAP8_SOURCE_ID,
    }));
    expect(m.conversationRepo.saveMessage.mock.calls[1][0].metadata)
      .toHaveProperty('pulseCaptureSourceMessageId', CAP8_SOURCE_ID);
  });

  it('rejects a previous-exact receipt carried by a foreign outbound row', async () => {
    const m = baseMocks();
    const question = 'What about that exact one now?';
    m.conversationRepo.findRecentMessages.mockResolvedValue([
      { id: 'm-onboarding', ...OWNERSHIP, direction: 'inbound', text: 'The onboarding is great.', occurredAt: new Date('2026-09-03T09:58:00.000Z') },
      {
        id: 'out-foreign', conversationId: 'c-1', tenantId: 't-foreign', userId: 'u-foreign',
        direction: 'outbound', text: 'Foreign exact answer.',
        occurredAt: new Date('2026-09-03T09:59:00.000Z'),
        metadata: { pulseCaptureSourceMessageId: 'm-onboarding' },
      },
      { id: 'm-1', ...OWNERSHIP, direction: 'inbound', text: question, occurredAt: INBOUND_OCCURRED_AT },
    ]);
    m.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent: 'pulse_capture_explanation', secondaryIntents: [], urgency: 'low',
      emotionalState: [], confidence: 0.95, reasoningSummary: 'foreign receipt',
      surveyAllowed: false, requiresSafetyCheck: false, reminderRequest: null,
      dialogueAct: 'continuation', latestUserSubstance: question, topicAnchor: null,
      pulseCaptureScope: { type: 'previous_exact' },
    });

    await makeOrchestrator(m).orchestrate(INPUT);

    expect(captureFactsOf(m)).toEqual(UNRESOLVED_FACTS);
    expect(m.surveyRepo.findPulseCaptureForConversation).not.toHaveBeenCalled();
    expect(m.conversationRepo.saveMessage.mock.calls[0][0].metadata)
      .not.toHaveProperty('pulseCaptureSourceMessageId');
  });

  it('honors conversation-wide correction even when an older exact receipt exists', async () => {
    const m = baseMocks();
    const question = 'What exact pulse information did you capture from this conversation?';
    m.conversationRepo.findRecentMessages.mockResolvedValue([
      { id: 'm-onboarding', ...OWNERSHIP, direction: 'inbound', text: 'The onboarding is great.', occurredAt: new Date('2026-09-03T09:57:00.000Z') },
      { id: 'out-cap8', ...OWNERSHIP, direction: 'outbound', text: 'Exact answer.', occurredAt: new Date('2026-09-03T09:59:00.000Z'), metadata: { pulseCaptureSourceMessageId: 'm-onboarding' } },
      { id: 'm-1', ...OWNERSHIP, direction: 'inbound', text: question, occurredAt: INBOUND_OCCURRED_AT },
    ]);
    m.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent: 'pulse_capture_explanation', secondaryIntents: [], urgency: 'low',
      emotionalState: [], confidence: 0.95, reasoningSummary: 'conversation-wide correction',
      surveyAllowed: false, requiresSafetyCheck: false, reminderRequest: null,
      dialogueAct: 'correction', latestUserSubstance: question, topicAnchor: null,
      pulseCaptureScope: { type: 'conversation' },
    });

    await makeOrchestrator(m).orchestrate(INPUT);

    expect(m.surveyRepo.findPulseCaptureForConversation).toHaveBeenCalledWith({
      tenantId: 't-1', userId: 'u-1', conversationId: 'c-1', beforeOccurredAt: INBOUND_OCCURRED_AT,
    });
    expect(m.conversationRepo.saveMessage.mock.calls[0][0].metadata)
      .not.toHaveProperty('pulseCaptureSourceMessageId');
  });

  it('does not persist an exact-target receipt when safety suppresses CAP-8', async () => {
    const m = baseMocks();
    const question = 'I might hurt myself. What about that exact message?';
    m.conversationRepo.findRecentMessages.mockResolvedValue([
      { id: 'm-onboarding', ...OWNERSHIP, direction: 'inbound', text: 'The onboarding is great.', occurredAt: new Date('2026-09-03T09:57:00.000Z') },
      { id: 'out-cap8', ...OWNERSHIP, direction: 'outbound', text: 'Exact answer.', occurredAt: new Date('2026-09-03T09:59:00.000Z'), metadata: { pulseCaptureSourceMessageId: 'm-onboarding' } },
      { id: 'm-1', ...OWNERSHIP, direction: 'inbound', text: question, occurredAt: INBOUND_OCCURRED_AT },
    ]);
    m.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent: 'potential_crisis', secondaryIntents: ['pulse_capture_explanation'], urgency: 'critical',
      emotionalState: ['unsafe'], confidence: 0.95, reasoningSummary: 'safety first',
      surveyAllowed: false, requiresSafetyCheck: true, reminderRequest: null,
      dialogueAct: 'emotional_disclosure', latestUserSubstance: question, topicAnchor: null,
      pulseCaptureScope: { type: 'previous_exact' },
    });
    m.aiProvider.detectRisk.mockResolvedValue({
      riskType: 'potential_self_harm', severity: 'critical', confidence: 0.95,
      evidence: ['direct statement'], immediateResponseRequired: true,
      escalationRecommended: true, surveyMustBeBlocked: true,
      proactiveMessagesMustBePaused: true, reasoningSummary: 'Immediate safety response required.',
    });
    m.aiProvider.generateResponse.mockResolvedValue({
      text: 'Please contact emergency support now.', confidence: 0.95, containsSurveyProbe: false,
    });

    await makeOrchestrator(m).orchestrate(INPUT);

    expect(m.surveyRepo.findPulseCaptureForConversation).not.toHaveBeenCalled();
    expect(m.outbox.enqueueSurveyEvidence).not.toHaveBeenCalled();
    expect(m.conversationRepo.saveMessage.mock.calls[0][0].metadata)
      .not.toHaveProperty('pulseCaptureSourceMessageId');
  });

  it.each(['acknowledgement', 'closing'] as const)(
    'does not look up or persist a hallucinated previous-exact receipt on %s',
    async (dialogueAct) => {
      const m = baseMocks();
      const text = dialogueAct === 'closing' ? 'Never mind.' : 'Okay.';
      m.conversationRepo.findRecentMessages.mockResolvedValue([
        {
          id: 'out-cap8', ...OWNERSHIP, direction: 'outbound', text: 'Exact answer.',
          occurredAt: new Date('2026-09-03T09:59:00.000Z'),
          metadata: { pulseCaptureSourceMessageId: 'm-onboarding' },
        },
        { id: 'm-1', ...OWNERSHIP, direction: 'inbound', text, occurredAt: INBOUND_OCCURRED_AT },
      ]);
      m.aiProvider.classifySituation.mockResolvedValue({
        primaryIntent: 'pulse_capture_explanation', secondaryIntents: [], urgency: 'low',
        emotionalState: [], confidence: 0.95, reasoningSummary: 'hallucinated carry-over',
        surveyAllowed: false, requiresSafetyCheck: false, reminderRequest: null,
        dialogueAct, latestUserSubstance: dialogueAct === 'closing' ? null : text, topicAnchor: null,
        pulseCaptureScope: { type: 'previous_exact' },
      });

      await makeOrchestrator(m).orchestrate(INPUT);

      expect(m.surveyRepo.findPulseCaptureForConversation).not.toHaveBeenCalled();
      expect(m.conversationRepo.saveMessage.mock.calls[0][0].metadata)
        .not.toHaveProperty('pulseCaptureSourceMessageId');
    },
  );

  it('fails closed when CAP-8 provenance storage is unavailable', async () => {
    const m = baseMocks();
    const question = 'What exact pulse information did you pick up from this discussion?';
    m.conversationRepo.findRecentMessages.mockResolvedValue([
      { id: 'm-1', ...OWNERSHIP, direction: 'inbound', text: question, occurredAt: INBOUND_OCCURRED_AT },
    ]);
    m.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent: 'pulse_capture_explanation', secondaryIntents: [], urgency: 'low',
      emotionalState: [], confidence: 0.95, reasoningSummary: 'pulse capture transparency',
      surveyAllowed: false, requiresSafetyCheck: false, reminderRequest: null,
      dialogueAct: 'request', latestUserSubstance: question, topicAnchor: null,
      pulseCaptureScope: { type: 'conversation' },
    });
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, undefined,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    await expect(orch.orchestrate(INPUT)).rejects.toThrow('pulse_capture_repository_unavailable');
    expect(m.conversationRepo.saveMessage).not.toHaveBeenCalled();
    expect(m.outbox.enqueueMessageSend).not.toHaveBeenCalled();
  });

  it('grounds linked temporary evidence for the model without touching survey state', async () => {
    const m = baseMocks();
    const question = 'What exact pulse information did you pick up from this discussion?';
    m.conversationRepo.findRecentMessages.mockResolvedValue([
      {
        id: 'm-prior', ...OWNERSHIP, direction: 'inbound', text: 'The onboarding is great.',
        occurredAt: new Date('2026-09-03T09:59:00.000Z'),
      },
      { id: 'm-1', ...OWNERSHIP, direction: 'inbound', text: question, occurredAt: INBOUND_OCCURRED_AT },
    ]);
    m.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent: 'pulse_capture_explanation', secondaryIntents: [], urgency: 'low',
      emotionalState: [], confidence: 0.95, reasoningSummary: 'pulse capture transparency',
      surveyAllowed: false, requiresSafetyCheck: false, reminderRequest: null,
      dialogueAct: 'request', latestUserSubstance: question, topicAnchor: null,
      pulseCaptureScope: { type: 'conversation' },
    });
    m.surveyRepo.findPulseCaptureForConversation.mockResolvedValue([
      {
        evidenceSummary: 'The employee views onboarding positively.',
        questionGroup: 'belonging',
        sourceMessageIds: ['m-prior'],
        status: 'temporary',
      },
    ]);
    m.surveyRepo.findAwaitingConfirmationGroups.mockResolvedValue([
      {
        surveyWindowId: 'w-1', userId: 'u-1', tenantId: 't-1', questionGroup: 'belonging',
        confirmationPromptMessageId: 'out-confirmation-1',
        deidentificationDecision: ACCEPTED_DEIDENTIFICATION,
      },
    ]);
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    await orch.orchestrate(INPUT);

    expect(captureFactsOf(m)).toEqual({
      scope: 'conversation',
      captures: [{ evidenceSummary: 'The employee views onboarding positively.', status: 'temporary' }],
    });
    expect(m.aiProvider.generateResponse).toHaveBeenCalledTimes(1);
    expect(m.aiProvider.interpretConfirmationResponse).not.toHaveBeenCalled();
    expect(m.surveyRepo.findAwaitingConfirmationGroups).not.toHaveBeenCalled();
    expect(m.surveyRepo.findPendingConfirmationGroups).not.toHaveBeenCalled();
    expect(m.surveyRepo.upsertGroupState).not.toHaveBeenCalled();
    expect(m.surveyRepo.stageGroupConfirmation).not.toHaveBeenCalled();
    expect(m.surveyRepo.transitionAwaitingGroupState).not.toHaveBeenCalled();
    expect(m.surveyRepo.withdrawGroupState).not.toHaveBeenCalled();
    expect(m.surveyRepo.confirmGroupState).not.toHaveBeenCalled();
    expect(m.outbox.enqueueGroupReport).not.toHaveBeenCalled();
    expect(m.outbox.enqueueSurveyEvidence).not.toHaveBeenCalled();
  });

  it.each([
    ['confirmed', 'Exact confirmed summary.'],
    ['withdrawn', 'Exact withdrawn summary.'],
  ] as const)('grounds linked %s pulse evidence with its status for the model', async (status, summary) => {
    const m = baseMocks();
    const question = 'What exact pulse information did you pick up from this discussion?';
    m.conversationRepo.findRecentMessages.mockResolvedValue([
      {
        id: 'm-prior', ...OWNERSHIP, direction: 'inbound', text: 'The onboarding is great.',
        occurredAt: new Date('2026-09-03T09:59:00.000Z'),
      },
      { id: 'm-1', ...OWNERSHIP, direction: 'inbound', text: question, occurredAt: INBOUND_OCCURRED_AT },
    ]);
    m.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent: 'pulse_capture_explanation', secondaryIntents: [], urgency: 'low',
      emotionalState: [], confidence: 0.95, reasoningSummary: 'pulse capture transparency',
      surveyAllowed: false, requiresSafetyCheck: false, reminderRequest: null,
      dialogueAct: 'request', latestUserSubstance: question, topicAnchor: null,
      pulseCaptureScope: { type: 'conversation' },
    });
    m.surveyRepo.findPulseCaptureForConversation.mockResolvedValue([
      { evidenceSummary: summary, questionGroup: 'belonging', sourceMessageIds: ['m-prior'], status },
    ]);
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    await orch.orchestrate(INPUT);

    expect(captureFactsOf(m)).toEqual({ scope: 'conversation', captures: [{ evidenceSummary: summary, status }] });
    expect(m.aiProvider.generateResponse).toHaveBeenCalledTimes(1);
    expect(m.outbox.enqueueSurveyEvidence).not.toHaveBeenCalled();
  });

  it('keeps safety primary and performs no CAP-8 provenance lookup', async () => {
    const m = baseMocks();
    const question = 'I might hurt myself. What exact information did you pick up from this discussion?';
    m.conversationRepo.findRecentMessages.mockResolvedValue([
      { id: 'm-prior', ...OWNERSHIP, direction: 'inbound', text: 'Earlier context.', occurredAt: new Date('2026-09-03T09:59:00.000Z') },
      { id: 'm-1', ...OWNERSHIP, direction: 'inbound', text: question, occurredAt: INBOUND_OCCURRED_AT },
    ]);
    m.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent: 'potential_crisis', secondaryIntents: ['pulse_capture_explanation'], urgency: 'critical',
      emotionalState: ['unsafe'], confidence: 0.95, reasoningSummary: 'safety is primary',
      surveyAllowed: false, requiresSafetyCheck: true, reminderRequest: null,
      dialogueAct: 'emotional_disclosure', latestUserSubstance: question, topicAnchor: null,
    });
    m.aiProvider.detectRisk.mockResolvedValue({
      riskType: 'potential_self_harm', severity: 'critical', confidence: 0.95,
      evidence: ['direct statement'], immediateResponseRequired: true,
      escalationRecommended: true, surveyMustBeBlocked: true,
      proactiveMessagesMustBePaused: true, reasoningSummary: 'Immediate safety response required.',
    });
    m.aiProvider.generateResponse.mockResolvedValue({
      text: 'Please contact emergency support now.', confidence: 0.95, containsSurveyProbe: false,
    });
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    const result = await orch.orchestrate(INPUT);

    expect(result.classification.primaryIntent).toBe('potential_crisis');
    expect(result.responseText).toBe('Please contact emergency support now.');
    expect(m.surveyRepo.findPulseCaptureForConversation).not.toHaveBeenCalled();
    expect(m.surveyRepo.findAwaitingConfirmationGroups).not.toHaveBeenCalled();
    expect(m.aiProvider.interpretConfirmationResponse).not.toHaveBeenCalled();
    expect(m.outbox.enqueueSurveyEvidence).not.toHaveBeenCalled();
  });

  it('does not promote a direct CAP-8 request over a secondary safety intent', async () => {
    const m = baseMocks();
    const question = 'Help me understand what exact pulse information you captured from this conversation?';
    m.conversationRepo.findRecentMessages.mockResolvedValue([
      { id: 'm-1', ...OWNERSHIP, direction: 'inbound', text: question, occurredAt: INBOUND_OCCURRED_AT },
    ]);
    m.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent: 'clarification', secondaryIntents: ['potential_crisis'], urgency: 'critical',
      emotionalState: ['unsafe'], confidence: 0.95, reasoningSummary: 'secondary safety intent',
      surveyAllowed: false, requiresSafetyCheck: false, reminderRequest: null,
      dialogueAct: 'request', latestUserSubstance: question, topicAnchor: null,
    });
    m.aiProvider.detectRisk.mockResolvedValue({
      riskType: 'potential_self_harm', severity: 'critical', confidence: 0.95,
      evidence: ['safety classifier signal'], immediateResponseRequired: true,
      escalationRecommended: true, surveyMustBeBlocked: true,
      proactiveMessagesMustBePaused: true, reasoningSummary: 'Immediate safety response required.',
    });
    m.aiProvider.generateResponse.mockResolvedValue({
      text: 'Please contact emergency support now.', confidence: 0.95, containsSurveyProbe: false,
    });
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    const result = await orch.orchestrate(INPUT);

    expect(result.classification.primaryIntent).toBe('clarification');
    expect(result.responseText).toBe('Please contact emergency support now.');
    expect(m.aiProvider.detectRisk).toHaveBeenCalledOnce();
    expect(m.surveyRepo.findPulseCaptureForConversation).not.toHaveBeenCalled();
  });

  it.each([
    ['en-US', [
      'i am an ai assistant, not a human', 'respond in this conversation', 'private memory',
      'goals, tasks, or reminders', 'pulse measurement', 'confirmed, de-identified, and non-withdrawn',
      'safety checks', 'product retention rules', 'audited internal admin and debugging access',
    ], /only to reply|depending on (?:the )?setup|human review|model training/],
    ['ru-RU', [
      'i am an ai assistant, not a human', 'respond in this conversation', 'private memory',
      'goals, tasks, or reminders', 'pulse measurement', 'confirmed, de-identified, and non-withdrawn',
      'safety checks', 'product retention rules', 'audited internal admin and debugging access',
    ], /only to reply|depending on (?:the )?setup|human review|model training/],
    ['uk-UA', [
      'i am an ai assistant, not a human', 'respond in this conversation', 'private memory',
      'goals, tasks, or reminders', 'pulse measurement', 'confirmed, de-identified, and non-withdrawn',
      'safety checks', 'product retention rules', 'audited internal admin and debugging access',
    ], /only to reply|depending on (?:the )?setup|human review|model training/],
    ['fr-FR', [
      'i am an ai assistant, not a human', 'respond in this conversation', 'private memory',
      'goals, tasks, or reminders', 'pulse measurement', 'confirmed, de-identified, and non-withdrawn',
      'safety checks', 'product retention rules', 'audited internal admin and debugging access',
    ], /only to reply|depending on (?:the )?setup|human review|model training/],
  ] as const)('answers the complete CAP-5 policy in English for profile locale %s (product default)', async (locale, required, forbidden) => {
    const m = baseMocks();
    m.conversationRepo.findById.mockResolvedValue({
      id: 'c-1', tenantId: 't-1', userId: 'u-1', channelType: 'slack', externalConversationId: 'ec',
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

describe('ConversationOrchestrator V2 question confirmation', () => {
  it('asks one focused clarification after a partial reply and stages its prompt before delivery', async () => {
    const m = baseMocks();
    const clarificationText = 'What did I miss about your freedom to choose?';
    m.aiProvider.interpretQuestionBundleResponse = vi.fn().mockResolvedValue({
      kind: 'partial', acceptedQuestionIds: ['q-a'], disputedQuestionIds: ['q-b'], declinedQuestionIds: ['q-c'],
    });
    m.aiProvider.composeQuestionClarification = vi.fn().mockResolvedValue(clarificationText);
    const pending = {
      workingInsightId: 'working-b', tenantId: 't-1', userId: 'u-1',
      surveyWindowId: 'w-v2', surveyQuestionId: 'q-b', questionGroup: 'autonomy',
      workingSummary: 'Can choose tasks.', disputedStatement: 'You can choose tasks.',
      clarificationPromptMessageId: null, clarificationPromptSentAt: null,
    };
    const questionConfirmationRepo = {
      findAppliedQuestionVerdictForInbound: vi.fn().mockResolvedValue(null),
      findAwaitingQuestionBundle: vi.fn().mockResolvedValue({
        id: 'bundle-1', tenantId: 't-1', userId: 'u-1', surveyWindowId: 'w-v2',
        questionGroup: 'autonomy', displayedText: 'Is that fair?',
        components: ['q-a', 'q-b', 'q-c'].map((surveyQuestionId) => ({
          surveyQuestionId, questionVersion: 'v2', statement: surveyQuestionId,
        })),
      }),
      applyQuestionBundleVerdict: vi.fn().mockResolvedValue(true),
      findPendingQuestionClarification: vi.fn().mockResolvedValue(null),
      previewPendingQuestionClarificationAfterBundleVerdict: vi.fn().mockResolvedValue(pending),
      stageQuestionClarificationPrompt: vi.fn().mockResolvedValue(true),
      applyQuestionClarificationVerdict: vi.fn(),
      hasReadyQuestionBundle: vi.fn().mockResolvedValue(false),
      findReadyQuestionBundle: vi.fn(),
      stageQuestionConfirmationBundle: vi.fn(),
    };
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
      undefined, undefined, questionConfirmationRepo,
    );

    const result = await orch.orchestrate(INPUT);

    expect(result.responseText).toBe(clarificationText);
    expect(questionConfirmationRepo.previewPendingQuestionClarificationAfterBundleVerdict)
      .toHaveBeenCalledWith({
        tenantId: 't-1', userId: 'u-1', conversationId: 'c-1', inboundMessageId: 'm-1',
        bundleId: 'bundle-1', disputedQuestionIds: ['q-b'],
      });
    expect(questionConfirmationRepo.stageQuestionClarificationPrompt).toHaveBeenCalledWith({
      tenantId: 't-1', userId: 'u-1', conversationId: 'c-1',
      workingInsightId: 'working-b', promptMessageId: 'out-1', displayedText: clarificationText,
    });
    expect(questionConfirmationRepo.stageQuestionClarificationPrompt.mock.invocationCallOrder[0])
      .toBeLessThan(m.outbox.enqueueMessageSend.mock.invocationCallOrder[0]);
    expect(m.aiProvider.composeQuestionClarification.mock.invocationCallOrder[0])
      .toBeLessThan(questionConfirmationRepo.applyQuestionBundleVerdict.mock.invocationCallOrder[0]);
    expect(m.aiProvider.generateResponse).toHaveBeenCalledTimes(1);
    expect(result.bundleReply).toBe('bundle_without_reply');
  });

  it('shows a substantive clarification back for confirmation instead of confirming it silently', async () => {
    const m = baseMocks();
    const corrected = 'I can decide my work methods, but not my priorities.';
    m.aiProvider.interpretQuestionClarificationResponse = vi.fn().mockResolvedValue({
      kind: 'clarified', correctedSummary: corrected,
    });
    // GC round 3 CAP-3: the corrected meaning is composed as a one-statement bundle and shown.
    m.aiProvider.composeQuestionBundle = vi.fn().mockResolvedValue({
      text: `So: ${corrected} Is that right?`, statements: [{ surveyQuestionId: 'q-b', statement: corrected }],
    });
    m.aiProvider.generateResponse = vi.fn(async (_turns: unknown, _strategy: unknown, context: { trailingBundle?: { text: string } }) => ({
      text: `Got it.\n\n${context.trailingBundle?.text ?? ''}`, replyText: 'Got it.', bundleText: context.trailingBundle?.text,
      confidence: 0.9, containsSurveyProbe: false,
    }));
    const pending = {
      workingInsightId: 'working-b', tenantId: 't-1', userId: 'u-1',
      surveyWindowId: 'w-v2', surveyQuestionId: 'q-b', questionVersion: 'v2', questionGroup: 'autonomy',
      workingSummary: 'I choose all my work.', disputedStatement: 'You choose your work.',
      clarificationPromptMessageId: 'clarify-out',
      clarificationPromptSentAt: new Date('2026-09-03T09:59:00Z'),
    };
    const questionConfirmationRepo = {
      findAppliedQuestionVerdictForInbound: vi.fn().mockResolvedValue(null),
      findAwaitingQuestionBundle: vi.fn().mockResolvedValue(null),
      applyQuestionBundleVerdict: vi.fn(),
      findPendingQuestionClarification: vi.fn()
        .mockResolvedValueOnce(pending).mockResolvedValueOnce(null),
      stageQuestionClarificationPrompt: vi.fn(),
      applyQuestionClarificationVerdict: vi.fn().mockResolvedValue(true),
      hasReadyQuestionBundle: vi.fn().mockResolvedValue(false),
      findReadyQuestionBundle: vi.fn(),
      stageQuestionConfirmationBundle: vi.fn(),
      stageCorrectedStatementConfirmation: vi.fn().mockResolvedValue('bundle-3'),
    };
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
      undefined, undefined, questionConfirmationRepo,
    );

    await orch.orchestrate(INPUT);

    expect(questionConfirmationRepo.findPendingQuestionClarification).toHaveBeenCalledWith({
      tenantId: 't-1', userId: 'u-1', conversationId: 'c-1', inboundMessageId: 'm-1',
    });
    expect(questionConfirmationRepo.applyQuestionClarificationVerdict).toHaveBeenCalledWith({
      tenantId: 't-1', userId: 'u-1', conversationId: 'c-1',
      workingInsightId: 'working-b', inboundMessageId: 'm-1',
      verdict: { kind: 'clarified', correctedSummary: corrected },
    });
    expect(questionConfirmationRepo.stageQuestionConfirmationBundle).not.toHaveBeenCalled();
    expect(questionConfirmationRepo.stageCorrectedStatementConfirmation).toHaveBeenCalledWith(expect.objectContaining({
      workingInsightId: 'working-b', promptMessageId: 'out-1', statement: corrected, expectedWorkingSummary: corrected,
    }));
  });

  it('does not commit a clarification verdict when response generation fails', async () => {
    const m = baseMocks();
    m.aiProvider.interpretQuestionClarificationResponse = vi.fn().mockResolvedValue({ kind: 'declined' });
    m.aiProvider.generateResponse = vi.fn().mockRejectedValue(new Error('response_generation_failed'));
    const questionConfirmationRepo = {
      findAppliedQuestionVerdictForInbound: vi.fn().mockResolvedValue(null),
      findAwaitingQuestionBundle: vi.fn().mockResolvedValue(null),
      applyQuestionBundleVerdict: vi.fn(),
      findPendingQuestionClarification: vi.fn().mockResolvedValue({
        workingInsightId: 'working-b', tenantId: 't-1', userId: 'u-1',
        surveyWindowId: 'w-v2', surveyQuestionId: 'q-b', questionGroup: 'autonomy',
        workingSummary: 'I choose all my work.', disputedStatement: 'You choose your work.',
        clarificationPromptMessageId: 'clarify-out',
        clarificationPromptSentAt: new Date('2026-09-03T09:59:00Z'),
      }),
      previewPendingQuestionClarificationAfterVerdict: vi.fn().mockResolvedValue(null),
      stageQuestionClarificationPrompt: vi.fn(),
      applyQuestionClarificationVerdict: vi.fn().mockResolvedValue(true),
      hasReadyQuestionBundle: vi.fn().mockResolvedValue(false),
      findReadyQuestionBundle: vi.fn(),
      stageQuestionConfirmationBundle: vi.fn(),
    };
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
      undefined, undefined, questionConfirmationRepo,
    );

    await expect(orch.orchestrate(INPUT)).rejects.toThrow('response_generation_failed');
    expect(questionConfirmationRepo.applyQuestionClarificationVerdict).not.toHaveBeenCalled();
    expect(m.conversationRepo.saveMessage).not.toHaveBeenCalled();
  });

  it('keeps an unrelated reply after clarification pending without scoring or decline', async () => {
    const m = baseMocks();
    m.aiProvider.interpretQuestionClarificationResponse = vi.fn().mockResolvedValue({ kind: 'unrelated' });
    const questionConfirmationRepo = {
      findAppliedQuestionVerdictForInbound: vi.fn().mockResolvedValue(null),
      findAwaitingQuestionBundle: vi.fn().mockResolvedValue(null),
      applyQuestionBundleVerdict: vi.fn(),
      findPendingQuestionClarification: vi.fn().mockResolvedValue({
        workingInsightId: 'working-b', tenantId: 't-1', userId: 'u-1',
        surveyWindowId: 'w-v2', surveyQuestionId: 'q-b', questionGroup: 'autonomy',
        workingSummary: 'I choose all my work.', disputedStatement: 'You choose your work.',
        clarificationPromptMessageId: 'clarify-out',
        clarificationPromptSentAt: new Date('2026-09-03T09:59:00Z'),
      }),
      stageQuestionClarificationPrompt: vi.fn(),
      applyQuestionClarificationVerdict: vi.fn(),
      hasReadyQuestionBundle: vi.fn().mockResolvedValue(false),
      findReadyQuestionBundle: vi.fn(),
      stageQuestionConfirmationBundle: vi.fn(),
    };
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
      undefined, undefined, questionConfirmationRepo,
    );

    await orch.orchestrate(INPUT);

    expect(questionConfirmationRepo.applyQuestionClarificationVerdict).not.toHaveBeenCalled();
    expect(questionConfirmationRepo.stageQuestionClarificationPrompt).not.toHaveBeenCalled();
    expect(questionConfirmationRepo.findReadyQuestionBundle).not.toHaveBeenCalled();
  });

  it('applies an unqualified agreement to the exact delivered bundle', async () => {
    const m = baseMocks();
    const components = [
      { surveyQuestionId: 'q-a', questionVersion: 'v2', statement: 'You choose methods.' },
      { surveyQuestionId: 'q-b', questionVersion: 'v2', statement: 'You set priorities.' },
      { surveyQuestionId: 'q-c', questionVersion: 'v2', statement: 'You raise concerns.' },
    ];
    const awaiting = {
      id: 'bundle-1', tenantId: 't-1', userId: 'u-1', surveyWindowId: 'w-v2',
      questionGroup: 'autonomy', displayedText: 'Is that fair?', components,
    };
    m.aiProvider.interpretQuestionBundleResponse = vi.fn().mockResolvedValue({ kind: 'agree' });
    const questionConfirmationRepo = {
      findPendingQuestionClarification: vi.fn().mockResolvedValue(null),
      stageQuestionClarificationPrompt: vi.fn(),
      applyQuestionClarificationVerdict: vi.fn(),
      findAppliedQuestionVerdictForInbound: vi.fn().mockResolvedValue(null),
      findAwaitingQuestionBundle: vi.fn().mockResolvedValue(awaiting),
      applyQuestionBundleVerdict: vi.fn().mockResolvedValue(true),
      hasReadyQuestionBundle: vi.fn().mockResolvedValue(false),
      findReadyQuestionBundle: vi.fn(),
      stageQuestionConfirmationBundle: vi.fn(),
    };
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
      undefined, undefined, questionConfirmationRepo,
    );

    await orch.orchestrate(INPUT);

    expect(m.aiProvider.interpretQuestionBundleResponse).toHaveBeenCalledWith(
      expect.any(Array), awaiting,
    );
    expect(questionConfirmationRepo.applyQuestionBundleVerdict).toHaveBeenCalledWith({
      tenantId: 't-1', userId: 'u-1', conversationId: 'c-1',
      inboundMessageId: 'm-1', bundleId: 'bundle-1', verdict: { kind: 'agree' },
    });
    expect(questionConfirmationRepo.findReadyQuestionBundle).not.toHaveBeenCalled();
  });

  it('does not commit a prepared Bundle verdict when response generation fails', async () => {
    const m = baseMocks();
    m.aiProvider.interpretQuestionBundleResponse = vi.fn().mockResolvedValue({ kind: 'agree' });
    m.aiProvider.generateResponse = vi.fn().mockRejectedValue(new Error('response_generation_failed'));
    const questionConfirmationRepo = {
      findAppliedQuestionVerdictForInbound: vi.fn().mockResolvedValue(null),
      findAwaitingQuestionBundle: vi.fn().mockResolvedValue({
        id: 'bundle-1', tenantId: 't-1', userId: 'u-1', surveyWindowId: 'w-v2',
        questionGroup: 'autonomy', displayedText: 'Is that fair?',
        components: ['q-a', 'q-b', 'q-c'].map((surveyQuestionId) => ({
          surveyQuestionId, questionVersion: 'v2', statement: surveyQuestionId,
        })),
      }),
      applyQuestionBundleVerdict: vi.fn().mockResolvedValue(true),
      findPendingQuestionClarification: vi.fn().mockResolvedValue(null),
      stageQuestionClarificationPrompt: vi.fn(),
      applyQuestionClarificationVerdict: vi.fn(),
      hasReadyQuestionBundle: vi.fn().mockResolvedValue(false),
      findReadyQuestionBundle: vi.fn(),
      stageQuestionConfirmationBundle: vi.fn(),
    };
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
      undefined, undefined, questionConfirmationRepo,
    );

    await expect(orch.orchestrate(INPUT)).rejects.toThrow('response_generation_failed');
    expect(questionConfirmationRepo.applyQuestionBundleVerdict).not.toHaveBeenCalled();
    expect(m.conversationRepo.saveMessage).not.toHaveBeenCalled();
    expect(m.outbox.enqueueMessageSend).not.toHaveBeenCalled();
  });

  it('keeps an unrelated reply from changing question state', async () => {
    const m = baseMocks();
    m.aiProvider.interpretQuestionBundleResponse = vi.fn().mockResolvedValue({ kind: 'unrelated' });
    const questionConfirmationRepo = {
      findPendingQuestionClarification: vi.fn().mockResolvedValue(null),
      stageQuestionClarificationPrompt: vi.fn(),
      applyQuestionClarificationVerdict: vi.fn(),
      findAppliedQuestionVerdictForInbound: vi.fn().mockResolvedValue(null),
      findAwaitingQuestionBundle: vi.fn().mockResolvedValue({
        id: 'bundle-1', tenantId: 't-1', userId: 'u-1', surveyWindowId: 'w-v2',
        questionGroup: 'autonomy', displayedText: 'Is that fair?',
        components: ['q-a', 'q-b', 'q-c'].map((surveyQuestionId) => ({
          surveyQuestionId, questionVersion: 'v2', statement: surveyQuestionId,
        })),
      }),
      applyQuestionBundleVerdict: vi.fn(),
      hasReadyQuestionBundle: vi.fn().mockResolvedValue(false),
      findReadyQuestionBundle: vi.fn(),
      stageQuestionConfirmationBundle: vi.fn(),
    };
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
      undefined, undefined, questionConfirmationRepo,
    );

    await orch.orchestrate(INPUT);

    expect(questionConfirmationRepo.applyQuestionBundleVerdict).not.toHaveBeenCalled();
  });

  it('stages one natural three-question bundle before queueing its delivery', async () => {
    const m = baseMocks();
    const statements = [
      { surveyQuestionId: 'q-a', statement: 'You can choose your methods.' },
      { surveyQuestionId: 'q-b', statement: 'You can set priorities.' },
      { surveyQuestionId: 'q-c', statement: 'You can challenge decisions.' },
    ];
    const text = `I hear that ${statements.map((item) => item.statement).join(' ')} Is that fair?`;
    m.aiProvider.composeQuestionBundle = vi.fn().mockResolvedValue({ text, statements });
    const questionConfirmationRepo = {
      findPendingQuestionClarification: vi.fn().mockResolvedValue(null),
      stageQuestionClarificationPrompt: vi.fn(),
      applyQuestionClarificationVerdict: vi.fn(),
      findAppliedQuestionVerdictForInbound: vi.fn().mockResolvedValue(null),
      findAwaitingQuestionBundle: vi.fn().mockResolvedValue(null),
      applyQuestionBundleVerdict: vi.fn(),
      hasReadyQuestionBundle: vi.fn().mockResolvedValue(false),
      findReadyQuestionBundle: vi.fn().mockResolvedValue({
        tenantId: 't-1', userId: 'u-1', surveyWindowId: 'w-v2', questionGroup: 'autonomy',
        questions: statements.map((statement) => ({
          surveyQuestionId: statement.surveyQuestionId,
          questionVersion: 'v2',
          workingSummary: statement.statement,
        })),
      }),
      stageQuestionConfirmationBundle: vi.fn().mockResolvedValue('bundle-1'),
    };
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
      undefined, undefined, questionConfirmationRepo,
    );

    const result = await orch.orchestrate(INPUT);

    expect(result.responseText).toBe(text);
    expect(result.bundleReply).toBe('bundle_without_reply');
    expect(result.bundleReplyFallbackReason).toBe('reply_missing');
    expect(m.aiProvider.generateResponse).toHaveBeenCalledTimes(1);
    expect(questionConfirmationRepo.stageQuestionConfirmationBundle).toHaveBeenCalledWith({
      tenantId: 't-1', userId: 'u-1', conversationId: 'c-1', surveyWindowId: 'w-v2',
      questionGroup: 'autonomy', promptMessageId: 'out-1', displayedText: text,
      components: statements.map((statement) => ({
        ...statement, questionVersion: 'v2', expectedWorkingSummary: statement.statement,
      })),
    });
    expect(questionConfirmationRepo.stageQuestionConfirmationBundle.mock.invocationCallOrder[0])
      .toBeLessThan(m.outbox.enqueueMessageSend.mock.invocationCallOrder[0]);
  });

  it('offers disclosure in the ordinary reply before surfacing a ready V2 bundle', async () => {
    const m = baseMocks();
    m.conversationRepo.findLatestDeliveredReportingDisclosure.mockResolvedValue(null);
    const questionConfirmationRepo = {
      findPendingQuestionClarification: vi.fn().mockResolvedValue(null),
      stageQuestionClarificationPrompt: vi.fn(),
      applyQuestionClarificationVerdict: vi.fn(),
      findAppliedQuestionVerdictForInbound: vi.fn().mockResolvedValue(null),
      findAwaitingQuestionBundle: vi.fn().mockResolvedValue(null),
      applyQuestionBundleVerdict: vi.fn(),
      hasReadyQuestionBundle: vi.fn().mockResolvedValue(true),
      findReadyQuestionBundle: vi.fn(),
      stageQuestionConfirmationBundle: vi.fn(),
    };
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
      undefined, undefined, questionConfirmationRepo,
    );

    const result = await orch.orchestrate(INPUT);

    expect(questionConfirmationRepo.hasReadyQuestionBundle).toHaveBeenCalledWith({ tenantId: 't-1', userId: 'u-1' });
    expect(questionConfirmationRepo.findReadyQuestionBundle).not.toHaveBeenCalled();
    expect(questionConfirmationRepo.stageQuestionConfirmationBundle).not.toHaveBeenCalled();
    expect(result.responseText).toContain(getReportingDisclosureText('en'));
    expect(m.conversationRepo.saveMessage.mock.calls[0][0].metadata)
      .toHaveProperty('reportingDisclosureVersion', REPORTING_DISCLOSURE_VERSION);
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
    expect(m.conversationRepo.saveMessage.mock.calls[0][0].metadata.confirmationSourceMessageIds)
      .toEqual(['m-1']);
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

  it('checks current hierarchy identifiers even when no legacy reporting Team exists', async () => {
    const m = baseMocks();
    m.surveyRepo.findPendingConfirmationGroups.mockResolvedValue([{
      surveyWindowId: 'w-1', userId: 'u-1', tenantId: 't-1', questionGroup: 'autonomy',
      updatedAt: new Date('2026-09-03T09:59:00.000Z'),
    }]);
    m.surveyRepo.findCurrentHierarchyIdentifiers.mockResolvedValue(['Engineering Unit']);
    m.aiProvider.generateResponse
      .mockResolvedValueOnce({
        text: 'Engineering Unit feels blocked. Did I get that right?',
        confirmationSummary: 'Engineering Unit feels blocked.',
        confidence: 0.9, containsSurveyProbe: false,
      })
      .mockResolvedValueOnce({
        text: 'I hear you. We can keep working through this.',
        confidence: 0.9, containsSurveyProbe: false,
      });
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    await orch.orchestrate(INPUT);

    expect(m.surveyRepo.findTeamByMemberId).toHaveBeenCalledWith('u-1', 't-1');
    expect(m.surveyRepo.findCurrentHierarchyIdentifiers).toHaveBeenCalledWith('u-1', 't-1');
    expect(m.surveyRepo.recordGroupDeidentificationDecision).toHaveBeenCalledWith(
      expect.objectContaining({ deidentificationDecision: {
        status: 'rejected', policyVersion: 'deidentification-v1', reasons: ['known_identifier'],
      } }),
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

  it('assesses risk on a benign turn without marking it as a safety turn (ADR-013 G1)', async () => {
    const m = baseMocks(); // default classification: casual_conversation, requiresSafetyCheck false
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    const result = await orch.orchestrate(INPUT);

    expect(m.aiProvider.detectRisk).toHaveBeenCalledOnce();
    expect(result.classification.requiresSafetyCheck).toBe(false);
    expect(result.risk).toMatchObject({ assessed: true, severity: 'none', tripwireRaised: false });
  });

  it('starts risk detection before classification resolves, so safety runs in parallel', async () => {
    const m = baseMocks();
    let releaseClassification!: () => void;
    const defaultClassification = await m.aiProvider.classifySituation();
    m.aiProvider.classifySituation.mockClear();
    m.aiProvider.classifySituation.mockReturnValue(new Promise((resolve) => {
      releaseClassification = () => resolve(defaultClassification);
    }));
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    const pending = orch.orchestrate(INPUT);
    await vi.waitFor(() => expect(m.aiProvider.classifySituation).toHaveBeenCalled());
    expect(m.aiProvider.detectRisk).toHaveBeenCalledOnce();
    releaseClassification();
    await pending;
  });

  it('treats a failed risk assessment as unknown, never as safe (ADR-013 G2)', async () => {
    const m = baseMocks();
    m.aiProvider.detectRisk.mockRejectedValue(new Error('provider timeout'));
    const riskSignalRepo = { saveOnceForSource: vi.fn() };
    const escalation = { raise: vi.fn() };
    const orch = new ConversationOrchestrator(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo, riskSignalRepo as any,
      escalation, m.featureFlags, undefined, undefined,
    );

    const result = await orch.orchestrate(INPUT);

    expect(result.risk).toEqual({
      assessed: false, reason: 'assessment_failed', riskType: null, severity: 'unknown',
      immediateResponseRequired: false, tripwireRaised: false,
    });
    expect(result.risk).not.toHaveProperty('confidence');
    expect(result.mode).toBe('sensitive');
    expect(riskSignalRepo.saveOnceForSource).not.toHaveBeenCalled();
    expect(escalation.raise).not.toHaveBeenCalled();
    const [, strategy] = m.aiProvider.generateResponse.mock.calls[0]!;
    expect(strategy).toMatchObject({ includeFollowUpQuestion: false, forbiddenPatterns: ['survey'] });
  });

  it('escalates when the provider moderation refuses a self-harm turn (R1 tripwire)', async () => {
    const m = baseMocks();
    m.aiProvider.detectRisk.mockRejectedValue(new ModerationSignalError({
      source: 'azure_content_filter', blocked: true,
      categories: [{ category: 'self_harm', level: 'medium' }],
    }));
    const escalation = { raise: vi.fn() };
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo, undefined,
      escalation, m.featureFlags, undefined, undefined,
    );

    const result = await orch.orchestrate(INPUT);

    expect(result.risk).toMatchObject({
      assessed: false, reason: 'moderation_blocked', severity: 'critical',
      riskType: 'potential_self_harm', immediateResponseRequired: true, tripwireRaised: true,
    });
    expect(result.mode).toBe('crisis');
    expect(escalation.raise).toHaveBeenCalledOnce();
    expect(escalation.raise.mock.calls[0]?.[0]).toMatchObject({
      severity: 'critical', riskType: 'potential_self_harm', messageIds: [INPUT.messageId],
      details: { assessed: false, tripwireRaised: true, unassessedReason: 'moderation_blocked' },
    });
  });

  it('still escalates when classification fails on a turn the provider moderation refused', async () => {
    const m = baseMocks();
    const blocked = { source: 'azure_content_filter' as const, blocked: true,
      categories: [{ category: 'self_harm' as const, level: 'high' as const }] };
    m.aiProvider.classifySituation.mockRejectedValue(Object.assign(new Error('content_filter'), { status: 400 }));
    m.aiProvider.detectRisk.mockRejectedValue(new ModerationSignalError(blocked));
    const escalation = { raise: vi.fn() };
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo, undefined,
      escalation, m.featureFlags, undefined, undefined,
    );

    await expect(orch.orchestrate(INPUT)).rejects.toThrow('content_filter');
    expect(escalation.raise).toHaveBeenCalledOnce();
    expect(escalation.raise.mock.calls[0]?.[0]).toMatchObject({ severity: 'critical' });
  });

  it('escalates a critical risk before reply generation, even when generation fails', async () => {
    const m = baseMocks();
    m.aiProvider.detectRisk.mockResolvedValue({
      ...NO_RISK, riskType: 'potential_self_harm', severity: 'critical', immediateResponseRequired: true,
    });
    m.aiProvider.generateResponse.mockRejectedValue(new Error('generation failed'));
    const escalation = { raise: vi.fn() };
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo, undefined,
      escalation, m.featureFlags, undefined, undefined,
    );

    await expect(orch.orchestrate(INPUT)).rejects.toThrow();
    expect(escalation.raise).toHaveBeenCalledOnce();
    expect(escalation.raise.mock.calls[0]?.[0]).toMatchObject({
      severity: 'critical', details: { assessed: true, tripwireRaised: false },
    });
  });

  it('never lowers model severity from a weaker moderation signal', async () => {
    const m = baseMocks();
    m.aiProvider.detectRisk.mockResolvedValue({
      ...NO_RISK, riskType: 'potential_self_harm', severity: 'critical', immediateResponseRequired: true,
      escalationRecommended: true, surveyMustBeBlocked: true, proactiveMessagesMustBePaused: true,
      moderation: { source: 'openai_moderation', blocked: false, categories: [{ category: 'violence', level: null }] },
    });
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    const result = await orch.orchestrate(INPUT);

    expect(result.risk).toMatchObject({
      assessed: true, severity: 'critical', riskType: 'potential_self_harm', tripwireRaised: false,
    });
    expect(result.mode).toBe('crisis');
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
      id: 'c-1', tenantId: 't-1', userId: 'u-other', channelType: 'slack', externalConversationId: 'ec',
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
      channelType: 'slack', externalConversationId: 'ec',
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
      id: 'c-1', tenantId: 't-1', userId: 'u-1', channelType: 'slack', externalConversationId: 'ec',
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
      id: 'c-1', tenantId: 't-1', userId: 'u-1', channelType: 'slack', externalConversationId: 'ec',
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
      id: 'c-1', tenantId: 't-1', userId: 'u-1', channelType: 'slack', externalConversationId: 'ec',
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
      id: 'c-1', tenantId: 't-1', userId: 'u-1', channelType: 'slack', externalConversationId: 'ec',
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
      id: 'c-1', tenantId: 't-1', userId: 'u-1', channelType: 'slack', externalConversationId: 'ec',
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

describe('ConversationOrchestrator language policy (English product default)', () => {
  it.each([
    ['a Ukrainian conversation with a Ukrainian profile', 'uk', 'Мені сьогодні важко зосередитися'],
    ['a Russian conversation with a Russian profile', 'ru', 'Мне сегодня сложно сосредоточиться'],
    ['an English conversation with a Portuguese profile', 'pt-BR', 'I am struggling to focus today'],
  ])('replies in English for %s', async (_case, userLocale, text) => {
    const m = baseMocks();
    m.conversationRepo.findById.mockResolvedValue({
      id: 'c-1', tenantId: 't-1', userId: 'u-1', channelType: 'slack', externalConversationId: 'ec',
      userDisplayName: 'Sam', userLocale, userTimezone: 'UTC',
    });
    m.conversationRepo.findRecentMessages.mockResolvedValue([
      { id: 'm-1', ...OWNERSHIP, direction: 'inbound', text, occurredAt: new Date(), metadata: undefined },
    ]);
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    await orch.orchestrate(INPUT);

    expect(m.aiProvider.generateResponse.mock.calls[0][2].languagePolicy).toEqual({
      responseLanguage: 'en', source: 'product_default',
    });
  });
});

describe('ConversationOrchestrator group confirmation — interpret (Phase B)', () => {
  it('does not confirm or queue a V1 group report when response preparation fails', async () => {
    const m = baseMocks();
    m.surveyRepo.findAwaitingConfirmationGroups.mockResolvedValue([{
      id: 'group-state-1', surveyWindowId: 'w-1', userId: 'u-1', tenantId: 't-1',
      questionGroup: 'growth', confirmationSummary: 'The exact shown summary.',
      confirmationPromptMessageId: 'out-confirmation-1',
      deidentificationDecision: ACCEPTED_DEIDENTIFICATION,
    }]);
    m.surveyRepo.findTeamByMemberId.mockResolvedValue({
      teamId: 'team-1', reportingCohortId: 'cohort-1',
    });
    m.aiProvider.interpretConfirmationResponse.mockResolvedValue({ verdict: 'agree' });
    m.aiProvider.generateResponse.mockRejectedValue(new Error('synthetic_model_failure'));

    await expect(makeOrchestrator(m).orchestrate(INPUT)).rejects.toThrow('synthetic_model_failure');

    expect(m.surveyRepo.confirmGroupState).not.toHaveBeenCalled();
    expect(m.outbox.enqueueGroupReport).not.toHaveBeenCalled();
  });

  it.each(['correct', 'exclude'] as const)(
    'does not apply a V1 %s verdict when response preparation fails', async (verdict) => {
      const m = baseMocks();
      m.surveyRepo.findAwaitingConfirmationGroups.mockResolvedValue([{
        id: 'group-state-1', surveyWindowId: 'w-1', userId: 'u-1', tenantId: 't-1',
        questionGroup: 'growth', confirmationSummary: 'The exact shown summary.',
        confirmationPromptMessageId: 'out-confirmation-1',
        deidentificationDecision: ACCEPTED_DEIDENTIFICATION,
      }]);
      m.aiProvider.interpretConfirmationResponse.mockResolvedValue({ verdict });
      m.aiProvider.generateResponse.mockRejectedValue(new Error('synthetic_model_failure'));

      await expect(makeOrchestrator(m).orchestrate(INPUT)).rejects.toThrow('synthetic_model_failure');

      expect(m.surveyRepo.transitionAwaitingGroupState).not.toHaveBeenCalled();
      expect(m.surveyRepo.withdrawGroupState).not.toHaveBeenCalled();
    },
  );

  it('does not reset a V1 awaiting group before a failed response', async () => {
    const m = baseMocks();
    m.conversationRepo.findLatestDeliveredReportingDisclosure.mockResolvedValue(null);
    m.surveyRepo.findAwaitingConfirmationGroups.mockResolvedValue([{
      id: 'group-state-1', surveyWindowId: 'w-1', userId: 'u-1', tenantId: 't-1',
      questionGroup: 'growth', confirmationSummary: 'The exact shown summary.',
      confirmationPromptMessageId: 'out-confirmation-1',
      deidentificationDecision: ACCEPTED_DEIDENTIFICATION,
    }]);
    m.aiProvider.generateResponse.mockRejectedValue(new Error('synthetic_model_failure'));

    await expect(makeOrchestrator(m).orchestrate(INPUT)).rejects.toThrow('synthetic_model_failure');

    expect(m.surveyRepo.transitionAwaitingGroupState).not.toHaveBeenCalled();
  });

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

    await expect(orch.orchestrate(INPUT)).rejects.toThrow('v1_group_state_stale');

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

    await expect(orch.orchestrate(INPUT)).rejects.toThrow('v1_group_state_stale');

    expect(m.surveyRepo.confirmGroupState).toHaveBeenCalled();
    expect(m.outbox.enqueueGroupReport).not.toHaveBeenCalled();
    expect(m.conversationRepo.saveMessage).not.toHaveBeenCalled();
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

describe('ConversationOrchestrator safety source identity', () => {
  it('persists a risk signal against the exact inbound even when response generation fails', async () => {
    const m = baseMocks();
    m.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent: 'potential_crisis', secondaryIntents: [], emotionalState: ['unsafe'],
      urgency: 'critical', confidence: 0.95, surveyAllowed: false,
      requiresSafetyCheck: true, reasoningSummary: 'synthetic', reminderRequest: null,
      dialogueAct: 'emotional_disclosure', latestUserSubstance: 'unsafe', topicAnchor: null,
    });
    m.aiProvider.detectRisk.mockResolvedValue({
      riskType: 'potential_self_harm', severity: 'critical', confidence: 0.95,
      immediateResponseRequired: true, surveyMustBeBlocked: true,
      proactiveMessagesMustBePaused: true, escalationRecommended: true,
      reasoningSummary: 'synthetic',
    });
    m.aiProvider.generateResponse.mockRejectedValue(new Error('synthetic_model_failure'));
    const riskRepo = {
      save: vi.fn(), saveOnceForSource: vi.fn().mockResolvedValue({ id: 'signal-1' }),
    };
    const orchestrator = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, undefined,
      riskRepo as never, undefined, m.featureFlags,
    );

    await expect(orchestrator.orchestrate(INPUT)).rejects.toThrow('synthetic_model_failure');

    expect(riskRepo.saveOnceForSource).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 't-1', userId: 'u-1', sourceMessageId: 'm-1',
      evidenceMessageIds: ['m-1'], type: 'potential_self_harm',
    }));
    expect(riskRepo.save).not.toHaveBeenCalled();
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
        sourceInboundMessageId: INPUT.messageId,
        measurementVersion: 'ts-conversation-decision-v1',
        dialogueAct: 'new_substance',
        responseMove: 'address_new_substance',
        replyShape: {
          askedQuestion: false,
          maxQuestions: 1,
          questionPolicyReason: 'new_substance_allows_question',
          conciseSession: false,
        },
        languagePolicy: {
          responseLanguage: 'en',
          source: 'product_default',
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
      topicAnchor: null,
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
      'sourceInboundMessageId',
    ]);
    expect(JSON.stringify(metadata)).not.toContain('Private Project Atlas concern');
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

describe('ConversationOrchestrator session concise mode', () => {
  const directRequests = [
    'Hey, busy day. Keep it short today.',
    'Reply briefly.',
    'Respond concisely.',
    'Write briefly.',
    'Busy day\nKeep it short.',
    'Тяжёлый день. Отвечай коротко.',
    'Важкий день. Відповідай стисло.\n*Sent using* <@U0BPHHA21GC>',
    'Keep it short\n*Sent using* <@U0BPHHA21GC|ChatGPT>',
  ];

  it.each(directRequests)('shortens direct concise request without changing question pacing: %s', async (text) => {
    const m = baseMocks();
    const styleProfileRepo: StyleProfileRepositoryPort = {
      findByUser: vi.fn().mockResolvedValue(null),
      upsert: vi.fn(),
    };
    m.conversationRepo.findRecentMessages.mockResolvedValue([
      { id: 'm-1', ...OWNERSHIP, direction: 'inbound', text, occurredAt: new Date(), metadata: undefined },
    ]);
    m.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent: 'casual_conversation', secondaryIntents: [], emotionalState: [], urgency: 'low',
      confidence: 0.9, surveyAllowed: true, requiresSafetyCheck: false, reasoningSummary: 'mixed request',
      reminderRequest: null, dialogueAct: 'new_substance',
      latestUserSubstance: 'Help me prioritize the release work.', topicAnchor: 'release priorities',
    });
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined, styleProfileRepo,
    );

    const result = await orch.orchestrate(INPUT);

    expect(m.aiProvider.generateResponse.mock.calls[0][1]).toMatchObject({
      maxResponseLength: 'short',
      includeFollowUpQuestion: true,
    });
    expect(result.classification.latestUserSubstance).toBe('Help me prioritize the release work.');
    expect(m.conversationRepo.saveMessage.mock.calls[0][0].metadata.replyShape)
      .toMatchObject({ conciseSession: true, maxQuestions: 1 });
    expect(styleProfileRepo.upsert).not.toHaveBeenCalled();
  });

  it.each([
    'Translate "keep it short" into Russian.',
    'She said, "Keep it short."',
    'Does keep it short sound too abrupt?',
    'I like it when replies are short.',
    "Don't keep it short today.",
    "Don't reply briefly.",
    'Write shortly.',
    'Translate this:\nKeep it short.',
    'Quote this:\nReply briefly.',
    'Evaluate this:\nRespond concisely.',
    'Could you translate this:\nRespond concisely.',
    'She wrote:\nKeep it short.',
    'Она написала:\nОтвечай коротко.',
    'Чи можеш перекласти це:\nВідповідай стисло.',
    'Переведи это:\nОтвечай коротко.',
    'Процитируй это:\nПиши кратко.',
    'Оцени это:\nОтветь лаконично.',
    'Переклади це:\nВідповідай стисло.',
    'Процитуй це:\nПиши коротко.',
    'Оціни це:\nВідповідай лаконічно.',
  ])('does not activate concise mode for control text: %s', async (text) => {
    const m = baseMocks();
    m.conversationRepo.findRecentMessages.mockResolvedValue([
      { id: 'm-1', ...OWNERSHIP, direction: 'inbound', text, occurredAt: new Date(), metadata: undefined },
    ]);
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    await orch.orchestrate(INPUT);

    expect(m.aiProvider.generateResponse.mock.calls[0][1].maxResponseLength).toBe('medium');
    expect(m.conversationRepo.saveMessage.mock.calls[0][0].metadata.replyShape.conciseSession).toBe(false);
  });

  it('carries concise mode from the latest outbound receipt after the original directive leaves the window', async () => {
    const m = baseMocks();
    const now = Date.now();
    const history = Array.from({ length: 18 }, (_, index) => ({
      id: `m-prior-${index}`, ...OWNERSHIP,
      direction: index % 2 === 0 ? 'inbound' : 'outbound',
      text: 'ordinary turn', occurredAt: new Date(now - (20 - index) * 1_000), metadata: undefined,
    }));
    m.conversationRepo.findRecentMessages.mockResolvedValue([
      ...history,
      {
        id: 'o-latest', ...OWNERSHIP, direction: 'outbound', text: 'brief reply',
        occurredAt: new Date(now - 1_000),
        metadata: { replyShape: { askedQuestion: false, conciseSession: true } },
      },
      { id: 'm-1', ...OWNERSHIP, direction: 'inbound', text: 'What should I do next?', occurredAt: new Date(now), metadata: undefined },
    ]);
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    await orch.orchestrate(INPUT);

    expect(m.aiProvider.generateResponse.mock.calls[0][1].maxResponseLength).toBe('short');
    expect(m.conversationRepo.saveMessage.mock.calls[0][0].metadata.replyShape.conciseSession).toBe(true);
  });

  it('uses the inbound timestamp for session carryover when queue processing is delayed', async () => {
    const m = baseMocks();
    m.conversationRepo.findRecentMessages.mockResolvedValue([
      {
        id: 'o-latest', ...OWNERSHIP, direction: 'outbound', text: 'brief reply',
        occurredAt: new Date('2026-09-03T09:59:00.000Z'),
        metadata: { replyShape: { askedQuestion: false, conciseSession: true } },
      },
      { id: 'm-1', ...OWNERSHIP, direction: 'inbound', text: 'What should I do next?', occurredAt: INBOUND_OCCURRED_AT, metadata: undefined },
    ]);
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    await orch.orchestrate(INPUT);

    expect(m.aiProvider.generateResponse.mock.calls[0][1].maxResponseLength).toBe('short');
    expect(m.conversationRepo.saveMessage.mock.calls[0][0].metadata.replyShape.conciseSession).toBe(true);
  });

  it('keeps concise carryover across a later outbound without session metadata', async () => {
    const m = baseMocks();
    m.conversationRepo.findRecentMessages.mockResolvedValue([
      {
        id: 'o-receipt', ...OWNERSHIP, direction: 'outbound', text: 'brief reply',
        occurredAt: new Date('2026-09-03T09:57:00.000Z'),
        metadata: { replyShape: { askedQuestion: false, conciseSession: true } },
      },
      {
        id: 'o-proactive', ...OWNERSHIP, direction: 'outbound', text: 'scheduled follow-up',
        occurredAt: new Date('2026-09-03T09:59:00.000Z'), metadata: {},
      },
      { id: 'm-1', ...OWNERSHIP, direction: 'inbound', text: 'What should I do next?', occurredAt: INBOUND_OCCURRED_AT, metadata: undefined },
    ]);
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    await orch.orchestrate(INPUT);

    expect(m.aiProvider.generateResponse.mock.calls[0][1].maxResponseLength).toBe('short');
  });

  it('does not revive an expired concise receipt through newer fieldless activity', async () => {
    const m = baseMocks();
    m.conversationRepo.findRecentMessages.mockResolvedValue([
      {
        id: 'o-receipt', ...OWNERSHIP, direction: 'outbound', text: 'brief reply',
        occurredAt: new Date('2026-09-03T03:59:00.000Z'),
        metadata: { replyShape: { askedQuestion: false, conciseSession: true } },
      },
      {
        id: 'm-later', ...OWNERSHIP, direction: 'inbound', text: 'Later session',
        occurredAt: new Date('2026-09-03T09:58:00.000Z'), metadata: undefined,
      },
      {
        id: 'o-proactive', ...OWNERSHIP, direction: 'outbound', text: 'scheduled follow-up',
        occurredAt: new Date('2026-09-03T09:59:00.000Z'), metadata: {},
      },
      { id: 'm-1', ...OWNERSHIP, direction: 'inbound', text: 'What should I do next?', occurredAt: INBOUND_OCCURRED_AT, metadata: undefined },
    ]);
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    await orch.orchestrate(INPUT);

    expect(m.aiProvider.generateResponse.mock.calls[0][1].maxResponseLength).toBe('medium');
    expect(m.conversationRepo.saveMessage.mock.calls[0][0].metadata.replyShape.conciseSession).toBe(false);
  });

  it('clears concise carryover after the five-hour session gap', async () => {
    const m = baseMocks();
    const now = Date.now();
    m.conversationRepo.findRecentMessages.mockResolvedValue([
      {
        id: 'o-latest', ...OWNERSHIP, direction: 'outbound', text: 'brief reply',
        occurredAt: new Date(now - 5 * 3_600_000 - 1),
        metadata: { replyShape: { askedQuestion: false, conciseSession: true } },
      },
      { id: 'm-1', ...OWNERSHIP, direction: 'inbound', text: 'What should I do next?', occurredAt: new Date(now), metadata: undefined },
    ]);
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    await orch.orchestrate(INPUT);

    expect(m.aiProvider.generateResponse.mock.calls[0][1].maxResponseLength).toBe('medium');
    expect(m.conversationRepo.saveMessage.mock.calls[0][0].metadata.replyShape.conciseSession).toBe(false);
  });

  it('keeps sensitive strategy authoritative while carrying the concise decision', async () => {
    const m = baseMocks();
    m.conversationRepo.findRecentMessages.mockResolvedValue([
      { id: 'm-1', ...OWNERSHIP, direction: 'inbound', text: 'I am burned out. Keep it short.', occurredAt: new Date(), metadata: undefined },
    ]);
    m.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent: 'burnout_signal', secondaryIntents: [], emotionalState: ['overwhelmed'], urgency: 'high',
      confidence: 0.95, surveyAllowed: false, requiresSafetyCheck: true, reasoningSummary: 'burnout',
      reminderRequest: null, dialogueAct: 'emotional_disclosure', latestUserSubstance: 'I am burned out.', topicAnchor: 'burnout',
    });
    m.aiProvider.detectRisk.mockResolvedValue({
      riskType: 'burnout', severity: 'high', confidence: 0.9, evidence: ['burned out'],
      immediateResponseRequired: false, escalationRecommended: false,
      surveyMustBeBlocked: true, proactiveMessagesMustBePaused: true, reasoningSummary: 'high burnout risk',
    });
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    await orch.orchestrate(INPUT);

    expect(m.aiProvider.generateResponse.mock.calls[0][1]).toMatchObject({ mode: 'sensitive', maxResponseLength: 'medium' });
    expect(m.conversationRepo.saveMessage.mock.calls[0][0].metadata.replyShape.conciseSession).toBe(true);
  });

  it('keeps confirmation strategy authoritative while carrying the concise decision', async () => {
    const m = baseMocks();
    m.conversationRepo.findRecentMessages.mockResolvedValue([
      { id: 'm-1', ...OWNERSHIP, direction: 'inbound', text: 'Keep it short.', occurredAt: new Date(), metadata: undefined },
    ]);
    m.surveyRepo.findPendingConfirmationGroups.mockResolvedValue([{
      surveyWindowId: 'w-1', userId: 'u-1', tenantId: 't-1', questionGroup: 'autonomy', updatedAt: new Date(),
    }]);
    m.aiProvider.generateResponse.mockResolvedValue({
      text: 'You value ownership. Did I get that right?', confirmationSummary: 'You value ownership.',
      confidence: 0.9, containsSurveyProbe: false,
    });
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    await orch.orchestrate(INPUT);

    expect(m.aiProvider.generateResponse.mock.calls[0][1]).toMatchObject({ mode: 'confirmation', maxResponseLength: 'medium' });
    expect(m.conversationRepo.saveMessage.mock.calls[0][0].metadata.replyShape.conciseSession).toBe(true);
  });

  it.each([
    {
      intent: 'reporting_explanation',
      text: 'Can HR read my answers after confirmation? Keep it short.',
      concise: () => getReportingExplanationText('en', true),
      full: () => getReportingExplanationText('en'),
    },
    {
      intent: 'data_use_explanation',
      text: 'How do you use my data? Keep it short.',
      concise: () => getDataUseExplanationText('en', true),
      full: () => getDataUseExplanationText('en'),
    },
  ])('uses deterministic concise $intent copy without model generation', async ({ intent, text, concise, full }) => {
    const m = baseMocks();
    m.conversationRepo.findRecentMessages.mockResolvedValue([
      { id: 'm-1', ...OWNERSHIP, direction: 'inbound', text, occurredAt: INBOUND_OCCURRED_AT, metadata: undefined },
    ]);
    m.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent: intent, secondaryIntents: [], emotionalState: [], urgency: 'low', confidence: 0.95,
      surveyAllowed: false, requiresSafetyCheck: false, reasoningSummary: 'explicit trust question',
      reminderRequest: null, dialogueAct: 'request', latestUserSubstance: text, topicAnchor: null,
    });
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    const result = await orch.orchestrate(INPUT);

    expect(concise().length).toBeLessThan(full().length);
    expect(result.responseText).toBe(concise());
    expect(m.aiProvider.generateResponse).not.toHaveBeenCalled();
  });
});

describe('concise deterministic trust copy', () => {
  it.each([
    {
      locale: 'en-US',
      reporting: [/shown de-identified summary/i, /grants no access/i, /managers\/hr/i, /messages\/answers\/summary\/tasks\/goals\/identity/i, /audited internal access/i, /conversation\/temp.*(?:isn’t|not) reportable/i, /unconfirmed pulse data.*scores\/aggregation\/themes\/recommendations\/reports/i, /confirmed, non-withdrawn summary.*team report/i],
      dataUse: [/ai, not human/i, /replies, private memory, goals\/tasks\/reminders, pulse measurement, and safety checks/i, /private memory\/unconfirmed data.*not reportable/i, /confirmed, de-identified, non-withdrawn summary.*team reports/i, /retention rules/i, /audited admin\/debug access.*authorized staff/i],
    },
    {
      locale: 'ru-RU',
      reporting: [/показанн.*обезличенн/i, /доступа не даёт/i, /менеджер.*hr/i, /сообщени.*ответ.*резюме.*задач.*цел.*личност/i, /аудируем.*внутренн.*доступ/i, /разговор\/временные данные не отчётны/i, /неподтверждённ.*оцен.*агрегац.*тем.*рекомендац.*отчёт/i, /подтверждённ.*неотозванн.*командн/i],
      dataUse: [/ии, не человек/i, /ответ.*приватн.*памят.*цел.*задач.*напоминан.*пульс.*безопасн/i, /память\/неподтверждённ.*не отчётны/i, /подтверждённ.*обезличенн.*неотозванн.*командн/i, /сроки хранения/i, /аудируем.*админ.*отладочн.*доступ.*уполномоченн/i],
    },
    {
      locale: 'uk-UA',
      reporting: [/показан.*знеособлен/i, /доступу.*не надає/i, /менеджер.*hr/i, /повідомлен.*відповід.*резюме.*завдан.*ціл.*особ/i, /аудитован.*внутрішн.*доступ/i, /розмова\/тимчасові дані не звітні/i, /непідтверджен.*оцін.*агрегац.*тем.*рекомендац.*звіт/i, /підтверджен.*невідкликан.*командн/i],
      dataUse: [/ші, не людина/i, /відповід.*приватн.*пам’ят.*ціл.*завдан.*нагадуван.*пульс.*безпек/i, /пам’ять\/непідтверджен.*не звітні/i, /підтверджен.*знеособлен.*невідкликан.*командн/i, /строки зберігання/i, /аудитован.*адмін.*налагоджувальн.*доступ.*уповноважен/i],
    },
  ])('keeps complete concise trust boundaries for $locale', ({ locale, reporting, dataUse }) => {
    const reportingText = getReportingExplanationText(locale, true);
    const dataUseText = getDataUseExplanationText(locale, true);

    expect(reportingText.length).toBeLessThanOrEqual(360);
    expect(dataUseText.length).toBeLessThanOrEqual(360);
    for (const pattern of reporting) expect(reportingText).toMatch(pattern);
    for (const pattern of dataUse) expect(dataUseText).toMatch(pattern);
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
      id: 'c-1', tenantId: 't-1', userId: 'u-1', channelType: 'slack', externalConversationId: 'ec',
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

describe('ConversationOrchestrator resolved-detail carry-over', () => {
  const priorDetail = 'The difficulty was reconstructing the whole analysis flow.';

  function history(
    resolvedDetails: unknown = [priorDetail],
    latestPriorAt = new Date('2026-09-03T09:59:00.000Z'),
  ) {
    return [
      {
        id: 'm-0', ...OWNERSHIP, direction: 'inbound', text: 'Interruptions cost me 20 minutes.',
        occurredAt: new Date(latestPriorAt.getTime() - 60_000), metadata: undefined,
      },
      {
        id: 'out-0', ...OWNERSHIP, direction: 'outbound', text: 'That sounds disruptive.',
        occurredAt: latestPriorAt,
        metadata: { replyShape: { resolvedDetails } },
      },
      {
        id: 'm-1', ...OWNERSHIP, direction: 'inbound', text: 'The live interruption was necessary; I am just venting.',
        occurredAt: INBOUND_OCCURRED_AT, metadata: undefined,
      },
    ];
  }

  function classification(
    dialogueAct: 'continuation' | 'acknowledgement' | 'emotional_disclosure' | 'new_substance' | 'correction' | 'closing',
  ) {
    return {
      primaryIntent: 'casual_conversation', secondaryIntents: [], emotionalState: [], urgency: 'low',
      confidence: 0.9, surveyAllowed: true, requiresSafetyCheck: false, reasoningSummary: 'test',
      reminderRequest: null, dialogueAct, latestUserSubstance: 'The interruption was necessary.',
      topicAnchor: 'interruption',
      resolvedDetails: ['The interruption was necessary.'],
    } as const;
  }

  function orchestrator(m: ReturnType<typeof baseMocks>) {
    return new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );
  }

  it.each(['continuation', 'acknowledgement'] as const)(
    'merges and persists resolved details on a %s turn',
    async (dialogueAct) => {
      const m = baseMocks();
      m.conversationRepo.findRecentMessages.mockResolvedValue(history());
      m.conversationRepo.findById.mockResolvedValue({
        id: 'c-1', tenantId: 't-1', userId: 'u-1', channelType: 'slack', externalConversationId: 'ec',
        userDisplayName: 'Sam', userLocale: 'en', userTimezone: 'UTC',
        activeTopic: {
          summary: 'interruption', status: 'active', startedAt: '2026-09-03T09:58:00.000Z',
        },
      });
      m.aiProvider.classifySituation.mockResolvedValue(classification(dialogueAct));

      await orchestrator(m).orchestrate(INPUT);

      const expected = [priorDetail, 'The interruption was necessary.'];
      expect(m.aiProvider.generateResponse.mock.calls[0][2].isSessionStart).toBe(false);
      expect(m.aiProvider.generateResponse.mock.calls[0][2].replyPlan.resolvedDetails).toEqual(expected);
      expect(m.conversationRepo.saveMessage.mock.calls[0][0].metadata.replyShape.resolvedDetails)
        .toEqual(expected);
    },
  );

  it('clears prior details when a continuation replaces the active topic', async () => {
    const m = baseMocks();
    m.conversationRepo.findRecentMessages.mockResolvedValue(history());
    m.conversationRepo.findById.mockResolvedValue({
      id: 'c-1', tenantId: 't-1', userId: 'u-1', channelType: 'slack', externalConversationId: 'ec',
      userDisplayName: 'Sam', userLocale: 'en', userTimezone: 'UTC',
      activeTopic: {
        summary: 'interruption', status: 'active', startedAt: '2026-09-03T09:58:00.000Z',
      },
    });
    m.aiProvider.classifySituation.mockResolvedValue({
      ...classification('continuation'),
      latestUserSubstance: 'The hiring plan is now blocked on finance.',
      topicAnchor: 'hiring plan',
      resolvedDetails: ['Finance approval is the blocker.'],
    });

    await orchestrator(m).orchestrate(INPUT);

    const expected = ['Finance approval is the blocker.'];
    expect(m.aiProvider.generateResponse.mock.calls[0][2].replyPlan.resolvedDetails)
      .toEqual(expected);
    expect(m.conversationRepo.saveMessage.mock.calls[0][0].metadata.replyShape.resolvedDetails)
      .toEqual(expected);
  });

  it('carries resolved details for an emotional disclosure that continues the active thread', async () => {
    const m = baseMocks();
    m.conversationRepo.findRecentMessages.mockResolvedValue(history());
    m.conversationRepo.findById.mockResolvedValue({
      id: 'c-1', tenantId: 't-1', userId: 'u-1', channelType: 'slack', externalConversationId: 'ec',
      userDisplayName: 'Sam', userLocale: 'en', userTimezone: 'UTC',
      activeTopic: {
        summary: 'interruption', status: 'active', startedAt: '2026-09-03T09:58:00.000Z',
      },
    });
    m.aiProvider.classifySituation.mockResolvedValue(classification('emotional_disclosure'));

    await orchestrator(m).orchestrate(INPUT);

    expect(m.aiProvider.generateResponse.mock.calls[0][2].replyPlan.resolvedDetails)
      .toEqual([priorDetail, 'The interruption was necessary.']);
  });

  it('clears prior details when an emotional disclosure replaces the active topic', async () => {
    const m = baseMocks();
    m.conversationRepo.findRecentMessages.mockResolvedValue(history());
    m.conversationRepo.findById.mockResolvedValue({
      id: 'c-1', tenantId: 't-1', userId: 'u-1', channelType: 'slack', externalConversationId: 'ec',
      userDisplayName: 'Sam', userLocale: 'en', userTimezone: 'UTC',
      activeTopic: {
        summary: 'interruption', status: 'active', startedAt: '2026-09-03T09:58:00.000Z',
      },
    });
    m.aiProvider.classifySituation.mockResolvedValue({
      ...classification('emotional_disclosure'),
      latestUserSubstance: 'I feel stuck about my career change.',
      topicAnchor: 'career change',
      resolvedDetails: [],
    });

    await orchestrator(m).orchestrate(INPUT);

    expect(m.aiProvider.generateResponse.mock.calls[0][2].replyPlan.resolvedDetails).toEqual([]);
    expect(m.conversationRepo.saveMessage.mock.calls[0][0].metadata.replyShape.resolvedDetails)
      .toBeUndefined();
  });

  it.each(['continuation', 'acknowledgement'] as const)(
    'clears resolved details for a %s that starts a new session',
    async (dialogueAct) => {
      const m = baseMocks();
      m.conversationRepo.findRecentMessages.mockResolvedValue(
        history([priorDetail], new Date('2026-09-03T03:59:00.000Z')),
      );
      m.aiProvider.classifySituation.mockResolvedValue(classification(dialogueAct));

      await orchestrator(m).orchestrate(INPUT);

      const context = m.aiProvider.generateResponse.mock.calls[0][2];
      expect(context.isSessionStart).toBe(true);
      expect(context.replyPlan.resolvedDetails).toEqual([]);
      expect(m.conversationRepo.saveMessage.mock.calls[0][0].metadata.replyShape.resolvedDetails)
        .toBeUndefined();
    },
  );

  it.each(['new_substance', 'correction', 'closing'] as const)(
    'does not inherit resolved details on a %s turn',
    async (dialogueAct) => {
      const m = baseMocks();
      m.conversationRepo.findRecentMessages.mockResolvedValue(history());
      m.aiProvider.classifySituation.mockResolvedValue(classification(dialogueAct));

      await orchestrator(m).orchestrate(INPUT);

      expect(m.aiProvider.generateResponse.mock.calls[0][2].replyPlan.resolvedDetails).toEqual([]);
      expect(m.conversationRepo.saveMessage.mock.calls[0][0].metadata.replyShape.resolvedDetails)
        .toBeUndefined();
    },
  );

  it.each([
    ['sensitive', 'burnout_signal', 'high', 'burnout'],
    ['crisis', 'potential_crisis', 'critical', 'self_harm'],
  ] as const)('does not inherit resolved details in %s mode', async (
    _mode,
    primaryIntent,
    severity,
    riskType,
  ) => {
    const m = baseMocks();
    m.conversationRepo.findRecentMessages.mockResolvedValue(history());
    m.aiProvider.classifySituation.mockResolvedValue({
      ...classification('acknowledgement'),
      primaryIntent,
      surveyAllowed: false,
    });
    m.aiProvider.detectRisk.mockResolvedValue({
      severity, riskType, confidence: 0.9, evidence: [],
      surveyMustBeBlocked: true, immediateResponseRequired: false,
      escalationRecommended: false, proactiveMessagesMustBePaused: true,
      reasoningSummary: `${severity} risk`,
    });

    await orchestrator(m).orchestrate(INPUT);

    expect(m.aiProvider.generateResponse.mock.calls[0][2].replyPlan.resolvedDetails).toEqual([]);
    expect(m.conversationRepo.saveMessage.mock.calls[0][0].metadata.replyShape.resolvedDetails)
      .toBeUndefined();
  });

  it('does not inherit resolved details when a safety check returns low risk', async () => {
    const m = baseMocks();
    m.conversationRepo.findRecentMessages.mockResolvedValue(history());
    m.aiProvider.classifySituation.mockResolvedValue({
      ...classification('continuation'),
      requiresSafetyCheck: true,
    });
    m.aiProvider.detectRisk.mockResolvedValue({
      severity: 'low', riskType: 'stress', confidence: 0.7, evidence: [],
      surveyMustBeBlocked: false, immediateResponseRequired: false,
      escalationRecommended: false, proactiveMessagesMustBePaused: false,
      reasoningSummary: 'low risk',
    });

    await orchestrator(m).orchestrate(INPUT);

    expect(m.aiProvider.generateResponse.mock.calls[0][2].replyPlan.resolvedDetails).toEqual([]);
    expect(m.conversationRepo.saveMessage.mock.calls[0][0].metadata.replyShape.resolvedDetails)
      .toBeUndefined();
  });

  it('does not inherit resolved details on a confirmation turn', async () => {
    const m = baseMocks();
    m.conversationRepo.findRecentMessages.mockResolvedValue(history());
    m.aiProvider.classifySituation.mockResolvedValue(classification('continuation'));
    m.surveyRepo.findPendingConfirmationGroups.mockResolvedValue([{
      surveyWindowId: 'w-1', userId: 'u-1', tenantId: 't-1', questionGroup: 'autonomy',
      updatedAt: new Date('2026-09-03T09:59:00.000Z'),
    }]);
    m.aiProvider.generateResponse.mockResolvedValue({
      text: 'You value ownership. Did I get that right?',
      confirmationSummary: 'You value ownership.',
      confidence: 0.9,
      containsSurveyProbe: false,
    });

    await orchestrator(m).orchestrate(INPUT);

    expect(m.aiProvider.generateResponse.mock.calls[0][2].replyPlan).toBeUndefined();
    expect(m.conversationRepo.saveMessage.mock.calls[0][0].metadata.replyShape.resolvedDetails)
      .toBeUndefined();
  });

  it('keeps resolved details cleared when a rejected confirmation falls back to a normal response', async () => {
    const m = baseMocks();
    m.conversationRepo.findRecentMessages.mockResolvedValue(history());
    m.aiProvider.classifySituation.mockResolvedValue(classification('continuation'));
    m.surveyRepo.findPendingConfirmationGroups.mockResolvedValue([{
      surveyWindowId: 'w-1', userId: 'u-1', tenantId: 't-1', questionGroup: 'autonomy',
      updatedAt: new Date('2026-09-03T09:59:00.000Z'),
    }]);
    m.aiProvider.generateResponse
      .mockResolvedValueOnce({
        text: 'Project Apollo was blocked on 2026-09-03. Did I get that right?',
        confirmationSummary: 'Project Apollo was blocked on 2026-09-03.',
        confidence: 0.9,
        containsSurveyProbe: false,
      })
      .mockResolvedValueOnce({
        text: 'I hear you.', confidence: 0.9, containsSurveyProbe: false,
      });

    await orchestrator(m).orchestrate(INPUT);

    expect(m.aiProvider.generateResponse).toHaveBeenCalledTimes(2);
    expect(m.aiProvider.generateResponse.mock.calls[1][2].replyPlan.resolvedDetails).toEqual([]);
    expect(m.conversationRepo.saveMessage.mock.calls[0][0].metadata.replyShape.resolvedDetails)
      .toBeUndefined();
  });

  it('ignores malformed persisted resolved details', async () => {
    const m = baseMocks();
    m.conversationRepo.findRecentMessages.mockResolvedValue(history('not-an-array'));
    m.aiProvider.classifySituation.mockResolvedValue(classification('continuation'));

    await orchestrator(m).orchestrate(INPUT);

    expect(m.aiProvider.generateResponse.mock.calls[0][2].replyPlan.resolvedDetails)
      .toEqual(['The interruption was necessary.']);
  });

  it.each(['continuation', 'emotional_disclosure', 'new_substance'] as const)(
    'retains explicit same-thread substance classified as %s when resolved details are omitted',
    async (dialogueAct) => {
      const m = baseMocks();
      const messages = history([]);
      messages[2]!.text = 'The payment exception forced me to reconstruct the whole flow.';
      m.conversationRepo.findRecentMessages.mockResolvedValue(messages);
      m.conversationRepo.findById.mockResolvedValue({
        id: 'c-1', tenantId: 't-1', userId: 'u-1', channelType: 'slack', externalConversationId: 'ec',
        userDisplayName: 'Sam', userLocale: 'en', userTimezone: 'UTC',
        activeTopic: {
          summary: 'interruption', status: 'active', startedAt: '2026-09-03T09:58:00.000Z',
        },
      });
      m.aiProvider.classifySituation.mockResolvedValue({
        ...classification(dialogueAct),
        latestUserSubstance: 'The payment exception forced me to reconstruct the whole flow.',
        resolvedDetails: [],
      });

      await orchestrator(m).orchestrate(INPUT);

      const expected = ['The payment exception forced me to reconstruct the whole flow.'];
      expect(m.aiProvider.generateResponse.mock.calls[0][2].replyPlan.resolvedDetails)
        .toEqual(expected);
      expect(m.conversationRepo.saveMessage.mock.calls[0][0].metadata.replyShape.resolvedDetails)
        .toEqual(expected);
    },
  );

  it('does not promote omitted details when a continuation replaces the topic', async () => {
    const m = baseMocks();
    const messages = history([]);
    messages[2]!.text = 'The hiring plan is now blocked on finance.';
    m.conversationRepo.findRecentMessages.mockResolvedValue(messages);
    m.conversationRepo.findById.mockResolvedValue({
      id: 'c-1', tenantId: 't-1', userId: 'u-1', channelType: 'slack', externalConversationId: 'ec',
      userDisplayName: 'Sam', userLocale: 'en', userTimezone: 'UTC',
      activeTopic: {
        summary: 'interruption', status: 'active', startedAt: '2026-09-03T09:58:00.000Z',
      },
    });
    m.aiProvider.classifySituation.mockResolvedValue({
      ...classification('continuation'),
      latestUserSubstance: 'The hiring plan is now blocked on finance.',
      topicAnchor: 'hiring plan',
      resolvedDetails: [],
    });

    await orchestrator(m).orchestrate(INPUT);

    expect(m.aiProvider.generateResponse.mock.calls[0][2].replyPlan.resolvedDetails).toEqual([]);
    expect(m.conversationRepo.saveMessage.mock.calls[0][0].metadata.replyShape.resolvedDetails)
      .toBeUndefined();
  });

  it.each(['correction', 'closing'] as const)(
    'does not promote a same-thread %s turn when resolved details are omitted',
    async (dialogueAct) => {
      const m = baseMocks();
      const messages = history([]);
      m.conversationRepo.findRecentMessages.mockResolvedValue(messages);
      m.aiProvider.classifySituation.mockResolvedValue({
        ...classification(dialogueAct),
        resolvedDetails: [],
      });

      await orchestrator(m).orchestrate(INPUT);

      expect(m.aiProvider.generateResponse.mock.calls[0][2].replyPlan.resolvedDetails).toEqual([]);
    },
  );

  it('trims, deduplicates, and caps carried resolved details at five', async () => {
    const m = baseMocks();
    m.conversationRepo.findRecentMessages.mockResolvedValue(history([
      '  prior one  ', 'prior two', 'prior three', 'prior four', 'prior five', 'prior six', '', 42,
    ]));
    m.conversationRepo.findById.mockResolvedValue({
      id: 'c-1', tenantId: 't-1', userId: 'u-1', channelType: 'slack', externalConversationId: 'ec',
      userDisplayName: 'Sam', userLocale: 'en', userTimezone: 'UTC',
      activeTopic: {
        summary: 'interruption', status: 'active', startedAt: '2026-09-03T09:58:00.000Z',
      },
    });
    m.aiProvider.classifySituation.mockResolvedValue({
      ...classification('continuation'),
      resolvedDetails: [' current one ', 'prior two', 'current one', 'current two'],
    });

    await orchestrator(m).orchestrate(INPUT);

    const expected = ['prior four', 'prior five', 'current one', 'prior two', 'current two'];
    expect(m.aiProvider.generateResponse.mock.calls[0][2].replyPlan.resolvedDetails).toEqual(expected);
    expect(m.conversationRepo.saveMessage.mock.calls[0][0].metadata.replyShape.resolvedDetails)
      .toEqual(expected);
  });

  it('drops all prior details when five current details fill the cap', async () => {
    const m = baseMocks();
    m.conversationRepo.findRecentMessages.mockResolvedValue(history(['prior one', 'prior two']));
    m.conversationRepo.findById.mockResolvedValue({
      id: 'c-1', tenantId: 't-1', userId: 'u-1', channelType: 'slack', externalConversationId: 'ec',
      userDisplayName: 'Sam', userLocale: 'en', userTimezone: 'UTC',
      activeTopic: {
        summary: 'interruption', status: 'active', startedAt: '2026-09-03T09:58:00.000Z',
      },
    });
    const current = ['current one', 'current two', 'current three', 'current four', 'current five'];
    m.aiProvider.classifySituation.mockResolvedValue({
      ...classification('continuation'),
      resolvedDetails: current,
    });

    await orchestrator(m).orchestrate(INPUT);

    expect(m.aiProvider.generateResponse.mock.calls[0][2].replyPlan.resolvedDetails).toEqual(current);
  });
});

describe('ConversationOrchestrator pulse-capture questions answered by the model (GC round 3 CAP-5)', () => {
  const PREVIOUS_SYSTEM_REPLY = 'There is no current persisted pulse evidence linked to your earlier messages in this conversation. Pulse extraction can finish after a reply, so your most recent messages may not have been evaluated yet.';
  const captureClassification = (question: string, extra: Record<string, unknown> = {}) => ({
    primaryIntent: 'pulse_capture_explanation', secondaryIntents: [], urgency: 'low',
    emotionalState: [], confidence: 0.95, reasoningSummary: 'pulse capture transparency',
    surveyAllowed: false, requiresSafetyCheck: false, reminderRequest: null,
    dialogueAct: 'request', latestUserSubstance: question, topicAnchor: null,
    ...extra,
  });

  it('answers a follow-up about the previous capture answer in its own words, never repeating it', async () => {
    const m = baseMocks();
    const question = 'What do you mean by "pulse evidence"? Just explain the term to me.';
    m.conversationRepo.findRecentMessages.mockResolvedValue([
      { id: 'm-ask', ...OWNERSHIP, direction: 'inbound', text: 'what exact information did you pick up from our conversation?', occurredAt: new Date('2026-09-03T09:58:00.000Z') },
      { id: 'out-ask', ...OWNERSHIP, direction: 'outbound', text: PREVIOUS_SYSTEM_REPLY, occurredAt: new Date('2026-09-03T09:58:05.000Z'), metadata: { sourceInboundMessageId: 'm-ask' } },
      { id: 'm-1', ...OWNERSHIP, direction: 'inbound', text: question, occurredAt: INBOUND_OCCURRED_AT },
    ]);
    m.aiProvider.classifySituation.mockResolvedValue(
      captureClassification(question, { pulseCaptureScope: { type: 'conversation' } }),
    );
    m.aiProvider.generateResponse.mockResolvedValue({
      text: 'By pulse evidence I mean a short working note about how work feels for you; nothing from this chat is saved as one yet.',
      confidence: 0.9, containsSurveyProbe: false,
    });

    const result = await makeOrchestrator(m).orchestrate(INPUT);

    expect(result.responseText).not.toBe(PREVIOUS_SYSTEM_REPLY);
    expect(result.responseText).toContain('By pulse evidence I mean');
    expect(m.surveyRepo.findPulseCaptureForConversation).toHaveBeenCalledWith({
      tenantId: 't-1', userId: 'u-1', conversationId: 'c-1', beforeOccurredAt: INBOUND_OCCURRED_AT,
    });
    expect(m.aiProvider.generateResponse).toHaveBeenCalledTimes(1);
    const context = m.aiProvider.generateResponse.mock.calls[0][2];
    expect(context.captureFacts).toEqual({ scope: 'conversation', captures: [] });
    expect(context.replyPlan?.responseMove).toBe('answer_request');
    expect(m.outbox.enqueueSurveyEvidence).not.toHaveBeenCalled();
  });

  it('grounds persisted captures as facts with their status instead of rendering them as the reply', async () => {
    const m = baseMocks();
    const question = 'What did you capture from my onboarding message?';
    m.conversationRepo.findRecentMessages.mockResolvedValue([
      { id: CAP8_SOURCE_ID, ...OWNERSHIP, direction: 'inbound', text: 'The onboarding is great.', occurredAt: new Date('2026-09-03T09:57:00.000Z') },
      { id: 'm-1', ...OWNERSHIP, direction: 'inbound', text: question, occurredAt: INBOUND_OCCURRED_AT },
    ]);
    m.aiProvider.classifySituation.mockResolvedValue(
      captureClassification(question, { pulseCaptureScope: { type: 'message', messageIndex: 0 } }),
    );
    m.surveyRepo.findPulseCaptureForConversation.mockResolvedValue([
      { evidenceSummary: 'Onboarding feels positive.', questionGroup: 'belonging', sourceMessageIds: [CAP8_SOURCE_ID], status: 'temporary' },
      { evidenceSummary: 'Onboarding support was confirmed.', questionGroup: 'belonging', sourceMessageIds: [CAP8_SOURCE_ID], status: 'confirmed' },
    ]);
    m.aiProvider.generateResponse.mockResolvedValue({ text: 'model answer', confidence: 0.9, containsSurveyProbe: false });

    const result = await makeOrchestrator(m).orchestrate(INPUT);

    expect(result.responseText).toBe('model answer');
    expect(m.surveyRepo.findPulseCaptureForConversation).toHaveBeenCalledWith({
      tenantId: 't-1', userId: 'u-1', conversationId: 'c-1',
      beforeOccurredAt: INBOUND_OCCURRED_AT, sourceMessageId: CAP8_SOURCE_ID,
    });
    expect(m.aiProvider.generateResponse.mock.calls[0][2].captureFacts).toEqual({
      scope: 'exact',
      captures: [
        { evidenceSummary: 'Onboarding feels positive.', status: 'temporary' },
        { evidenceSummary: 'Onboarding support was confirmed.', status: 'confirmed' },
      ],
    });
    expect(m.conversationRepo.saveMessage.mock.calls[0][0].metadata)
      .toHaveProperty('pulseCaptureSourceMessageId', CAP8_SOURCE_ID);
    expect(m.outbox.enqueueSurveyEvidence).not.toHaveBeenCalled();
  });

  it('grounds an unresolved scope as a fact without reading the repository', async () => {
    const m = baseMocks();
    const question = 'What did you capture from that message?';
    m.conversationRepo.findRecentMessages.mockResolvedValue([
      { id: 'm-prior', ...OWNERSHIP, direction: 'inbound', text: 'Earlier context.', occurredAt: new Date('2026-09-03T09:59:00.000Z') },
      { id: 'm-1', ...OWNERSHIP, direction: 'inbound', text: question, occurredAt: INBOUND_OCCURRED_AT },
    ]);
    m.aiProvider.classifySituation.mockResolvedValue(
      captureClassification(question, { pulseCaptureScope: { type: 'unresolved' } }),
    );

    await makeOrchestrator(m).orchestrate(INPUT);

    expect(m.surveyRepo.findPulseCaptureForConversation).not.toHaveBeenCalled();
    expect(m.aiProvider.generateResponse).toHaveBeenCalledTimes(1);
    expect(m.aiProvider.generateResponse.mock.calls[0][2].captureFacts).toEqual({ scope: 'unresolved', captures: [] });
    expect(m.conversationRepo.saveMessage.mock.calls[0][0].metadata)
      .not.toHaveProperty('pulseCaptureSourceMessageId');
  });

  it('lets a reminder in the same turn reach the model as reminder context, not as appended text', async () => {
    const m = baseMocks();
    const question = 'What did you capture from onboarding, and remind me tomorrow to send the report?';
    const reminderRequest = { intent: 'send the report', dueAt: '2026-09-04T09:00:00.000Z' };
    m.conversationRepo.findRecentMessages.mockResolvedValue([
      { id: CAP8_SOURCE_ID, ...OWNERSHIP, direction: 'inbound', text: 'The onboarding is great.', occurredAt: new Date('2026-09-03T09:57:00.000Z') },
      { id: 'm-1', ...OWNERSHIP, direction: 'inbound', text: question, occurredAt: INBOUND_OCCURRED_AT },
    ]);
    m.aiProvider.classifySituation.mockResolvedValue(captureClassification(question, {
      reminderRequest, dialogueAct: 'new_substance', pulseCaptureScope: { type: 'message', messageIndex: 0 },
    }));
    m.aiProvider.generateResponse.mockResolvedValue({ text: 'model answer with reminder', confidence: 0.9, containsSurveyProbe: false });

    const result = await makeOrchestrator(m).orchestrate(INPUT);

    expect(result.responseText).toBe('model answer with reminder');
    const context = m.aiProvider.generateResponse.mock.calls[0][2];
    expect(context.captureFacts?.scope).toBe('exact');
    expect(context.reminderConfirmation).toEqual(expect.objectContaining({ intent: 'send the report' }));
    expect(m.scheduledActionRepo.save).toHaveBeenCalledWith(expect.objectContaining({ type: 'user_reminder', intent: 'send the report' }));
  });

  it('does not promote a capture question lexically when the classifier labelled it otherwise (ADR-013 D2)', async () => {
    const m = baseMocks();
    const question = 'but i don’t understand what exact information you already picked from our discussion?';
    m.conversationRepo.findRecentMessages.mockResolvedValue([
      { id: 'm-prior', ...OWNERSHIP, direction: 'inbound', text: 'The onboarding is great.', occurredAt: new Date('2026-09-03T09:59:00.000Z') },
      { id: 'm-1', ...OWNERSHIP, direction: 'inbound', text: question, occurredAt: INBOUND_OCCURRED_AT },
    ]);
    m.aiProvider.classifySituation.mockResolvedValue({
      ...captureClassification(question), primaryIntent: 'clarification', surveyAllowed: true,
    });

    const result = await makeOrchestrator(m).orchestrate(INPUT);

    expect(result.classification.primaryIntent).toBe('clarification');
    expect(m.surveyRepo.findPulseCaptureForConversation).not.toHaveBeenCalled();
    expect(m.aiProvider.generateResponse.mock.calls[0][2].captureFacts).toBeUndefined();
  });
});

describe('ConversationOrchestrator answer first, then the bundle (GC round 3 CAP-4)', () => {
  const statements = [
    { surveyQuestionId: 'q-a', statement: 'You can choose your methods.' },
    { surveyQuestionId: 'q-b', statement: 'You can set priorities.' },
    { surveyQuestionId: 'q-c', statement: 'You can challenge decisions.' },
  ];
  const bundleText = `I hear that ${statements.map((item) => item.statement).join(' ')} Is that fair?`;
  const replyText = 'Start tomorrow with the retro notes; the checklist can wait until after standup.';
  const question = 'Should I start tomorrow with the retro notes or the release checklist?';

  function bundleMocks() {
    const m = baseMocks();
    m.conversationRepo.findRecentMessages.mockResolvedValue([
      { id: 'm-1', ...OWNERSHIP, direction: 'inbound', text: question, occurredAt: INBOUND_OCCURRED_AT, metadata: undefined },
    ]);
    m.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent: 'casual_conversation', secondaryIntents: [], emotionalState: [], urgency: 'low',
      confidence: 0.9, surveyAllowed: true, requiresSafetyCheck: false, reasoningSummary: 'test',
      reminderRequest: null, dialogueAct: 'new_substance', latestUserSubstance: question, topicAnchor: null,
    });
    m.aiProvider.composeQuestionBundle = vi.fn().mockResolvedValue({ text: bundleText, statements });
    // Like the live model under the two-part contract: answer, then the fixed text.
    m.aiProvider.generateResponse = vi.fn(async (_turns: unknown, _strategy: unknown, context: { trailingBundle?: { text: string } }) => ({
      text: `${replyText}\n\n${context.trailingBundle?.text ?? ''}`,
      replyText,
      bundleText: context.trailingBundle?.text,
      confidence: 0.9,
      containsSurveyProbe: false,
    }));
    const questionConfirmationRepo = {
      findPendingQuestionClarification: vi.fn().mockResolvedValue(null),
      stageQuestionClarificationPrompt: vi.fn().mockResolvedValue(true),
      applyQuestionClarificationVerdict: vi.fn(),
      findAppliedQuestionVerdictForInbound: vi.fn().mockResolvedValue(null),
      findAwaitingQuestionBundle: vi.fn().mockResolvedValue(null),
      applyQuestionBundleVerdict: vi.fn(),
      hasReadyQuestionBundle: vi.fn().mockResolvedValue(false),
      findReadyQuestionBundle: vi.fn().mockResolvedValue({
        tenantId: 't-1', userId: 'u-1', surveyWindowId: 'w-v2', questionGroup: 'autonomy',
        questions: statements.map((statement) => ({
          surveyQuestionId: statement.surveyQuestionId, questionVersion: 'v2', workingSummary: statement.statement,
        })),
      }),
      stageQuestionConfirmationBundle: vi.fn().mockResolvedValue('bundle-1'),
    };
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
      undefined, undefined, questionConfirmationRepo,
    );
    return { m, questionConfirmationRepo, orch };
  }

  it('answers the employee question before the byte-exact bundle in one outbound', async () => {
    const { m, questionConfirmationRepo, orch } = bundleMocks();

    const result = await orch.orchestrate(INPUT);

    expect(result.responseText).toBe(`${replyText}\n\n${bundleText}`);
    expect(result.bundleReply).toBe('answer_then_bundle');
    expect(m.aiProvider.generateResponse).toHaveBeenCalledTimes(1);
    const [, strategy, context] = m.aiProvider.generateResponse.mock.calls[0];
    expect(context.trailingBundle).toEqual({
      kind: 'confirmation_bundle', text: bundleText, statements: statements.map((statement) => statement.statement),
    });
    expect(context.replyPlan).toBeUndefined();
    expect(strategy.includeFollowUpQuestion).toBe(false);
    expect(questionConfirmationRepo.stageQuestionConfirmationBundle).toHaveBeenCalledWith(expect.objectContaining({
      promptMessageId: 'out-1', displayedText: bundleText,
      components: statements.map((statement) => ({
        ...statement, questionVersion: 'v2', expectedWorkingSummary: statement.statement,
      })),
    }));
    expect(m.conversationRepo.saveMessage).toHaveBeenCalledWith(expect.objectContaining({
      text: `${replyText}\n\n${bundleText}`,
      metadata: expect.objectContaining({ v2ConfirmationBundle: true, v2BundleReply: 'answer_then_bundle' }),
    }));
  });

  it('sends the bundle alone and records bundle_without_reply when the reply breaks the contract', async () => {
    const { m, questionConfirmationRepo, orch } = bundleMocks();
    m.aiProvider.generateResponse = vi.fn().mockResolvedValue({
      text: `${replyText}\n\n${bundleText.replace('fair', 'right')}`,
      replyText, bundleText: bundleText.replace('fair', 'right'), confidence: 0.9, containsSurveyProbe: false,
    });

    const result = await orch.orchestrate(INPUT);

    expect(result.responseText).toBe(bundleText);
    expect(result.bundleReply).toBe('bundle_without_reply');
    expect(questionConfirmationRepo.stageQuestionConfirmationBundle).toHaveBeenCalledWith(expect.objectContaining({
      displayedText: bundleText,
    }));
    expect(result.bundleReplyFallbackReason).toBe('bundle_mismatch');
    expect(m.conversationRepo.saveMessage).toHaveBeenCalledWith(expect.objectContaining({
      text: bundleText,
      metadata: expect.objectContaining({
        v2ConfirmationBundle: true, v2BundleReply: 'bundle_without_reply', v2BundleReplyFallbackReason: 'bundle_mismatch',
      }),
    }));
    expect(m.outbox.enqueueMessageSend).toHaveBeenCalledTimes(1);
  });

  it('falls back with the adapter reason when the provider fails closed after its repair', async () => {
    const { m, orch } = bundleMocks();
    m.aiProvider.generateResponse = vi.fn().mockRejectedValue(new BundleReplyInvalidError('reply_question'));

    const result = await orch.orchestrate(INPUT);

    expect(result.responseText).toBe(bundleText);
    expect(result.bundleReply).toBe('bundle_without_reply');
    expect(result.bundleReplyFallbackReason).toBe('reply_question');
  });

  it('skips the bundle and answers normally when the provider composition fails closed, recording the reason', async () => {
    const { m, questionConfirmationRepo, orch } = bundleMocks();
    m.aiProvider.composeQuestionBundle = vi.fn().mockRejectedValue(new BundleCompositionInvalidError('question_count'));

    const result = await orch.orchestrate(INPUT);

    expect(result.responseText).toContain(replyText);
    expect(result.responseText).not.toContain(bundleText);
    expect(result.bundleReply).toBeUndefined();
    expect(result.bundleCompositionFallbackReason).toBe('question_count');
    expect(m.aiProvider.generateResponse).toHaveBeenCalledTimes(1);
    const [, strategy, context] = m.aiProvider.generateResponse.mock.calls[0]!;
    expect(strategy.mode).not.toBe('confirmation');
    expect(context.trailingBundle).toBeUndefined();
    expect(context.replyPlan).toBeDefined();
    expect(questionConfirmationRepo.stageQuestionConfirmationBundle).not.toHaveBeenCalled();
    expect(m.conversationRepo.saveMessage).toHaveBeenCalledWith(expect.objectContaining({
      direction: 'outbound',
      metadata: expect.objectContaining({ v2BundleCompositionFallbackReason: 'question_count' }),
    }));
    expect(m.conversationRepo.saveMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ v2ConfirmationBundle: true }),
    }));
    expect(m.outbox.enqueueMessageSend).toHaveBeenCalledTimes(1);
  });

  it('skips the bundle when its own re-validation rejects what the adapter returned', async () => {
    const { m, questionConfirmationRepo, orch } = bundleMocks();
    m.aiProvider.composeQuestionBundle = vi.fn().mockResolvedValue({
      text: `${bundleText} Anything else?`, statements,
    });

    const result = await orch.orchestrate(INPUT);

    expect(result.bundleCompositionFallbackReason).toBe('question_count');
    expect(result.responseText).not.toContain('Is that fair?');
    expect(questionConfirmationRepo.stageQuestionConfirmationBundle).not.toHaveBeenCalled();
  });

  it('still fails the turn when composition hits a transport or provider failure', async () => {
    const { m, orch } = bundleMocks();
    m.aiProvider.composeQuestionBundle = vi.fn().mockRejectedValue(new Error('fetch failed'));

    await expect(orch.orchestrate(INPUT)).rejects.toThrow('fetch failed');

    expect(m.aiProvider.generateResponse).not.toHaveBeenCalled();
    expect(m.outbox.enqueueMessageSend).not.toHaveBeenCalled();
  });

  it('sends the bundle alone when the provider output filter blocks the reply part', async () => {
    const { m, orch } = bundleMocks();
    m.aiProvider.generateResponse = vi.fn().mockRejectedValue(new ProviderContentFilterError('output'));

    const result = await orch.orchestrate(INPUT);

    expect(result.responseText).toBe(bundleText);
    expect(result.bundleReply).toBe('bundle_without_reply');
    expect(result.bundleReplyFallbackReason).toBe('output_filtered');
    expect(m.outbox.enqueueMessageSend).toHaveBeenCalledTimes(1);
  });

  it('falls back when the reply part repeats a bundle statement', async () => {
    const { m, orch } = bundleMocks();
    m.aiProvider.generateResponse = vi.fn().mockResolvedValue({
      text: `Noted: ${statements[1]!.statement}\n\n${bundleText}`,
      replyText: `Noted: ${statements[1]!.statement}`, bundleText, confidence: 0.9, containsSurveyProbe: false,
    });

    const result = await orch.orchestrate(INPUT);

    expect(result.responseText).toBe(bundleText);
    expect(result.bundleReply).toBe('bundle_without_reply');
    expect(result.bundleReplyFallbackReason).toBe('reply_restates_statement');
  });

  it('falls back when the reply part exceeds the application-owned length budget', async () => {
    const { m, orch } = bundleMocks();
    const longReply = 'Start with the retro notes. '.repeat(40).trim();
    m.aiProvider.generateResponse = vi.fn().mockResolvedValue({
      text: `${longReply}\n\n${bundleText}`, replyText: longReply, bundleText, confidence: 0.9, containsSurveyProbe: false,
    });

    const result = await orch.orchestrate(INPUT);

    expect(result.responseText).toBe(bundleText);
    expect(result.bundleReply).toBe('bundle_without_reply');
    expect(result.bundleReplyFallbackReason).toBe('reply_too_long');
  });

  it('keeps the one filtered-input turn when the reply call trips the provider input filter', async () => {
    const { m, questionConfirmationRepo, orch } = bundleMocks();
    m.aiProvider.generateResponse = vi.fn().mockRejectedValue(new ProviderContentFilterError('input', [], ['jailbreak']));
    m.conversationRepo.findCommittedTurnForInbound = vi.fn().mockResolvedValue(null);
    m.conversationRepo.recordCommittedTurn = vi.fn().mockResolvedValue(undefined);
    m.conversationRepo.findUnqueuedCommittedDispatchKinds = vi.fn().mockResolvedValue(['message_send']);
    m.conversationRepo.markCommittedDispatchQueued = vi.fn().mockResolvedValue(undefined);

    const result = await orch.orchestrate(INPUT);

    expect(result.outcome).toBe('input_filtered');
    expect(result.responseText).not.toContain(bundleText);
    expect(questionConfirmationRepo.stageQuestionConfirmationBundle).not.toHaveBeenCalled();
  });

  it('answers the employee before the one clarification question and stages only the question', async () => {
    const m = baseMocks();
    const clarificationText = 'What did I miss about your freedom to choose?';
    m.aiProvider.interpretQuestionBundleResponse = vi.fn().mockResolvedValue({
      kind: 'partial', acceptedQuestionIds: ['q-a'], disputedQuestionIds: ['q-b'], declinedQuestionIds: ['q-c'],
    });
    m.aiProvider.composeQuestionClarification = vi.fn().mockResolvedValue(clarificationText);
    m.aiProvider.generateResponse = vi.fn(async (_turns: unknown, _strategy: unknown, context: { trailingBundle?: { text: string } }) => ({
      text: `${replyText}\n\n${context.trailingBundle?.text ?? ''}`,
      replyText, bundleText: context.trailingBundle?.text, confidence: 0.9, containsSurveyProbe: false,
    }));
    const pending = {
      workingInsightId: 'working-b', tenantId: 't-1', userId: 'u-1',
      surveyWindowId: 'w-v2', surveyQuestionId: 'q-b', questionGroup: 'autonomy',
      workingSummary: 'Can choose tasks.', disputedStatement: 'You can choose tasks.',
      clarificationPromptMessageId: null, clarificationPromptSentAt: null,
    };
    const questionConfirmationRepo = {
      findAppliedQuestionVerdictForInbound: vi.fn().mockResolvedValue(null),
      findAwaitingQuestionBundle: vi.fn().mockResolvedValue({
        id: 'bundle-1', tenantId: 't-1', userId: 'u-1', surveyWindowId: 'w-v2',
        questionGroup: 'autonomy', displayedText: 'Is that fair?',
        components: ['q-a', 'q-b', 'q-c'].map((surveyQuestionId) => ({
          surveyQuestionId, questionVersion: 'v2', statement: surveyQuestionId,
        })),
      }),
      applyQuestionBundleVerdict: vi.fn().mockResolvedValue(true),
      findPendingQuestionClarification: vi.fn().mockResolvedValue(null),
      previewPendingQuestionClarificationAfterBundleVerdict: vi.fn().mockResolvedValue(pending),
      stageQuestionClarificationPrompt: vi.fn().mockResolvedValue(true),
      applyQuestionClarificationVerdict: vi.fn(),
      hasReadyQuestionBundle: vi.fn().mockResolvedValue(false),
      findReadyQuestionBundle: vi.fn(),
      stageQuestionConfirmationBundle: vi.fn(),
    };
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
      undefined, undefined, questionConfirmationRepo,
    );

    const result = await orch.orchestrate(INPUT);

    expect(result.responseText).toBe(`${replyText}\n\n${clarificationText}`);
    expect(result.bundleReply).toBe('answer_then_bundle');
    expect(m.aiProvider.generateResponse.mock.calls[0][2].trailingBundle)
      .toEqual({ kind: 'clarification', text: clarificationText, statements: ['You can choose tasks.'] });
    expect(questionConfirmationRepo.stageQuestionClarificationPrompt).toHaveBeenCalledWith(expect.objectContaining({
      workingInsightId: 'working-b', promptMessageId: 'out-1', displayedText: clarificationText,
    }));
    expect(m.conversationRepo.saveMessage).toHaveBeenCalledWith(expect.objectContaining({
      text: `${replyText}\n\n${clarificationText}`,
      metadata: expect.objectContaining({ v2ClarificationPrompt: true, v2BundleReply: 'answer_then_bundle' }),
    }));
  });
});

describe('GC round 3 CAP-3: shown corrections, topic completion, cycle status', () => {
  const components = [
    { surveyQuestionId: 'q-a', questionVersion: 'v2', statement: 'You choose your tasks.' },
    { surveyQuestionId: 'q-b', questionVersion: 'v2', statement: 'You set your priorities.' },
    { surveyQuestionId: 'q-c', questionVersion: 'v2', statement: 'You raise concerns.' },
  ];
  const awaiting = {
    id: 'bundle-1', tenantId: 't-1', userId: 'u-1', surveyWindowId: 'w-v2',
    questionGroup: 'autonomy', displayedText: 'Is that fair?', components,
  };
  const snapshot = (autonomy: string[]) => ({
    surveyWindowId: 'w-v2',
    groups: [
      { questionGroup: 'autonomy', questions: ['q-a', 'q-b', 'q-c'].map((surveyQuestionId, index) => ({ surveyQuestionId, status: autonomy[index]! })) },
      { questionGroup: 'growth', questions: [{ surveyQuestionId: 'q-d', status: 'no_data' }] },
      { questionGroup: 'purpose', questions: [{ surveyQuestionId: 'q-e', status: 'no_data' }] },
      { questionGroup: 'belonging', questions: [{ surveyQuestionId: 'q-f', status: 'no_data' }] },
    ],
  });

  function repoMocks(overrides: Record<string, unknown> = {}) {
    return {
      findAppliedQuestionVerdictForInbound: vi.fn().mockResolvedValue(null),
      findAwaitingQuestionBundle: vi.fn().mockResolvedValue(null),
      applyQuestionBundleVerdict: vi.fn().mockResolvedValue(true),
      findPendingQuestionClarification: vi.fn().mockResolvedValue(null),
      previewPendingQuestionClarificationAfterBundleVerdict: vi.fn().mockResolvedValue(null),
      previewPendingQuestionClarificationAfterVerdict: vi.fn().mockResolvedValue(null),
      stageQuestionClarificationPrompt: vi.fn().mockResolvedValue(true),
      applyQuestionClarificationVerdict: vi.fn().mockResolvedValue(true),
      hasReadyQuestionBundle: vi.fn().mockResolvedValue(false),
      findReadyQuestionBundle: vi.fn().mockResolvedValue(null),
      stageQuestionConfirmationBundle: vi.fn().mockResolvedValue('bundle-2'),
      stageCorrectedStatementConfirmation: vi.fn().mockResolvedValue('bundle-3'),
      findCycleProgress: vi.fn().mockResolvedValue(snapshot(['pending_confirmation', 'pending_confirmation', 'pending_confirmation'])),
      ...overrides,
    };
  }

  function orchestrator(m: ReturnType<typeof baseMocks>, repo: ReturnType<typeof repoMocks>) {
    return new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
      undefined, undefined, repo,
    );
  }

  it('states completion with progress when an agree verdict closes the topic', async () => {
    const m = baseMocks();
    m.aiProvider.interpretQuestionBundleResponse = vi.fn().mockResolvedValue({ kind: 'agree' });
    const repo = repoMocks({ findAwaitingQuestionBundle: vi.fn().mockResolvedValue(awaiting) });

    await orchestrator(m, repo).orchestrate(INPUT);

    const [, , context] = m.aiProvider.generateResponse.mock.calls[0];
    expect(context.topicConfirmed).toEqual({ questionGroup: 'autonomy', topicsClosed: 1, topicsTotal: 4 });
    expect(repo.findCycleProgress).toHaveBeenCalledWith({ tenantId: 't-1', userId: 'u-1' });
  });

  it('closes the topic on a partial verdict that disputes nothing', async () => {
    const m = baseMocks();
    m.aiProvider.interpretQuestionBundleResponse = vi.fn().mockResolvedValue({
      kind: 'partial', acceptedQuestionIds: ['q-a', 'q-b'], disputedQuestionIds: [], declinedQuestionIds: ['q-c'],
    });
    const repo = repoMocks({ findAwaitingQuestionBundle: vi.fn().mockResolvedValue(awaiting) });

    await orchestrator(m, repo).orchestrate(INPUT);

    const [, , context] = m.aiProvider.generateResponse.mock.calls[0];
    expect(context.topicConfirmed).toEqual({ questionGroup: 'autonomy', topicsClosed: 1, topicsTotal: 4 });
    expect(repo.previewPendingQuestionClarificationAfterBundleVerdict).not.toHaveBeenCalled();
  });

  it('keeps completion silent while a statement is still disputed', async () => {
    const m = baseMocks();
    m.aiProvider.interpretQuestionBundleResponse = vi.fn().mockResolvedValue({
      kind: 'partial', acceptedQuestionIds: ['q-a', 'q-c'], disputedQuestionIds: ['q-b'], declinedQuestionIds: [],
    });
    m.aiProvider.composeQuestionClarification = vi.fn().mockResolvedValue('What would you change about priorities?');
    m.aiProvider.generateResponse = vi.fn(async (_turns: unknown, _strategy: unknown, context: { trailingBundle?: { text: string } }) => ({
      text: `Noted.\n\n${context.trailingBundle?.text ?? ''}`, replyText: 'Noted.', bundleText: context.trailingBundle?.text,
      confidence: 0.9, containsSurveyProbe: false,
    }));
    const repo = repoMocks({
      findAwaitingQuestionBundle: vi.fn().mockResolvedValue(awaiting),
      previewPendingQuestionClarificationAfterBundleVerdict: vi.fn().mockResolvedValue({
        workingInsightId: 'working-b', tenantId: 't-1', userId: 'u-1', surveyWindowId: 'w-v2',
        surveyQuestionId: 'q-b', questionVersion: 'v2', questionGroup: 'autonomy',
        workingSummary: 'I set all priorities.', disputedStatement: 'You set your priorities.',
        clarificationPromptMessageId: null, clarificationPromptSentAt: null,
      }),
    });

    await orchestrator(m, repo).orchestrate(INPUT);

    const [, , context] = m.aiProvider.generateResponse.mock.calls[0];
    expect(context.topicConfirmed).toBeUndefined();
    expect(context.trailingBundle).toMatchObject({ kind: 'clarification' });
  });

  it('shows the corrected statement back after a clarified verdict and stages it for confirmation', async () => {
    const m = baseMocks();
    const corrected = 'I can decide my work methods, but not my priorities.';
    const shown = `So the fair version is: ${corrected} Did I get that right?`;
    m.aiProvider.interpretQuestionClarificationResponse = vi.fn().mockResolvedValue({ kind: 'clarified', correctedSummary: corrected });
    m.aiProvider.composeQuestionBundle = vi.fn().mockResolvedValue({
      text: shown, statements: [{ surveyQuestionId: 'q-b', statement: corrected }],
    });
    m.aiProvider.generateResponse = vi.fn(async (_turns: unknown, _strategy: unknown, context: { trailingBundle?: { text: string } }) => ({
      text: `Thanks for clearing that up.\n\n${context.trailingBundle?.text ?? ''}`,
      replyText: 'Thanks for clearing that up.', bundleText: context.trailingBundle?.text,
      confidence: 0.9, containsSurveyProbe: false,
    }));
    const pending = {
      workingInsightId: 'working-b', tenantId: 't-1', userId: 'u-1',
      surveyWindowId: 'w-v2', surveyQuestionId: 'q-b', questionVersion: 'v2', questionGroup: 'autonomy',
      workingSummary: 'I choose all my work.', disputedStatement: 'You set your priorities.',
      clarificationPromptMessageId: 'clarify-out',
      clarificationPromptSentAt: new Date('2026-09-03T09:59:00Z'),
    };
    const repo = repoMocks({
      findPendingQuestionClarification: vi.fn().mockResolvedValue(pending),
      findCycleProgress: vi.fn().mockResolvedValue(snapshot(['confirmed', 'pending_clarification', 'confirmed'])),
    });

    const result = await orchestrator(m, repo).orchestrate(INPUT);

    expect(m.aiProvider.composeQuestionBundle).toHaveBeenCalledWith(
      expect.any(Array), [{ surveyQuestionId: 'q-b', workingSummary: corrected }], 'en', 'corrected_statement',
    );
    const [, , context] = m.aiProvider.generateResponse.mock.calls[0];
    expect(context.trailingBundle).toEqual({ kind: 'corrected_statement', text: shown, statements: [corrected] });
    expect(context.topicConfirmed).toBeUndefined();
    expect(result.responseText).toBe(`Thanks for clearing that up.\n\n${shown}`);
    expect(repo.applyQuestionClarificationVerdict).toHaveBeenCalledWith({
      tenantId: 't-1', userId: 'u-1', conversationId: 'c-1',
      workingInsightId: 'working-b', inboundMessageId: 'm-1',
      verdict: { kind: 'clarified', correctedSummary: corrected },
    });
    expect(repo.stageCorrectedStatementConfirmation).toHaveBeenCalledWith({
      tenantId: 't-1', userId: 'u-1', conversationId: 'c-1', surveyWindowId: 'w-v2',
      questionGroup: 'autonomy', workingInsightId: 'working-b', surveyQuestionId: 'q-b', questionVersion: 'v2',
      promptMessageId: 'out-1', displayedText: shown, statement: corrected, expectedWorkingSummary: corrected,
    });
    expect(repo.applyQuestionClarificationVerdict.mock.invocationCallOrder[0])
      .toBeLessThan(repo.stageCorrectedStatementConfirmation.mock.invocationCallOrder[0]);
    expect(repo.previewPendingQuestionClarificationAfterVerdict).not.toHaveBeenCalled();
    expect(repo.stageQuestionConfirmationBundle).not.toHaveBeenCalled();
    expect(m.conversationRepo.saveMessage).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ v2CorrectedStatement: true, v2BundleReply: 'answer_then_bundle' }),
    }));
  });

  it('skips the corrected statement for this turn when its composition stays invalid, keeping the verdict', async () => {
    const m = baseMocks();
    const corrected = 'I can decide my work methods, but not my priorities.';
    m.aiProvider.interpretQuestionClarificationResponse = vi.fn().mockResolvedValue({ kind: 'clarified', correctedSummary: corrected });
    m.aiProvider.composeQuestionBundle = vi.fn().mockRejectedValue(new BundleCompositionInvalidError('statement_not_in_text'));
    m.aiProvider.generateResponse = vi.fn(async (_turns: unknown, _strategy: unknown, context: { trailingBundle?: { text: string } }) => ({
      text: `Thanks for clearing that up.${context.trailingBundle ? `\n\n${context.trailingBundle.text}` : ''}`,
      confidence: 0.9, containsSurveyProbe: false,
    }));
    const pending = {
      workingInsightId: 'working-b', tenantId: 't-1', userId: 'u-1',
      surveyWindowId: 'w-v2', surveyQuestionId: 'q-b', questionVersion: 'v2', questionGroup: 'autonomy',
      workingSummary: 'I choose all my work.', disputedStatement: 'You set your priorities.',
      clarificationPromptMessageId: 'clarify-out',
      clarificationPromptSentAt: new Date('2026-09-03T09:59:00Z'),
    };
    const repo = repoMocks({
      findPendingQuestionClarification: vi.fn().mockResolvedValue(pending),
      findCycleProgress: vi.fn().mockResolvedValue(snapshot(['confirmed', 'pending_clarification', 'confirmed'])),
    });

    const result = await orchestrator(m, repo).orchestrate(INPUT);

    expect(m.aiProvider.composeQuestionBundle).toHaveBeenCalledWith(
      expect.any(Array), [{ surveyQuestionId: 'q-b', workingSummary: corrected }], 'en', 'corrected_statement',
    );
    const [, strategy, context] = m.aiProvider.generateResponse.mock.calls[0];
    expect(context.trailingBundle).toBeUndefined();
    expect(strategy.mode).not.toBe('confirmation');
    expect(result.responseText).toBe('Thanks for clearing that up.');
    expect(result.bundleReply).toBeUndefined();
    expect(result.bundleCompositionFallbackReason).toBe('statement_not_in_text');
    expect(repo.applyQuestionClarificationVerdict).toHaveBeenCalledWith(expect.objectContaining({
      workingInsightId: 'working-b', verdict: { kind: 'clarified', correctedSummary: corrected },
    }));
    expect(repo.stageCorrectedStatementConfirmation).not.toHaveBeenCalled();
    expect(m.conversationRepo.saveMessage).toHaveBeenCalledWith(expect.objectContaining({
      direction: 'outbound',
      metadata: expect.objectContaining({ v2CorrectedStatementFallbackReason: 'statement_not_in_text' }),
    }));
    expect(m.conversationRepo.saveMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ v2CorrectedStatement: true }),
    }));
    expect(m.conversationRepo.saveMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ v2BundleCompositionFallbackReason: expect.anything() }),
    }));
  });

  it('answers a cycle-status question from typed progress, and reports no cycle outside one', async () => {
    const m = baseMocks();
    m.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent: 'clarification', secondaryIntents: [], emotionalState: [], urgency: 'low',
      confidence: 0.9, surveyAllowed: true, requiresSafetyCheck: false, reasoningSummary: 'asks what is left',
      reminderRequest: null, dialogueAct: 'request', latestUserSubstance: 'did I answer everything?', topicAnchor: null,
      cycleStatusQuestion: true,
    });
    const repo = repoMocks({
      findCycleProgress: vi.fn().mockResolvedValue(snapshot(['confirmed', 'confirmed', 'declined'])),
    });

    await orchestrator(m, repo).orchestrate(INPUT);

    const [, , context] = m.aiProvider.generateResponse.mock.calls[0];
    expect(context.cycleProgress).toEqual({
      inCycle: true, topicsTotal: 4, topicsClosed: 1, openTopics: ['growth', 'purpose', 'belonging'], awaitingReply: false,
    });

    const m2 = baseMocks();
    m2.aiProvider.classifySituation = m.aiProvider.classifySituation;
    const repo2 = repoMocks({ findCycleProgress: vi.fn().mockResolvedValue(null) });
    await orchestrator(m2, repo2).orchestrate(INPUT);
    const [, , context2] = m2.aiProvider.generateResponse.mock.calls[0];
    expect(context2.cycleProgress).toEqual({ inCycle: false, topicsTotal: 0, topicsClosed: 0, openTopics: [], awaitingReply: false });
  });
});

describe('GC round 3 CAP-3: review edge cases', () => {
  const correctedBundle = {
    id: 'bundle-3', tenantId: 't-1', userId: 'u-1', surveyWindowId: 'w-v2', questionGroup: 'autonomy',
    displayedText: 'So the fair version is: you set your own priorities. Right?',
    components: [{ surveyQuestionId: 'q-b', questionVersion: 'v2', statement: 'you set your own priorities' }],
  };
  const snapshot = (autonomy: string[]) => ({
    surveyWindowId: 'w-v2',
    groups: [
      { questionGroup: 'autonomy', questions: ['q-a', 'q-b', 'q-c'].map((surveyQuestionId, index) => ({ surveyQuestionId, status: autonomy[index]! })) },
      { questionGroup: 'growth', questions: [{ surveyQuestionId: 'q-d', status: 'no_data' }] },
    ],
  });
  function repoMocks(overrides: Record<string, unknown> = {}) {
    return {
      findAppliedQuestionVerdictForInbound: vi.fn().mockResolvedValue(null),
      findAwaitingQuestionBundle: vi.fn().mockResolvedValue(null),
      applyQuestionBundleVerdict: vi.fn().mockResolvedValue(true),
      findPendingQuestionClarification: vi.fn().mockResolvedValue(null),
      previewPendingQuestionClarificationAfterBundleVerdict: vi.fn().mockResolvedValue(null),
      previewPendingQuestionClarificationAfterVerdict: vi.fn().mockResolvedValue(null),
      stageQuestionClarificationPrompt: vi.fn().mockResolvedValue(true),
      applyQuestionClarificationVerdict: vi.fn().mockResolvedValue(true),
      hasReadyQuestionBundle: vi.fn().mockResolvedValue(false),
      findReadyQuestionBundle: vi.fn().mockResolvedValue(null),
      stageQuestionConfirmationBundle: vi.fn().mockResolvedValue('bundle-2'),
      stageCorrectedStatementConfirmation: vi.fn().mockResolvedValue('bundle-3'),
      findCycleProgress: vi.fn().mockResolvedValue(snapshot(['confirmed', 'pending_confirmation', 'pending_clarification'])),
      ...overrides,
    };
  }
  function orchestrator(m: ReturnType<typeof baseMocks>, repo: ReturnType<typeof repoMocks>) {
    return new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
      undefined, undefined, repo,
    );
  }

  it('opens no second clarification while a corrected statement still awaits its verdict', async () => {
    const m = baseMocks();
    m.aiProvider.interpretQuestionBundleResponse = vi.fn().mockResolvedValue({ kind: 'unrelated' });
    const repo = repoMocks({ findAwaitingQuestionBundle: vi.fn().mockResolvedValue(correctedBundle) });

    await orchestrator(m, repo).orchestrate(INPUT);

    expect(repo.findPendingQuestionClarification).not.toHaveBeenCalled();
    expect(repo.stageQuestionClarificationPrompt).not.toHaveBeenCalled();
    const [, , context] = m.aiProvider.generateResponse.mock.calls[0];
    expect(context.trailingBundle).toBeUndefined();
  });

  it('answers a cycle-status question with the progress after this turn verdict', async () => {
    const m = baseMocks();
    m.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent: 'clarification', secondaryIntents: [], emotionalState: [], urgency: 'low',
      confidence: 0.9, surveyAllowed: true, requiresSafetyCheck: false, reasoningSummary: 'yes and what is left',
      reminderRequest: null, dialogueAct: 'request', latestUserSubstance: 'yes, and what is left?', topicAnchor: null,
      cycleStatusQuestion: true,
    });
    m.aiProvider.interpretQuestionBundleResponse = vi.fn().mockResolvedValue({ kind: 'agree' });
    const repo = repoMocks({
      findAwaitingQuestionBundle: vi.fn().mockResolvedValue(correctedBundle),
      findCycleProgress: vi.fn().mockResolvedValue(snapshot(['confirmed', 'pending_confirmation', 'confirmed'])),
    });

    await orchestrator(m, repo).orchestrate(INPUT);

    const [, , context] = m.aiProvider.generateResponse.mock.calls[0];
    expect(context.topicConfirmed).toEqual({ questionGroup: 'autonomy', topicsClosed: 1, topicsTotal: 2 });
    expect(context.cycleProgress).toEqual({ inCycle: true, topicsTotal: 2, topicsClosed: 1, openTopics: ['growth'], awaitingReply: false });
  });

  it('replies without the corrected bundle when the window has already ended', async () => {
    const m = baseMocks();
    m.aiProvider.interpretQuestionClarificationResponse = vi.fn().mockResolvedValue({ kind: 'clarified', correctedSummary: 'I set my own priorities.' });
    m.aiProvider.composeQuestionBundle = vi.fn();
    const repo = repoMocks({
      findPendingQuestionClarification: vi.fn().mockResolvedValue({
        workingInsightId: 'working-b', tenantId: 't-1', userId: 'u-1', surveyWindowId: 'w-v2',
        surveyQuestionId: 'q-b', questionVersion: 'v2', questionGroup: 'autonomy',
        workingSummary: 'I choose all my work.', disputedStatement: 'You set your priorities.',
        clarificationPromptMessageId: 'clarify-out', clarificationPromptSentAt: new Date('2026-09-03T09:59:00Z'),
      }),
      findCycleProgress: vi.fn().mockResolvedValue(null),
    });

    await orchestrator(m, repo).orchestrate(INPUT);

    expect(repo.applyQuestionClarificationVerdict).toHaveBeenCalledOnce();
    expect(m.aiProvider.composeQuestionBundle).not.toHaveBeenCalled();
    expect(repo.stageCorrectedStatementConfirmation).not.toHaveBeenCalled();
    const [, , context] = m.aiProvider.generateResponse.mock.calls[0];
    expect(context.trailingBundle).toBeUndefined();
  });

  it('marks the cycle as waiting when this reply itself ends with a fixed text', async () => {
    const m = baseMocks();
    m.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent: 'clarification', secondaryIntents: [], emotionalState: [], urgency: 'low',
      confidence: 0.9, surveyAllowed: true, requiresSafetyCheck: false, reasoningSummary: 'what is left',
      reminderRequest: null, dialogueAct: 'request', latestUserSubstance: 'what is left?', topicAnchor: null,
      cycleStatusQuestion: true,
    });
    const statements = [{ surveyQuestionId: 'q-d', statement: 'You want more training time.' }];
    const bundleText = `I hear that ${statements[0]!.statement} Is that fair?`;
    m.aiProvider.composeQuestionBundle = vi.fn().mockResolvedValue({ text: bundleText, statements });
    m.aiProvider.generateResponse = vi.fn(async (_turns: unknown, _strategy: unknown, context: { trailingBundle?: { text: string } }) => ({
      text: `Nearly there.\n\n${context.trailingBundle?.text ?? ''}`, replyText: 'Nearly there.', bundleText: context.trailingBundle?.text,
      confidence: 0.9, containsSurveyProbe: false,
    }));
    const repo = repoMocks({
      findCycleProgress: vi.fn().mockResolvedValue(snapshot(['confirmed', 'confirmed', 'confirmed'])),
      findReadyQuestionBundle: vi.fn().mockResolvedValue({
        tenantId: 't-1', userId: 'u-1', surveyWindowId: 'w-v2', questionGroup: 'growth',
        questions: [{ surveyQuestionId: 'q-d', questionVersion: 'v2', workingSummary: statements[0]!.statement }],
      }),
    });

    await orchestrator(m, repo).orchestrate(INPUT);

    const [, , context] = m.aiProvider.generateResponse.mock.calls[0];
    expect(context.trailingBundle).toMatchObject({ kind: 'confirmation_bundle' });
    expect(context.cycleProgress).toMatchObject({ inCycle: true, awaitingReply: true });
  });

  it('gives no cycle-status grounding when the survey is disabled', async () => {
    const m = baseMocks();
    m.featureFlags.isEnabled = vi.fn().mockResolvedValue(false);
    m.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent: 'clarification', secondaryIntents: [], emotionalState: [], urgency: 'low',
      confidence: 0.9, surveyAllowed: true, requiresSafetyCheck: false, reasoningSummary: 'what is left',
      reminderRequest: null, dialogueAct: 'request', latestUserSubstance: 'what is left?', topicAnchor: null,
      cycleStatusQuestion: true,
    });
    const repo = repoMocks();

    await orchestrator(m, repo).orchestrate(INPUT);

    const [, , context] = m.aiProvider.generateResponse.mock.calls[0];
    expect(context.cycleProgress).toBeUndefined();
    expect(repo.findCycleProgress).not.toHaveBeenCalled();
  });
});

describe('GC round 3 CAP-3: review findings round 2', () => {
  const pending = {
    workingInsightId: 'working-b', tenantId: 't-1', userId: 'u-1', surveyWindowId: 'w-v2',
    surveyQuestionId: 'q-b', questionVersion: 'v2', questionGroup: 'autonomy',
    workingSummary: 'I choose all my work.', disputedStatement: 'You set your priorities.',
    clarificationPromptMessageId: 'clarify-out', clarificationPromptSentAt: new Date('2026-09-03T09:59:00Z'),
  };
  const snapshot = (autonomy: string[]) => ({
    surveyWindowId: 'w-v2',
    groups: [
      { questionGroup: 'autonomy', questions: ['q-a', 'q-b', 'q-c'].map((surveyQuestionId, index) => ({ surveyQuestionId, status: autonomy[index]! })) },
      { questionGroup: 'growth', questions: [{ surveyQuestionId: 'q-d', status: 'no_data' }] },
    ],
  });
  function repoMocks(overrides: Record<string, unknown> = {}) {
    return {
      findAppliedQuestionVerdictForInbound: vi.fn().mockResolvedValue(null),
      findAwaitingQuestionBundle: vi.fn().mockResolvedValue(null),
      applyQuestionBundleVerdict: vi.fn().mockResolvedValue(true),
      findPendingQuestionClarification: vi.fn().mockResolvedValue(pending),
      previewPendingQuestionClarificationAfterBundleVerdict: vi.fn().mockResolvedValue(null),
      previewPendingQuestionClarificationAfterVerdict: vi.fn().mockResolvedValue(null),
      stageQuestionClarificationPrompt: vi.fn().mockResolvedValue(true),
      applyQuestionClarificationVerdict: vi.fn().mockResolvedValue(true),
      hasReadyQuestionBundle: vi.fn().mockResolvedValue(false),
      findReadyQuestionBundle: vi.fn().mockResolvedValue(null),
      stageQuestionConfirmationBundle: vi.fn().mockResolvedValue('bundle-2'),
      stageCorrectedStatementConfirmation: vi.fn().mockResolvedValue('bundle-3'),
      findCycleProgress: vi.fn().mockResolvedValue(snapshot(['confirmed', 'pending_clarification', 'confirmed'])),
      ...overrides,
    };
  }
  function orchestrator(m: ReturnType<typeof baseMocks>, repo: ReturnType<typeof repoMocks>) {
    return new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
      undefined, undefined, repo,
    );
  }

  it('states completion when a declined clarification closes the topic', async () => {
    const m = baseMocks();
    m.aiProvider.interpretQuestionClarificationResponse = vi.fn().mockResolvedValue({ kind: 'declined' });
    const repo = repoMocks();

    await orchestrator(m, repo).orchestrate(INPUT);

    const [, , context] = m.aiProvider.generateResponse.mock.calls[0];
    expect(context.topicConfirmed).toEqual({ questionGroup: 'autonomy', topicsClosed: 1, topicsTotal: 2 });
    expect(repo.applyQuestionClarificationVerdict).toHaveBeenCalledWith(expect.objectContaining({ verdict: { kind: 'declined' } }));
  });

  it('does not show the corrected statement on a closing turn; the row stays ready for the ordinary bundle path', async () => {
    const m = baseMocks();
    m.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent: 'casual_conversation', secondaryIntents: [], emotionalState: [], urgency: 'low',
      confidence: 0.9, surveyAllowed: true, requiresSafetyCheck: false, reasoningSummary: 'closing',
      reminderRequest: null, dialogueAct: 'closing', latestUserSubstance: null, topicAnchor: null,
    });
    m.aiProvider.interpretQuestionClarificationResponse = vi.fn().mockResolvedValue({ kind: 'clarified', correctedSummary: 'I set my own priorities, bye.' });
    m.aiProvider.composeQuestionBundle = vi.fn();
    const repo = repoMocks();

    await orchestrator(m, repo).orchestrate(INPUT);

    expect(repo.applyQuestionClarificationVerdict).toHaveBeenCalledOnce();
    expect(m.aiProvider.composeQuestionBundle).not.toHaveBeenCalled();
    expect(repo.stageCorrectedStatementConfirmation).not.toHaveBeenCalled();
  });

  it('does not show the corrected statement when the adapter cannot stage it', async () => {
    const m = baseMocks();
    m.aiProvider.interpretQuestionClarificationResponse = vi.fn().mockResolvedValue({ kind: 'clarified', correctedSummary: 'I set my own priorities.' });
    m.aiProvider.composeQuestionBundle = vi.fn();
    const repo = repoMocks({ stageCorrectedStatementConfirmation: undefined });

    await orchestrator(m, repo).orchestrate(INPUT);

    expect(repo.applyQuestionClarificationVerdict).toHaveBeenCalledOnce();
    expect(m.aiProvider.composeQuestionBundle).not.toHaveBeenCalled();
  });

  it('withholds cycle-status counting on a turn where the survey is blocked by risk', async () => {
    const m = baseMocks();
    m.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent: 'support', secondaryIntents: [], emotionalState: ['distressed'], urgency: 'high',
      confidence: 0.9, surveyAllowed: false, requiresSafetyCheck: false, reasoningSummary: 'distressed',
      reminderRequest: null, dialogueAct: 'request', latestUserSubstance: 'did I answer everything, I cannot do this', topicAnchor: null,
      cycleStatusQuestion: true,
    });
    const repo = repoMocks({ findPendingQuestionClarification: vi.fn().mockResolvedValue(null) });

    await orchestrator(m, repo).orchestrate(INPUT);

    const [, , context] = m.aiProvider.generateResponse.mock.calls[0];
    expect(context.cycleProgress).toBeUndefined();
  });
});

describe('ConversationOrchestrator accepted offers are delivered (GC round 3 CAP-6)', () => {
  const PRIOR_OFFER = 'Lead with the one change you want and name it in the first sentence. If you want, I can give you exact phrases you can say out loud.';

  it('hands an accepted offer to generation as a delivery request even when the classifier labels the turn an acknowledgement', async () => {
    const m = baseMocks();
    const acceptance = 'Yes, a bit more direct please';
    m.conversationRepo.findRecentMessages.mockResolvedValue([
      { id: 'm-ask', ...OWNERSHIP, direction: 'inbound', text: 'How do I give feedback to a senior colleague without it landing wrong?', occurredAt: new Date('2026-09-03T09:58:00.000Z') },
      { id: 'out-offer', ...OWNERSHIP, direction: 'outbound', text: PRIOR_OFFER, occurredAt: new Date('2026-09-03T09:58:05.000Z'), metadata: { sourceInboundMessageId: 'm-ask', replyShape: { askedQuestion: false } } },
      { id: 'm-1', ...OWNERSHIP, direction: 'inbound', text: acceptance, occurredAt: INBOUND_OCCURRED_AT },
    ]);
    m.aiProvider.classifySituation.mockResolvedValue({
      primaryIntent: 'coaching', secondaryIntents: [], emotionalState: [], urgency: 'low',
      confidence: 0.9, surveyAllowed: true, requiresSafetyCheck: false, reasoningSummary: 'accepts the offer',
      reminderRequest: null, dialogueAct: 'acknowledgement', latestUserSubstance: null,
      topicAnchor: 'feedback for the senior colleague',
      priorAssistantOffer: true, acceptsPriorOffer: true, formatRequest: null,
    });
    m.aiProvider.generateResponse.mockResolvedValue({
      text: 'Try: "I want to flag one thing about the review timing: it slipped twice this sprint and I need it by Wednesday."',
      confidence: 0.9, containsSurveyProbe: false,
    });

    const result = await makeOrchestrator(m).orchestrate(INPUT);

    expect(result.responseText).toContain('I want to flag one thing');
    expect(m.aiProvider.generateResponse).toHaveBeenCalledTimes(1);
    const context = m.aiProvider.generateResponse.mock.calls[0][2];
    expect(context.replyPlan?.responseMove).toBe('answer_request');
    expect(context.replyPlan?.requiredGrounding).toEqual([
      expect.objectContaining({ source: 'prior_offer', requirement: 'deliver_now' }),
    ]);
    expect(context.replyPlan?.forbiddenMoves).toContain('offer_again');
    expect(context.replyPlan?.questionPolicy).toEqual({ maxQuestions: 0, reason: 'offer_delivery' });
    // The offer grounding item is not memory; decision metadata must not report memory grounding.
    expect(m.conversationRepo.saveMessage.mock.calls[0][0].metadata.memoryGrounding).toEqual({ used: false, count: 0 });
  });
});

describe('GC round 3 S4b: a rejected corrected statement gets one more clarification, then closes', () => {
  const correctedBundle = (clarificationAttempts: number) => ({
    id: 'bundle-3', tenantId: 't-1', userId: 'u-1', surveyWindowId: 'w-v2', questionGroup: 'autonomy',
    displayedText: 'So the fair version is: you set your own priorities. Right?',
    components: [{ surveyQuestionId: 'q-b', questionVersion: 'v2', statement: 'you set your own priorities' }],
    kind: 'corrected_statement' as const,
    clarificationAttempts,
  });
  const snapshot = (autonomy: string[]) => ({
    surveyWindowId: 'w-v2',
    groups: [
      { questionGroup: 'autonomy', questions: ['q-a', 'q-b', 'q-c'].map((surveyQuestionId, index) => ({ surveyQuestionId, status: autonomy[index]! })) },
      { questionGroup: 'growth', questions: [{ surveyQuestionId: 'q-d', status: 'no_data' }] },
    ],
  });
  const nextClarification = {
    workingInsightId: 'working-b', tenantId: 't-1', userId: 'u-1', surveyWindowId: 'w-v2',
    surveyQuestionId: 'q-b', questionVersion: 'v2', questionGroup: 'autonomy',
    workingSummary: 'I set my own priorities.', disputedStatement: 'you set your own priorities',
    clarificationPromptMessageId: null, clarificationPromptSentAt: null,
  };
  function repoMocks(overrides: Record<string, unknown> = {}) {
    return {
      findAppliedQuestionVerdictForInbound: vi.fn().mockResolvedValue(null),
      findAwaitingQuestionBundle: vi.fn().mockResolvedValue(null),
      applyQuestionBundleVerdict: vi.fn().mockResolvedValue(true),
      findPendingQuestionClarification: vi.fn().mockResolvedValue(null),
      previewPendingQuestionClarificationAfterBundleVerdict: vi.fn().mockResolvedValue(nextClarification),
      previewPendingQuestionClarificationAfterVerdict: vi.fn().mockResolvedValue(null),
      stageQuestionClarificationPrompt: vi.fn().mockResolvedValue(true),
      applyQuestionClarificationVerdict: vi.fn().mockResolvedValue(true),
      hasReadyQuestionBundle: vi.fn().mockResolvedValue(false),
      findReadyQuestionBundle: vi.fn().mockResolvedValue(null),
      stageQuestionConfirmationBundle: vi.fn().mockResolvedValue('bundle-2'),
      stageCorrectedStatementConfirmation: vi.fn().mockResolvedValue('bundle-4'),
      findCycleProgress: vi.fn().mockResolvedValue(snapshot(['confirmed', 'pending_confirmation', 'confirmed'])),
      ...overrides,
    };
  }
  function orchestrator(m: ReturnType<typeof baseMocks>, repo: ReturnType<typeof repoMocks>) {
    return new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
      undefined, undefined, repo,
    );
  }
  function twoPartReplies(m: ReturnType<typeof baseMocks>) {
    m.aiProvider.composeQuestionClarification = vi.fn().mockResolvedValue('What part of it still feels off?');
    m.aiProvider.generateResponse = vi.fn(async (_turns: unknown, _strategy: unknown, context: { trailingBundle?: { text: string } }) => (
      context.trailingBundle
        ? {
            text: `Got it.\n\n${context.trailingBundle.text}`, replyText: 'Got it.', bundleText: context.trailingBundle.text,
            confidence: 0.9, containsSurveyProbe: false,
          }
        : { text: 'reply', confidence: 0.9, containsSurveyProbe: false }));
  }
  const disputedVerdict = { kind: 'partial', acceptedQuestionIds: [], disputedQuestionIds: ['q-b'], declinedQuestionIds: [] };
  const declinedVerdict = { kind: 'partial', acceptedQuestionIds: [], disputedQuestionIds: [], declinedQuestionIds: ['q-b'] };

  it('asks one more clarification instead of wiping the correction when the budget lasts', async () => {
    const m = baseMocks();
    twoPartReplies(m);
    m.aiProvider.interpretQuestionBundleResponse = vi.fn().mockResolvedValue({ kind: 'reject' });
    const repo = repoMocks({ findAwaitingQuestionBundle: vi.fn().mockResolvedValue(correctedBundle(1)) });

    await orchestrator(m, repo).orchestrate(INPUT);

    expect(repo.applyQuestionBundleVerdict).toHaveBeenCalledWith(expect.objectContaining({
      bundleId: 'bundle-3', verdict: disputedVerdict,
    }));
    expect(repo.previewPendingQuestionClarificationAfterBundleVerdict).toHaveBeenCalledWith(expect.objectContaining({
      bundleId: 'bundle-3', disputedQuestionIds: ['q-b'],
    }));
    const [, , context] = m.aiProvider.generateResponse.mock.calls[0];
    expect(context.trailingBundle).toMatchObject({ kind: 'clarification', text: 'What part of it still feels off?' });
    expect(context.questionNotCollected).toBeUndefined();
    expect(context.topicConfirmed).toBeUndefined();
    expect(repo.stageQuestionClarificationPrompt).toHaveBeenCalledWith(expect.objectContaining({
      workingInsightId: 'working-b', promptMessageId: 'out-1',
    }));
  });

  it.each([
    ['a second reject', { kind: 'reject' }],
    ['a second dispute', disputedVerdict],
    ['a skip', declinedVerdict],
  ])('closes the question as not collected on %s once the budget is spent', async (_label, verdict) => {
    const m = baseMocks();
    m.aiProvider.interpretQuestionBundleResponse = vi.fn().mockResolvedValue(verdict);
    m.aiProvider.composeQuestionClarification = vi.fn();
    const repo = repoMocks({ findAwaitingQuestionBundle: vi.fn().mockResolvedValue(correctedBundle(2)) });

    await orchestrator(m, repo).orchestrate(INPUT);

    expect(repo.applyQuestionBundleVerdict).toHaveBeenCalledWith(expect.objectContaining({
      bundleId: 'bundle-3', verdict: declinedVerdict,
    }));
    expect(repo.previewPendingQuestionClarificationAfterBundleVerdict).not.toHaveBeenCalled();
    expect(m.aiProvider.composeQuestionClarification).not.toHaveBeenCalled();
    const [, , context] = m.aiProvider.generateResponse.mock.calls[0];
    expect(context.questionNotCollected).toEqual({ questionGroup: 'autonomy' });
    // The declined statement was the last open one of the topic: completion is stated too.
    expect(context.topicConfirmed).toEqual({ questionGroup: 'autonomy', topicsClosed: 1, topicsTotal: 2 });
    expect(context.trailingBundle).toBeUndefined();
  });

  it('closes as not collected when the adapter does not say how many clarifications were asked', async () => {
    const m = baseMocks();
    m.aiProvider.interpretQuestionBundleResponse = vi.fn().mockResolvedValue({ kind: 'reject' });
    const withoutAttempts: Partial<ReturnType<typeof correctedBundle>> = correctedBundle(1);
    delete withoutAttempts.clarificationAttempts;
    const repo = repoMocks({ findAwaitingQuestionBundle: vi.fn().mockResolvedValue(withoutAttempts) });

    await orchestrator(m, repo).orchestrate(INPUT);

    expect(repo.applyQuestionBundleVerdict).toHaveBeenCalledWith(expect.objectContaining({ verdict: declinedVerdict }));
  });

  it('states the point is not collected when one statement of an ordinary bundle is skipped', async () => {
    const m = baseMocks();
    m.aiProvider.interpretQuestionBundleResponse = vi.fn().mockResolvedValue({
      kind: 'partial', acceptedQuestionIds: ['q-a', 'q-c'], disputedQuestionIds: [], declinedQuestionIds: ['q-b'],
    });
    const ordinary = {
      ...correctedBundle(0), kind: 'confirmation' as const, clarificationAttempts: undefined,
      components: ['q-a', 'q-b', 'q-c'].map((surveyQuestionId) => ({ surveyQuestionId, questionVersion: 'v2', statement: `${surveyQuestionId}.` })),
    };
    const repo = repoMocks({
      findAwaitingQuestionBundle: vi.fn().mockResolvedValue(ordinary),
      findCycleProgress: vi.fn().mockResolvedValue(snapshot(['pending_confirmation', 'pending_confirmation', 'pending_confirmation'])),
    });

    await orchestrator(m, repo).orchestrate(INPUT);

    const [, , context] = m.aiProvider.generateResponse.mock.calls[0];
    expect(context.questionNotCollected).toEqual({ questionGroup: 'autonomy' });
  });

  it('shows a ready corrected meaning with the corrected-statement wording on the ordinary path', async () => {
    const m = baseMocks();
    twoPartReplies(m);
    const corrected = 'I set my own priorities.';
    const shown = `So the corrected version is: ${corrected} Right?`;
    m.aiProvider.composeQuestionBundle = vi.fn().mockResolvedValue({
      text: shown, statements: [{ surveyQuestionId: 'q-b', statement: corrected }],
    });
    const repo = repoMocks({
      findReadyQuestionBundle: vi.fn().mockResolvedValue({
        tenantId: 't-1', userId: 'u-1', surveyWindowId: 'w-v2', questionGroup: 'autonomy', kind: 'corrected_statement',
        questions: [{ surveyQuestionId: 'q-b', questionVersion: 'v2', workingSummary: corrected }],
      }),
    });

    await orchestrator(m, repo).orchestrate(INPUT);

    expect(m.aiProvider.composeQuestionBundle).toHaveBeenCalledWith(
      expect.any(Array), [{ surveyQuestionId: 'q-b', workingSummary: corrected }], 'en', 'corrected_statement',
    );
    const [, , context] = m.aiProvider.generateResponse.mock.calls[0];
    expect(context.trailingBundle).toMatchObject({ kind: 'corrected_statement', text: shown });
    expect(repo.stageQuestionConfirmationBundle).toHaveBeenCalledOnce();
  });

  it('keeps the ordinary bundle reject semantics unchanged', async () => {
    const m = baseMocks();
    m.aiProvider.interpretQuestionBundleResponse = vi.fn().mockResolvedValue({ kind: 'reject' });
    const ordinary = { ...correctedBundle(0), kind: 'confirmation' as const, clarificationAttempts: undefined };
    const repo = repoMocks({ findAwaitingQuestionBundle: vi.fn().mockResolvedValue(ordinary) });

    await orchestrator(m, repo).orchestrate(INPUT);

    expect(repo.applyQuestionBundleVerdict).toHaveBeenCalledWith(expect.objectContaining({ verdict: { kind: 'reject' } }));
    const [, , context] = m.aiProvider.generateResponse.mock.calls[0];
    expect(context.questionNotCollected).toBeUndefined();
  });

  it('states the point is not collected when the employee skips a clarification', async () => {
    const m = baseMocks();
    m.aiProvider.interpretQuestionClarificationResponse = vi.fn().mockResolvedValue({ kind: 'declined' });
    const repo = repoMocks({
      findPendingQuestionClarification: vi.fn().mockResolvedValue({
        ...nextClarification, clarificationPromptMessageId: 'clarify-out',
        clarificationPromptSentAt: new Date('2026-09-03T09:59:00Z'),
      }),
      findCycleProgress: vi.fn().mockResolvedValue(snapshot(['confirmed', 'pending_clarification', 'confirmed'])),
    });

    await orchestrator(m, repo).orchestrate(INPUT);

    const [, , context] = m.aiProvider.generateResponse.mock.calls[0];
    expect(context.questionNotCollected).toEqual({ questionGroup: 'autonomy' });
    expect(context.topicConfirmed).toEqual({ questionGroup: 'autonomy', topicsClosed: 1, topicsTotal: 2 });
  });

  it.each([
    ['bundle', { kind: 'bundle', verdictKind: 'partial', questionGroup: 'autonomy', questionNotCollected: true }],
    ['clarification', { kind: 'clarification', verdictKind: 'declined', questionGroup: 'autonomy', questionNotCollected: true }],
  ])('keeps the not-collected statement on a retried %s turn', async (_label, applied) => {
    const m = baseMocks();
    const repo = repoMocks({
      findAppliedQuestionVerdictForInbound: vi.fn().mockResolvedValue(applied),
      findCycleProgress: vi.fn().mockResolvedValue(snapshot(['confirmed', 'declined', 'confirmed'])),
    });

    await orchestrator(m, repo).orchestrate(INPUT);

    expect(repo.applyQuestionBundleVerdict).not.toHaveBeenCalled();
    const [, , context] = m.aiProvider.generateResponse.mock.calls[0];
    expect(context.questionNotCollected).toEqual({ questionGroup: 'autonomy' });
  });
});

// GC round 3 CAP-1, CAP-2 (T1, T2): the policy decides; a due topic question is required (ADR-013 D4, D8).
describe('GC round 3 CAP-1: topic steering inside an active V2 cycle', () => {
  const at = (minute: number) => new Date(INBOUND_OCCURRED_AT.getTime() + minute * 60_000);
  const disclosure = {
    id: 'disclosure-1', ...OWNERSHIP, direction: 'outbound', text: 'Your reflections can be used in aggregated reporting.',
    occurredAt: at(-10), metadata: { reportingDisclosureVersion: REPORTING_DISCLOSURE_VERSION },
  };
  const inbound = (id: string, minute: number) => ({ id, ...OWNERSHIP, direction: 'inbound', text: `turn ${id}`, occurredAt: at(minute), metadata: undefined });
  const outbound = (id: string, minute: number, metadata: Record<string, unknown> = {}) => ({
    id, ...OWNERSHIP, direction: 'outbound', text: `reply ${id}`, occurredAt: at(minute), metadata,
  });
  const current = inbound('m-1', 0);
  const openSnapshot = {
    surveyWindowId: 'w-v2',
    groups: [
      { questionGroup: 'autonomy', questions: [{ surveyQuestionId: 'q-a1', status: 'collecting' }] },
      { questionGroup: 'growth', questions: [{ surveyQuestionId: 'q-g1', status: 'confirmed' }] },
    ],
  };
  const candidate = {
    question: { id: 'q-a1', questionGroup: 'autonomy', responseType: 'open_ended', probeStrategies: ['How free they are to choose methods'] },
    windowId: 'w-v2',
    focus: 'open',
  };
  const topicReply = {
    text: 'That release sounds tight. How much say do you have over how you plan it?',
    replyText: 'That release sounds tight.', topicQuestion: 'How much say do you have over how you plan it?',
    confidence: 0.9, containsSurveyProbe: true, surveyProbeQuestionId: 'q-a1',
  };

  function setup(messages: unknown[], overrides: { probe?: unknown; snapshot?: unknown; escalation?: unknown } = {}) {
    const m = baseMocks();
    m.conversationRepo.findRecentMessages.mockResolvedValue(messages);
    m.aiProvider.generateResponse.mockResolvedValue(topicReply);
    const pulseBacklog = { getNextProbeQuestion: vi.fn().mockResolvedValue(overrides.probe ?? candidate) };
    const repo = {
      findAppliedQuestionVerdictForInbound: vi.fn().mockResolvedValue(null),
      findAwaitingQuestionBundle: vi.fn().mockResolvedValue(null),
      applyQuestionBundleVerdict: vi.fn().mockResolvedValue(true),
      findPendingQuestionClarification: vi.fn().mockResolvedValue(null),
      stageQuestionClarificationPrompt: vi.fn().mockResolvedValue(true),
      applyQuestionClarificationVerdict: vi.fn().mockResolvedValue(true),
      hasReadyQuestionBundle: vi.fn().mockResolvedValue(false),
      findReadyQuestionBundle: vi.fn().mockResolvedValue(null),
      stageQuestionConfirmationBundle: vi.fn(),
      findCycleProgress: vi.fn().mockResolvedValue(overrides.snapshot === undefined ? openSnapshot : overrides.snapshot),
      recordDriverRequested: vi.fn().mockResolvedValue(true),
    };
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, overrides.escalation as never, m.featureFlags, undefined, pulseBacklog as never,
      undefined, undefined, repo,
    );
    return { m, orch, pulseBacklog, repo };
  }
  const lastContext = (m: ReturnType<typeof baseMocks>) => m.aiProvider.generateResponse.mock.calls.at(-1)[2];
  const savedOutbound = (m: ReturnType<typeof baseMocks>) => m.conversationRepo.saveMessage.mock.calls
    .map((call: [{ direction: string; metadata?: Record<string, unknown>; text: string }]) => call[0])
    .find((message: { direction: string }) => message.direction === 'outbound');

  it('three turns after disclosure with no topic yet, the reply carries the required topic question', async () => {
    const { m, orch } = setup([
      disclosure, inbound('m-a', -8), outbound('o-a', -7), inbound('m-b', -6), outbound('o-b', -5), current,
    ]);

    const result = await orch.orchestrate(INPUT);

    const context = lastContext(m);
    expect(context.topicQuestion).toEqual({
      questionId: 'q-a1', questionGroup: 'autonomy', focus: 'open',
      probeStrategies: ['How free they are to choose methods'],
    });
    expect(context.surveyProbeQuestion).toBeUndefined();
    expect(context.replyPlan.questionPolicy).toEqual({ maxQuestions: 1, reason: 'topic_question' });
    expect(context.replyPlan.forbiddenMoves).not.toContain('survey_probe');
    expect(result.responseText).toBe(topicReply.text);
    expect(savedOutbound(m).metadata).toMatchObject({
      containsSurveyProbe: true, surveyProbeQuestionId: 'q-a1',
      topicQuestion: { questionGroup: 'autonomy', focus: 'open', policyVersion: 'topic-question-v1' },
    });
  });

  it('two turns after disclosure: no topic question and no optional probe hint inside a V2 window', async () => {
    const { m, orch } = setup([disclosure, inbound('m-a', -8), outbound('o-a', -7), current]);

    await orch.orchestrate(INPUT);

    const context = lastContext(m);
    expect(context.topicQuestion).toBeUndefined();
    expect(context.surveyProbeQuestion).toBeUndefined();
    expect(savedOutbound(m).metadata).toMatchObject({ containsSurveyProbe: false, topicQuestionDecision: 'cadence_not_reached' });
  });

  it('a completed topic opens the next topic on the next eligible turn', async () => {
    const { m, orch } = setup([
      disclosure, inbound('m-a', -8), outbound('o-a', -7, { containsSurveyProbe: true }), inbound('m-b', -6),
      outbound('o-b', -5, { topicCompleted: 'growth' }), current,
    ]);

    await orch.orchestrate(INPUT);

    expect(lastContext(m).topicQuestion).toMatchObject({ questionId: 'q-a1', questionGroup: 'autonomy' });
  });

  it('asks for the driver when the next question holds a status without one (CAP-2)', async () => {
    const { m, orch } = setup([
      disclosure, inbound('m-a', -8), outbound('o-a', -7), inbound('m-b', -6), outbound('o-b', -5), current,
    ], { probe: { ...candidate, focus: 'driver' } });

    await orch.orchestrate(INPUT);

    expect(lastContext(m).topicQuestion).toMatchObject({ questionId: 'q-a1', focus: 'driver' });
  });

  it('a safety turn carries no topic question', async () => {
    const { m, orch } = setup([
      disclosure, inbound('m-a', -8), outbound('o-a', -7), inbound('m-b', -6), outbound('o-b', -5), current,
    ]);
    m.aiProvider.detectRisk.mockResolvedValue({
      ...NO_RISK, riskType: 'burnout', severity: 'high', confidence: 0.9, surveyMustBeBlocked: true,
    });
    m.aiProvider.generateResponse.mockResolvedValue({ text: 'I am here with you.', confidence: 0.9, containsSurveyProbe: false });

    await orch.orchestrate(INPUT);

    expect(lastContext(m).topicQuestion).toBeUndefined();
    expect(lastContext(m).surveyProbeQuestion).toBeUndefined();
  });

  it('no active V2 window keeps the legacy optional probe', async () => {
    const { m, orch } = setup([
      disclosure, inbound('m-a', -8), outbound('o-a', -7), inbound('m-b', -6), outbound('o-b', -5), current,
    ], { snapshot: null });
    m.aiProvider.generateResponse.mockResolvedValue({ text: 'reply', confidence: 0.9, containsSurveyProbe: false });

    await orch.orchestrate(INPUT);

    expect(lastContext(m).topicQuestion).toBeUndefined();
    expect(lastContext(m).surveyProbeQuestion).toMatchObject({ id: 'q-a1' });
  });

  it('when the topic rail fails after its repair, replies without the topic and records why', async () => {
    const { m, orch } = setup([
      disclosure, inbound('m-a', -8), outbound('o-a', -7), inbound('m-b', -6), outbound('o-b', -5), current,
    ]);
    m.aiProvider.generateResponse
      .mockRejectedValueOnce(new TopicQuestionReplyInvalidError('question_count'))
      .mockResolvedValueOnce({ text: 'That release sounds tight.', confidence: 0.9, containsSurveyProbe: false });

    const result = await orch.orchestrate(INPUT);

    expect(m.aiProvider.generateResponse).toHaveBeenCalledTimes(2);
    expect(m.aiProvider.generateResponse.mock.calls[1][2].topicQuestion).toBeUndefined();
    expect(result.responseText).toBe('That release sounds tight.');
    expect(savedOutbound(m).metadata).toMatchObject({
      containsSurveyProbe: false, topicQuestionFallbackReason: 'question_count',
    });
  });

  it('records that the driver was asked, so it is asked at most once (CAP-2)', async () => {
    const { m, orch, repo } = setup([
      disclosure, inbound('m-a', -8), outbound('o-a', -7), inbound('m-b', -6), outbound('o-b', -5), current,
    ], { probe: { ...candidate, focus: 'driver' } });

    await orch.orchestrate(INPUT);

    expect(repo.recordDriverRequested).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 't-1', userId: 'u-1', surveyWindowId: 'w-v2', surveyQuestionId: 'q-a1',
    }));
    expect(lastContext(m).topicQuestion.focus).toBe('driver');
  });

  it('does not record a driver request when the topic fell back', async () => {
    const { m, orch, repo } = setup([
      disclosure, inbound('m-a', -8), outbound('o-a', -7), inbound('m-b', -6), outbound('o-b', -5), current,
    ], { probe: { ...candidate, focus: 'driver' } });
    m.aiProvider.generateResponse
      .mockRejectedValueOnce(new TopicQuestionReplyInvalidError('question_count'))
      .mockResolvedValueOnce({ text: 'Noted.', confidence: 0.9, containsSurveyProbe: false });

    await orch.orchestrate(INPUT);

    expect(repo.recordDriverRequested).not.toHaveBeenCalled();
  });

  it('falls back with the original question policy, not the forced topic allowance', async () => {
    const { m, orch } = setup([
      disclosure, inbound('m-a', -8), outbound('o-a', -7), inbound('m-b', -6), outbound('o-b', -5), current,
    ]);
    m.aiProvider.generateResponse
      .mockRejectedValueOnce(new TopicQuestionReplyInvalidError('reply_question'))
      .mockResolvedValueOnce({ text: 'Noted.', confidence: 0.9, containsSurveyProbe: false });

    await orch.orchestrate(INPUT);

    const fallback = m.aiProvider.generateResponse.mock.calls[1];
    expect(fallback[2].replyPlan.questionPolicy).toEqual({ maxQuestions: 1, reason: 'new_substance_allows_question' });
    expect(fallback[2].replyBrief.questionPolicy.reason).toBe('new_substance_allows_question');
  });

  it('stops at three topic questions in 24 hours using the durable count', async () => {
    const { m, orch } = setup([
      disclosure, inbound('m-a', -8), outbound('o-a', -7), inbound('m-b', -6), outbound('o-b', -5), current,
    ]);
    m.conversationRepo.countTopicQuestionsSince = vi.fn().mockResolvedValue(3);

    await orch.orchestrate(INPUT);

    expect(m.conversationRepo.countTopicQuestionsSince).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 't-1', conversationId: 'c-1',
    }));
    expect(lastContext(m).topicQuestion).toBeUndefined();
    expect(lastContext(m).surveyProbeQuestion).toBeUndefined();
    expect(savedOutbound(m).metadata).toMatchObject({ topicQuestionDecision: 'daily_cap_reached' });
  });

  it('keeps the legacy probe when every V2 topic is already closed', async () => {
    const { m, orch } = setup([
      disclosure, inbound('m-a', -8), outbound('o-a', -7), inbound('m-b', -6), outbound('o-b', -5), current,
    ], { snapshot: { surveyWindowId: 'w-v2', groups: [
      { questionGroup: 'autonomy', questions: [{ surveyQuestionId: 'q-a1', status: 'confirmed' }] },
    ] } });
    m.aiProvider.generateResponse.mockResolvedValue({ text: 'reply', confidence: 0.9, containsSurveyProbe: false });

    await orch.orchestrate(INPUT);

    expect(lastContext(m).topicQuestion).toBeUndefined();
    expect(lastContext(m).surveyProbeQuestion).toMatchObject({ id: 'q-a1' });
  });

  it('escalates a risk turn before a failed cycle lookup fails the turn', async () => {
    const escalation = { raise: vi.fn() };
    const { m, orch, repo } = setup([
      disclosure, inbound('m-a', -8), outbound('o-a', -7), inbound('m-b', -6), outbound('o-b', -5), current,
    ], { escalation });
    repo.findCycleProgress.mockRejectedValue(new Error('v2_multiple_active_survey_windows'));
    m.aiProvider.detectRisk.mockResolvedValue({
      ...NO_RISK, riskType: 'potential_self_harm', severity: 'critical', confidence: 0.95,
      immediateResponseRequired: true, escalationRecommended: true, surveyMustBeBlocked: true,
    });

    await expect(orch.orchestrate(INPUT)).rejects.toThrow('v2_multiple_active_survey_windows');
    expect(escalation.raise).toHaveBeenCalledOnce();
  });

  it('marks the completion reply so the next turn can open the next topic', async () => {
    const m = baseMocks();
    m.aiProvider.interpretQuestionBundleResponse = vi.fn().mockResolvedValue({ kind: 'agree' });
    const repo = {
      findAppliedQuestionVerdictForInbound: vi.fn().mockResolvedValue(null),
      findAwaitingQuestionBundle: vi.fn().mockResolvedValue({
        id: 'bundle-1', tenantId: 't-1', userId: 'u-1', surveyWindowId: 'w-v2', questionGroup: 'autonomy',
        displayedText: 'Is that fair?',
        components: [{ surveyQuestionId: 'q-a1', questionVersion: 'v2', statement: 'You choose methods.' }],
      }),
      applyQuestionBundleVerdict: vi.fn().mockResolvedValue(true),
      findPendingQuestionClarification: vi.fn().mockResolvedValue(null),
      stageQuestionClarificationPrompt: vi.fn(),
      applyQuestionClarificationVerdict: vi.fn(),
      hasReadyQuestionBundle: vi.fn().mockResolvedValue(false),
      findReadyQuestionBundle: vi.fn().mockResolvedValue(null),
      stageQuestionConfirmationBundle: vi.fn(),
      findCycleProgress: vi.fn().mockResolvedValue({
        surveyWindowId: 'w-v2',
        groups: [
          { questionGroup: 'autonomy', questions: [{ surveyQuestionId: 'q-a1', status: 'pending_confirmation' }] },
          { questionGroup: 'growth', questions: [{ surveyQuestionId: 'q-g1', status: 'collecting' }] },
        ],
      }),
    };
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, { getNextProbeQuestion: vi.fn().mockResolvedValue(candidate) } as never,
      undefined, undefined, repo,
    );

    await orch.orchestrate(INPUT);

    expect(lastContext(m).topicQuestion).toBeUndefined();
    expect(savedOutbound(m).metadata).toMatchObject({ topicCompleted: 'autonomy' });
  });
});
