import { describe, expect, it } from 'vitest';
import { AdminModule } from './admin.module';
import { ManagerTeamController } from './manager-team.controller';
import { PulseOverviewController } from './pulse-overview.controller';
import { UserDebugController } from './user-debug.controller';
import { UserInsightsController } from './user-insights.controller';
import { ManagerTrendsController } from './manager-trends.controller';
import { SurveyCoverageController } from './survey-coverage.controller';
import { UserResetController } from './user-reset.controller';

describe('private analytical HTTP boundary', () => {
  it('does not register employee-level views under the shared admin API key', () => {
    const controllers = Reflect.getMetadata('controllers', AdminModule) as unknown[];
    expect(controllers).not.toContain(ManagerTeamController);
    expect(controllers).not.toContain(PulseOverviewController);
    expect(controllers).not.toContain(UserDebugController);
    expect(controllers).not.toContain(UserInsightsController);
    expect(controllers).not.toContain(UserResetController);
    expect(controllers).toContain(ManagerTrendsController);
    expect(controllers).toContain(SurveyCoverageController);
  });

  it('does not expose per-person survey windows through coverage', () => {
    const routes = Reflect.getMetadata('path', SurveyCoverageController.prototype.getCoverage);
    expect(routes).toBe('/');
    expect('getWindows' in SurveyCoverageController.prototype).toBe(false);
  });
});
