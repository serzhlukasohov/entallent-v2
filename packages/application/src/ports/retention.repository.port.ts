export interface RetentionPolicy {
  messagesRetentionDays: number;
  memoryRetentionDays: number;
  riskSignalRetentionDays: number;
  auditLogRetentionDays: number;
}

export interface RetentionTenant {
  tenantId: string;
  retentionPolicy: RetentionPolicy;
}

export interface RetentionCleanupParams {
  tenantId: string;
  now: Date;
  messagesCutoff: Date;
  memoryCutoff: Date;
  riskSignalCutoff: Date;
  auditLogCutoff: Date;
}

export interface RetentionCleanupResult {
  messagesDeleted: number;
  surveyEvidenceExpired: number;
  memoryItemsExpired: number;
  riskSignalsExpired: number;
  temporaryGroupStatesExpired: number;
  confirmedGroupStatesExpired: number;
  withdrawnGroupStatesExpired: number;
  auditLogsDeleted: number;
  reportSnapshotsDeleted: number;
}

export interface RetentionCleanupRepositoryPort {
  findRetentionTenants(): Promise<RetentionTenant[]>;
  applyRetention(params: RetentionCleanupParams): Promise<RetentionCleanupResult>;
}
