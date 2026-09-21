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
  );

  return { controller, dbTouched, queueAdd };
}
