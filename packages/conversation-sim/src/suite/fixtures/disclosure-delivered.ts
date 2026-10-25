import { z } from 'zod';
import { SIM_CONVERSATION_ID, SIM_TENANT_ID, SIM_USER_ID } from '../../harness/coach-harness';
import { satisfied, type FixtureModule } from './types';

/** `REPORTING_DISCLOSURE_VERSION` in `packages/application/src/utils/reporting-disclosure.ts` (not exported). */
const CURRENT_DISCLOSURE_VERSION = 'reporting-disclosure-v1';

const params = z
  .object({
    /** The outbound text that carried the disclosure. */
    text: z.string().min(1),
    /** How long before the first step it was sent and delivered; must be before the turn. */
    atOffsetMs: z.number().int().positive(),
    version: z.string().min(1).default(CURRENT_DISCLOSURE_VERSION),
  })
  .strict();

/**
 * An outbound message with `metadata.reportingDisclosureVersion`, marked delivered at its
 * own timestamp (P-07, P-09, P-10), verified through the repository's delivered-disclosure
 * lookup as the orchestrator reads it.
 */
export const disclosureDeliveredFixture: FixtureModule<z.infer<typeof params>> = {
  name: 'disclosureDelivered',
  params,
  create(context, value) {
    const occurredAt = new Date(context.start.getTime() - value.atOffsetMs);
    return {
      async apply() {
        const message = await context.ports.conversationRepo.saveMessage({
          conversationId: SIM_CONVERSATION_ID,
          tenantId: SIM_TENANT_ID,
          userId: SIM_USER_ID,
          direction: 'outbound',
          text: value.text,
          occurredAt,
          metadata: { reportingDisclosureVersion: value.version },
        });
        await context.ports.conversationRepo.updateMessageDelivery(message.id, {
          tenantId: SIM_TENANT_ID,
          conversationId: SIM_CONVERSATION_ID,
          externalMessageId: `sim:${message.id}`,
          sentAt: occurredAt,
        });
      },
      async verify() {
        const receipt = await context.state.conversationRepo.findLatestDeliveredReportingDisclosure(
          SIM_TENANT_ID,
          SIM_USER_ID,
          value.version,
          context.start,
        );
        return satisfied('disclosureDelivered', receipt !== null, receipt ? `shown ${receipt.shownAt.toISOString()}` : 'no delivered disclosure');
      },
    };
  },
};
