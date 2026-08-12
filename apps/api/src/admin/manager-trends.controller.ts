import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { ManagerDashboardReadModel } from './manager-dashboard.read-model';
import type { TrendsResult } from './manager-trends.aggregate';

@Controller('admin/manager/trends')
@UseGuards(ApiKeyGuard)
export class ManagerTrendsController {
  constructor(private readonly readModel: ManagerDashboardReadModel) {}

  @Get()
  getTrends(
    @Query('tenantId') tenantId: string | undefined,
    @Query('days') daysRaw?: string,
  ): Promise<TrendsResult> {
    return this.readModel.getTrends(tenantId, daysRaw);
  }
}
