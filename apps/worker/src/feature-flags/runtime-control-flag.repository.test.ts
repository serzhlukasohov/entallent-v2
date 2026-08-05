import { describe, expect, it } from 'vitest';
import { runtimeControlMetadataDeniesUser, runtimeControlRowsEnableKillSwitch } from './runtime-control-flag.repository';

describe('runtimeControlMetadataDeniesUser', () => {
  it('denies all users when no user list is configured for an enabled denylist flag', () => {
    expect(runtimeControlMetadataDeniesUser({}, 'user-1')).toBe(true);
  });

  it('matches configured user IDs', () => {
    expect(runtimeControlMetadataDeniesUser({ userIds: ['user-1'] }, 'user-1')).toBe(true);
    expect(runtimeControlMetadataDeniesUser({ denylistedUserIds: ['user-2'] }, 'user-1')).toBe(false);
  });

  it('fails closed when user-list metadata is malformed', () => {
    expect(runtimeControlMetadataDeniesUser({ userIds: 'user-1' }, 'user-2')).toBe(true);
    expect(runtimeControlMetadataDeniesUser({ users: [123] }, 'user-2')).toBe(true);
  });
});

describe('runtimeControlRowsEnableKillSwitch', () => {
  it('keeps a global kill switch enabled even when a tenant row is disabled', () => {
    expect(
      runtimeControlRowsEnableKillSwitch(
        [
          { tenantId: null, enabled: true },
          { tenantId: 'tenant-1', enabled: false },
        ],
        'tenant-1',
      ),
    ).toBe(true);
  });

  it('allows a scoped tenant kill switch without disabling other tenants', () => {
    expect(runtimeControlRowsEnableKillSwitch([{ tenantId: 'tenant-1', enabled: true }], 'tenant-1')).toBe(true);
    expect(runtimeControlRowsEnableKillSwitch([{ tenantId: 'tenant-1', enabled: true }], 'tenant-2')).toBe(false);
  });
});
