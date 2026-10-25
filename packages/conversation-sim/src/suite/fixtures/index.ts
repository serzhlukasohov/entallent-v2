import type { FixtureName } from '../schema';
import { clockFixture } from './clock';
import { confirmationStateFixture } from './confirmation-state';
import { disclosureDeliveredFixture } from './disclosure-delivered';
import { freshPersonaFixture } from './fresh-persona';
import { pendingBotQuestionFixture } from './pending-bot-question';
import { proactiveUsersFixture } from './proactive-users';
import { seededHistoryFixture } from './seeded-history';
import type { FixtureModule } from './types';

/**
 * L0 fixtures by name (architecture AD-4). `pulseCycle` is absent: the L0 executor reports
 * it unsupported and the case's criteria are NOT_RUN `unsupported-fixture:pulseCycle`.
 */
export const L0_FIXTURES: Readonly<Partial<Record<FixtureName, FixtureModule<unknown>>>> = Object.freeze({
  clock: clockFixture,
  seededHistory: seededHistoryFixture,
  confirmationState: confirmationStateFixture,
  freshPersona: freshPersonaFixture,
  pendingBotQuestion: pendingBotQuestionFixture,
  disclosureDelivered: disclosureDeliveredFixture,
  proactiveUsers: proactiveUsersFixture,
});

export type { FixtureContext, FixtureHarnessOptions, FixtureInstance, FixtureModule } from './types';
