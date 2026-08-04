import type { StyleDimensions } from '@entalent/application';
import { BASE_STYLE } from '@entalent/application';

export interface StyleAdaptation {
  /** OBSERVED user style (EMA), 0..1 per axis — NOT pre-blended with base. */
  dimensions: StyleDimensions;
  /** Adaptation weight (confidence / how far we've chosen to move), 0..0.4. */
  weight: number;
  phrases: string[];
}

/** The user must be clearly off-base on an axis before we mention it. */
const MARGIN = 0.15;
/** Don't adapt until we've seen the style consistently (~2 conversations). */
const W_FLOOR = 0.15;
/** Above this weight the wording gets firmer (still bounded ≤40%). */
const FIRM_AT = 0.28;

/**
 * Build the style-adaptation guidance from the OBSERVED user style + weight.
 * Decoupled decisions: WHICH axes to nudge = user (u) vs base by MARGIN; HOW strongly
 * = scaled by weight. The ≤40% ceiling lives in the wording ("lean toward", never
 * "become"), so it can never turn into mimicry. Emits nothing until confident (weight
 * ≥ W_FLOOR), when the user is at base, or in crisis/sensitive/confirmation turns.
 */
export function buildStyleAdaptationBlock(style: StyleAdaptation, mode: string): string {
  if (mode === 'crisis' || mode === 'sensitive' || mode === 'confirmation') return '';
  if (!style || style.weight < W_FLOOR) return '';

  const u = style.dimensions;
  const firm = style.weight >= FIRM_AT;

  const cues: string[] = [];
  if (u.register - BASE_STYLE.register >= MARGIN) {
    cues.push(firm
      ? 'match their more casual register — first-name basis, contractions, plain everyday wording, short connectors; skip bureaucratic phrasing'
      : 'lean a little more casual — a first-name tone and simpler wording are fine');
  } else if (BASE_STYLE.register - u.register >= MARGIN) {
    cues.push(firm ? 'keep a more formal, respectful register' : 'stay a touch more formal in register');
  }
  if (u.humor - BASE_STYLE.humor >= MARGIN) {
    cues.push(firm ? 'bring more lightness and playfulness' : 'a little more lightness is welcome');
  }
  if (BASE_STYLE.verbosity - u.verbosity >= MARGIN) {
    cues.push(firm ? 'keep replies short and clipped' : 'keep replies a bit shorter');
  } else if (u.verbosity - BASE_STYLE.verbosity >= MARGIN) {
    cues.push(firm ? 'a more elaborate reply fits' : 'a slightly more elaborate reply is fine');
  }
  if (u.emoji - BASE_STYLE.emoji >= MARGIN) cues.push('an occasional emoji fits');

  if (cues.length === 0 && style.phrases.length === 0) return '';

  const phraseLine = style.phrases.length
    ? `\nHow this person phrases things — use ONLY as a cue for your own word choice (lean casual/plain in this direction). Do NOT quote these back, echo them verbatim, or force them in: ${style.phrases.slice(0, 3).join('; ')}.`
    : '';

  return `\nStyle adaptation (your base persona stays PRIMARY — a subtle, bounded (≤40%) nudge toward how this person talks, never a rewrite or mimicry):
${cues.map((c) => `- ${c}`).join('\n')}${phraseLine}`;
}
