export interface RuntimeUserState {
  userStatus: string;
  deletedAt: Date | null;
  personLifecycle: string | null;
  pulseParticipant: boolean | null;
}

export function isRuntimeEligibleUser(state: RuntimeUserState): boolean {
  return state.userStatus === 'active' && state.deletedAt === null &&
    (state.personLifecycle === null ||
      (state.personLifecycle === 'active' && state.pulseParticipant === true));
}
