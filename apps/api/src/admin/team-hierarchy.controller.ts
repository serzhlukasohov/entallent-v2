import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '@entalent/config';
import type { AdminTeamHierarchyResponse } from '@entalent/contracts';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { assertInternalDashboardEnabled } from './internal-dashboard-gate';
import { TeamHierarchyReadModel } from './team-hierarchy.read-model';

@Controller('admin/team-hierarchy')
@UseGuards(ApiKeyGuard)
export class TeamHierarchyController {
  constructor(
    private readonly readModel: TeamHierarchyReadModel,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  async getHierarchy(@Query('tenantId') tenantId?: string): Promise<AdminTeamHierarchyResponse> {
    assertInternalDashboardEnabled(this.config);
    return this.readModel.getHierarchy(tenantId);
  }
}
