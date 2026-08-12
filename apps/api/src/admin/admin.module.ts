import { Module } from '@nestjs/common';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { DatabaseModule } from '../database/database.module';
import { AuditModule } from '../audit/audit.module';
import { QueuesController } from './queues.controller';
import { LlmRunsController } from './llm-runs.controller';
import { AuditLogsController } from './audit-logs.controller';
import { SurveyCoverageController } from './survey-coverage.controller';
import { UserDebugController } from './user-debug.controller';
import { AnalyticsController } from './analytics.controller';
import { FeatureFlagsController } from './feature-flags.controller';
import { ManagerTeamController } from './manager-team.controller';
import { ManagerTrendsController } from './manager-trends.controller';
import { PulseOverviewController } from './pulse-overview.controller';
import { UserInsightsController } from './user-insights.controller';
import { ProfileHydrationStatusController } from './profile-hydration-status.controller';

@Module({
  imports: [DatabaseModule, AuditModule],
  controllers: [
    QueuesController,
    LlmRunsController,
    AuditLogsController,
    SurveyCoverageController,
    UserDebugController,
    AnalyticsController,
    FeatureFlagsController,
    ManagerTeamController,
    ManagerTrendsController,
    PulseOverviewController,
    UserInsightsController,
    ProfileHydrationStatusController,
  ],
  providers: [ApiKeyGuard],
})
export class AdminModule {}
