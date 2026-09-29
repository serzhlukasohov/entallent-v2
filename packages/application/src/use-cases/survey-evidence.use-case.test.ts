import { describe, it, expect, vi } from 'vitest';
import { SurveyEvidenceExtractionUseCase } from './survey-evidence.use-case';
import { PulseBacklogService } from '../services/pulse-backlog.service';
import type { AiProviderPort } from '../ports/ai-provider.port';
import type { ConversationRepositoryPort } from '../ports/conversation.repository.port';
import type { SurveyRepositoryPort } from '../ports/survey.repository.port';
import type { QuestionWorkingCapturePort } from '../ports/question-working-capture.port';
import type { SurveyQuestionRecord, SurveyWindowRecord, SurveyEvidenceRecord } from '../types/records';

function makeWindow(overrides: Partial<SurveyWindowRecord> = {}): SurveyWindowRecord {
  return {
    id: 'w-1', tenantId: 't-1', userId: 'u-1', surveyDefinitionId: 'def-1',
    periodType: 'quarter',
    periodStart: new Date(Date.now() - 7 * 86_400_000),
    periodEnd: new Date(Date.now() + 7 * 86_400_000),
    status: 'active',
    ...overrides,
  };
}

function makeQuestion(id = 'q-1', group = 'autonomy', overrides: Partial<SurveyQuestionRecord> = {}): SurveyQuestionRecord {
  return {
    id, surveyDefinitionId: 'def-1', stableKey: 'q12_expectations', title: 'Clear Expectations',
    canonicalMeaning: 'Does the employee know?', dimension: 'engagement', questionGroup: group,
    displayOrder: 10, positiveIndicators: ['knows goals'], negativeIndicators: ['confused'],
    probeStrategies: [], contraindications: [], confidenceThreshold: 0.72,
    completenessThreshold: 0.65, minimumEvidenceCount: 2, cooldownDays: 14,
    maxFollowUpProbes: 3, responseType: 'open_ended', version: '1',
    ...overrides,
  };
}

function makeEvidence(): SurveyEvidenceRecord {
  return {
    id: 'ev-1', surveyWindowId: 'w-1', surveyQuestionId: 'q-1', userId: 'u-1',
    sourceMessageIds: ['m-1'], evidenceSummary: 'Knows their goals clearly', polarity: 'positive',
    strength: 0.8, completeness: 0.75, confidence: 0.85, evaluatorVersion: 'v1',
    promptVersion: 'v1', createdAt: new Date(),
  };
}

/** confidence/completeness values that produce each status via computeAssessmentStatus */
const EVIDENCE_BY_STATUS: Record<string, { confidence: number; completeness: number; strength: number }> = {
  scored:            { strength: 0.8, completeness: 0.75, confidence: 0.85 },
  covered:           { strength: 0.8, completeness: 0.75, confidence: 0.85 },
  partially_covered: { strength: 0.6, completeness: 0.5,  confidence: 0.6  },
  insufficient_evidence: { strength: 0.6, completeness: 0.2, confidence: 0.6 },
};

function makeAi(status: string, numericValue?: number, voluntaryReopenQuestionIds: string[] = []): AiProviderPort {
  const vals = EVIDENCE_BY_STATUS[status] ?? EVIDENCE_BY_STATUS['scored'];
  return {
    evaluateSurveyEvidence: vi.fn().mockResolvedValue({
      voluntaryReopenQuestionIds,
      evidence: [{
        questionId: 'q-1', evidenceSummary: 'Knows their goals clearly',
        polarity: 'positive', strength: vals.strength, completeness: vals.completeness,
        confidence: vals.confidence, assessmentShouldRemainUnknown: false, numericValue,
      }],
    }),
    generateResponse: vi.fn(),
    generateGroupSummary: vi.fn().mockResolvedValue({ summary: 'Good clarity on expectations.' }),
    classifyIntent: vi.fn(),
    extractMemory: vi.fn(),
    detectRisk: vi.fn(),
  } as unknown as AiProviderPort;
}

function makeSurveyRepo(assessmentStatus: string): SurveyRepositoryPort {
  return {
    findOrCreateActiveWindow: vi.fn().mockResolvedValue(makeWindow()),
    findQuestionsForWindow: vi.fn().mockResolvedValue([makeQuestion()]),
    saveEvidence: vi.fn().mockResolvedValue(makeEvidence()),
    markEvidenceSuperseded: vi.fn().mockResolvedValue(undefined),
    upsertAssessment: vi.fn().mockResolvedValue(undefined),
    findEvidenceForQuestion: vi.fn().mockResolvedValue([makeEvidence()]),
    findAssessmentsForWindow: vi.fn().mockResolvedValue([
      { surveyQuestionId: 'q-1', status: assessmentStatus, score: null },
    ]),
    findGroupState: vi.fn().mockResolvedValue(null),
    findPendingConfirmationGroups: vi.fn().mockResolvedValue([]),
    upsertGroupState: vi.fn().mockResolvedValue({}),
    findConfirmedGroupStates: vi.fn().mockResolvedValue([]),
    findTeamByMemberId: vi.fn().mockResolvedValue(null),
    findTeamById: vi.fn().mockResolvedValue(null),
  } as unknown as SurveyRepositoryPort;
}

function makeConversationRepo(): ConversationRepositoryPort {
  return {
    findRecentMessages: vi.fn().mockResolvedValue([
      { id: 'm-1', direction: 'inbound', text: 'I know exactly what my OKRs are', occurredAt: new Date(), conversationId: 'c-1', tenantId: 't-1', userId: 'u-1', createdAt: new Date() },
    ]),
    findById: vi.fn().mockResolvedValue({
      id: 'c-1', tenantId: 't-1', userId: 'u-1', channelType: 'dev',
      externalConversationId: 'ec-1', status: 'active',
    }),
    saveMessage: vi.fn(),
    findMessageById: vi.fn(),
    findConversationByExternal: vi.fn(),
  } as unknown as ConversationRepositoryPort;
}

