import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  evaluatePulseNarrativeOffline,
  type PulseNarrativeEvaluationCase,
  PULSE_NARRATIVE_EVALUATION_RUBRIC,
} from '../evaluators/pulse-report-narrative.eval';
describe('RPT06 offline rubric harness, no model egress', () => {
  const cases = JSON.parse(
    readFileSync(
      resolve(__dirname, '../fixtures/pulse-report-narrative/offline-cases.json'),
      'utf8',
    ),
  ) as PulseNarrativeEvaluationCase[];
  for (const fixture of cases)
    it(fixture.caseKey, () => {
      const result = evaluatePulseNarrativeOffline(fixture);
      expect(result.shape).toBe('passed');
      expect(result.localReferences).toBe('passed');
      expect(result.semanticAcceptance).toBe('not_evaluated');
      expect(result.multilingualAcceptance).toBe('not_evaluated');
      expect(result.rubric).toHaveLength(10);
    });
  it('rubric retains distinct causal, role, identity and cross-section dimensions', () => {
    expect(PULSE_NARRATIVE_EVALUATION_RUBRIC).toContain('source_entailment');
    expect(PULSE_NARRATIVE_EVALUATION_RUBRIC).toContain('overall_child_distinction');
  });
});
