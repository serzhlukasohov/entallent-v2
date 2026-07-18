import { describe, it, expect } from 'vitest';
import { buildEmployeeRows, type BuildEmployeeRowsInput } from './manager-team.aggregate';

function baseInput(overrides: Partial<BuildEmployeeRowsInput> = {}): BuildEmployeeRowsInput {
  return {
    teamUsers: [{ id: 'u1', displayName: 'Alice' }],
    lastMessages: [],
    activeRiskUserIds: [],
    assessments: [],
    evidence: [],
    ...overrides,
  };
}

describe('buildEmployeeRows', () => {
  it('computes coverage from scored + partially_covered over total', () => {
    const rows = buildEmployeeRows(
      baseInput({
        assessments: [
          a('u1', 'q1', 'scored'),
          a('u1', 'q2', 'partially_covered'),
          a('u1', 'q3', 'insufficient_evidence'),
          a('u1', 'q4', 'unknown'),
        ],
      }),
    );
    expect(rows[0].totalQuestions).toBe(4);
    expect(rows[0].scoredCount).toBe(2);
    expect(rows[0].coveragePct).toBe(50);
  });

  it('attaches the strongest evidence to each question', () => {
    const rows = buildEmployeeRows(
      baseInput({
        assessments: [a('u1', 'q1', 'scored')],
        // pre-ordered by strength DESC (as the SQL guarantees)
        evidence: [
          e('u1', 'q1', 'negative', 0.9, 0.8, 'strong negative read'),
          e('u1', 'q1', 'positive', 0.4, 0.5, 'weaker positive read'),
        ],
      }),
    );
    const sig = rows[0].signals[0];
    expect(sig.polarity).toBe('negative');
    expect(sig.strength).toBe(0.9);
    expect(sig.evidenceSummary).toBe('strong negative read');
  });

  it('leaves signals without evidence as nulls', () => {
    const rows = buildEmployeeRows(baseInput({ assessments: [a('u1', 'q1', 'unknown')] }));
    const sig = rows[0].signals[0];
    expect(sig.polarity).toBeNull();
    expect(sig.strength).toBeNull();
    expect(sig.evidenceSummary).toBeNull();
  });

  it('sorts signals by stableKey', () => {
    const rows = buildEmployeeRows(
      baseInput({
        assessments: [a('u1', 'q12_c', 'scored'), a('u1', 'q12_a', 'scored'), a('u1', 'q12_b', 'scored')],
      }),
    );
    expect(rows[0].signals.map((s) => s.stableKey)).toEqual(['q12_a', 'q12_b', 'q12_c']);
  });

  it('sorts employees risk-first, then by coverage desc', () => {
    const rows = buildEmployeeRows({
      teamUsers: [
        { id: 'high', displayName: 'HighCoverage' },
        { id: 'risk', displayName: 'AtRisk' },
        { id: 'low', displayName: 'LowCoverage' },
      ],
      lastMessages: [],
      activeRiskUserIds: [{ userId: 'risk' }],
      assessments: [
        a('high', 'q1', 'scored'),
        a('high', 'q2', 'scored'),
        a('low', 'q1', 'scored'),
        a('low', 'q2', 'unknown'),
        a('risk', 'q1', 'unknown'),
      ],
      evidence: [],
    });
    // AtRisk first despite 0% coverage; then HighCoverage (100%) before LowCoverage (50%)
    expect(rows.map((r) => r.userId)).toEqual(['risk', 'high', 'low']);
  });

  it('falls back to userId when displayName is null and maps lastActive', () => {
    const when = new Date('2026-07-01T12:00:00Z');
    const rows = buildEmployeeRows(
      baseInput({
        teamUsers: [{ id: 'u1', displayName: null }],
        lastMessages: [{ userId: 'u1', occurredAt: when }],
      }),
    );
    expect(rows[0].displayName).toBe('u1');
    expect(rows[0].lastActiveAt).toBe(when.toISOString());
  });

  it('handles a user with no assessments as 0% coverage', () => {
    const rows = buildEmployeeRows(baseInput());
    expect(rows[0]).toMatchObject({ totalQuestions: 0, scoredCount: 0, coveragePct: 0, signals: [] });
  });
});

function a(userId: string, questionId: string, status: string) {
  return {
    userId,
    windowId: 'w1',
    questionId,
    stableKey: questionId,
    title: `Title ${questionId}`,
    dimension: 'engagement',
    assessmentStatus: status,
  };
}

function e(
  userId: string,
  questionId: string,
  polarity: string,
  strength: number,
  confidence: number,
  summary: string,
) {
  return { userId, questionId, polarity, strength, confidence, evidenceSummary: summary };
}
