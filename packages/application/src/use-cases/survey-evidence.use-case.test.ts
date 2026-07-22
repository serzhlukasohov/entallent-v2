import { describe, it, expect, vi } from 'vitest';
import { SurveyEvidenceExtractionUseCase } from './survey-evidence.use-case';
import { PulseBacklogService } from '../services/pulse-backlog.service';
import type { AiProviderPort } from '../ports/ai-provider.port';
import type { ConversationRepositoryPort } from '../ports/conversation.repository.port';
import type { SurveyRepositoryPort } from '../ports/survey.repository.port';
import type { SurveyQuestionRecord, SurveyWindowRecord, SurveyEvidenceRecord } from '../types/records';

function makeWindow(): SurveyWindowRecord {
  return {
    id: 'w-1', tenantId: 't-1', userId: 'u-1', surveyDefinitionId: 'def-1',
    periodType: 'quarter', periodStart: new Date(), periodEnd: new Date(), status: 'active',
  };
}

function makeQuestion(id = 'q-1', group = 'autonomy'): SurveyQuestionRecord {
  return {
    id, surveyDefinitionId: 'def-1', stableKey: 'q12_expectations', title: 'Clear Expectations',
    canonicalMeaning: 'Does the employee know?', dimension: 'engagement', questionGroup: group,
    displayOrder: 10, positiveIndicators: ['knows goals'], negativeIndicators: ['confused'],
    probeStrategies: [], contraindications: [], confidenceThreshold: 0.72,
    completenessThreshold: 0.65, minimumEvidenceCount: 2, cooldownDays: 14,
    maxFollowUpProbes: 3, responseType: 'open_ended', version: '1',
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
      { surveyQuestionId: 'q-1', status: assessmentStatus },
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
      undefined,
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
      undefined,
      pulseService,
    );

    await useCase.execute(BASE_INPUT);

    expect(pulseService.markQuestionCovered).toHaveBeenCalled();
  });

  it('does NOT call markQuestionCovered when assessment is partially_covered', async () => {
    const pulseService = makePulseService();
    const useCase = new SurveyEvidenceExtractionUseCase(
      makeAi('partially_covered'),
      makeConversationRepo(),
      makeSurveyRepo('partially_covered'),
      undefined,
      pulseService,
    );

    await useCase.execute(BASE_INPUT);

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
});
