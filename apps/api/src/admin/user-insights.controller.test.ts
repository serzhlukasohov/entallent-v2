import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { UserInsightsController } from './user-insights.controller';

describe('UserInsightsController', () => {
  it('refuses employee insights when the internal dashboard gate is disabled', async () => {
    const db = { client: { select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), limit: vi.fn(async () => []) }) } };
    const config = { get: vi.fn(() => false) };
    const controller = new UserInsightsController(db as never, config as never);

    await expect(controller.getInsights('user-1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.client.select).not.toHaveBeenCalled();
  });
});
