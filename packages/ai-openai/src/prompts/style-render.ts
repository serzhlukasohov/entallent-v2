import type { StyleDimensions } from '@entalent/application';
import { BASE_STYLE } from '@entalent/application';

export interface StyleAdaptation {
  dimensions: StyleDimensions;
  weight: number;
  phrases: string[];
}

const DELTA = 0.12; // effective must differ from base by this to emit a cue

export function buildStyleAdaptationBlock(style: StyleAdaptation, mode: string): string {
  if (mode === 'crisis' || mode === 'sensitive' || mode === 'confirmation') return '';
  if (!style || style.weight <= 0) return '';

  const cues: string[] = [];
  const d = style.dimensions;
  if (d.register - BASE_STYLE.register >= DELTA) cues.push('lean a little more casual — «ты» and informal phrasing are fine');
  else if (d.register - BASE_STYLE.register <= -DELTA) cues.push('stay a touch more formal/respectful in register');
  if (d.humor - BASE_STYLE.humor >= DELTA) cues.push('a bit more lightness/playfulness is welcome');
  if (d.verbosity - BASE_STYLE.verbosity <= -DELTA) cues.push('keep replies shorter and more clipped');
  else if (d.verbosity - BASE_STYLE.verbosity >= DELTA) cues.push('a slightly more elaborate reply is fine');
  if (d.emoji - BASE_STYLE.emoji >= DELTA) cues.push('an occasional emoji fits');

  if (cues.length === 0 && style.phrases.length === 0) return '';

  const phraseLine = style.phrases.length
    ? `\nExpressions this person uses that you may occasionally echo — sparingly, only if natural, never forced: ${style.phrases.slice(0, 2).join(', ')}.`
    : '';

  return `\nStyle adaptation (your base persona stays PRIMARY — this is a subtle ≤40% nudge toward how this person talks, not a rewrite):
${cues.map((c) => `- ${c}`).join('\n')}${phraseLine}`;
}
