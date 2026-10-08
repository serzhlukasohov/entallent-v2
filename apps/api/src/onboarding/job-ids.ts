// Custom BullMQ job ids may contain ':' only as exactly three segments (prefix:a:b); keep every builder here.
export const actionJobId = (externalUserId: string, actionTs: string): string => `onb-act:${externalUserId}:${actionTs}`;
export const recalculateJobId = (tenantId: string, nowMs: number): string => `onb-recalc:${tenantId}:${nowMs}`;
export const systemJobId = (personId: string, auditLogId: string): string => `onb-sys:${personId}:${auditLogId}`;
/** Same format as the worker's canonical `reminderJobId` (apps/worker/src/onboarding/job-ids.ts). */
export const reminderJobId = (personId: string, dueMs: number): string => `onb-rem:${personId}:${dueMs}`;
/** Dev console role change: no audit row exists, so the time keeps the id unique. */
export const devSystemJobId = (personId: string, nowMs: number): string => `onb-sys:${personId}:dev-${nowMs}`;
