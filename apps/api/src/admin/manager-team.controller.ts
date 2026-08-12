import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import type { AdminManagerTeamResponse } from '@entalent/contracts';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { ManagerDashboardReadModel } from './manager-dashboard.read-model';

@Controller('admin/manager/team')
@UseGuards(ApiKeyGuard)
export class ManagerTeamController {
  constructor(private readonly readModel: ManagerDashboardReadModel) {}

  @Get()
  getTeamOverview(@Query('tenantId') tenantId: string): Promise<AdminManagerTeamResponse> {
    return this.readModel.getTeamOverview(tenantId);
  }
}
