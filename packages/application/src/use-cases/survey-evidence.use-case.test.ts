import { describe, it, expect, vi } from 'vitest';
import { SurveyEvidenceExtractionUseCase } from './survey-evidence.use-case';
import { PulseBacklogService } from '../services/pulse-backlog.service';
import type { AiProviderPort } from '../ports/ai-provider.port';
import type { ConversationRepositoryPort } from '../ports/conversation.repository.port';
import type { SurveyRepositoryPort } from '../ports/survey.repository.port';
import type { SurveyQuestionRecord, SurveyWindowRecord, SurveyEvidenceRecord } from '../types/records';

function makeWindow(overrides: Partial<SurveyWindowRecord> = {}): SurveyWindowRecord {
  return {
    id: 'w-1', tenantId: 't-1', userId: 'u-1', surveyDefinitionId: 'def-1',
    periodType: 'quarter', periodStart: new Date(), periodEnd: new Date(), status: 'active',
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

function makeAi(status: string): AiProviderPort {
  const vals = EVIDENCE_BY_STATUS[status] ?? EVIDENCE_BY_STATUS['scored'];
  return {
    evaluateSurveyEvidence: vi.fn().mockResolvedValue({
      evidence: [{
        questionId: 'q-1', evidenceSummary: 'Knows their goals clearly',
        polarity: 'positive', strength: vals.strength, completeness: vals.completeness,
        confidence: vals.confidence, assessmentShouldRemainUnknown: false,
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
    findById: vi.fn(),
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
    // group of one question fully covered
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (surveyRepo.findQuestionsForWindow as any).mockResolvedValue([makeQuestion('q-1', 'autonomy')]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (surveyRepo.findAssessmentsForWindow as any).mockResolvedValue([{ surveyQuestionId: 'q-1', status: 'scored', score: null }]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (surveyRepo.findGroupState as any).mockResolvedValue(null);

    const useCase = new SurveyEvidenceExtractionUseCase(
      makeAi('scored'), makeConversationRepo(), surveyRepo, makePulseService(),
    );

    await useCase.execute(BASE_INPUT);

    expect(surveyRepo.upsertGroupState).toHaveBeenCalledWith(
      expect.objectContaining({ questionGroup: 'autonomy', status: 'pending_confirmation' }),
    );
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

  it('fails engagement eligibility closed when the queued inbound is no longer in recent context', async () => {
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

    expect(ai.evaluateSurveyEvidence).toHaveBeenCalledWith(
      expect.anything(),
      [expect.objectContaining({ id: 'q-regular' })],
    );
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
