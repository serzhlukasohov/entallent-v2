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
});
