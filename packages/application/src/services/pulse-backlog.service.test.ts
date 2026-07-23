import { describe, it, expect, vi } from 'vitest';
import { PulseBacklogService } from './pulse-backlog.service';
import type { PulseBacklogRepositoryPort, PulseBacklogRecord, ResolvedIgnore } from '../ports/pulse-backlog.repository.port';
import type { SurveyRepositoryPort } from '../ports/survey.repository.port';
import type { SurveyQuestionRecord, SurveyWindowRecord } from '../types/records';

const QUARTER_END_FAR = new Date(Date.now() + 90 * 86_400_000); // 90 days out
const QUARTER_END_NEAR = new Date(Date.now() + 7 * 86_400_000);  // 7 days out — within 14-day window

function makeWindow(overrides: Partial<SurveyWindowRecord> = {}): SurveyWindowRecord {
  return {
    id: 'w-1',
    tenantId: 't-1',
    userId: 'u-1',
    surveyDefinitionId: 'def-1',
    periodType: 'quarter',
    periodStart: new Date(Date.now() - 80 * 86_400_000),
    periodEnd: QUARTER_END_FAR,
    status: 'active',
    ...overrides,
  };
}

function makeQuestion(overrides: Partial<SurveyQuestionRecord> = {}): SurveyQuestionRecord {
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
    probeStrategies: [],
    contraindications: [],
    confidenceThreshold: 0.72,
    completenessThreshold: 0.65,
    minimumEvidenceCount: 2,
    cooldownDays: 14,
    maxFollowUpProbes: 3,
    responseType: 'open_ended',
    version: '1',
    ...overrides,
  };
}

function makeBacklogEntry(overrides: Partial<PulseBacklogRecord> = {}): PulseBacklogRecord {
  return {
    id: 'b-1',
    surveyWindowId: 'w-1',
    userId: 'u-1',
    tenantId: 't-1',
    surveyQuestionId: 'q-1',
    position: 1,
    status: 'pending',
    ignoreCount: 0,
    proactiveSentAt: null,
    evidenceCapturedCount: 0,
    resultedInCoverage: null,
    doneAt: null,
    ...overrides,
  };
}

