import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { DevSimulateController } from './dev-simulate.controller';

const validTenantId = '00000000-0000-4000-8000-000000000000';

describe('DevSimulateController security', () => {
  it('requires ApiKeyGuard on all /dev routes', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, DevSimulateController) ?? [];

    expect(guards).toContain(ApiKeyGuard);
  });

  it('rejects force-checkin without tenantId before touching storage or queues', async () => {
    const { controller, dbTouched, queueAdd } = makeController();

    await expect(controller.forceCheckIn({} as never)).rejects.toBeInstanceOf(BadRequestException);

    expect(dbTouched).not.toHaveBeenCalled();
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('rejects force-checkin with blank tenantId before touching storage or queues', async () => {
    const { controller, dbTouched, queueAdd } = makeController();

    await expect(controller.forceCheckIn({ tenantId: '   ' })).rejects.toBeInstanceOf(BadRequestException);

    expect(dbTouched).not.toHaveBeenCalled();
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('rejects force-checkin with an absent body before touching storage or queues', async () => {
    const { controller, dbTouched, queueAdd } = makeController();

    await expect(controller.forceCheckIn(undefined)).rejects.toBeInstanceOf(BadRequestException);

    expect(dbTouched).not.toHaveBeenCalled();
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('rejects force-checkin with non-string tenantId before touching storage or queues', async () => {
    const { controller, dbTouched, queueAdd } = makeController();

    await expect(controller.forceCheckIn({ tenantId: 123 } as never)).rejects.toBeInstanceOf(BadRequestException);

    expect(dbTouched).not.toHaveBeenCalled();
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('rejects force-checkin with non-UUID tenantId before touching storage or queues', async () => {
    const { controller, dbTouched, queueAdd } = makeController();

    await expect(controller.forceCheckIn({ tenantId: 'not-a-uuid' })).rejects.toBeInstanceOf(BadRequestException);

    expect(dbTouched).not.toHaveBeenCalled();
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('rejects force-checkin with malformed userIds before touching storage or queues', async () => {
    const { controller, dbTouched, queueAdd } = makeController();

    await expect(controller.forceCheckIn({ tenantId: validTenantId, userIds: 'u-1' } as never)).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.forceCheckIn({ tenantId: validTenantId, userIds: ['u-1', 42] } as never)).rejects.toBeInstanceOf(BadRequestException);

    expect(dbTouched).not.toHaveBeenCalled();
    expect(queueAdd).not.toHaveBeenCalled();
  });
});

describe('DevSimulateController reset-user', () => {
  const resetResult = {
    conversations: 1, messages: 2, memoryItems: 3, userGoals: 4, scheduledActions: 5, riskSignals: 6, surveyWindows: 7,
    surveyAssessments: 8, surveyEvidence: 9, surveyGroupStates: 10, pulseBacklog: 11, userStyleProfiles: 12, llmRuns: 13,
  };

  function makeResetController(restartResult: { stateDeleted: boolean; deliveryRequeued: boolean; unitId: string | null }) {
    const resetUser = vi.fn().mockResolvedValue(resetResult);
    const restart = vi.fn().mockResolvedValue(restartResult);
    const scanAdd = vi.fn().mockResolvedValue(undefined);
    const controller = new DevSimulateController(
      {} as never,
      {} as never,
      {} as never,
      { add: scanAdd } as never,
      {} as never,
      { resetUser } as never,
      { restart } as never,
    );
    return { controller, resetUser, restart, scanAdd };
  }

  it('restarts onboarding after the user reset and queues the intro dispatch for the delivery unit', async () => {
    const { controller, resetUser, restart, scanAdd } = makeResetController({ stateDeleted: true, deliveryRequeued: true, unitId: 'unit-1' });

    const result = await controller.resetUser({ userId: 'person-1', tenantId: validTenantId, deep: false });

    expect(resetUser).toHaveBeenCalledWith({ tenantId: validTenantId, userId: 'person-1', deleteConversationHistory: false });
    expect(restart).toHaveBeenCalledWith({ tenantId: validTenantId, personId: 'person-1' });
    expect(scanAdd).toHaveBeenCalledWith(
      'onboarding-only',
      { tenantId: validTenantId, unitId: 'unit-1' },
      expect.objectContaining({ attempts: 1, jobId: expect.stringContaining('person-1') }),
    );
    expect(result).toEqual({ ...resetResult, onboarding: { stateDeleted: true, deliveryRequeued: true, introQueued: true } });
  });

  it('queues no dispatch when the person has no onboarding delivery to requeue', async () => {
    const { controller, restart, scanAdd } = makeResetController({ stateDeleted: true, deliveryRequeued: false, unitId: null });

    const result = await controller.resetUser({ userId: 'person-2', tenantId: validTenantId, deep: true });

    expect(restart).toHaveBeenCalledOnce();
    expect(scanAdd).not.toHaveBeenCalled();
    expect(result.onboarding).toEqual({ stateDeleted: true, deliveryRequeued: false, introQueued: false });
  });
});

function makeController() {
  const dbTouched = vi.fn(() => {
    throw new Error('db should not be touched');
  });
  const queueAdd = vi.fn();
  const db = {
    client: {
      get select() {
        dbTouched();
        return undefined;
      },
    },
  };

  const controller = new DevSimulateController(
    {} as never,
    db as never,
    { add: queueAdd } as never,
    {} as never,
    {} as never,
    { resetUser: vi.fn() } as never,
    { restart: vi.fn() } as never,
  );

  return { controller, dbTouched, queueAdd };
}
