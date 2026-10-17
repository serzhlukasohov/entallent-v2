import {
  ACK_COPY,
  decideOnboarding,
  type OnboardingApplyResult,
  type OnboardingEvent,
  type OnboardingState,
  type OnboardingTurnPort,
} from '@entalent/application';

/**
 * In-memory `OnboardingTurnPort` that runs the production `decideOnboarding` state machine and derives
 * the reply acknowledgement exactly like the worker's onboarding service does for turn-originated events.
 */
export class InMemoryOnboardingTurn implements OnboardingTurnPort {
  readonly events: OnboardingEvent[] = [];

  constructor(public state: OnboardingState) {}

  async contextFor(): Promise<{ state: OnboardingState }> {
    return { state: this.state };
  }

  async applyTurnEvent(_tenantId: string, _userId: string, event: OnboardingEvent): Promise<OnboardingApplyResult> {
    this.events.push(event);
    const { next, effects } = decideOnboarding(this.state, event);
    this.state = next;
    const ack = effects.find((e) => e.type === 'acknowledge');
    const start = effects.some((e) => e.type === 'start_conversation');
    return {
      changed: effects.length > 0,
      effects,
      state: next,
      ...(ack && ack.type === 'acknowledge' ? { replyAck: ACK_COPY[ack.key] } : {}),
      ...(start ? { replyStart: true } : {}),
    };
  }
}
