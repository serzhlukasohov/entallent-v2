import type { BundleCompositionInvalidReason } from './question-bundle-composition';

/**
 * GC round 3 retro A1: a ready bundle whose composition keeps failing is skipped, so later groups
 * are not blocked and each turn does not spend compose and repair calls on it. The memory is the
 * outbound metadata of the loaded message window (no schema): the backoff decays as those
 * messages leave the window, which is the retry policy.
 */
export const BUNDLE_COMPOSITION_BACKOFF = {
  failuresBeforeSkip: 2,
} as const;

export interface BundleBackoffGroup {
  surveyWindowId: string;
  questionGroup: string;
}

interface BackoffMessage {
  direction: 'inbound' | 'outbound';
  metadata?: Record<string, unknown>;
}

/** Outbound metadata for a ready bundle skipped because its composition stayed invalid. */
export function bundleCompositionFailureMetadata(input: {
  reason: BundleCompositionInvalidReason | 'unknown';
  questionGroup: string;
  surveyWindowId: string;
}): Record<string, string> {
  return {
    v2BundleCompositionFallbackReason: input.reason,
    v2BundleCompositionFallbackGroup: input.questionGroup,
    v2BundleCompositionFallbackWindowId: input.surveyWindowId,
  };
}

/** Groups to skip this turn, in first-failure order; untagged legacy failures do not count. */
export function readBundleCompositionBackoff(messages: readonly BackoffMessage[]): BundleBackoffGroup[] {
  const failures = new Map<string, BundleBackoffGroup & { count: number }>();
  for (const message of messages) {
    if (message.direction !== 'outbound') continue;
    const reason = message.metadata?.['v2BundleCompositionFallbackReason'];
    const questionGroup = message.metadata?.['v2BundleCompositionFallbackGroup'];
    const surveyWindowId = message.metadata?.['v2BundleCompositionFallbackWindowId'];
    if (typeof reason !== 'string' || typeof questionGroup !== 'string' || typeof surveyWindowId !== 'string') continue;
    const key = `${surveyWindowId}\u0000${questionGroup}`;
    const entry = failures.get(key) ?? { surveyWindowId, questionGroup, count: 0 };
    entry.count += 1;
    failures.set(key, entry);
  }
  return [...failures.values()]
    .filter((entry) => entry.count >= BUNDLE_COMPOSITION_BACKOFF.failuresBeforeSkip)
    .map(({ surveyWindowId, questionGroup }) => ({ surveyWindowId, questionGroup }));
}
