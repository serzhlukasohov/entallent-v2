import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { initialOnboardingState, type PrimaryOrgRole } from '@entalent/application';
import { onboardingStates, people } from '@entalent/database';
import { DatabaseService } from '../database/database.service';
import { OnboardingEffectsService } from './onboarding-effects.service';
import { OnboardingIntroService, type SendIntroResult } from './onboarding-intro.service';

/**
 * Local dev console only: sends the intro for the person's current role into their dev conversation.
 * `seedVersion` starts the (just reset) state at a fresh version so every version-keyed id (intro, acks,
 * start job) differs from an earlier run for the same person.
 */
@Injectable()
export class OnboardingDevIntroService {
  constructor(
    private readonly db: DatabaseService,
    private readonly effects: OnboardingEffectsService,
    private readonly intro: OnboardingIntroService,
  ) {}

  async send(tenantId: string, personId: string, seedVersion: number): Promise<SendIntroResult> {
    const [person] = await this.db.client.select({ role: people.primaryRole }).from(people)
      .where(and(eq(people.id, personId), eq(people.tenantId, tenantId))).limit(1);
    if (!person) throw new Error('dev_person_missing');
    const target = await this.effects.findDeliveryTarget(tenantId, personId);
    if (!target) throw new Error('dev_delivery_target_missing');
    const role = person.role as PrimaryOrgRole;
    const initial = initialOnboardingState(role);
    await this.db.client.insert(onboardingStates).values({
      tenantId, personId, track: initial.track, introStatus: initial.introStatus,
      participation: initial.participation, buttonsActive: false, version: seedVersion,
    }).onConflictDoNothing();
    return this.intro.sendIntro({
      tenantId, personId, role, version: seedVersion,
      conversation: {
        id: target.conversationId, channelType: target.channelType,
        externalConversationId: target.externalConversationId, externalWorkspaceId: target.externalWorkspaceId,
      },
    });
  }
}
