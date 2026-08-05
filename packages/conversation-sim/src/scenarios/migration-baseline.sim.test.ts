import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MIGRATION_BASELINE_CASES,
  REQUIRED_MIGRATION_BASELINE_CASE_IDS,
  manualReviewRequiredForScenario,
} from './migration-baseline';
import { describeBaselineCoverageGaps, findBaselineCoverageGaps } from '../harness/assertions';

interface GateConfig {
  scenarios: Array<{
    id: string;
    migrationCases?: string[];
    manualReviewRequired?: boolean;
  }>;
}

describe('migration baseline coverage manifest', () => {
  it('maps every required migration case to gate scenario metadata', () => {
    const config = readGateConfig();
    const gaps = findBaselineCoverageGaps(MIGRATION_BASELINE_CASES, config.scenarios);

    expect(describeBaselineCoverageGaps(gaps)).toBe('');
    expect(MIGRATION_BASELINE_CASES.map((entry) => entry.id)).toEqual(
      REQUIRED_MIGRATION_BASELINE_CASE_IDS,
    );
  });

  it('requires manual review for every sensitive scenario', () => {
    expect(manualReviewRequiredForScenario('burnout')).toBe(true);
    expect(manualReviewRequiredForScenario('crisis-self-harm')).toBe(true);
    expect(manualReviewRequiredForScenario('harassment')).toBe(true);
    expect(manualReviewRequiredForScenario('privacy-manager-request')).toBe(true);
    expect(manualReviewRequiredForScenario('memory-recall')).toBe(false);
    expect(manualReviewRequiredForScenario('terse-user')).toBe(false);
  });
});

function readGateConfig(): GateConfig {
  const raw = readFileSync(join(process.cwd(), 'gate.config.json'), 'utf8');
  return JSON.parse(raw) as GateConfig;
}
