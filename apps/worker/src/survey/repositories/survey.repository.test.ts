import { describe, expect, it, vi } from 'vitest';
import type { SaveSurveyEvidenceParams } from '@entalent/application';
import { SurveyRepository } from './survey.repository';

const persistedEvidence = {
  id: 'evidence-1',
  surveyWindowId: 'window-1',
  surveyQuestionId: 'question-1',
  userId: 'user-1',
  sourceMessageIds: ['message-1'],
  evidenceSummary: 'Knows their goals clearly',
  polarity: 'positive',
  strength: '0.80',
  completeness: '0.75',
  confidence: '0.85',
  evaluatorVersion: 'v1',
  promptVersion: 'v1',
  createdAt: new Date('2026-08-12T16:30:00.000Z'),
};

function createDbMock() {
  const returning = vi.fn().mockResolvedValue([persistedEvidence]);
  const values = vi.fn(() => ({ returning }));
  const insert = vi.fn(() => ({ values }));

  return {
    client: {
      insert,
    },
    calls: {
      insert,
      values,
      returning,
    },
  };
}

function makeRepository(db: ReturnType<typeof createDbMock>) {
  return new SurveyRepository(db as never, {} as never, {} as never);
}

const validEvidenceParams: SaveSurveyEvidenceParams = {
  surveyWindowId: 'window-1',
  surveyQuestionId: 'question-1',
  userId: 'user-1',
  sourceMessageIds: ['message-1'],
  evidenceSummary: 'Knows their goals clearly',
  polarity: 'positive',
  strength: 0.8,
  completeness: 0.75,
  confidence: 0.85,
  evaluatorVersion: 'v1',
  promptVersion: 'v1',
};

describe('SurveyRepository', () => {
  it('persists evidence with an allowed polarity', async () => {
    const db = createDbMock();
    const repository = makeRepository(db);

    await expect(repository.saveEvidence(validEvidenceParams)).resolves.toMatchObject({
      id: 'evidence-1',
      polarity: 'positive',
      strength: 0.8,
      completeness: 0.75,
      confidence: 0.85,
    });

    expect(db.calls.insert).toHaveBeenCalledTimes(1);
    expect(db.calls.values).toHaveBeenCalledWith(
      expect.objectContaining({
        polarity: 'positive',
        strength: '0.8',
        completeness: '0.75',
        confidence: '0.85',
      }),
    );
  });

  it('rejects unsupported polarity before inserting evidence', async () => {
    const db = createDbMock();
    const repository = makeRepository(db);

    await expect(
      repository.saveEvidence({
        ...validEvidenceParams,
        polarity: 'unclear',
      } as never),
    ).rejects.toThrow('survey_evidence_invalid_polarity');

    expect(db.calls.insert).not.toHaveBeenCalled();
    expect(db.calls.values).not.toHaveBeenCalled();
  });

  it('updates an existing assessment with an explicit numeric score', async () => {
    const limit = vi.fn().mockResolvedValue([{ id: 'assessment-1', evidenceIds: ['evidence-old'] }]);
    const selectWhere = vi.fn(() => ({ limit }));
    const selectFrom = vi.fn(() => ({ where: selectWhere }));
    const setWhere = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn(() => ({ where: setWhere }));
    const db = {
      client: {
        select: vi.fn(() => ({ from: selectFrom })),
        update: vi.fn(() => ({ set })),
      },
    };
    const repository = makeRepository(db as never);

    await repository.upsertAssessment({
      surveyWindowId: 'window-1', surveyQuestionId: 'question-1', score: 6,
      confidence: 1, status: 'scored', evidenceId: 'evidence-new', evaluatorVersion: 'v1',
    });

    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      score: '6',
      status: 'scored',
      evidenceIds: ['evidence-old', 'evidence-new'],
    }));
  });

  it('does not erase an existing score when a later assessment has no numeric value', async () => {
    const limit = vi.fn().mockResolvedValue([{ id: 'assessment-1', evidenceIds: [] }]);
    const selectWhere = vi.fn(() => ({ limit }));
    const selectFrom = vi.fn(() => ({ where: selectWhere }));
    const set = vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) }));
    const db = {
      client: {
        select: vi.fn(() => ({ from: selectFrom })),
        update: vi.fn(() => ({ set })),
      },
    };
    const repository = makeRepository(db as never);

    await repository.upsertAssessment({
      surveyWindowId: 'window-1', surveyQuestionId: 'question-1',
      confidence: 0.9, status: 'scored', evidenceId: 'evidence-new', evaluatorVersion: 'v1',
    });

    expect(set).toHaveBeenCalledWith(expect.not.objectContaining({ score: expect.anything() }));
  });

  it('returns assessment scores as numbers', async () => {
    const where = vi.fn().mockResolvedValue([
      { surveyQuestionId: 'question-1', status: 'scored', score: '7.00' },
      { surveyQuestionId: 'question-2', status: 'partially_covered', score: null },
    ]);
    const from = vi.fn(() => ({ where }));
    const db = { client: { select: vi.fn(() => ({ from })) } };
    const repository = makeRepository(db as never);

    await expect(repository.findAssessmentsForWindow('window-1')).resolves.toEqual([
      { surveyQuestionId: 'question-1', status: 'scored', score: 7 },
      { surveyQuestionId: 'question-2', status: 'partially_covered', score: null },
    ]);
  });
});
