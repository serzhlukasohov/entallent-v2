import type { SurveyQuestionRecord } from '@entalent/application';
import { describe, expect, it } from 'vitest';
import { InMemorySurveyRepository } from '../../fakes/survey-repository';
import { FixedClock } from './clock';

const START = new Date('2026-01-05T08:00:00.000Z');

function question(id: string, questionGroup: string, displayOrder: number): SurveyQuestionRecord {
  return {
    id, surveyDefinitionId: 'd', stableKey: id, title: id, canonicalMeaning: id, dimension: questionGroup,
    positiveIndicators: [], negativeIndicators: [], probeStrategies: [], contraindications: [],
    confidenceThreshold: 0.7, completenessThreshold: 0.6, minimumEvidenceCount: 1, cooldownDays: 14, maxFollowUpProbes: 3,
    displayOrder, version: 'v1', questionGroup, responseType: 'open_ended',
  };
}

function seeded(): InMemorySurveyRepository {
  const repo = new InMemorySurveyRepository(new FixedClock(START));
  repo.seedWindow({
    window: { id: 'w', tenantId: 't', userId: 'u', surveyDefinitionId: 'd', periodType: 'quarter', periodStart: START, periodEnd: START, status: 'active' },
    questions: [question('a2', 'autonomy', 2), question('a1', 'autonomy', 1), question('g1', 'growth', 3)],
    uncoveredTopics: ['growth', 'autonomy'],
    closedQuestionIds: ['g1'],
  });
  return repo;
}

const evidence = (surveyQuestionId: string) => ({
  surveyWindowId: 'w', surveyQuestionId, userId: 'u', sourceMessageIds: ['m'], evidenceSummary: 'x',
  polarity: 'positive' as const, strength: 0.8, completeness: 0.8, confidence: 0.9, evaluatorVersion: 'v1', promptVersion: 'v1',
});

describe('InMemorySurveyRepository', () => {
  it('has no window until one is seeded, and is scoped to its tenant and user', async () => {
    const empty = new InMemorySurveyRepository(new FixedClock(START));
    expect(await empty.findOrCreateActiveWindow('u', 't')).toBeNull();
    expect(empty.hasWindow()).toBe(false);
    expect(await empty.pulseBacklog().getNextProbeQuestion('u', 't')).toBeNull();
    const repo = seeded();
    expect(await repo.findOrCreateActiveWindow('u', 't')).toMatchObject({ id: 'w' });
    expect(await repo.findOrCreateActiveWindow('other', 't')).toBeNull();
    expect((await repo.findQuestionsForWindow('w')).map((record) => record.id)).toEqual(['a2', 'a1', 'g1']);
    expect(await repo.findQuestionsForWindow('x')).toEqual([]);
  });

  it('stores evidence stamped by the clock, supersedes it and counts only live rows', async () => {
    const repo = seeded();
    const first = await repo.saveEvidence(evidence('a1'));
    expect(first).toMatchObject({ id: 'evidence-1', createdAt: START });
    expect(first).not.toHaveProperty('superseded');
    await repo.saveEvidence(evidence('a1'));
    expect(repo.evidenceCount()).toBe(2);
    await repo.markEvidenceSuperseded([first.id]);
    expect(repo.evidenceCount()).toBe(1);
    expect((await repo.findEvidenceForQuestion('u', 'a1', 'w')).map((row) => row.id)).toEqual(['evidence-2']);
  });

  it('stores assessments and group states', async () => {
    const repo = seeded();
    await repo.upsertAssessment({ surveyWindowId: 'w', surveyQuestionId: 'a1', confidence: 0.9, status: 'covered', evidenceId: 'e', evaluatorVersion: 'v1', score: 7 });
    await repo.upsertAssessment({ surveyWindowId: 'w', surveyQuestionId: 'a1', confidence: 0.9, status: 'scored', evidenceId: 'e', evaluatorVersion: 'v1' });
    expect(await repo.findAssessmentsForWindow('w')).toEqual([{ surveyQuestionId: 'a1', status: 'scored', score: 7 }]);
    expect(await repo.findGroupState('u', 'w', 'autonomy')).toBeNull();
    await repo.upsertGroupState({ surveyWindowId: 'w', userId: 'u', tenantId: 't', questionGroup: 'autonomy', status: 'in_progress' });
    const updated = await repo.upsertGroupState({ surveyWindowId: 'w', userId: 'u', tenantId: 't', questionGroup: 'autonomy', status: 'pending_confirmation' });
    expect(updated).toMatchObject({ status: 'pending_confirmation', createdAt: START });
    expect(await repo.findGroupState('u', 'w', 'autonomy')).toMatchObject({ status: 'pending_confirmation' });
  });

  it('pulseBacklog steers to the first open question of the first uncovered topic with an open question', async () => {
    const repo = seeded();
    const backlog = repo.pulseBacklog();
    // growth's only question is closed, so autonomy's first question by display order comes next.
    expect(await backlog.getNextProbeQuestion('u', 't')).toMatchObject({ question: { id: 'a1' }, windowId: 'w', focus: 'open' });
    await repo.upsertAssessment({ surveyWindowId: 'w', surveyQuestionId: 'a1', confidence: 0.9, status: 'covered', evidenceId: 'e', evaluatorVersion: 'v1' });
    expect(await backlog.getNextProbeQuestion('u', 't')).toMatchObject({ question: { id: 'a2' } });
    await repo.upsertAssessment({ surveyWindowId: 'w', surveyQuestionId: 'a2', confidence: 0.9, status: 'partially_covered', evidenceId: 'e', evaluatorVersion: 'v1' });
    expect(await backlog.getNextProbeQuestion('u', 't')).toBeNull();
  });

  it('answers every other port method with a safe empty', async () => {
    const repo = seeded();
    expect(await repo.findPulseCaptureForConversation()).toEqual([]);
    expect(await repo.findPendingConfirmationGroups()).toEqual([]);
    expect(await repo.findAwaitingConfirmationGroups()).toEqual([]);
    expect(await repo.stageGroupConfirmation()).toBe(false);
    expect(await repo.confirmGroupState()).toBe(false);
    expect(await repo.countOverdueQuestionConfirmationReplies()).toBe(0);
    expect(await repo.findTeamByMemberId()).toBeNull();
    expect(await repo.openReportingCycle()).toEqual([]);
  });
});
