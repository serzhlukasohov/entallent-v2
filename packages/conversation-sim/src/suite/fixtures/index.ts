import type { FixtureName } from '../schema';
import { clockFixture } from './clock';
import { confirmationStateFixture } from './confirmation-state';
import { disclosureDeliveredFixture } from './disclosure-delivered';
import { freshPersonaFixture } from './fresh-persona';
import { pendingBotQuestionFixture } from './pending-bot-question';
import { proactiveUsersFixture } from './proactive-users';
import { pulseCycleFixture } from './pulse-cycle';
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

/**
 * L1 fixtures by name (architecture AD-4): the L0 fixtures plus `pulseCycle`, which needs the
 * survey repository only the L1 world provides.
 */
export const L1_FIXTURES: Readonly<Partial<Record<FixtureName, FixtureModule<unknown>>>> = Object.freeze({
  ...L0_FIXTURES,
  pulseCycle: pulseCycleFixture,
});

export type { FixtureContext, FixtureHarnessOptions, FixtureInstance, FixtureModule } from './types';
