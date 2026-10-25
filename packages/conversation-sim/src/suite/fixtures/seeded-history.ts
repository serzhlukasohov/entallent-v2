import { z } from 'zod';
import { SIM_CONVERSATION_ID, SIM_TENANT_ID, SIM_USER_ID } from '../../harness/coach-harness';
import { satisfied, type FixtureModule } from './types';

const params = z.object({}).strict().default({});

/**
 * Writes the test's `seed.history` through the recorded conversation repository, each
 * turn at `start - atOffsetMs` (AD-4), and verifies every turn by reading it back.
 * Coach turns are outbound messages; they are not marked delivered (use
 * `disclosureDelivered` for a delivered disclosure).
 */
export const seededHistoryFixture: FixtureModule<z.infer<typeof params>> = {
  name: 'seededHistory',
  params,
  create(context) {
    const history = context.test.seed?.history ?? [];
    const at = (offset: number): Date => new Date(context.start.getTime() - offset);
    return {
      async apply() {
        for (const turn of history) {
          await context.ports.conversationRepo.saveMessage({
            conversationId: SIM_CONVERSATION_ID,
            tenantId: SIM_TENANT_ID,
            userId: SIM_USER_ID,
            direction: turn.role === 'user' ? 'inbound' : 'outbound',
            text: turn.text,
            occurredAt: at(turn.atOffsetMs),
            ...(turn.metadata ? { metadata: { ...turn.metadata } } : {}),
          });
        }
      },
      async verify() {
        const messages = context.state.conversationRepo.messages;
        let cursor = 0;
        for (const [index, turn] of history.entries()) {
          const direction = turn.role === 'user' ? 'inbound' : 'outbound';
          const found = messages.findIndex(
            (message, position) =>
              position >= cursor &&
              message.direction === direction &&
              message.text === turn.text &&
              message.occurredAt.getTime() === at(turn.atOffsetMs).getTime(),
          );
          if (found < 0) return satisfied('seededHistory', false, `seed turn ${index + 1} not found`);
          cursor = found + 1;
        }
        return satisfied('seededHistory', true, `${history.length} seed turns`);
      },
    };
  },
};
