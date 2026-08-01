import type { StyleDimensions, StyleProfileRecord } from '../types/records';

export const EMA_ALPHA = 0.3;
export const WEIGHT_STEP = 0.075;
export const WEIGHT_CAP = 0.4;
export const MIN_USER_TURNS = 3;
export const MAX_PHRASES = 5;

export const BASE_STYLE: StyleDimensions = { register: 0.5, humor: 0.3, verbosity: 0.5, emoji: 0.2 };

export interface ObservedStyle {
  dimensions: StyleDimensions;
  phrases: string[];
}

export function DEFAULT_STYLE_PROFILE(userId: string, tenantId: string): StyleProfileRecord {
  return {
    userId,
    tenantId,
    dimensions: { ...BASE_STYLE },
    phrases: [],
    adaptationWeight: 0,
    conversationsAnalyzed: 0,
    updatedAt: new Date(),
  };
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const DIMS: (keyof StyleDimensions)[] = ['register', 'humor', 'verbosity', 'emoji'];

export function updateStyleProfile(
  current: StyleProfileRecord,
  observed: ObservedStyle,
  userTurnCount: number,
): StyleProfileRecord {
  const dimensions = { ...current.dimensions };
  for (const d of DIMS) {
    dimensions[d] = clamp01(current.dimensions[d] + EMA_ALPHA * (clamp01(observed.dimensions[d]) - current.dimensions[d]));
  }

  const enoughSignal = userTurnCount >= MIN_USER_TURNS;
  const adaptationWeight = enoughSignal
    ? Math.min(WEIGHT_CAP, current.adaptationWeight + WEIGHT_STEP)
    : current.adaptationWeight;

  // Merge phrases (dedupe, bump counts), keep top MAX_PHRASES by count.
  const byText = new Map(current.phrases.map((p) => [p.text, { ...p }]));
  for (const text of observed.phrases) {
    const existing = byText.get(text);
    if (existing) existing.count += 1;
    else byText.set(text, { text, count: 1 });
  }
  const phrases = [...byText.values()].sort((a, b) => b.count - a.count).slice(0, MAX_PHRASES);

  return {
    ...current,
    dimensions,
    phrases,
    adaptationWeight,
    conversationsAnalyzed: current.conversationsAnalyzed + 1,
    updatedAt: new Date(),
  };
}

export function effectiveStyleLevels(profile: StyleProfileRecord): StyleDimensions {
  const w = profile.adaptationWeight;
  const out = {} as StyleDimensions;
  for (const d of DIMS) out[d] = BASE_STYLE[d] * (1 - w) + profile.dimensions[d] * w;
  return out;
}
