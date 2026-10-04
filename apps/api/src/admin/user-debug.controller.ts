import { Controller, Get, NotFoundException, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { users, messages } from '@entalent/database';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { AuditLogRepository } from '../audit/audit-log.repository';
import { DatabaseService } from '../database/database.service';

@Controller('admin/users/:userId/debug')
@UseGuards(ApiKeyGuard)
export class UserDebugController {
  constructor(private readonly db: DatabaseService, private readonly auditLog: AuditLogRepository) {}
  @Get()
  async getDebugView(@Param('userId', ParseUUIDPipe) userId: string,
    @Query('tenantId') tenantId = process.env['DEFAULT_TENANT_ID'] ?? ''): Promise<Record<string, unknown>> {
    const [user] = await this.db.client.select({ id: users.id, status: users.status,
      onboardingStatus: users.onboardingStatus, proactiveMessagingEnabled: users.proactiveMessagingEnabled,
      createdAt: users.createdAt }).from(users).where(and(eq(users.id, userId), eq(users.tenantId, tenantId))).limit(1);
    if (!user) throw new NotFoundException('User not found');
    const recentMessages = await this.db.client.select({ id: messages.id, direction: messages.direction,
      messageType: messages.messageType, occurredAt: messages.occurredAt, sentAt: messages.sentAt })
      .from(messages).where(and(eq(messages.userId, userId), eq(messages.tenantId, tenantId), isNull(messages.deletedAt)))
      .orderBy(desc(messages.occurredAt)).limit(50);
    await this.auditLog.append({ tenantId, actorType: 'admin', actorId: 'admin', action: 'admin.user_debug_viewed',
      resourceType: 'user', resourceId: userId, reason: 'Delivery metadata only' });
    return { user: { id: user.id, status: user.status, onboardingStatus: user.onboardingStatus,
      proactiveMessagingEnabled: user.proactiveMessagingEnabled, createdAt: user.createdAt },
      recentMessages: recentMessages.map((m) => ({ id: m.id, direction: m.direction, messageType: m.messageType,
        occurredAt: m.occurredAt, sentAt: m.sentAt })), accessedAt: new Date().toISOString() };
  }
}
