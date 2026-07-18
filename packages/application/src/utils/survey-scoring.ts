import type { SurveyQuestionRecord } from '../types/records';

export function computeAssessmentStatus(
  ev: { confidence: number; completeness: number; thresholdReached: boolean },
  question: SurveyQuestionRecord,
): string {
  if (
    ev.thresholdReached ||
    (ev.confidence >= question.confidenceThreshold &&
      ev.completeness >= question.completenessThreshold)
  ) {
    return 'scored';
  }
  if (ev.completeness >= 0.4) return 'partially_covered';
  return 'insufficient_evidence';
}
