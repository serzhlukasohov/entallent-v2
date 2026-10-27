import { REPLY_MESSAGE_SEPARATOR, type CaseRun, type ObservationField, type ReplyMessage } from '../schema';
import { PROACTIVE_MESSAGE_TYPE } from './proactive';

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

/** A proactive (or, with `messageType: null`, unmarked) outbound message for fixtures and tests. */
export function outbound(id: string, occurredAt: string, messageType: string | null = PROACTIVE_MESSAGE_TYPE): ReplyMessage {
  return { id, text: `Check-in ${id}.`, occurredAt, metadata: messageType === null ? {} : { messageType } };
}

/** An observation run over a 7-day window starting Monday 2026-01-05 00:00 UTC. */
export function windowRun(testId: string, messages: ReplyMessage[]): CaseRun {
  return {
    ...syntheticRun(testId, [], ['window.outbound']),
    window: { from: '2026-01-05T00:00:00.000Z', to: '2026-01-12T00:00:00.000Z', outbound: messages },
  };
}

/** A one-step run with the given state snapshots, for state-rule fixtures. */
export function stateFixtureRun(
  testId: string,
  state: CaseRun['state'],
  observed: CaseRun['observed'],
  replies: ReadonlyArray<string | null> = ['Noted.'],
): CaseRun {
  return { ...syntheticRun(testId, replies, observed), state };
}
