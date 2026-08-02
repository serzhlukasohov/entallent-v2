export const SESSION_GAP_HOURS = 5;

/** A new "session" starts when there's no prior message or a long silence precedes this one. */
export function isSessionStart(lastPriorMessageAt: Date | undefined, now: Date): boolean {
  if (!lastPriorMessageAt) return true;
  return now.getTime() - lastPriorMessageAt.getTime() > SESSION_GAP_HOURS * 3600_000;
}
