import { z } from 'zod';
import { SIM_CONVERSATION_ID, SIM_TENANT_ID, SIM_USER_ID } from '../../harness/coach-harness';
import { satisfied, type FixtureModule } from './types';

const params = z
  .object({
    /** The bot question, verbatim. */
    text: z.string().min(1),
    /** How long before the first step the question was sent. */
    atOffsetMs: z.number().int().nonnegative(),
    /** Stored message type, e.g. `proactive_check_in` for a bot-initiated question. */
    messageType: z.string().min(1).optional(),
  })
  .strict();

/**
 * The last message of the conversation is an outbound bot question with no inbound after
 * it (P-03). Apply it after `seededHistory` so it is the latest message.
 */
export const pendingBotQuestionFixture: FixtureModule<z.infer<typeof params>> = {
  name: 'pendingBotQuestion',
  params,
  create(context, value) {
    const occurredAt = new Date(context.start.getTime() - value.atOffsetMs);
    return {
      async apply() {
        await context.ports.conversationRepo.saveMessage({
          conversationId: SIM_CONVERSATION_ID,
          tenantId: SIM_TENANT_ID,
          userId: SIM_USER_ID,
          direction: 'outbound',
          text: value.text,
          occurredAt,
          ...(value.messageType ? { messageType: value.messageType } : {}),
        });
      },
      async verify() {
        const messages = context.state.conversationRepo.messages;
        const question = [...messages]
          .reverse()
          .find((message) => message.direction === 'outbound' && message.text === value.text);
        if (!question) return satisfied('pendingBotQuestion', false, 'question not found');
        const latest = Math.max(...messages.map((message) => message.occurredAt.getTime()));
        const answered = messages.some(
          (message) => message.direction === 'inbound' && message.occurredAt.getTime() >= question.occurredAt.getTime(),
        );
        if (answered) return satisfied('pendingBotQuestion', false, 'an inbound message follows the question');
        return satisfied(
          'pendingBotQuestion',
          question.occurredAt.getTime() === latest,
          question.occurredAt.getTime() === latest ? undefined : 'a later message follows the question',
        );
      },
    };
  },
};
