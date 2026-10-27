import { MemoryCategorySchema } from '@entalent/contracts';
import { z } from 'zod';
import { SIM_TENANT_ID, SIM_USER_ID } from '../../harness/coach-harness';
import { satisfied, type FixtureModule } from './types';

const params = z
  .object({
    items: z
      .array(
        z
          .object({
            category: MemoryCategorySchema,
            /** The fact as the extractor would store it, verbatim. */
            content: z.string().min(1),
            /** 0-1, as the extractor proposes it; higher items are read first. */
            importance: z.number().min(0).max(1).default(0.7),
            canonicalKey: z.string().min(1).optional(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

/**
 * Active long-term memory items for the test persona, as if extracted from earlier
 * conversations. Written to the raw memory fake, so they add no events; the reply model
 * receives them through the product's own memory read (see the call's context digest).
 */
export const memoryItemsFixture: FixtureModule<z.infer<typeof params>> = {
  name: 'memoryItems',
  params,
  create(context, value) {
    return {
      async apply() {
        for (const item of value.items) {
          await context.state.memoryRepo.save({
            tenantId: SIM_TENANT_ID,
            userId: SIM_USER_ID,
            category: item.category,
            content: item.content,
            importance: item.importance,
            confidence: 1,
            sensitivity: 'normal',
            sourceMessageIds: [],
            ...(item.canonicalKey !== undefined ? { canonicalKey: item.canonicalKey } : {}),
          });
        }
      },
      async verify() {
        const active = await context.state.memoryRepo.findActiveByUser(SIM_USER_ID, SIM_TENANT_ID, 100);
        const missing = value.items.filter((item) => !active.some((stored) => stored.content === item.content));
        return satisfied(
          'memoryItems',
          missing.length === 0,
          missing.length > 0 ? `missing ${missing.length} of ${value.items.length} items` : undefined,
        );
      },
    };
  },
};
