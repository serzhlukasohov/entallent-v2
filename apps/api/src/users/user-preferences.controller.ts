import { Controller, Patch, Body, Param, ParseUUIDPipe, UseGuards, Logger, HttpCode } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { users } from '@entalent/database';
import { DatabaseService } from '../database/database.service';
import { AuditLogRepository } from '../audit/audit-log.repository';
import { ApiKeyGuard } from '../auth/api-key.guard';

interface UpdatePreferencesDto {
  proactiveMessagingEnabled?: boolean;
  quietHours?: { enabled: boolean; startHour?: number; endHour?: number };
  timezone?: string;
  surveyEnabled?: boolean;
}

const PLACEHOLDER_TENANT = process.env['DEFAULT_TENANT_ID'] ?? '';

@Controller('users/:userId/preferences')
@UseGuards(ApiKeyGuard)
export class UserPreferencesController {
  private readonly logger = new Logger(UserPreferencesController.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly auditLog: AuditLogRepository,
  ) {}

  @Patch()
  @HttpCode(204)
  async update(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdatePreferencesDto,
  ): Promise<void> {
    const updateSet: Record<string, unknown> = { updatedAt: new Date() };

    if (dto.proactiveMessagingEnabled !== undefined) {
      updateSet['proactiveMessagingEnabled'] = dto.proactiveMessagingEnabled;
    }
    if (dto.quietHours !== undefined) {
      updateSet['quietHours'] = dto.quietHours;
    }
    if (dto.timezone !== undefined) {
      updateSet['timezone'] = dto.timezone;
    }
    if (dto.surveyEnabled !== undefined) {
      // surveyEnabled stored in consentState JSONB
      const [existing] = await this.db.client
        .select({ consentState: users.consentState })
        .from(users)
        .where(and(eq(users.id, userId), eq(users.tenantId, PLACEHOLDER_TENANT)))
        .limit(1);
      const current = (existing?.consentState as Record<string, unknown>) ?? {};
      updateSet['consentState'] = { ...current, surveyEnabled: dto.surveyEnabled };
    }

    await this.db.client
      .update(users)
      .set(updateSet)
      .where(and(eq(users.id, userId), eq(users.tenantId, PLACEHOLDER_TENANT)));

    await this.auditLog.append({
      tenantId: PLACEHOLDER_TENANT,
      actorType: 'user',
      actorId: userId,
      action: 'user.preferences_updated',
      resourceType: 'user',
      resourceId: userId,
      metadata: { fields: Object.keys(dto) },
    });

    this.logger.log(`Updated preferences for user ${userId}: ${Object.keys(dto).join(', ')}`);
  }
}
