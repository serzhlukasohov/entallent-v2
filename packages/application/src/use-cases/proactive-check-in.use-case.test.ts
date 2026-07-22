import { describe, it, expect, vi } from 'vitest';
import { ProactiveCheckInUseCase } from './proactive-check-in.use-case';
import { PulseBacklogService } from '../services/pulse-backlog.service';
import type { AiProviderPort } from '../ports/ai-provider.port';
import type { ConversationRepositoryPort } from '../ports/conversation.repository.port';
import type { OutboxPort } from '../ports/outbox.port';
import type { SurveyQuestionRecord } from '../types/records';

function makeQuestion(): SurveyQuestionRecord {
  return {
    id: 'q-1',
    surveyDefinitionId: 'def-1',
    stableKey: 'q12_expectations',
    title: 'Clear Expectations',
    canonicalMeaning: 'Does the employee know what is expected?',
    dimension: 'engagement',
    questionGroup: 'autonomy',
    displayOrder: 10,
    positiveIndicators: [],
    negativeIndicators: [],
    probeStrategies: ['Ask about their OKRs'],
    contraindications: [],
    confidenceThreshold: 0.72,
    completenessThreshold: 0.65,
    minimumEvidenceCount: 2,
    cooldownDays: 14,
    maxFollowUpProbes: 3,
    responseType: 'open_ended',
    version: '1',
  };
}

function makeConversationRepo(
  overrides: Partial<ConversationRepositoryPort> = {},
): ConversationRepositoryPort {
  return {
    findById: vi.fn().mockResolvedValue({
      id: 'c-1',
      tenantId: 't-1',
      userId: 'u-1',
      channelType: 'slack',
      externalConversationId: 'ext-c-1',
      status: 'active',
      userDisplayName: 'Alex',
    }),
    findRecentMessages: vi.fn().mockResolvedValue([
      { id: 'm-1', direction: 'inbound', text: 'Hello', occurredAt: new Date(), conversationId: 'c-1', tenantId: 't-1', userId: 'u-1', createdAt: new Date() },
    ]),
    saveMessage: vi.fn().mockResolvedValue({ id: 'out-1', conversationId: 'c-1', tenantId: 't-1', userId: 'u-1', direction: 'outbound', text: 'Hi Alex!', occurredAt: new Date(), createdAt: new Date() }),
    findMessageById: vi.fn(),
    findConversationByExternal: vi.fn(),
    ...overrides,
  } as unknown as ConversationRepositoryPort;
}

function makeAiProvider(containsSurveyProbe = false, probeQuestionId: string | null = null): AiProviderPort {
  return {
    generateResponse: vi.fn().mockResolvedValue({
      text: 'Hey Alex, how are things going with your team goals?',
      containsSurveyProbe,
      surveyProbeQuestionId: probeQuestionId,
    }),
    evaluateSurveyEvidence: vi.fn(),
    generateGroupSummary: vi.fn(),
    classifyIntent: vi.fn(),
    extractMemory: vi.fn(),
    detectRisk: vi.fn(),
  } as unknown as AiProviderPort;
}

function makeOutbox(): OutboxPort {
  return {
    enqueueMessageSend: vi.fn().mockResolvedValue(undefined),
    enqueueMemoryExtraction: vi.fn(),
    enqueueFollowUpExecution: vi.fn(),
    enqueueSurveyEvidence: vi.fn(),
    enqueueGroupConfirmation: vi.fn(),
    enqueueGroupReport: vi.fn(),
  };
}

function makePulseBacklogService(
  question: SurveyQuestionRecord | null = makeQuestion(),
): PulseBacklogService {
  return {
    getNextProbeQuestion: vi.fn().mockResolvedValue(
      question ? { question, windowId: 'w-1' } : null,
    ),
    recordProbeSent: vi.fn().mockResolvedValue(undefined),
    markQuestionCovered: vi.fn().mockResolvedValue(undefined),
  } as unknown as PulseBacklogService;
}

const BASE_INPUT = {
  conversationId: 'c-1',
  userId: 'u-1',
  tenantId: 't-1',
  externalWorkspaceId: 'ws-1',
  externalConversationId: 'ext-c-1',
  traceId: 'trace-1',
};

describe('ProactiveCheckInUseCase', () => {
  it('returns a result with the outbound message', async () => {
    const useCase = new ProactiveCheckInUseCase(
      makeConversationRepo(),
      makeAiProvider(),
      makeOutbox(),
      undefined,
      makePulseBacklogService(),
    );

    const result = await useCase.execute(BASE_INPUT);

    expect(result.outboundMessageId).toBe('out-1');
    expect(result.responseText).toContain('Hey Alex');
  });

  it('passes probeQuestion to AI when backlog returns a question', async () => {
    const ai = makeAiProvider();
    const useCase = new ProactiveCheckInUseCase(
      makeConversationRepo(),
      ai,
      makeOutbox(),
      undefined,
      makePulseBacklogService(makeQuestion()),
    );

    await useCase.execute(BASE_INPUT);

    const generateCall = (ai.generateResponse as ReturnType<typeof vi.fn>).mock.calls[0];
    const context = generateCall[2];
    expect(context.proactiveCheckIn.probeQuestion).toMatchObject({
      id: 'q-1',
      probeStrategies: ['Ask about their OKRs'],
    });
  });

  it('passes null probeQuestion to AI when backlog returns null', async () => {
    const ai = makeAiProvider();
    const useCase = new ProactiveCheckInUseCase(
      makeConversationRepo(),
      ai,
      makeOutbox(),
      undefined,
      makePulseBacklogService(null),
    );

    await useCase.execute(BASE_INPUT);

    const context = (ai.generateResponse as ReturnType<typeof vi.fn>).mock.calls[0][2];
    expect(context.proactiveCheckIn.probeQuestion).toBeUndefined();
  });

  it('calls recordProbeSent when AI embeds a probe', async () => {
    const service = makePulseBacklogService(makeQuestion());
    const useCase = new ProactiveCheckInUseCase(
      makeConversationRepo(),
      makeAiProvider(true, 'q-1'),
      makeOutbox(),
      undefined,
      service,
    );

    await useCase.execute(BASE_INPUT);

    expect(service.recordProbeSent).toHaveBeenCalledWith('u-1', 'w-1', 'q-1', expect.any(Date));
  });

  it('does NOT call recordProbeSent when AI did not embed a probe', async () => {
    const service = makePulseBacklogService(makeQuestion());
    const useCase = new ProactiveCheckInUseCase(
      makeConversationRepo(),
      makeAiProvider(false, null),
      makeOutbox(),
      undefined,
      service,
    );

    await useCase.execute(BASE_INPUT);

    expect(service.recordProbeSent).not.toHaveBeenCalled();
  });

  it('skips probe question on first contact (no messages, no memory)', async () => {
    const convRepo = makeConversationRepo({
      findRecentMessages: vi.fn().mockResolvedValue([]),
    });
    const service = makePulseBacklogService(makeQuestion());
    const useCase = new ProactiveCheckInUseCase(
      convRepo,
      makeAiProvider(),
      makeOutbox(),
      undefined,
      service,
    );

    await useCase.execute(BASE_INPUT);

    expect(service.getNextProbeQuestion).not.toHaveBeenCalled();
  });

  it('works when pulseBacklogService is not provided', async () => {
    const useCase = new ProactiveCheckInUseCase(
      makeConversationRepo(),
      makeAiProvider(),
      makeOutbox(),
    );

    const result = await useCase.execute(BASE_INPUT);
    expect(result.outboundMessageId).toBe('out-1');
  });
});
