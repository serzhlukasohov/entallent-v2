import type { PreconditionBody, Preset } from './schema';

/** Topic order of the pulse cycle (`CANONICAL_GROUP_ORDER` in the pulse backlog service). */
const CYCLE_GROUPS = ['autonomy', 'belonging', 'growth', 'purpose'];

/**
 * Named states that are hard to reach by chatting. Each returns a partial precondition; presets
 * are applied in order and the file's explicit fields are applied over them.
 */
export function expandPreset(preset: Preset): PreconditionBody {
  switch (preset.name) {
    case 'onboarding-done':
      return { onboarding: { role: 'employee', introStatus: 'completed', participation: 'active', buttonsActive: false } };
    case 'cycle-open':
      return {
        pulseCycle: {
          open: true,
          topics: Array.from({ length: preset.topicsTotal }, (_, index) => {
            const group = CYCLE_GROUPS[index] ?? `topic-${index + 1}`;
            return {
              group,
              questions: [{ id: `q-${group}`, status: index < preset.topicsClosed ? 'confirmed' : 'collecting' }],
            };
          }),
        },
      };
    case 'elapsed':
      return { elapsedMinutes: preset.minutes };
  }
}

/** Short label for the report, for example `cycle-open (3 topics, 1 closed)`. */
export function describePreset(preset: Preset): string {
  switch (preset.name) {
    case 'onboarding-done':
      return 'onboarding-done';
    case 'cycle-open':
      return `cycle-open (${preset.topicsTotal} topics, ${preset.topicsClosed} closed)`;
    case 'elapsed':
      return `elapsed (${preset.minutes} min since the last message)`;
  }
}

/**
 * Applies `next` over `base`: a state area that is an object on both sides is merged one level
 * deep (so explicit `pulseCycle.topics` replaces a preset's topics but keeps its other fields);
 * anything else is replaced.
 */
export function mergeBodies(base: PreconditionBody, next: PreconditionBody): PreconditionBody {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(next)) {
    if (value === undefined) continue;
    const current = merged[key];
    merged[key] = isPlainObject(current) && isPlainObject(value) ? { ...current, ...value } : value;
  }
  return merged as PreconditionBody;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
