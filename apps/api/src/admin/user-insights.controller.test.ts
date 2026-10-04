import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { UserInsightsController } from './user-insights.controller';
describe('UserInsightsController privacy boundary', () => {
  it.each([false, true])('refuses private insights with internal dashboard enabled=%s', async (enabled) => {
    const select = vi.fn();
    const controller = new UserInsightsController({ client: { select } } as never, { get: () => enabled } as never);
    await expect(controller.getInsights('user-1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(select).not.toHaveBeenCalled();
  });
});
