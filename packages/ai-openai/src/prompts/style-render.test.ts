import { describe, it, expect } from 'vitest';
import { buildStyleAdaptationBlock } from './style-render';

const hi = { dimensions: { register: 0.9, humor: 0.8, verbosity: 0.7, emoji: 0.6 }, weight: 0.4, phrases: ['ну такое'] };

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
});
