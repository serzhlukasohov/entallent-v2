import type { StyleDimensions } from '@entalent/application';

export interface StyleAdaptation {
  dimensions: StyleDimensions;
  weight: number;
  phrases: string[];
}

const HI = 0.6;
const LO = 0.4;

export function buildStyleAdaptationBlock(style: StyleAdaptation, mode: string): string {
  if (mode === 'crisis' || mode === 'sensitive') return '';
  if (!style || style.weight <= 0) return '';

  const cues: string[] = [];
  const d = style.dimensions;
  if (d.register >= HI) cues.push('lean a little more casual — «ты» and informal phrasing are fine');
  else if (d.register <= LO) cues.push('stay a touch more formal/respectful in register');
  if (d.humor >= HI) cues.push('a bit more lightness/playfulness is welcome');
  if (d.verbosity <= LO) cues.push('keep replies shorter and more clipped');
  else if (d.verbosity >= HI) cues.push('a slightly more elaborate reply is fine');
  if (d.emoji >= HI) cues.push('an occasional emoji fits');

  if (cues.length === 0 && style.phrases.length === 0) return '';

  const phraseLine = style.phrases.length
    ? `\nExpressions this person uses that you may occasionally echo — sparingly, only if natural, never forced: ${style.phrases.slice(0, 2).join(', ')}.`
    : '';

  return `\nStyle adaptation (your base persona stays PRIMARY — this is a subtle ≤40% nudge toward how ${'{the employee}'} talks, not a rewrite):
${cues.map((c) => `- ${c}`).join('\n')}${phraseLine}`;
}
