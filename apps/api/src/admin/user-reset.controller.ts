import { Controller, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { AuditLogRepository } from '../audit/audit-log.repository';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { UserResetService, type UserResetResult } from './user-reset.service';

@Controller('admin/users/:userId/reset')
@UseGuards(ApiKeyGuard)
export class UserResetController {
  constructor(
    private readonly resetService: UserResetService,
    private readonly auditLog: AuditLogRepository,
  ) {}

  @Post()
  @HttpCode(200)
  async reset(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query('tenantId', ParseUUIDPipe) tenantId: string,
  ): Promise<UserResetResult> {
    await this.auditLog.append({
      tenantId,
      actorType: 'admin',
      actorId: 'admin',
      action: 'admin.user_reset_requested',
      resourceType: 'user',
      resourceId: userId,
      reason: 'Admin reset user conversation state from dashboard',
    });

    const result = await this.resetService.resetUser({ tenantId, userId, deleteConversationHistory: true });

    await this.auditLog.append({
      tenantId,
      actorType: 'admin',
      actorId: 'admin',
      action: 'admin.user_reset_completed',
      resourceType: 'user',
      resourceId: userId,
      reason: 'Admin reset user conversation state from dashboard',
      metadata: { ...result },
    });

    return result;
  }
}
