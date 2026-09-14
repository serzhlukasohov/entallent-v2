import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '@entalent/config';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { ManagerDashboardReadModel } from './manager-dashboard.read-model';
import type { TrendsResult } from './manager-trends.aggregate';
import { assertInternalDashboardEnabled } from './internal-dashboard-gate';

@Controller('admin/manager/trends')
@UseGuards(ApiKeyGuard)
export class ManagerTrendsController {
  constructor(
    private readonly readModel: ManagerDashboardReadModel,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Get()
  async getTrends(
    @Query('tenantId') tenantId: string | undefined,
    @Query('days') daysRaw?: string,
  ): Promise<TrendsResult> {
    assertInternalDashboardEnabled(this.config);
    return this.readModel.getTrends(tenantId, daysRaw);
  }
}
