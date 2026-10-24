import type { PrimaryOrgRole } from '../hierarchy/draft-person';
import type { OnboardingEffect, OnboardingEvent, OnboardingState } from '../onboarding';

export interface OnboardingApplyResult {
  changed: boolean;
  effects: OnboardingEffect[];
  /** null when the person has no onboarding state row (legacy / not rolled out). */
  state: OnboardingState | null;
  /** Acknowledgement text the orchestrator must send as its reply (turn-originated events only). */
  replyAck?: string;
  /**
   * Turn-originated start: the orchestrator's reply opens the conversation (first backlog topic or the
   * approved empty-backlog opener); no separate conversation is started.
   */
  replyStart?: boolean;
}

/** Post-commit side effects of onboarding transitions. Implementations must be idempotent per dedupeKey. */
export interface OnboardingEffectsPort {
  scheduleReminder(input: { tenantId: string; personId: string; dueAt: Date }): Promise<void>;
  /** Rewrites the intro message without buttons; resolves true only when the message was actually edited. Never throws. */
  replaceIntroActions(input: { tenantId: string; personId: string; channelId: string; messageTs: string; text: string }): Promise<boolean>;
  sendAcknowledgement(input: { tenantId: string; personId: string; text: string; dedupeKey: string }): Promise<void>;
  startConversation(input: { tenantId: string; personId: string; dedupeKey: string }): Promise<void>;
  /** Role-change introduction (full approved copy of `role`); `version` is the committed state version that keys its message ids. */
  sendRoleIntro(input: { tenantId: string; personId: string; role: PrimaryOrgRole; version: number }): Promise<void>;
}

/** Consumed by the conversation orchestrator. */
export interface OnboardingTurnPort {
  contextFor(tenantId: string, userId: string): Promise<{ state: OnboardingState } | null>;
  applyTurnEvent(tenantId: string, userId: string, event: OnboardingEvent): Promise<OnboardingApplyResult>;
}
