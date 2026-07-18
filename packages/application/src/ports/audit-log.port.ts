export interface AppendAuditLogParams {
  tenantId: string;
  actorType: 'user' | 'agent' | 'system' | 'admin';
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  reason?: string;
  metadata?: Record<string, unknown>;
  traceId?: string;
}

export interface AuditLogPort {
  append(params: AppendAuditLogParams): Promise<void>;
}
