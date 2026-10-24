import { REPLY_MESSAGE_SEPARATOR, type CaseRun, type ObservationField } from '../schema';

const BASE_TIME = Date.UTC(2026, 0, 5, 10, 0, 0);

/**
 * A minimal executor-independent `CaseRun` for rule fixtures: one step per entry,
 * `null` meaning observed silence on that step.
 */
export function syntheticRun(
  testId: string,
  replies: ReadonlyArray<string | null>,
  observed: ObservationField[] = ['reply.text', 'reply.messages'],
): CaseRun {
  return {
    testId,
    level: 'L0',
    attempt: 1,
    subject: { externalUserId: `fixture-${testId}` },
    observed,
    preconditions: [],
    steps: replies.map((text, position) => {
      const index = position + 1;
      const occurredAt = new Date(BASE_TIME + index * 60_000).toISOString();
      return {
        index,
        userText: `user message ${index}`,
        traceId: `${testId}-trace-${index}`,
        gapMs: 60_000,
        reply:
          text === null
            ? null
            : {
                messages: [{ id: `${testId}-m${index}`, text, occurredAt, metadata: {} }],
                text: [text].join(REPLY_MESSAGE_SEPARATOR),
              },
        unsolicited: [],
      };
    }),
    state: { before: {}, after: {}, afterStep: {} },
    errors: [],
    events: [],
  };
}
