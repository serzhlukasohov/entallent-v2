import {
  Controller,
  Get,
  Delete,
  Param,
  HttpCode,
  ParseUUIDPipe,
  Logger,
  UseGuards,
} from '@nestjs/common';
import { UserMemoryService } from './user-memory.service';
import { AuditLogRepository } from '../audit/audit-log.repository';
import { ApiKeyGuard } from '../auth/api-key.guard';
import type { MemoryItemRecord } from '@entalent/application';

const PLACEHOLDER_TENANT = process.env['DEFAULT_TENANT_ID'] ?? '';

@Controller('users/:userId/memory')
@UseGuards(ApiKeyGuard)
export class UserMemoryController {
  private readonly logger = new Logger(UserMemoryController.name);

  constructor(
    private readonly service: UserMemoryService,
    private readonly auditLog: AuditLogRepository,
  ) {}

  @Get()
  async list(
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<{ items: MemoryItemRecord[] }> {
    await this.auditLog.append({
      tenantId: PLACEHOLDER_TENANT,
      actorType: 'user',
      actorId: userId,
      action: 'user.memory_accessed',
      resourceType: 'memory',
      resourceId: userId,
    });

    const items = await this.service.listActiveMemory(userId, PLACEHOLDER_TENANT);
    return { items };
  }

  @Delete(':memoryId')
  @HttpCode(204)
  async delete(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('memoryId', ParseUUIDPipe) memoryId: string,
  ): Promise<void> {
    await this.auditLog.append({
      tenantId: PLACEHOLDER_TENANT,
      actorType: 'user',
      actorId: userId,
      action: 'user.memory_deleted',
      resourceType: 'memory',
      resourceId: memoryId,
      reason: 'User requested deletion of specific memory item',
    });

    this.logger.log(`User ${userId} requested delete of memory item ${memoryId}`);
    await this.service.deleteMemoryItem(memoryId, userId, PLACEHOLDER_TENANT);
  }
}
