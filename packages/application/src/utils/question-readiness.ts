/**
 * GC round 3 CAP-2 (PO decision 2026-10-17): a question is ready for confirmation only when its
 * meaning is sufficient AND the employee gave what drives it or explicitly declined to. Both parts
 * may arrive in different messages, so each is accumulated before the rule is applied.
 */
export interface QuestionReadinessState {
  meaningSufficient: boolean;
  driverResolved: boolean;
}

export function accumulateQuestionReadiness(
  previous: QuestionReadinessState | null,
  capture: { sufficientMeaning: boolean; driverCaptured: boolean; driverDeclined: boolean },
): QuestionReadinessState & { ready: boolean } {
  const meaningSufficient = (previous?.meaningSufficient ?? false) || capture.sufficientMeaning;
  const driverResolved = (previous?.driverResolved ?? false) || capture.driverCaptured || capture.driverDeclined;
  return { meaningSufficient, driverResolved, ready: meaningSufficient && driverResolved };
}

/** A captured status still waiting for its driver, which has not been asked for yet. */
export function needsDriver(
  state: QuestionReadinessState & { status: string; readyForConfirmation: boolean; driverRequested: boolean },
): boolean {
  return state.status === 'collecting' && !state.readyForConfirmation && state.meaningSufficient
    && !state.driverResolved && !state.driverRequested;
}
