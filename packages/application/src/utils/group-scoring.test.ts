import { describe, it, expect } from 'vitest';
import { computeEngagementIndex, computeOpenEndedQuestionScore, computeGroupIndex } from './group-scoring';

describe('computeEngagementIndex', () => {
  it('computes average of three 0-10 scores scaled to 0-100', () => {
    expect(computeEngagementIndex(6, 8, 10)).toBeCloseTo(80, 1);
  });

  it('returns 0 for all zeros', () => {
    expect(computeEngagementIndex(0, 0, 0)).toBe(0);
  });

  it('returns 100 for all tens', () => {
    expect(computeEngagementIndex(10, 10, 10)).toBe(100);
  });

  it('rounds to two decimal places', () => {
    expect(computeEngagementIndex(1, 2, 3)).toBeCloseTo(20, 1);
  });
});

describe('computeOpenEndedQuestionScore', () => {
  it('returns 0.7 * 1 + 0.3 * sentiment for positive polarity', () => {
    expect(computeOpenEndedQuestionScore('positive', 0.8)).toBeCloseTo(0.94, 5);
  });

  it('returns 0.7 * 0.5 + 0.3 * sentiment for neutral polarity', () => {
    expect(computeOpenEndedQuestionScore('neutral', 0.5)).toBeCloseTo(0.5, 5);
  });

  it('returns 0.7 * 0 + 0.3 * sentiment for negative polarity', () => {
    expect(computeOpenEndedQuestionScore('negative', 0.2)).toBeCloseTo(0.06, 5);
  });

  it('clamps to [0, 1]', () => {
    expect(computeOpenEndedQuestionScore('positive', 1.5)).toBeLessThanOrEqual(1);
    expect(computeOpenEndedQuestionScore('negative', -0.5)).toBeGreaterThanOrEqual(0);
  });
});

describe('computeGroupIndex', () => {
  it('returns mean of question scores scaled to 100', () => {
    expect(computeGroupIndex([0.6, 0.8, 1.0])).toBeCloseTo(80, 1);
  });

  it('ignores empty array by returning 0', () => {
    expect(computeGroupIndex([])).toBe(0);
  });

  it('works with single question', () => {
    expect(computeGroupIndex([0.5])).toBeCloseTo(50, 1);
  });
});
