/** Source of business time for the conversation and proactive paths (AD-5). */
export interface ClockPort {
  now(): Date;
}

export const systemClock: ClockPort = { now: () => new Date() };
