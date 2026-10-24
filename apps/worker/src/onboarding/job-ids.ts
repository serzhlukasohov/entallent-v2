// Custom BullMQ job ids may contain ':' only as exactly three segments (prefix:a:b); keep every builder here.
export const reminderJobId = (personId: string, dueMs: number): string => `onb-rem:${personId}:${dueMs}`;

/** Distinct from the canonical id so a retained completed job cannot swallow the recovery; at most one per hour. */
export const reminderSweepJobId = (personId: string, dueMs: number, hourBucket: number): string =>
  `onb-rem-sweep:${personId}:${dueMs}-${hourBucket}`;

/** `dedupeKey` is `${personId}:${stateVersion}`. */
export const startJobId = (dedupeKey: string): string => `onb-start:${dedupeKey}`;

export const trustJobId = (trustMessageId: string): string => `onb-trust-${trustMessageId}`;
