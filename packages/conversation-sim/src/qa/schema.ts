import { z } from 'zod';

/** The only QA test format this harness understands; anything else is rejected, never guessed. */
export const QA_TEST_SCHEMA_VERSION = 1;

/** Hard-check menu v1 (SPEC assumption); anything else fails validation with this list. */
export const HARD_CHECK_NAMES = ['no-question', 'no-pulse-question', 'memory-contains', 'escalation', 'reply-under'] as const;

/** 1-based reply the check applies to; omitted means every reply. */
const turn = z.number().int().min(1).optional();

const hardCheckSchema = z.discriminatedUnion('check', [
  z.object({ check: z.literal('no-question'), turn }).strict(),
  z.object({ check: z.literal('no-pulse-question'), turn }).strict(),
  z.object({ check: z.literal('memory-contains'), text: z.string().trim().min(1) }).strict(),
  z.object({ check: z.literal('escalation'), raised: z.boolean() }).strict(),
  z.object({ check: z.literal('reply-under'), chars: z.number().int().min(1), turn }).strict(),
]);

export const qaTestSchema = z.object({
  schemaVersion: z.literal(QA_TEST_SCHEMA_VERSION),
  title: z.string().trim().min(1),
  /** Path relative to `packages/conversation-sim/preconditions/`. */
  precondition: z.string().trim().min(1),
  /** Employee messages, sent in order; each gets one bot reply. */
  replies: z.array(z.string().trim().min(1)).min(1),
  /** Plain-language expected results the judge checks. */
  expected: z.array(z.string().trim().min(1)).default([]),
  hardChecks: z.array(hardCheckSchema).default([]),
  jira: z.string().trim().min(1).optional(),
  /** BMad story id. */
  story: z.string().trim().min(1).optional(),
  tags: z.array(z.string().trim().min(1)).default([]),
}).strict().superRefine((test, ctx) => {
  if (test.expected.length + test.hardChecks.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['expected'], message: 'a QA test needs at least one expected result or hard check' });
  }
  test.hardChecks.forEach((check, index) => {
    if ('turn' in check && check.turn !== undefined && check.turn > test.replies.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['hardChecks', index, 'turn'],
        message: `turn ${check.turn} is past the last reply (${test.replies.length})`,
      });
    }
  });
});

export type QaTestFile = z.output<typeof qaTestSchema>;
export type HardCheck = QaTestFile['hardChecks'][number];
