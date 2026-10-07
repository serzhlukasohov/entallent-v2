// Custom BullMQ job ids may contain ':' only as exactly three segments (prefix:a:b); keep every builder here.
export const actionJobId = (externalUserId: string, actionTs: string): string => `onb-act:${externalUserId}:${actionTs}`;
export const recalculateJobId = (tenantId: string, nowMs: number): string => `onb-recalc:${tenantId}:${nowMs}`;
export const systemJobId = (personId: string, auditLogId: string): string => `onb-sys:${personId}:${auditLogId}`;
