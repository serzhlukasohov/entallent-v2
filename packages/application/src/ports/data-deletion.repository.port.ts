export interface DataDeletionResult {
  messagesAnonymized: number;
  memoryItemsDeleted: number;
  actionsDeleted: number;
}

export interface DataDeletionRepositoryPort {
  softDeleteUser(userId: string, tenantId: string): Promise<void>;
  anonymizeMessages(userId: string, tenantId: string): Promise<number>;
  deleteMemoryItems(userId: string, tenantId: string): Promise<number>;
  cancelScheduledActions(userId: string, tenantId: string): Promise<number>;
  resolveRiskSignals(userId: string, tenantId: string): Promise<void>;
}
