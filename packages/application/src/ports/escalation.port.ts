export interface EscalationEvent {
  type: string;
  severity: string;
  userId: string;
  tenantId: string;
  riskType: string | null;
  messageIds: string[];
  traceId: string;
  details?: Record<string, unknown>;
}

export interface EscalationPort {
  raise(event: EscalationEvent): Promise<void>;
}
