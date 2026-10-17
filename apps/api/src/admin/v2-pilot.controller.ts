import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '@entalent/config';
import type {
  AdminV2PilotPeopleResponse, AdminV2PilotQaTeamSignalsResponse, AdminV2PilotResponse,
  AdminV2PilotTeamSignalsResponse,
} from '@entalent/contracts';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { assertInternalDashboardEnabled } from './internal-dashboard-gate';
import { V2PilotReadModel } from './v2-pilot.read-model';

@Controller('admin/v2-pilot')
@UseGuards(ApiKeyGuard)
export class V2PilotController {
  constructor(
    private readonly readModel: V2PilotReadModel,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  async getStatus(
    @Query('tenantId') tenantId?: string,
    @Query('cohortIds') cohortIds?: string,
  ): Promise<AdminV2PilotResponse> {
    assertInternalDashboardEnabled(this.config);
    return this.readModel.getStatus(tenantId, cohortIds);
  }

  @Get('people')
  @Header('Cache-Control', 'private, no-store')
  async getPeople(
    @Query('tenantId') tenantId?: string,
    @Query('cohortId') cohortId?: string,
  ): Promise<AdminV2PilotPeopleResponse> {
    assertInternalDashboardEnabled(this.config);
    return this.readModel.getPeople(tenantId, cohortId);
  }

  @Get('team-signals')
  @Header('Cache-Control', 'private, no-store')
  async getTeamSignals(
    @Query('tenantId') tenantId?: string,
    @Query('cohortId') cohortId?: string,
  ): Promise<AdminV2PilotTeamSignalsResponse> {
    assertInternalDashboardEnabled(this.config);
    return this.readModel.getTeamSignals(tenantId, cohortId);
  }

  /** QA-only: Team Signals with their authors. Same guards as people. */
  @Get('qa/team-signals')
  @Header('Cache-Control', 'private, no-store')
  async getQaTeamSignals(
    @Query('tenantId') tenantId?: string,
    @Query('cohortId') cohortId?: string,
  ): Promise<AdminV2PilotQaTeamSignalsResponse> {
    assertInternalDashboardEnabled(this.config);
    return this.readModel.getQaTeamSignals(tenantId, cohortId);
  }
}
