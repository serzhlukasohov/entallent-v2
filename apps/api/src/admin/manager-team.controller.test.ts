import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ManagerTeamController } from './manager-team.controller';

describe('ManagerTeamController', () => {
  it('refuses named team rows when the internal dashboard gate is disabled', async () => {
    const readModel = { getTeamOverview: vi.fn().mockResolvedValue({}) };
    const config = { get: vi.fn(() => false) };
    const controller = new ManagerTeamController(readModel as never, config as never);

    await expect(controller.getTeamOverview('8d1e0163-6d53-4713-bd24-254690cc5090')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(readModel.getTeamOverview).not.toHaveBeenCalled();
  });
});
