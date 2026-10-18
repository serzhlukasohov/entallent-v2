import { Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { initialOnboardingState, type PrimaryOrgRole } from '@entalent/application';
import { onboardingStates, orgOnboardingDeliveries, people } from '@entalent/database';
import { DatabaseService } from '../database/database.service';

export interface OnboardingRestartResult {
  stateDeleted: boolean;
  /** A new pending delivery replaced the old one, so the next onboarding dispatch re-sends the intro. */
  deliveryRequeued: boolean;
  unitId: string | null;
}

/**
 * Puts a person back at the start of onboarding v2 (dev tooling). Mirrors scripts/dev-slack-onboard.ts:
 * the state is recreated at a clock-seeded version so every version-keyed id (intro, trust, acks) differs from
 * the earlier run, and the delivery gets a new id because the intro message id is the delivery id.
 */
@Injectable()
export class OnboardingRestartService {
  constructor(private readonly db: DatabaseService) {}

  async restart(params: { tenantId: string; personId: string }): Promise<OnboardingRestartResult> {
    const { tenantId, personId } = params;
    return this.db.client.transaction(async (tx) => {
      const [person] = await tx.select({ role: people.primaryRole }).from(people)
        .where(and(eq(people.id, personId), eq(people.tenantId, tenantId))).limit(1);
      if (!person) throw new NotFoundException(`Person ${personId} not found for tenant ${tenantId}`);

      const deletedStates = await tx.delete(onboardingStates)
        .where(and(eq(onboardingStates.tenantId, tenantId), eq(onboardingStates.personId, personId)))
        .returning({ id: onboardingStates.id });
      const initial = initialOnboardingState(person.role as PrimaryOrgRole);
      await tx.insert(onboardingStates).values({
        tenantId, personId, track: initial.track, introStatus: initial.introStatus,
        participation: initial.participation, buttonsActive: false, version: Math.floor(Date.now() / 1000),
      });

      const [delivery] = await tx.delete(orgOnboardingDeliveries)
        .where(and(eq(orgOnboardingDeliveries.tenantId, tenantId), eq(orgOnboardingDeliveries.personId, personId)))
        .returning({ unitId: orgOnboardingDeliveries.unitId, externalWorkspaceId: orgOnboardingDeliveries.externalWorkspaceId });
      if (delivery) {
        await tx.insert(orgOnboardingDeliveries).values({
          tenantId, personId, unitId: delivery.unitId, externalWorkspaceId: delivery.externalWorkspaceId,
        });
      }

      return { stateDeleted: deletedStates.length > 0, deliveryRequeued: Boolean(delivery), unitId: delivery?.unitId ?? null };
    });
  }
}
