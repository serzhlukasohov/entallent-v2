import type { DataDeletionRepositoryPort, DataDeletionResult } from '../ports/data-deletion.repository.port';
import type { AuditLogPort } from '../ports/audit-log.port';

export interface DataDeletionInput {
  userId: string;
  tenantId: string;
  requestedBy: string;
  traceId?: string;
}

export class DataDeletionUseCase {
  constructor(
    private readonly repo: DataDeletionRepositoryPort,
    private readonly auditLog: AuditLogPort,
  ) {}

  async execute(input: DataDeletionInput): Promise<DataDeletionResult> {
    const [messagesAnonymized, memoryItemsDeleted, actionsDeleted] = await Promise.all([
      this.repo.anonymizeMessages(input.userId, input.tenantId),
      this.repo.deleteMemoryItems(input.userId, input.tenantId),
      this.repo.cancelScheduledActions(input.userId, input.tenantId),
    ]);

    await this.repo.resolveRiskSignals(input.userId, input.tenantId);
    await this.repo.softDeleteUser(input.userId, input.tenantId);

    await this.auditLog.append({
      tenantId: input.tenantId,
      actorType: 'system',
      actorId: input.requestedBy,
      action: 'user.data_deleted',
      resourceType: 'user',
      resourceId: input.userId,
      reason: 'User requested data deletion (GDPR/privacy)',
      metadata: { messagesAnonymized, memoryItemsDeleted, actionsDeleted },
      traceId: input.traceId,
    });

    return { messagesAnonymized, memoryItemsDeleted, actionsDeleted };
  }
}
