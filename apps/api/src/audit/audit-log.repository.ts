import { Injectable } from '@nestjs/common';
import { auditLogs } from '@entalent/database';
import type { AuditLogPort, AppendAuditLogParams } from '@entalent/application';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class AuditLogRepository implements AuditLogPort {
  constructor(private readonly db: DatabaseService) {}

  async append(params: AppendAuditLogParams): Promise<void> {
    await this.db.client.insert(auditLogs).values({
      tenantId: params.tenantId,
      actorType: params.actorType,
      actorId: params.actorId,
      action: params.action,
      resourceType: params.resourceType,
      resourceId: params.resourceId,
      reason: params.reason,
      metadata: params.metadata ?? {},
      traceId: params.traceId,
    });
  }
}
