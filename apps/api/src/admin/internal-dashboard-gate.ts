import { ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '@entalent/config';

type DashboardGateConfig = Pick<ConfigService<Env, true>, 'get'>;

export function assertInternalDashboardEnabled(config: DashboardGateConfig): void {
  if (!config.get('INTERNAL_DASHBOARD_ENABLED', { infer: true })) {
    throw new ForbiddenException('Internal dashboard is disabled');
  }
}
