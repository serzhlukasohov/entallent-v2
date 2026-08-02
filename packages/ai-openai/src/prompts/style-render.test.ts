import { describe, it, expect } from 'vitest';
import { buildStyleAdaptationBlock } from './style-render';

// A realistic MODERATE observed profile (from a real prod user): casual + short, not
// playful, few emoji. This is the case the old effective-blend logic silently failed
// to fire — dimensions are the OBSERVED user style (u), not pre-blended.
const realProfile = {
  dimensions: { register: 0.72, humor: 0.29, verbosity: 0.27, emoji: 0.11 },
  weight: 0.3,
  phrases: ['на чиле', 'по факт'],
};

describe('buildStyleAdaptationBlock', () => {
  it('fires casual + shorter cues for a realistic moderate profile', () => {
    const b = buildStyleAdaptationBlock(realProfile, 'normal');
    expect(b).toMatch(/casual|ты/i);         // register cue fires
    expect(b).toMatch(/shorter|clipped/i);   // verbosity cue fires
    expect(b).not.toMatch(/playful|lightness/i); // humor ~base → no cue
    expect(b).not.toMatch(/emoji/i);         // emoji below base → no cue
    expect(b).toContain('на чиле');          // phrase echo present
    expect(b.toLowerCase()).toMatch(/base persona stays primary|≤40%/);
  });

  it('emits nothing below the confidence floor (weight < 0.15)', () => {
    expect(buildStyleAdaptationBlock({ ...realProfile, weight: 0.1 }, 'normal')).toBe('');
  });

  it('emits nothing when the user sits at base, even at max weight', () => {
    const atBase = { dimensions: { register: 0.5, humor: 0.3, verbosity: 0.5, emoji: 0.2 }, weight: 0.4, phrases: [] };
    expect(buildStyleAdaptationBlock(atBase, 'normal')).toBe('');
  });

  it('uses firmer wording at higher weight', () => {
    const soft = buildStyleAdaptationBlock({ ...realProfile, weight: 0.2 }, 'normal');
    const firm = buildStyleAdaptationBlock({ ...realProfile, weight: 0.4 }, 'normal');
    expect(soft).toMatch(/lean a little more casual/i);
    expect(firm).toMatch(/match their more casual/i);
  });

  it('emits nothing in crisis, sensitive, or confirmation mode', () => {
    expect(buildStyleAdaptationBlock(realProfile, 'crisis')).toBe('');
    expect(buildStyleAdaptationBlock(realProfile, 'sensitive')).toBe('');
    expect(buildStyleAdaptationBlock(realProfile, 'confirmation')).toBe('');
  });
});
