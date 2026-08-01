import { describe, it, expect } from 'vitest';
import { DEFAULT_STYLE_PROFILE, updateStyleProfile, effectiveStyleLevels, BASE_STYLE, WEIGHT_CAP } from './style-adaptation';

const observed = { dimensions: { register: 1, humor: 1, verbosity: 1, emoji: 1 }, phrases: ['ну такое', 'по кайфу'] };

describe('updateStyleProfile', () => {
  it('EMA nudges dimensions toward observed (alpha 0.3)', () => {
    const p = DEFAULT_STYLE_PROFILE('u', 't'); // register base 0.5
    const next = updateStyleProfile(p, observed, 5);
    expect(next.dimensions.register).toBeCloseTo(0.5 + 0.3 * (1 - 0.5), 5); // 0.65
  });

  it('ramps weight by 0.075 when enough user turns', () => {
    const next = updateStyleProfile(DEFAULT_STYLE_PROFILE('u', 't'), observed, 5);
    expect(next.adaptationWeight).toBeCloseTo(0.075, 5);
    expect(next.conversationsAnalyzed).toBe(1);
  });

  it('does not ramp weight when fewer than MIN_USER_TURNS', () => {
    const next = updateStyleProfile(DEFAULT_STYLE_PROFILE('u', 't'), observed, 2);
    expect(next.adaptationWeight).toBe(0);
  });

  it('caps weight at 0.4', () => {
    let p = DEFAULT_STYLE_PROFILE('u', 't');
    for (let i = 0; i < 20; i++) p = updateStyleProfile(p, observed, 5);
    expect(p.adaptationWeight).toBe(WEIGHT_CAP);
  });

  it('merges phrases, dedupes with counts, caps at 5', () => {
    let p = updateStyleProfile(DEFAULT_STYLE_PROFILE('u', 't'), observed, 5);
    p = updateStyleProfile(p, { dimensions: observed.dimensions, phrases: ['ну такое', 'x', 'y', 'z', 'w', 'v'] }, 5);
    expect(p.phrases.length).toBeLessThanOrEqual(5);
    expect(p.phrases.find((x) => x.text === 'ну такое')?.count).toBe(2);
  });
});

describe('effectiveStyleLevels', () => {
  it('blends base and user by weight', () => {
    const p = { ...DEFAULT_STYLE_PROFILE('u', 't'), dimensions: { register: 1, humor: 1, verbosity: 1, emoji: 1 }, adaptationWeight: 0.4 };
    // base 0.5, user 1, w 0.4 -> 0.5*0.6 + 1*0.4 = 0.7
    expect(effectiveStyleLevels(p).register).toBeCloseTo(0.7, 5);
  });
  it('cold start (w=0) equals base', () => {
    expect(effectiveStyleLevels(DEFAULT_STYLE_PROFILE('u', 't'))).toEqual(BASE_STYLE);
  });
});
