import type { OnboardingEffect, OnboardingEvent, OnboardingState } from '../onboarding';

export interface OnboardingApplyResult {
  changed: boolean;
  effects: OnboardingEffect[];
  /** null when the person has no onboarding state row (legacy / not rolled out). */
  state: OnboardingState | null;
}

/** Post-commit side effects of onboarding transitions. Implementations must be idempotent per dedupeKey. */
export interface OnboardingEffectsPort {
  scheduleReminder(input: { tenantId: string; personId: string; dueAt: Date }): Promise<void>;
  replaceIntroActions(input: { tenantId: string; personId: string; channelId: string; messageTs: string; text: string }): Promise<void>;
  sendAcknowledgement(input: { tenantId: string; personId: string; text: string; dedupeKey: string }): Promise<void>;
  startConversation(input: { tenantId: string; personId: string; dedupeKey: string }): Promise<void>;
}

/** Consumed by the conversation orchestrator. */
export interface OnboardingTurnPort {
  contextFor(tenantId: string, userId: string): Promise<{ state: OnboardingState } | null>;
  applyTurnEvent(tenantId: string, userId: string, event: OnboardingEvent): Promise<OnboardingApplyResult>;
}
