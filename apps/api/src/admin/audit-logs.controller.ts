import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { auditLogs } from '@entalent/database';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { DatabaseService } from '../database/database.service';

@Controller('admin/audit-logs')
@UseGuards(ApiKeyGuard)
export class AuditLogsController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  async list(
    @Query('tenantId') tenantId?: string,
    @Query('actorId') actorId?: string,
    @Query('action') action?: string,
    @Query('resourceType') resourceType?: string,
    @Query('resourceId') resourceId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limitStr?: string,
    @Query('offset') offsetStr?: string,
  ): Promise<{ logs: unknown[]; total: number }> {
    const limit = Math.min(Number(limitStr) || 50, 500);
    const offset = Number(offsetStr) || 0;

    const conditions = [
      tenantId ? eq(auditLogs.tenantId, tenantId) : undefined,
      actorId ? eq(auditLogs.actorId, actorId) : undefined,
      action ? eq(auditLogs.action, action) : undefined,
      resourceType ? eq(auditLogs.resourceType, resourceType) : undefined,
      resourceId ? eq(auditLogs.resourceId, resourceId) : undefined,
      from ? gte(auditLogs.createdAt, new Date(from)) : undefined,
      to ? lte(auditLogs.createdAt, new Date(to)) : undefined,
    ].filter(Boolean);

    const where = conditions.length > 0 ? and(...(conditions as Parameters<typeof and>)) : undefined;

    const [rows, [{ total }]] = await Promise.all([
      this.db.client
        .select()
        .from(auditLogs)
        .where(where)
        .orderBy(desc(auditLogs.createdAt))
        .limit(limit)
        .offset(offset),
      this.db.client
        .select({ total: sql<number>`count(*)::int` })
        .from(auditLogs)
        .where(where),
    ]);

    return { logs: rows, total };
  }
}
