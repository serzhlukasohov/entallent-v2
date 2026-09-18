import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '@entalent/config';
import type { AdminManagerTeamResponse } from '@entalent/contracts';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { assertInternalDashboardEnabled } from './internal-dashboard-gate';
import { ManagerDashboardReadModel } from './manager-dashboard.read-model';

@Controller('admin/manager/team')
@UseGuards(ApiKeyGuard)
export class ManagerTeamController {
  constructor(
    private readonly readModel: ManagerDashboardReadModel,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Get()
  async getTeamOverview(@Query('tenantId') tenantId: string): Promise<AdminManagerTeamResponse> {
    assertInternalDashboardEnabled(this.config);
    return this.readModel.getTeamOverview(tenantId);
  }
}