function makeNumericConversationRepo(text: string, questionId = 'q-1'): ConversationRepositoryPort {
  const occurredAt = new Date();
  return {
    ...makeConversationRepo(),
    findRecentMessages: vi.fn().mockResolvedValue([
      {
        id: 'm-probe', direction: 'outbound', text: 'Rate this from 0 to 10?', occurredAt,
        conversationId: 'c-1', tenantId: 't-1', userId: 'u-1', createdAt: occurredAt,
        metadata: { containsSurveyProbe: true, surveyProbeQuestionId: questionId },
      },
      {
        id: 'm-1', direction: 'inbound', text, occurredAt,
        conversationId: 'c-1', tenantId: 't-1', userId: 'u-1', createdAt: occurredAt,
      },
    ]),
  } as unknown as ConversationRepositoryPort;
}

function makePulseService(): PulseBacklogService {
  return {
    getNextProbeQuestion: vi.fn(),
    recordProbeSent: vi.fn(),
    markQuestionCovered: vi.fn().mockResolvedValue(undefined),
  } as unknown as PulseBacklogService;
}

const BASE_INPUT = { conversationId: 'c-1', userId: 'u-1', tenantId: 't-1', inboundMessageId: 'm-1' };

describe('SurveyEvidenceExtractionUseCase', () => {
  it('rejects another employee in the queued scope before reading history or calling AI', async () => {
    const ai = makeAi('covered');
    const conversationRepo = makeConversationRepo();
    const surveyRepo = makeSurveyRepo('covered');
    const useCase = new SurveyEvidenceExtractionUseCase(ai, conversationRepo, surveyRepo);

    await expect(useCase.execute({ ...BASE_INPUT, userId: 'u-other' }))
      .rejects.toThrow('survey_evidence_conversation_scope_mismatch');
    expect(conversationRepo.findRecentMessages).not.toHaveBeenCalled();
    expect(surveyRepo.findOrCreateActiveWindow).not.toHaveBeenCalled();
    expect(ai.evaluateSurveyEvidence).not.toHaveBeenCalled();
  });

  it('does not evaluate a queued source message absent from the owned history', async () => {
    const ai = makeAi('covered');
    const conversationRepo = makeConversationRepo();
    const surveyRepo = makeSurveyRepo('covered');
    const useCase = new SurveyEvidenceExtractionUseCase(ai, conversationRepo, surveyRepo);

    await useCase.execute({ ...BASE_INPUT, inboundMessageId: 'missing-source' });
    expect(surveyRepo.findOrCreateActiveWindow).not.toHaveBeenCalled();
    expect(ai.evaluateSurveyEvidence).not.toHaveBeenCalled();
  });

  it('bounds a delayed live evaluation to its source message', async () => {
    const ai = makeAi('covered');
    const conversationRepo = makeConversationRepo();
    const time = new Date('2026-09-29T12:00:00.000Z');
    const message = (id: string, direction: 'inbound' | 'outbound', text: string) => ({
      id, conversationId: 'c-1', tenantId: 't-1', userId: 'u-1', direction, text,
      occurredAt: time, createdAt: time,
    });
    vi.mocked(conversationRepo.findRecentMessages).mockResolvedValue([
      message('m-probe', 'outbound', 'How clear are your goals?'),
      message('m-1', 'inbound', 'My goals are clear.'),
      message('m-reply', 'outbound', 'Thanks for sharing.'),
      message('m-newer', 'inbound', 'My goals have changed.'),
    ]);
    const questionCapture = {
      getWindowMode: vi.fn().mockResolvedValue('v2'),
      captureMeaning: vi.fn().mockResolvedValue('captured'),
    } as unknown as QuestionWorkingCapturePort;

    await new SurveyEvidenceExtractionUseCase(
      ai, conversationRepo, makeSurveyRepo('covered'), makePulseService(), questionCapture,
    ).execute(BASE_INPUT);

    expect(ai.evaluateSurveyEvidence).toHaveBeenCalledWith([
      { role: 'assistant', content: 'How clear are your goals?', timestamp: time },
      { role: 'user', content: 'My goals are clear.', timestamp: time },
    ], expect.anything(), { focusLatestEmployeeMessage: true });
    expect(questionCapture.captureMeaning).toHaveBeenCalledWith(expect.objectContaining({
      sourceMessageId: 'm-1',
    }));
  });

  it('captures a delayed source even when newer turns displace it from recent history', async () => {
    const ai = makeAi('covered');
    const conversationRepo = makeConversationRepo();
    const time = new Date('2026-09-29T12:00:00.000Z');
    const source = {
      id: 'm-1', conversationId: 'c-1', tenantId: 't-1', userId: 'u-1',
      direction: 'inbound' as const, text: 'My goals are clear.', occurredAt: time, createdAt: time,
    };
    const newer = { ...source, id: 'm-newer', text: 'A later turn.' };
    vi.mocked(conversationRepo.findRecentMessages).mockResolvedValue([newer]);
    conversationRepo.findMessagesThrough = vi.fn().mockResolvedValue([source]);
    const questionCapture = {
      getWindowMode: vi.fn().mockResolvedValue('v2'),
      captureMeaning: vi.fn().mockResolvedValue('captured'),
    } as unknown as QuestionWorkingCapturePort;

    await new SurveyEvidenceExtractionUseCase(
      ai, conversationRepo, makeSurveyRepo('covered'), makePulseService(), questionCapture,
    ).execute(BASE_INPUT);

    expect(conversationRepo.findMessagesThrough).toHaveBeenCalledWith({ ...BASE_INPUT, limit: 15 });
    expect(conversationRepo.findRecentMessages).not.toHaveBeenCalled();
    expect(ai.evaluateSurveyEvidence).toHaveBeenCalledWith(
      [{ role: 'user', content: source.text, timestamp: time }],
      expect.anything(), { focusLatestEmployeeMessage: true },
    );
    expect(questionCapture.captureMeaning).toHaveBeenCalledWith(expect.objectContaining({
      sourceMessageId: source.id,
    }));
  });

  it('rejects a mismatched message in the history before model evaluation', async () => {
    const ai = makeAi('covered');
    const conversationRepo = makeConversationRepo();
    const surveyRepo = makeSurveyRepo('covered');
    vi.mocked(conversationRepo.findRecentMessages).mockResolvedValue([{
      id: 'm-1', conversationId: 'c-1', tenantId: 't-1', userId: 'u-other',
      direction: 'inbound', text: 'private text', occurredAt: new Date(), createdAt: new Date(),
    }]);

    await expect(new SurveyEvidenceExtractionUseCase(ai, conversationRepo, surveyRepo)
      .execute(BASE_INPUT)).rejects.toThrow('survey_evidence_message_scope_mismatch');
    expect(surveyRepo.findOrCreateActiveWindow).not.toHaveBeenCalled();
    expect(ai.evaluateSurveyEvidence).not.toHaveBeenCalled();
  });

  it('rejects a backfill for another employee before reading conversation history', async () => {
    const ai = makeAi('covered');
    const conversationRepo = makeConversationRepo();
    const surveyRepo = makeSurveyRepo('covered');
    const useCase = new SurveyEvidenceExtractionUseCase(ai, conversationRepo, surveyRepo);

    await expect(useCase.backfill({ conversationId: 'c-1', tenantId: 't-1', userId: 'u-other' }))
      .rejects.toThrow('survey_evidence_conversation_scope_mismatch');
    expect(conversationRepo.findRecentMessages).not.toHaveBeenCalled();
    expect(surveyRepo.findOrCreateActiveWindow).not.toHaveBeenCalled();
    expect(ai.evaluateSurveyEvidence).not.toHaveBeenCalled();
  });

  it('captures open-ended V2 meaning without writing V1 evidence or assessments', async () => {
    const surveyRepo = makeSurveyRepo('insufficient_evidence');
    const ai = makeAi('covered');
    const questionCapture = {
      getWindowMode: vi.fn().mockResolvedValue('v2'),
      captureMeaning: vi.fn().mockResolvedValue('captured'),
    } as unknown as QuestionWorkingCapturePort;
    const useCase = new SurveyEvidenceExtractionUseCase(
      ai, makeConversationRepo(), surveyRepo, makePulseService(), questionCapture,
    );

    await useCase.execute(BASE_INPUT);

    expect(ai.evaluateSurveyEvidence).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), { focusLatestEmployeeMessage: true },
    );

    expect(questionCapture.captureMeaning).toHaveBeenCalledWith(expect.objectContaining({
      surveyWindowId: 'w-1', surveyQuestionId: 'q-1', questionVersion: '1',
      sourceMessageId: 'm-1', meaning: 'Knows their goals clearly',
      sufficientMeaning: true,
    }));
    expect(surveyRepo.saveEvidence).not.toHaveBeenCalled();
    expect(surveyRepo.upsertAssessment).not.toHaveBeenCalled();
    expect(surveyRepo.upsertGroupState).not.toHaveBeenCalled();
  });

  it('evaluates V2 evidence before writes and rejects changed source history', async () => {
    const conversationRepo = makeConversationRepo();
    const surveyRepo = makeSurveyRepo('insufficient_evidence');
    const ai = makeAi('covered');
    const questionCapture = {
      getWindowMode: vi.fn().mockResolvedValue('v2'),
      captureMeaning: vi.fn().mockResolvedValue('captured'),
    } as unknown as QuestionWorkingCapturePort;
    const useCase = new SurveyEvidenceExtractionUseCase(
      ai, conversationRepo, surveyRepo, undefined, questionCapture,
    );
    const prepared = await useCase.prepare(BASE_INPUT);
    expect(prepared?.mode).toBe('v2');
    expect(ai.evaluateSurveyEvidence).toHaveBeenCalledOnce();
    expect(questionCapture.captureMeaning).not.toHaveBeenCalled();
    await useCase.apply(BASE_INPUT, prepared!);
    expect(ai.evaluateSurveyEvidence).toHaveBeenCalledOnce();
    expect(questionCapture.captureMeaning).toHaveBeenCalledOnce();

    const original = await conversationRepo.findRecentMessages('c-1', 15);
    vi.mocked(conversationRepo.findRecentMessages).mockResolvedValue([
      { ...original[0]!, text: 'Edited source after model evaluation' },
    ]);
    await expect(useCase.apply(BASE_INPUT, prepared!))
      .rejects.toThrow('survey_evidence_prepared_history_changed');
    expect(questionCapture.captureMeaning).toHaveBeenCalledOnce();
  });

  it('excludes older employee statements from a new V2 evidence evaluation', async () => {
    const conversationRepo = makeConversationRepo();
    const time = new Date('2026-09-29T12:00:00.000Z');
    const message = (id: string, direction: 'inbound' | 'outbound', text: string) => ({
      id, conversationId: 'c-1', tenantId: 't-1', userId: 'u-1', direction, text,
      occurredAt: time, createdAt: time,
    });
    vi.mocked(conversationRepo.findRecentMessages).mockResolvedValue([
      message('m-old', 'inbound', 'My goals at work are very clear.'),
      message('m-transition', 'outbound', 'What would you like to discuss now?'),
      message('m-1', 'inbound', 'Can you tell me the weather today?'),
    ]);
    const ai = makeAi('covered');
    const questionCapture = {
      getWindowMode: vi.fn().mockResolvedValue('v2'),
      captureMeaning: vi.fn().mockResolvedValue('captured'),
    } as unknown as QuestionWorkingCapturePort;

    await new SurveyEvidenceExtractionUseCase(
      ai, conversationRepo, makeSurveyRepo('covered'), makePulseService(), questionCapture,
    ).execute(BASE_INPUT);

    expect(ai.evaluateSurveyEvidence).toHaveBeenCalledWith([
      { role: 'assistant', content: 'What would you like to discuss now?', timestamp: time },
      { role: 'user', content: 'Can you tell me the weather today?', timestamp: time },
    ], expect.anything(), { focusLatestEmployeeMessage: true });
  });

  it('reopens a declined question before capturing a new meaning', async () => {
    const questionCapture = {
      getWindowMode: vi.fn().mockResolvedValue('v2'),
      reopenDeclinedQuestion: vi.fn().mockResolvedValue(true),
      captureMeaning: vi.fn().mockResolvedValue('captured'),
    } as unknown as QuestionWorkingCapturePort;
    const useCase = new SurveyEvidenceExtractionUseCase(
      makeAi('covered', undefined, ['q-1']), makeConversationRepo(), makeSurveyRepo('covered'),
      makePulseService(), questionCapture,
    );

    await useCase.execute(BASE_INPUT);

    expect(questionCapture.reopenDeclinedQuestion).toHaveBeenCalledWith(expect.objectContaining({
      sourceMessageId: 'm-1', surveyQuestionId: 'q-1', questionVersion: '1',
    }));
    expect(vi.mocked(questionCapture.reopenDeclinedQuestion).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(questionCapture.captureMeaning).mock.invocationCallOrder[0]!);
  });

  it('reopens an explicitly revisited question without requiring new evidence', async () => {
    const ai = makeAi('insufficient_evidence');
    vi.mocked(ai.evaluateSurveyEvidence).mockResolvedValue({
      candidateQuestionIds: [], voluntaryReopenQuestionIds: ['q-1'], evidence: [],
    });
    const questionCapture = {
      getWindowMode: vi.fn().mockResolvedValue('v2'),
      reopenDeclinedQuestion: vi.fn().mockResolvedValue(true),
      captureMeaning: vi.fn(),
    } as unknown as QuestionWorkingCapturePort;
    const useCase = new SurveyEvidenceExtractionUseCase(
      ai, makeConversationRepo(), makeSurveyRepo('insufficient_evidence'),
      makePulseService(), questionCapture,
    );

    await useCase.execute(BASE_INPUT);

    expect(questionCapture.reopenDeclinedQuestion).toHaveBeenCalledOnce();
    expect(questionCapture.captureMeaning).not.toHaveBeenCalled();
  });

  it('keeps an incomplete V2 meaning out of confirmation readiness', async () => {
    const questionCapture = {
      getWindowMode: vi.fn().mockResolvedValue('v2'),
      captureMeaning: vi.fn().mockResolvedValue('captured'),
    } as unknown as QuestionWorkingCapturePort;
    const useCase = new SurveyEvidenceExtractionUseCase(
      makeAi('insufficient_evidence'), makeConversationRepo(), makeSurveyRepo('insufficient_evidence'),
      makePulseService(), questionCapture,
    );

    await useCase.execute(BASE_INPUT);

    expect(questionCapture.captureMeaning).toHaveBeenCalledWith(expect.objectContaining({
      surveyQuestionId: 'q-1', sufficientMeaning: false,
    }));
  });

  it('fails closed when a bound V2 window has an incomplete policy', async () => {
    const surveyRepo = makeSurveyRepo('covered');
    const questionCapture = {
      getWindowMode: vi.fn().mockRejectedValue(new Error('v2_scoring_policy_incomplete')),
      captureMeaning: vi.fn(),
    } as unknown as QuestionWorkingCapturePort;
    const useCase = new SurveyEvidenceExtractionUseCase(
      makeAi('covered'), makeConversationRepo(), surveyRepo, makePulseService(), questionCapture,
    );

    await expect(useCase.execute(BASE_INPUT)).rejects.toThrow('v2_scoring_policy_incomplete');
    expect(surveyRepo.saveEvidence).not.toHaveBeenCalled();
    expect(questionCapture.captureMeaning).not.toHaveBeenCalled();
  });

  it('calls markQuestionCovered when assessment reaches scored', async () => {
    const pulseService = makePulseService();
    const useCase = new SurveyEvidenceExtractionUseCase(
      makeAi('scored'),
      makeConversationRepo(),
      makeSurveyRepo('scored'),
      pulseService,
    );

    await useCase.execute(BASE_INPUT);

    expect(pulseService.markQuestionCovered).toHaveBeenCalledWith('u-1', 'w-1', 'q-1', 1);
  });

  it('calls markQuestionCovered when assessment reaches covered', async () => {
    const pulseService = makePulseService();
    const useCase = new SurveyEvidenceExtractionUseCase(
      makeAi('covered'),
      makeConversationRepo(),
      makeSurveyRepo('covered'),
      pulseService,
    );

    await useCase.execute(BASE_INPUT);

    expect(pulseService.markQuestionCovered).toHaveBeenCalled();
  });

  it('calls markQuestionCovered even when assessment is only partially_covered', async () => {
    // Any saved evidence closes the question for this pulse cycle — threshold lowered
    // from scored/covered to any meaningful evidence (strength >= MIN_EVIDENCE_STRENGTH).
    const pulseService = makePulseService();
    const useCase = new SurveyEvidenceExtractionUseCase(
      makeAi('partially_covered'),
      makeConversationRepo(),
      makeSurveyRepo('partially_covered'),
      pulseService,
    );

    await useCase.execute(BASE_INPUT);

    expect(pulseService.markQuestionCovered).toHaveBeenCalledWith('u-1', 'w-1', 'q-1', 1);
  });

  it('does not close a qualitative backlog question when assessment is insufficient_evidence', async () => {
    const pulseService = makePulseService();
    const surveyRepo = makeSurveyRepo('insufficient_evidence');
    const useCase = new SurveyEvidenceExtractionUseCase(
      makeAi('insufficient_evidence'),
      makeConversationRepo(),
      surveyRepo,
      pulseService,
    );

    await useCase.execute(BASE_INPUT);

    expect(surveyRepo.upsertAssessment).toHaveBeenCalledWith(
      expect.objectContaining({ surveyQuestionId: 'q-1', status: 'insufficient_evidence' }),
    );
    expect(pulseService.markQuestionCovered).not.toHaveBeenCalled();
  });

  it('works when pulseBacklogService is not provided', async () => {
    const useCase = new SurveyEvidenceExtractionUseCase(
      makeAi('scored'),
      makeConversationRepo(),
      makeSurveyRepo('scored'),
    );

    await expect(useCase.execute(BASE_INPUT)).resolves.not.toThrow();
  });

  it('persists explicit numeric answers as assessment score', async () => {
    const surveyRepo = makeSurveyRepo('scored');
    (surveyRepo.findQuestionsForWindow as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeQuestion('q-1', 'engagement', { responseType: 'numeric_0_10' }),
    ]);
    const useCase = new SurveyEvidenceExtractionUseCase(
      makeAi('scored', 7),
      makeNumericConversationRepo('7'),
      surveyRepo,
      makePulseService(),
    );

    await useCase.execute(BASE_INPUT);

    expect(surveyRepo.upsertAssessment).toHaveBeenCalledWith(
      expect.objectContaining({
        score: 7,
      }),
    );
  });

  it('does not evaluate engagement questions before the final 14 days', async () => {
    const surveyRepo = makeSurveyRepo('scored');
    const ai = makeAi('scored');
    const regularQuestion = makeQuestion('q-1', 'autonomy');
    const engagementQuestion = {
      ...makeQuestion('q-engagement', 'engagement'),
      stableKey: 'engagement_current',
      responseType: 'numeric_0_10',
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (surveyRepo.findOrCreateActiveWindow as any).mockResolvedValue({
      ...makeWindow(),
      periodEnd: new Date(Date.now() + 90 * 86_400_000),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (surveyRepo.findQuestionsForWindow as any).mockResolvedValue([regularQuestion, engagementQuestion]);

    const useCase = new SurveyEvidenceExtractionUseCase(
      ai,
      makeConversationRepo(),
      surveyRepo,
      makePulseService(),
    );

    await useCase.execute(BASE_INPUT);

    expect(ai.evaluateSurveyEvidence).toHaveBeenCalledWith(
      expect.any(Array),
      [
        expect.objectContaining({ id: 'q-1' }),
      ],
    );
  });

  it('backfill slides windows over the full history and evaluates each', async () => {
    // 35 messages, WINDOW=15, STEP=10 → window starts [0, 10, 20, 30] = 4 windows.
    const history = Array.from({ length: 35 }, (_, i) => ({
      id: `m-${i}`,
      direction: i % 2 === 0 ? 'inbound' : 'outbound',
      text: `message ${i}`,
      occurredAt: new Date(),
      conversationId: 'c-1',
      tenantId: 't-1',
      userId: 'u-1',
      createdAt: new Date(),
    }));
    const convRepo = {
      ...makeConversationRepo(),
      findRecentMessages: vi.fn().mockResolvedValue(history),
    } as unknown as ConversationRepositoryPort;
    const ai = makeAi('scored');

    const useCase = new SurveyEvidenceExtractionUseCase(
      ai,
      convRepo,
      makeSurveyRepo('scored'),
      makePulseService(),
    );

    const result = await useCase.backfill({ conversationId: 'c-1', userId: 'u-1', tenantId: 't-1' });

    expect(result.windowsProcessed).toBe(4);
    expect(ai.evaluateSurveyEvidence).toHaveBeenCalledTimes(4);
  });

  it('backfills every V2 employee turn once with only its nearest assistant reply', async () => {
    const time = new Date('2026-09-29T12:00:00.000Z');
    const history = Array.from({ length: 35 }, (_, index) => ({
      id: `m-${index}`,
      direction: index % 2 === 0 ? 'inbound' as const : 'outbound' as const,
      text: `message ${index}`,
      occurredAt: new Date(time.getTime() + index * 1_000),
      conversationId: 'c-1', tenantId: 't-1', userId: 'u-1', createdAt: time,
    }));
    const conversationRepo = makeConversationRepo();
    vi.mocked(conversationRepo.findRecentMessages).mockResolvedValue(history);
    const surveyRepo = makeSurveyRepo('covered');
    vi.mocked(surveyRepo.findOrCreateActiveWindow).mockResolvedValue(makeWindow({
      periodStart: new Date(time.getTime() - 1_000),
      periodEnd: new Date(time.getTime() + 60_000),
    }));
    const questionCapture = {
      getWindowMode: vi.fn().mockResolvedValue('v2'),
      captureMeaning: vi.fn().mockResolvedValue('captured'),
      reopenDeclinedQuestion: vi.fn().mockResolvedValue(false),
    } as unknown as QuestionWorkingCapturePort;
    const ai = makeAi('covered');

    const result = await new SurveyEvidenceExtractionUseCase(
      ai, conversationRepo, surveyRepo, undefined, questionCapture,
    ).backfill({ conversationId: 'c-1', tenantId: 't-1', userId: 'u-1' });

    expect(result.windowsProcessed).toBe(18);
    expect(ai.evaluateSurveyEvidence).toHaveBeenCalledTimes(18);
    expect(vi.mocked(questionCapture.captureMeaning).mock.calls.map(([input]) =>
      input.sourceMessageId)).toEqual(Array.from({ length: 18 }, (_, index) => `m-${index * 2}`));
    expect(ai.evaluateSurveyEvidence).toHaveBeenNthCalledWith(2, [
      { role: 'assistant', content: 'message 1', timestamp: history[1]!.occurredAt },
      { role: 'user', content: 'message 2', timestamp: history[2]!.occurredAt },
    ], expect.anything(), { focusLatestEmployeeMessage: true });
  });

  it('bounds a backfill window to the employee message it attributes evidence to', async () => {
    const conversationRepo = makeConversationRepo();
    const time = new Date('2026-09-29T12:00:00.000Z');
    const message = (id: string, direction: 'inbound' | 'outbound', text: string) => ({
      id, conversationId: 'c-1', tenantId: 't-1', userId: 'u-1', direction, text,
      occurredAt: time, createdAt: time,
    });
    vi.mocked(conversationRepo.findRecentMessages).mockResolvedValue([
      message('m-probe', 'outbound', 'What changed?'),
      message('m-1', 'inbound', 'My goals became clearer.'),
      message('m-reply', 'outbound', 'Let me suggest another interpretation.'),
    ]);
    const ai = makeAi('covered');
    const surveyRepo = makeSurveyRepo('covered');

    const result = await new SurveyEvidenceExtractionUseCase(ai, conversationRepo, surveyRepo)
      .backfill({ conversationId: 'c-1', tenantId: 't-1', userId: 'u-1' });

    expect(result.windowsProcessed).toBe(1);
    expect(ai.evaluateSurveyEvidence).toHaveBeenCalledWith([
      { role: 'assistant', content: 'What changed?', timestamp: time },
      { role: 'user', content: 'My goals became clearer.', timestamp: time },
    ], expect.anything());
    expect(surveyRepo.saveEvidence).toHaveBeenCalledWith(expect.objectContaining({
      sourceMessageIds: ['m-1'],
    }));
  });

  it('backfill returns zero windows for an empty history', async () => {
    const convRepo = {
      ...makeConversationRepo(),
      findRecentMessages: vi.fn().mockResolvedValue([]),
    } as unknown as ConversationRepositoryPort;
    const ai = makeAi('scored');

    const useCase = new SurveyEvidenceExtractionUseCase(ai, convRepo, makeSurveyRepo('scored'));

    const result = await useCase.backfill({ conversationId: 'c-1', userId: 'u-1', tenantId: 't-1' });

    expect(result.windowsProcessed).toBe(0);
    expect(ai.evaluateSurveyEvidence).not.toHaveBeenCalled();
  });

  it('completing a group upserts pending_confirmation', async () => {
    const surveyRepo = makeSurveyRepo('scored');
    const ai = makeAi('scored');
    // group of one question fully covered
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (surveyRepo.findQuestionsForWindow as any).mockResolvedValue([makeQuestion('q-1', 'autonomy')]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (surveyRepo.findAssessmentsForWindow as any).mockResolvedValue([{ surveyQuestionId: 'q-1', status: 'scored', score: null }]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (surveyRepo.findGroupState as any).mockResolvedValue(null);

    const useCase = new SurveyEvidenceExtractionUseCase(
      ai, makeConversationRepo(), surveyRepo, makePulseService(),
    );

    await useCase.execute(BASE_INPUT);

    expect(surveyRepo.upsertGroupState).toHaveBeenCalledWith(
      {
        surveyWindowId: 'w-1',
        userId: 'u-1',
        tenantId: 't-1',
        questionGroup: 'autonomy',
        status: 'pending_confirmation',
      },
    );
    expect(ai.generateGroupSummary).not.toHaveBeenCalled();
  });

  it('excludes engagement questions from evaluation outside the final 14 days', async () => {
    const surveyRepo = makeSurveyRepo('scored');
    const regular = makeQuestion('q-regular', 'autonomy');
    const engagement = makeQuestion('q-engagement', 'engagement', { responseType: 'numeric_0_10' });
    (surveyRepo.findOrCreateActiveWindow as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeWindow({ periodEnd: new Date(Date.now() + 15 * 86_400_000) }),
    );
    (surveyRepo.findQuestionsForWindow as ReturnType<typeof vi.fn>).mockResolvedValue([regular, engagement]);
    const ai = makeAi('scored');

    await new SurveyEvidenceExtractionUseCase(ai, makeConversationRepo(), surveyRepo).execute(BASE_INPUT);

    expect(ai.evaluateSurveyEvidence).toHaveBeenCalledWith(
      expect.anything(),
      [expect.objectContaining({ id: 'q-regular' })],
    );
  });

  it('uses the backfilled turn time when applying the engagement window', async () => {
    const messageTime = new Date('2026-01-01T12:00:00.000Z');
    const surveyRepo = makeSurveyRepo('scored');
    const regular = makeQuestion('q-regular', 'autonomy');
    const engagement = makeQuestion('q-engagement', 'engagement', { responseType: 'numeric_0_10' });
    (surveyRepo.findOrCreateActiveWindow as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeWindow({ periodEnd: new Date('2026-01-16T12:00:00.000Z') }),
    );
    (surveyRepo.findQuestionsForWindow as ReturnType<typeof vi.fn>).mockResolvedValue([regular, engagement]);
    const conversationRepo = makeConversationRepo();
    (conversationRepo.findRecentMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'm-1', direction: 'inbound', text: 'Historic message', occurredAt: messageTime,
        conversationId: 'c-1', tenantId: 't-1', userId: 'u-1', createdAt: messageTime,
      },
    ]);
    const ai = makeAi('scored');

    await new SurveyEvidenceExtractionUseCase(ai, conversationRepo, surveyRepo).backfill({
      conversationId: 'c-1', userId: 'u-1', tenantId: 't-1',
    });

    expect(ai.evaluateSurveyEvidence).toHaveBeenCalledWith(
      expect.anything(),
      [expect.objectContaining({ id: 'q-regular' })],
    );
  });

  it('skips stale queued evidence when its inbound is no longer in recent context', async () => {
    const surveyRepo = makeSurveyRepo('scored');
    const regular = makeQuestion('q-regular', 'autonomy');
    const engagement = makeQuestion('q-engagement', 'engagement', { responseType: 'numeric_0_10' });
    (surveyRepo.findOrCreateActiveWindow as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeWindow({ periodEnd: new Date(Date.now() + 7 * 86_400_000) }),
    );
    (surveyRepo.findQuestionsForWindow as ReturnType<typeof vi.fn>).mockResolvedValue([regular, engagement]);
    const conversationRepo = makeConversationRepo();
    (conversationRepo.findRecentMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'm-newer', direction: 'inbound', text: 'Newer message', occurredAt: new Date(),
        conversationId: 'c-1', tenantId: 't-1', userId: 'u-1', createdAt: new Date(),
      },
    ]);
    const ai = makeAi('scored');

    await new SurveyEvidenceExtractionUseCase(ai, conversationRepo, surveyRepo).execute(BASE_INPUT);

    expect(surveyRepo.findOrCreateActiveWindow).not.toHaveBeenCalled();
    expect(ai.evaluateSurveyEvidence).not.toHaveBeenCalled();
  });

  it.each([0, 7, 10])('persists the explicit numeric rating %s exactly', async (numericValue) => {
    const surveyRepo = makeSurveyRepo('scored');
    const numericQuestion = makeQuestion('q-1', 'engagement', { responseType: 'numeric_0_10' });
    (surveyRepo.findOrCreateActiveWindow as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeWindow({ periodEnd: new Date(Date.now() + 7 * 86_400_000) }),
    );
    (surveyRepo.findQuestionsForWindow as ReturnType<typeof vi.fn>).mockResolvedValue([numericQuestion]);
    (surveyRepo.findAssessmentsForWindow as ReturnType<typeof vi.fn>).mockResolvedValue([
      { surveyQuestionId: 'q-1', status: 'scored', score: numericValue },
    ]);
    const ai = makeAi('scored');
    (ai.evaluateSurveyEvidence as ReturnType<typeof vi.fn>).mockResolvedValue({
      evidence: [{
        questionId: 'q-1', evidenceSummary: `Explicit rating ${numericValue}`,
        numericValue, polarity: 'neutral', strength: 1, completeness: 1,
        confidence: 1, assessmentShouldRemainUnknown: false,
      }],
    });

    await new SurveyEvidenceExtractionUseCase(
      ai, makeNumericConversationRepo(String(numericValue)), surveyRepo,
    ).execute(BASE_INPUT);

    expect(surveyRepo.upsertAssessment).toHaveBeenCalledWith(
      expect.objectContaining({ surveyQuestionId: 'q-1', score: numericValue, status: 'scored' }),
    );
  });

  it('persists an explicit employee rating when the evaluator omits numericValue', async () => {
    const surveyRepo = makeSurveyRepo('partially_covered');
    (surveyRepo.findOrCreateActiveWindow as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeWindow({ periodEnd: new Date(Date.now() + 7 * 86_400_000) }),
    );
    (surveyRepo.findQuestionsForWindow as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeQuestion('q-1', 'engagement', { responseType: 'numeric_0_10' }),
    ]);
    const ai = makeAi('scored');
    (ai.evaluateSurveyEvidence as ReturnType<typeof vi.fn>).mockResolvedValue({
      evidence: [{
        questionId: 'q-1', evidenceSummary: 'Explicit rating 7',
        polarity: 'neutral', strength: 1, completeness: 1, confidence: 1,
        assessmentShouldRemainUnknown: false,
      }],
    });

    await new SurveyEvidenceExtractionUseCase(
      ai, makeNumericConversationRepo('7'), surveyRepo,
    ).execute(BASE_INPUT);

    expect(surveyRepo.upsertAssessment).toHaveBeenCalledWith(
      expect.objectContaining({ surveyQuestionId: 'q-1', score: 7, status: 'scored' }),
    );
  });

  it('rejects an evaluator numeric value that conflicts with the explicit employee rating', async () => {
    const surveyRepo = makeSurveyRepo('partially_covered');
    (surveyRepo.findOrCreateActiveWindow as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeWindow({ periodEnd: new Date(Date.now() + 7 * 86_400_000) }),
    );
    (surveyRepo.findQuestionsForWindow as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeQuestion('q-1', 'engagement', { responseType: 'numeric_0_10' }),
    ]);
    const ai = makeAi('scored');
    (ai.evaluateSurveyEvidence as ReturnType<typeof vi.fn>).mockResolvedValue({
      evidence: [{
        questionId: 'q-1', evidenceSummary: 'Conflicting model rating', numericValue: 7,
        polarity: 'neutral', strength: 1, completeness: 1, confidence: 1,
        assessmentShouldRemainUnknown: false,
      }],
    });
    const pulseService = makePulseService();

    await new SurveyEvidenceExtractionUseCase(
      ai, makeNumericConversationRepo('6'), surveyRepo, pulseService,
    ).execute(BASE_INPUT);

    expect(surveyRepo.upsertAssessment).toHaveBeenCalledWith(
      expect.not.objectContaining({ score: expect.anything() }),
    );
    expect(pulseService.markQuestionCovered).not.toHaveBeenCalled();
  });

  it('does not persist a model numeric value that is absent from the employee reply', async () => {
    const surveyRepo = makeSurveyRepo('partially_covered');
    (surveyRepo.findOrCreateActiveWindow as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeWindow({ periodEnd: new Date(Date.now() + 7 * 86_400_000) }),
    );
    (surveyRepo.findQuestionsForWindow as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeQuestion('q-1', 'engagement', { responseType: 'numeric_0_10' }),
    ]);
    (surveyRepo.findAssessmentsForWindow as ReturnType<typeof vi.fn>).mockResolvedValue([
      { surveyQuestionId: 'q-1', status: 'partially_covered', score: null },
    ]);
    const ai = makeAi('scored');
    (ai.evaluateSurveyEvidence as ReturnType<typeof vi.fn>).mockResolvedValue({
      evidence: [{
        questionId: 'q-1', evidenceSummary: 'Model inferred a rating', numericValue: 7,
        polarity: 'neutral', strength: 1, completeness: 1, confidence: 0.1,
        assessmentShouldRemainUnknown: false,
      }],
    });
    const pulseService = makePulseService();

    await new SurveyEvidenceExtractionUseCase(
      ai, makeNumericConversationRepo('It feels okay'), surveyRepo, pulseService,
    ).execute(BASE_INPUT);

    expect(surveyRepo.upsertAssessment).toHaveBeenCalledWith(
      expect.not.objectContaining({ score: expect.anything() }),
    );
    expect(pulseService.markQuestionCovered).not.toHaveBeenCalled();
  });

  it('replaces a prior numeric rating when the employee gives a new explicit value', async () => {
    const surveyRepo = makeSurveyRepo('scored');
    (surveyRepo.findOrCreateActiveWindow as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeWindow({ periodEnd: new Date(Date.now() + 7 * 86_400_000) }),
    );
    (surveyRepo.findQuestionsForWindow as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeQuestion('q-1', 'engagement', { responseType: 'numeric_0_10' }),
    ]);
    (surveyRepo.findAssessmentsForWindow as ReturnType<typeof vi.fn>).mockResolvedValue([
      { surveyQuestionId: 'q-1', status: 'scored', score: 8 },
    ]);
    const ai = makeAi('scored');
    (ai.evaluateSurveyEvidence as ReturnType<typeof vi.fn>).mockResolvedValue({
      evidence: [{
        questionId: 'q-1', evidenceSummary: 'Corrected rating 6', numericValue: 6,
        polarity: 'neutral', strength: 1, completeness: 1, confidence: 1,
        assessmentShouldRemainUnknown: false,
      }],
    });

    await new SurveyEvidenceExtractionUseCase(ai, makeNumericConversationRepo('6'), surveyRepo).execute(BASE_INPUT);

    expect(surveyRepo.upsertAssessment).toHaveBeenCalledWith(
      expect.objectContaining({ surveyQuestionId: 'q-1', score: 6, status: 'scored' }),
    );
  });

  it('keeps qualitative-only numeric evidence incomplete', async () => {
    const surveyRepo = makeSurveyRepo('partially_covered');
    (surveyRepo.findOrCreateActiveWindow as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeWindow({ periodEnd: new Date(Date.now() + 7 * 86_400_000) }),
    );
    (surveyRepo.findQuestionsForWindow as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeQuestion('q-1', 'engagement', { responseType: 'numeric_0_10' }),
    ]);
    (surveyRepo.findAssessmentsForWindow as ReturnType<typeof vi.fn>).mockResolvedValue([
      { surveyQuestionId: 'q-1', status: 'partially_covered', score: null },
    ]);
    const pulseService = makePulseService();

    await new SurveyEvidenceExtractionUseCase(
      makeAi('partially_covered'), makeNumericConversationRepo('It feels okay'), surveyRepo, pulseService,
    ).execute(BASE_INPUT);

    expect(surveyRepo.upsertAssessment).toHaveBeenCalledWith(
      expect.objectContaining({ surveyQuestionId: 'q-1', status: 'partially_covered' }),
    );
    expect(surveyRepo.upsertAssessment).toHaveBeenCalledWith(
      expect.not.objectContaining({ score: expect.anything() }),
    );
    expect(pulseService.markQuestionCovered).not.toHaveBeenCalled();
    expect(surveyRepo.upsertGroupState).not.toHaveBeenCalled();
  });

  it('does not complete engagement until all three questions have stored scores', async () => {
    const surveyRepo = makeSurveyRepo('scored');
    const questions = ['q-1', 'q-2', 'q-3'].map((id) =>
      makeQuestion(id, 'engagement', { responseType: 'numeric_0_10' }));
    (surveyRepo.findOrCreateActiveWindow as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeWindow({ periodEnd: new Date(Date.now() + 7 * 86_400_000) }),
    );
    (surveyRepo.findQuestionsForWindow as ReturnType<typeof vi.fn>).mockResolvedValue(questions);
    (surveyRepo.findAssessmentsForWindow as ReturnType<typeof vi.fn>).mockResolvedValue([
      { surveyQuestionId: 'q-1', status: 'scored', score: 7 },
      { surveyQuestionId: 'q-2', status: 'scored', score: 8 },
      { surveyQuestionId: 'q-3', status: 'partially_covered', score: null },
    ]);
    const ai = makeAi('scored');
    (ai.evaluateSurveyEvidence as ReturnType<typeof vi.fn>).mockResolvedValue({
      evidence: [{
        questionId: 'q-1', evidenceSummary: 'Explicit rating 7', numericValue: 7,
        polarity: 'positive', strength: 1, completeness: 1, confidence: 1,
        assessmentShouldRemainUnknown: false,
      }],
    });

    await new SurveyEvidenceExtractionUseCase(ai, makeNumericConversationRepo('7'), surveyRepo).execute(BASE_INPUT);

    expect(surveyRepo.upsertGroupState).not.toHaveBeenCalled();
  });
});
