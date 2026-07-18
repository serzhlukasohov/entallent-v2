import {
  Controller,
  Get,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, isNull, or } from 'drizzle-orm';
import { featureFlags } from '@entalent/database';
import { FEATURE_FLAGS } from '@entalent/application';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { DatabaseService } from '../database/database.service';

interface UpsertFlagDto {
  enabled: boolean;
  rolloutPercentage?: number;
  metadata?: Record<string, unknown>;
}

@Controller('admin/feature-flags')
@UseGuards(ApiKeyGuard)
export class FeatureFlagsController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  async list(@Query('tenantId') tenantId?: string): Promise<{ flags: unknown[]; knownKeys: string[] }> {
    const where = tenantId
      ? or(eq(featureFlags.tenantId, tenantId), isNull(featureFlags.tenantId))
      : isNull(featureFlags.tenantId);

    const flags = await this.db.client
      .select()
      .from(featureFlags)
      .where(where)
      .orderBy(featureFlags.key);

    return { flags, knownKeys: Object.values(FEATURE_FLAGS) };
  }

  @Put(':key')
  async upsert(
    @Param('key') key: string,
    @Query('tenantId') tenantId: string | undefined,
    @Body() dto: UpsertFlagDto,
  ): Promise<{ flag: unknown }> {
    const existing = await this.db.client
      .select()
      .from(featureFlags)
      .where(
        and(
          eq(featureFlags.key, key),
          tenantId ? eq(featureFlags.tenantId, tenantId) : isNull(featureFlags.tenantId),
        ),
      )
      .limit(1);

    const now = new Date();

    if (existing.length > 0) {
      const [updated] = await this.db.client
        .update(featureFlags)
        .set({
          enabled: dto.enabled,
          rolloutPercentage: dto.rolloutPercentage ?? existing[0].rolloutPercentage,
          metadata: dto.metadata ?? existing[0].metadata,
          updatedAt: now,
        })
        .where(eq(featureFlags.id, existing[0].id))
        .returning();
      return { flag: updated };
    }

    const [created] = await this.db.client
      .insert(featureFlags)
      .values({
        key,
        tenantId: tenantId ?? null,
        enabled: dto.enabled,
        rolloutPercentage: dto.rolloutPercentage ?? 100,
        metadata: dto.metadata ?? {},
      })
      .returning();

    return { flag: created };
  }

  @Delete(':key')
  @HttpCode(204)
  async remove(
    @Param('key') key: string,
    @Query('tenantId') tenantId?: string,
  ): Promise<void> {
    const result = await this.db.client
      .delete(featureFlags)
      .where(
        and(
          eq(featureFlags.key, key),
          tenantId ? eq(featureFlags.tenantId, tenantId) : isNull(featureFlags.tenantId),
        ),
      )
      .returning({ id: featureFlags.id });

    if (result.length === 0) {
      throw new NotFoundException(`Feature flag '${key}' not found`);
    }
  }
}
