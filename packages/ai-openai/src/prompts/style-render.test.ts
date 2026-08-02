import { describe, it, expect } from 'vitest';
import { buildStyleAdaptationBlock } from './style-render';

// Raw high-dim fixture (no longer representative of real pipeline, kept for basic sanity)
const hi = { dimensions: { register: 0.9, humor: 0.8, verbosity: 0.7, emoji: 0.6 }, weight: 0.4, phrases: ['ну такое'] };

// Realistic blended values: max-casual user at w=0.4
// effectiveStyleLevels output: base*(1-0.4) + user*0.4
//   register: 0.5*0.6 + 1*0.4 = 0.7  (delta from base 0.5 = +0.20 ≥ 0.12 → casual cue)
//   humor:    0.3*0.6 + 1*0.4 = 0.58 (delta from base 0.3 = +0.28 ≥ 0.12 → playful cue)
//   verbosity:0.5*0.6 + 1*0.4 = 0.70 (delta from base 0.5 = +0.20 ≥ 0.12 → elaborate cue)
//   emoji:    0.2*0.6 + 1*0.4 = 0.52 (delta from base 0.2 = +0.32 ≥ 0.12 → emoji cue)
const blended = {
  dimensions: { register: 0.7, humor: 0.58, verbosity: 0.7, emoji: 0.52 },
  weight: 0.4,
  phrases: ['ну такое'],
};

describe('buildStyleAdaptationBlock', () => {
  it('emits scaled guidance when weight is meaningful', () => {
    const b = buildStyleAdaptationBlock(hi, 'normal');
    expect(b).toMatch(/casual|ты|неформаль/i);
    expect(b).toContain('ну такое');
    expect(b.toLowerCase()).toMatch(/base|persona|primary|основ/);
  });

  it('emits nothing at cold start (weight 0)', () => {
    expect(buildStyleAdaptationBlock({ dimensions: hi.dimensions, weight: 0, phrases: [] }, 'normal')).toBe('');
  });

  it('emits nothing in crisis or sensitive mode', () => {
    expect(buildStyleAdaptationBlock(hi, 'crisis')).toBe('');
    expect(buildStyleAdaptationBlock(hi, 'sensitive')).toBe('');
  });

  it('emits nothing in confirmation mode', () => {
    expect(buildStyleAdaptationBlock(hi, 'confirmation')).toBe('');
  });

  it('emits humor, emoji, and casual cues for realistic blended dims (humor & emoji no longer dead)', () => {
    const b = buildStyleAdaptationBlock(blended, 'normal');
    // Casual/register cue
    expect(b).toMatch(/casual|ты|неформаль/i);
    // Humor/playful cue
    expect(b).toMatch(/lightness|playful/i);
    // Emoji cue
    expect(b).toMatch(/emoji/i);
    // Base-persona framing present
    expect(b.toLowerCase()).toMatch(/base|persona|primary/);
    // Phrase appears
    expect(b).toContain('ну такое');
  });
});
