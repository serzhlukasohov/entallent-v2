import { Module } from '@nestjs/common';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { DatabaseModule } from '../database/database.module';
import { AuditModule } from '../audit/audit.module';
import { QueuesController } from './queues.controller';
import { LlmRunsController } from './llm-runs.controller';
import { AuditLogsController } from './audit-logs.controller';
import { SurveyCoverageController } from './survey-coverage.controller';
import { AnalyticsController } from './analytics.controller';
import { FeatureFlagsController } from './feature-flags.controller';
import { ManagerTrendsController } from './manager-trends.controller';
import { ProfileHydrationStatusController } from './profile-hydration-status.controller';
import { ManagerDashboardReadModel } from './manager-dashboard.read-model';
import { V2PilotController } from './v2-pilot.controller';
import { V2PilotReadModel } from './v2-pilot.read-model';

@Module({
  imports: [DatabaseModule, AuditModule],
  controllers: [
    QueuesController,
    LlmRunsController,
    AuditLogsController,
    SurveyCoverageController,
    AnalyticsController,
    FeatureFlagsController,
    ManagerTrendsController,
    ProfileHydrationStatusController,
    V2PilotController,
  ],
  providers: [ApiKeyGuard, ManagerDashboardReadModel, V2PilotReadModel],
})
export class AdminModule {}
