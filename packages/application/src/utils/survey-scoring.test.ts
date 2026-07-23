import { describe, it, expect } from 'vitest';
import { computeAssessmentStatus } from './survey-scoring';
import type { SurveyQuestionRecord } from '../types/records';

function makeQuestion(overrides: Partial<SurveyQuestionRecord> = {}): SurveyQuestionRecord {
  return {
    id: 'q-1',
    surveyDefinitionId: 'def-1',
    stableKey: 'wellbeing_at_work',
    title: 'Wellbeing at Work',
    canonicalMeaning: 'Is the employee feeling well at work?',
    dimension: 'wellbeing',
    positiveIndicators: ['energetic', 'enjoying work'],
    negativeIndicators: ['exhausted', 'overwhelmed'],
    probeStrategies: [],
    contraindications: [],
    confidenceThreshold: 0.7,
    completenessThreshold: 0.7,
    minimumEvidenceCount: 1,
    cooldownDays: 7,
    maxFollowUpProbes: 3,
    displayOrder: 1,
    version: '1',
    questionGroup: 'wellbeing',
    responseType: 'open_ended',
    ...overrides,
  };
}

describe('computeAssessmentStatus', () => {
  it('returns scored when thresholdReached is true', () => {
    const q = makeQuestion();
    expect(computeAssessmentStatus({ confidence: 0.3, completeness: 0.3, thresholdReached: true }, q)).toBe('scored');
  });

  it('returns scored when both confidence and completeness meet thresholds', () => {
    const q = makeQuestion({ confidenceThreshold: 0.7, completenessThreshold: 0.7 });
    expect(computeAssessmentStatus({ confidence: 0.8, completeness: 0.8, thresholdReached: false }, q)).toBe('scored');
  });

  it('returns scored when values are exactly at threshold', () => {
    const q = makeQuestion({ confidenceThreshold: 0.7, completenessThreshold: 0.7 });
    expect(computeAssessmentStatus({ confidence: 0.7, completeness: 0.7, thresholdReached: false }, q)).toBe('scored');
  });

  it('returns partially_covered when completeness >= 0.4 but thresholds not met', () => {
    const q = makeQuestion({ confidenceThreshold: 0.7, completenessThreshold: 0.7 });
    expect(computeAssessmentStatus({ confidence: 0.5, completeness: 0.5, thresholdReached: false }, q)).toBe('partially_covered');
  });

  it('returns partially_covered at completeness boundary 0.4', () => {
    const q = makeQuestion();
    expect(computeAssessmentStatus({ confidence: 0.2, completeness: 0.4, thresholdReached: false }, q)).toBe('partially_covered');
  });

  it('returns insufficient_evidence when completeness below 0.4', () => {
    const q = makeQuestion();
    expect(computeAssessmentStatus({ confidence: 0.9, completeness: 0.3, thresholdReached: false }, q)).toBe('insufficient_evidence');
  });

  it('returns insufficient_evidence when both are zero', () => {
    const q = makeQuestion();
    expect(computeAssessmentStatus({ confidence: 0, completeness: 0, thresholdReached: false }, q)).toBe('insufficient_evidence');
  });

  it('requires both confidence AND completeness to reach scored (not just one)', () => {
    const q = makeQuestion({ confidenceThreshold: 0.7, completenessThreshold: 0.7 });
    // High confidence but low completeness
    expect(computeAssessmentStatus({ confidence: 0.95, completeness: 0.2, thresholdReached: false }, q)).toBe('insufficient_evidence');
    // Low confidence but high completeness
    expect(computeAssessmentStatus({ confidence: 0.2, completeness: 0.95, thresholdReached: false }, q)).toBe('partially_covered');
  });
});
