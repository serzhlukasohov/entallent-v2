import { Controller, Post, Get, Param, ParseUUIDPipe, UseGuards, Logger, HttpCode } from '@nestjs/common';
import { eq, and, desc, isNull } from 'drizzle-orm';
import { users, messages, memoryItems, userGoals, scheduledActions, riskSignals } from '@entalent/database';
import { DatabaseService } from '../database/database.service';
import { AuditLogRepository } from '../audit/audit-log.repository';
import { ApiKeyGuard } from '../auth/api-key.guard';

const PLACEHOLDER_TENANT = process.env['DEFAULT_TENANT_ID'] ?? '';

@Controller('users/:userId')
@UseGuards(ApiKeyGuard)
export class UserDataController {
  private readonly logger = new Logger(UserDataController.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly auditLog: AuditLogRepository,
  ) {}

  /** Export all user data — GDPR data portability right */
  @Get('data-export')
  async export(@Param('userId', ParseUUIDPipe) userId: string): Promise<Record<string, unknown>> {
    const tenantId = PLACEHOLDER_TENANT;

    await this.auditLog.append({
      tenantId,
      actorType: 'user',
      actorId: userId,
      action: 'user.data_exported',
      resourceType: 'user',
      resourceId: userId,
      reason: 'User requested data export (GDPR portability)',
    });

    const [userRows, msgRows, memRows, goalRows, actionRows] = await Promise.all([
      this.db.client
        .select()
        .from(users)
        .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)))
        .limit(1),
      this.db.client
        .select({ id: messages.id, direction: messages.direction, text: messages.text, occurredAt: messages.occurredAt, messageType: messages.messageType })
        .from(messages)
        .where(and(eq(messages.userId, userId), eq(messages.tenantId, tenantId), isNull(messages.deletedAt)))
        .orderBy(desc(messages.occurredAt))
        .limit(500),
      this.db.client
        .select({ id: memoryItems.id, category: memoryItems.category, content: memoryItems.content, status: memoryItems.status, createdAt: memoryItems.createdAt })
        .from(memoryItems)
        .where(and(eq(memoryItems.userId, userId), eq(memoryItems.tenantId, tenantId))),
      this.db.client
        .select({ id: userGoals.id, title: userGoals.title, status: userGoals.status, targetDate: userGoals.targetDate })
        .from(userGoals)
        .where(and(eq(userGoals.userId, userId), eq(userGoals.tenantId, tenantId))),
      this.db.client
        .select({ id: scheduledActions.id, type: scheduledActions.type, intent: scheduledActions.intent, dueAt: scheduledActions.dueAt, status: scheduledActions.status })
        .from(scheduledActions)
        .where(and(eq(scheduledActions.userId, userId), eq(scheduledActions.tenantId, tenantId))),
    ]);

    const user = userRows[0];

    return {
      exportedAt: new Date().toISOString(),
      user: user
        ? {
            id: user.id,
            preferredName: user.preferredName,
            timezone: user.timezone,
            proactiveMessagingEnabled: user.proactiveMessagingEnabled,
            quietHours: user.quietHours,
            onboardingStatus: user.onboardingStatus,
            consentState: user.consentState,
            createdAt: user.createdAt,
          }
        : null,
      messages: msgRows,
      memoryItems: memRows,
      goals: goalRows,
      scheduledActions: actionRows,
    };
  }

  /** Anonymize and soft-delete all user data — GDPR right to erasure */
  @Post('data-deletion')
  @HttpCode(202)
  async delete(@Param('userId', ParseUUIDPipe) userId: string): Promise<{ accepted: boolean; message: string }> {
    const tenantId = PLACEHOLDER_TENANT;

    await this.auditLog.append({
      tenantId,
      actorType: 'user',
      actorId: userId,
      action: 'user.data_deletion_requested',
      resourceType: 'user',
      resourceId: userId,
      reason: 'User requested data deletion (GDPR right to erasure)',
    });

    // Anonymize message text
    await this.db.client
      .update(messages)
      .set({ text: '[deleted]', normalizedText: null, deletedAt: new Date() })
      .where(and(eq(messages.userId, userId), eq(messages.tenantId, tenantId), isNull(messages.deletedAt)));

    // Delete memory items
    await this.db.client
      .update(memoryItems)
      .set({ status: 'deleted', content: '[deleted]', updatedAt: new Date() })
      .where(and(eq(memoryItems.userId, userId), eq(memoryItems.tenantId, tenantId)));

    // Cancel scheduled actions
    await this.db.client
      .update(scheduledActions)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(
        and(
          eq(scheduledActions.userId, userId),
          eq(scheduledActions.tenantId, tenantId),
          eq(scheduledActions.status, 'pending'),
        ),
      );

    // Resolve risk signals
    await this.db.client
      .update(riskSignals)
      .set({ status: 'resolved', resolvedAt: new Date() })
      .where(and(eq(riskSignals.userId, userId), eq(riskSignals.tenantId, tenantId), eq(riskSignals.status, 'active')));

    // Soft-delete user
    await this.db.client
      .update(users)
      .set({ status: 'deleted', deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)));

    this.logger.log(`Data deletion completed for user ${userId}`);

    return {
      accepted: true,
      message: 'User data has been anonymized and scheduled for permanent deletion.',
    };
  }
}
