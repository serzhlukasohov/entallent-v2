import { expect, it } from 'vitest';
import { engagementAnswerSchema, engagementProbeSchema } from './pulse-engagement';
it('requires an exact versioned integer answer and complete prompt identity', () => {
  for (const value of [1, 7, 10]) expect(engagementAnswerSchema.safeParse(value).success).toBe(true);
  for (const value of [0, -1, 11, 7.5, '7']) expect(engagementAnswerSchema.safeParse(value).success).toBe(false);
  expect(engagementProbeSchema.safeParse({ stableKey: 'engagement_nps' }).success).toBe(false);
});
