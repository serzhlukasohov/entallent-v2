import { describe, expect, it } from 'vitest';
import {
  BUNDLE_COMPOSITION_BACKOFF,
  bundleCompositionFailureMetadata,
  readBundleCompositionBackoff,
} from './bundle-composition-backoff';

let seq = 0;
function outbound(metadata?: Record<string, unknown>) {
  seq += 1;
  return { id: `o-${seq}`, direction: 'outbound' as const, metadata };
}
function inbound() {
  seq += 1;
  return { id: `i-${seq}`, direction: 'inbound' as const, metadata: undefined };
}
const failed = (questionGroup: string, surveyWindowId = 'w-1') =>
  bundleCompositionFailureMetadata({ reason: 'question_count', questionGroup, surveyWindowId });

describe('readBundleCompositionBackoff (GC retro A1)', () => {
  it('skips a group whose composition failed twice in the same window', () => {
    expect(BUNDLE_COMPOSITION_BACKOFF.failuresBeforeSkip).toBe(2);
    expect(readBundleCompositionBackoff([
      inbound(), outbound(failed('autonomy')), inbound(), outbound(), inbound(), outbound(failed('autonomy')), inbound(),
    ])).toEqual([{ surveyWindowId: 'w-1', questionGroup: 'autonomy' }]);
  });

  it('keeps a group with one failure, and counts failures per window', () => {
    expect(readBundleCompositionBackoff([
      outbound(failed('autonomy')), outbound(failed('growth')), outbound(failed('growth', 'w-0')), inbound(),
    ])).toEqual([]);
  });

  it('ignores inbound messages and untagged legacy failures', () => {
    expect(readBundleCompositionBackoff([
      { direction: 'inbound', metadata: failed('autonomy') },
      { direction: 'inbound', metadata: failed('autonomy') },
      outbound({ v2BundleCompositionFallbackReason: 'unknown' }),
      outbound({ v2BundleCompositionFallbackReason: 'unknown' }),
    ])).toEqual([]);
  });

  it('writes the reason with its group and window', () => {
    expect(failed('purpose')).toEqual({
      v2BundleCompositionFallbackReason: 'question_count',
      v2BundleCompositionFallbackGroup: 'purpose',
      v2BundleCompositionFallbackWindowId: 'w-1',
    });
  });
});
