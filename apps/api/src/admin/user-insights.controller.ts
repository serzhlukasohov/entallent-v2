import { Controller, ForbiddenException, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '@entalent/config';
import type { AdminUserInsightsResponse } from '@entalent/contracts';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { DatabaseService } from '../database/database.service';

@Controller('admin/users/:userId/insights')
@UseGuards(ApiKeyGuard)
export class UserInsightsController {
  constructor(_db: DatabaseService, _config: ConfigService<Env, true>) {}
  @Get()
  async getInsights(@Param('userId') _userId: string, @Query('tenantId') _tenantId?: string): Promise<AdminUserInsightsResponse> {
    throw new ForbiddenException('Individual employee responses and insights are private');
  }
}
