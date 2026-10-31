import 'reflect-metadata';
import { ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { OnboardingRestartController } from './onboarding-restart.controller';
import type { OnboardingRestartResult } from './onboarding-restart.service';

const tenantId = '00000000-0000-4000-8000-000000000000';
const userId = '11111111-1111-4111-8111-111111111111';

function makeController(restartResult: OnboardingRestartResult, dashboardEnabled = true) {
  const restart = vi.fn().mockResolvedValue(restartResult);
  const append = vi.fn().mockResolvedValue(true);
  const scanAdd = vi.fn();
  const config = { get: vi.fn(() => dashboardEnabled) };
  const controller = new OnboardingRestartController(
    { restart } as never,
    { append } as never,
    config as never,
    { add: scanAdd } as never,
  );
  return { controller, restart, append, scanAdd };
}

describe('OnboardingRestartController', () => {
  it('requires ApiKeyGuard', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, OnboardingRestartController)).toContain(ApiKeyGuard);
  });

  it('restarts onboarding, queues the intro dispatch for the unit and audits both ends', async () => {
    const { controller, restart, append, scanAdd } = makeController({ stateDeleted: true, deliveryRequeued: true, unitId: 'unit-1' });

    const result = await controller.restart(userId, tenantId);

    expect(restart).toHaveBeenCalledWith({ tenantId, personId: userId });
    expect(scanAdd).toHaveBeenCalledWith(
      'onboarding-only',
      { tenantId, unitId: 'unit-1' },
      expect.objectContaining({ attempts: 1, jobId: expect.stringContaining(userId) }),
    );
    expect(result).toEqual({ stateDeleted: true, deliveryRequeued: true, introQueued: true });
    expect(append.mock.calls.map(([entry]) => entry.action)).toEqual([
      'admin.onboarding_restart_requested',
      'admin.onboarding_restart_completed',
    ]);
  });

  it('queues no dispatch when the person has no onboarding delivery', async () => {
    const { controller, scanAdd } = makeController({ stateDeleted: true, deliveryRequeued: false, unitId: null });

    const result = await controller.restart(userId, tenantId);

    expect(scanAdd).not.toHaveBeenCalled();
    expect(result.introQueued).toBe(false);
  });

  it('refuses when the internal dashboard is disabled, before touching state', async () => {
    const { controller, restart, append, scanAdd } = makeController({ stateDeleted: true, deliveryRequeued: true, unitId: 'u' }, false);

    await expect(controller.restart(userId, tenantId)).rejects.toBeInstanceOf(ForbiddenException);

    expect(append).not.toHaveBeenCalled();
    expect(restart).not.toHaveBeenCalled();
    expect(scanAdd).not.toHaveBeenCalled();
  });
});