function makeBacklogRepo(
  overrides: Partial<Record<keyof PulseBacklogRepositoryPort, ReturnType<typeof vi.fn>>> = {},
): PulseBacklogRepositoryPort {
  return {
    initializeIfNeeded: vi.fn().mockResolvedValue(undefined),
    resolveIgnoredEntries: vi.fn().mockResolvedValue([] as ResolvedIgnore[]),
    findNextPending: vi.fn().mockResolvedValue(makeBacklogEntry()),
    markActive: vi.fn().mockResolvedValue(undefined),
    markDone: vi.fn().mockResolvedValue(undefined),
    unlockEngagementIfNeeded: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeSurveyRepo(
  window: SurveyWindowRecord | null,
  questions: SurveyQuestionRecord[] = [makeQuestion()],
  coveredIds: string[] = [],
): SurveyRepositoryPort {
  return {
    findOrCreateActiveWindow: vi.fn().mockResolvedValue(window),
    findQuestionsForWindow: vi.fn().mockResolvedValue(questions),
    findAssessmentsForWindow: vi.fn().mockResolvedValue(
      coveredIds.map((id) => ({ surveyQuestionId: id, status: 'scored' })),
    ),
    saveEvidence: vi.fn(),
    markEvidenceSuperseded: vi.fn(),
    upsertAssessment: vi.fn(),
    findEvidenceForQuestion: vi.fn().mockResolvedValue([]),
    findGroupState: vi.fn(),
    findPendingConfirmationGroups: vi.fn(),
    upsertGroupState: vi.fn(),
    findConfirmedGroupStates: vi.fn(),
    findTeamByMemberId: vi.fn(),
    findTeamById: vi.fn(),
  } as unknown as SurveyRepositoryPort;
}

describe('PulseBacklogService', () => {
  describe('getNextProbeQuestion', () => {
    it('returns null when no active window exists', async () => {
      const service = new PulseBacklogService(makeBacklogRepo(), makeSurveyRepo(null));
      const result = await service.getNextProbeQuestion('u-1', 't-1');
      expect(result).toBeNull();
    });

    it('returns null when no questions exist for the window', async () => {
      const service = new PulseBacklogService(makeBacklogRepo(), makeSurveyRepo(makeWindow(), []));
      const result = await service.getNextProbeQuestion('u-1', 't-1');
      expect(result).toBeNull();
    });

    it('initializes the backlog on first call', async () => {
      const backlogRepo = makeBacklogRepo();
      const surveyRepo = makeSurveyRepo(makeWindow());
      const service = new PulseBacklogService(backlogRepo, surveyRepo);

      await service.getNextProbeQuestion('u-1', 't-1');

      expect(backlogRepo.initializeIfNeeded).toHaveBeenCalledOnce();
    });

    it('passes covered question IDs to initializeIfNeeded', async () => {
      const q1 = makeQuestion({ id: 'q-1' });
      const q2 = makeQuestion({ id: 'q-2', stableKey: 'q12_strengths_opportunity', displayOrder: 11 });
      const backlogRepo = makeBacklogRepo();
      const surveyRepo = makeSurveyRepo(makeWindow(), [q1, q2], ['q-1']);
      const service = new PulseBacklogService(backlogRepo, surveyRepo);

      await service.getNextProbeQuestion('u-1', 't-1');

      const call = (backlogRepo.initializeIfNeeded as ReturnType<typeof vi.fn>).mock.calls[0];
      const coveredSet = call[4] as Set<string>;
      expect(coveredSet.has('q-1')).toBe(true);
      expect(coveredSet.has('q-2')).toBe(false);
    });

    it('calls resolveIgnoredEntries before finding next', async () => {
      const backlogRepo = makeBacklogRepo();
      const service = new PulseBacklogService(backlogRepo, makeSurveyRepo(makeWindow()));

      await service.getNextProbeQuestion('u-1', 't-1');

      const backlogRepoAny = backlogRepo as unknown as Record<string, { mock: { invocationCallOrder: number[] } }>;
      const ignoreOrder = backlogRepoAny.resolveIgnoredEntries.mock.invocationCallOrder[0];
      const findOrder = backlogRepoAny.findNextPending.mock.invocationCallOrder[0];
      expect(ignoreOrder).toBeLessThan(findOrder);
    });

    it('uses ignoreWindowHours from config when calling resolveIgnoredEntries', async () => {
      const backlogRepo = makeBacklogRepo();
      const service = new PulseBacklogService(backlogRepo, makeSurveyRepo(makeWindow()));

      await service.getNextProbeQuestion('u-1', 't-1', { engagementUnlockDays: 14, ignoreWindowHours: 72 });

      expect(backlogRepo.resolveIgnoredEntries).toHaveBeenCalledWith('u-1', 'w-1', 72);
    });

    it('returns question and windowId when pending entry found', async () => {
      const question = makeQuestion({ id: 'q-1' });
      const backlogRepo = makeBacklogRepo({
        findNextPending: vi.fn().mockResolvedValue(makeBacklogEntry({ surveyQuestionId: 'q-1' })),
      });
      const service = new PulseBacklogService(backlogRepo, makeSurveyRepo(makeWindow(), [question]));

      const result = await service.getNextProbeQuestion('u-1', 't-1');

      expect(result).toEqual({ question, windowId: 'w-1' });
    });

    it('returns null when no pending entry exists', async () => {
      const backlogRepo = makeBacklogRepo({
        findNextPending: vi.fn().mockResolvedValue(null),
      });
      const service = new PulseBacklogService(backlogRepo, makeSurveyRepo(makeWindow()));

      const result = await service.getNextProbeQuestion('u-1', 't-1');

      expect(result).toBeNull();
    });

    it('uses engagementOnly=false in regular mode', async () => {
      const backlogRepo = makeBacklogRepo();
      const service = new PulseBacklogService(backlogRepo, makeSurveyRepo(makeWindow()));

      await service.getNextProbeQuestion('u-1', 't-1');

      expect(backlogRepo.findNextPending).toHaveBeenCalledWith('u-1', 'w-1', false);
    });

    it('uses engagementOnly=true and unlocks engagement when periodEnd is within engagementUnlockDays', async () => {
      const engQuestion = makeQuestion({ id: 'q-eng', questionGroup: 'engagement', displayOrder: 30, stableKey: 'engagement_nps' });
      const regularQuestion = makeQuestion({ id: 'q-1' });
      const backlogRepo = makeBacklogRepo();
      const surveyRepo = makeSurveyRepo(makeWindow({ periodEnd: QUARTER_END_NEAR }), [regularQuestion, engQuestion]);
      const service = new PulseBacklogService(backlogRepo, surveyRepo);

      await service.getNextProbeQuestion('u-1', 't-1', { engagementUnlockDays: 14, ignoreWindowHours: 48 });

      expect(backlogRepo.unlockEngagementIfNeeded).toHaveBeenCalledOnce();
      expect(backlogRepo.findNextPending).toHaveBeenCalledWith('u-1', 'w-1', true);
    });

    it('does NOT unlock engagement when periodEnd is far away', async () => {
      const backlogRepo = makeBacklogRepo();
      const service = new PulseBacklogService(backlogRepo, makeSurveyRepo(makeWindow({ periodEnd: QUARTER_END_FAR })));

      await service.getNextProbeQuestion('u-1', 't-1');

      expect(backlogRepo.unlockEngagementIfNeeded).not.toHaveBeenCalled();
      expect(backlogRepo.findNextPending).toHaveBeenCalledWith('u-1', 'w-1', false);
    });

    it('does NOT pass engagement questions to initializeIfNeeded', async () => {
      const engQuestion = makeQuestion({ id: 'q-eng', questionGroup: 'engagement', displayOrder: 30 });
      const regularQuestion = makeQuestion({ id: 'q-1', questionGroup: 'autonomy' });
      const backlogRepo = makeBacklogRepo();
      const surveyRepo = makeSurveyRepo(makeWindow(), [engQuestion, regularQuestion]);
      const service = new PulseBacklogService(backlogRepo, surveyRepo);

      await service.getNextProbeQuestion('u-1', 't-1');

      const call = (backlogRepo.initializeIfNeeded as ReturnType<typeof vi.fn>).mock.calls[0];
      const questions = call[3] as SurveyQuestionRecord[];
      expect(questions.every((q) => q.questionGroup !== 'engagement')).toBe(true);
    });
  });

  describe('recordProbeSent', () => {
    it('calls backlogRepo.markActive with correct args', async () => {
      const backlogRepo = makeBacklogRepo();
      const service = new PulseBacklogService(backlogRepo, makeSurveyRepo(makeWindow()));
      const sentAt = new Date('2026-07-22T10:00:00Z');

      await service.recordProbeSent('u-1', 'w-1', 'q-1', sentAt);

      expect(backlogRepo.markActive).toHaveBeenCalledWith('u-1', 'w-1', 'q-1', sentAt);
    });
  });

  describe('markQuestionCovered', () => {
    it('calls backlogRepo.markDone with correct args', async () => {
      const backlogRepo = makeBacklogRepo();
      const service = new PulseBacklogService(backlogRepo, makeSurveyRepo(makeWindow()));

      await service.markQuestionCovered('u-1', 'w-1', 'q-1', 3);

      expect(backlogRepo.markDone).toHaveBeenCalledWith('u-1', 'w-1', 'q-1', 3);
    });
  });
});
