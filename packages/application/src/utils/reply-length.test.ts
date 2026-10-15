import { describe, expect, it } from 'vitest';
import { maxReplyChars } from './reply-length';

describe('maxReplyChars', () => {
  it('keeps the tiered budget on ordinary turns', () => {
    expect(maxReplyChars({ maxResponseLength: 'medium' }, {})).toBe(680);
    expect(maxReplyChars({ maxResponseLength: 'short' }, {})).toBe(360);
  });

  it('gives an explicit format request the long budget so a list is not collapsed into prose (GC round 3 CAP-9)', () => {
    const plan = { formatRequest: 'outline' } as NonNullable<Parameters<typeof maxReplyChars>[1]['replyPlan']>;
    expect(maxReplyChars({ maxResponseLength: 'medium' }, { replyPlan: plan })).toBe(980);
    expect(maxReplyChars({ maxResponseLength: 'short' }, { replyPlan: plan })).toBe(980);
  });
});
