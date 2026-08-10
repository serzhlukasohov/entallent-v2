import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  runtimeControlRowsEnableCanary,
  runtimeControlMetadataDeniesUser,
  runtimeControlRowsDenylistUser,
  runtimeControlRowsEnableKillSwitch,
} from './runtime-control-flag.repository';

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

describe('runtimeControlRowsEnableCanary', () => {
  it('matches internal user allowlists without exposing canary to other users', () => {
    const rows = [
      {
        tenantId: null,
        enabled: true,
        rolloutPercentage: 100,
        metadata: { internalUserIds: ['internal-user'] },
      },
    ];

    expect(
      runtimeControlRowsEnableCanary(rows, {
        tenantId: 'tenant-1',
        userId: 'internal-user',
        externalWorkspaceId: 'workspace-1',
      }),
    ).toBe(true);
    expect(
      runtimeControlRowsEnableCanary(rows, {
        tenantId: 'tenant-1',
        userId: 'control-user',
        externalWorkspaceId: 'workspace-1',
      }),
    ).toBe(false);
  });

  it('matches workspace allowlists without requiring a user match', () => {
    expect(
      runtimeControlRowsEnableCanary(
        [
          {
            tenantId: null,
            enabled: true,
            rolloutPercentage: 0,
            metadata: { externalWorkspaceIds: ['workspace-1'] },
          },
        ],
        {
          tenantId: 'tenant-1',
          userId: 'control-user',
          externalWorkspaceId: 'workspace-1',
        },
      ),
    ).toBe(true);
  });

  it('uses deterministic percentage buckets only when no allowlist metadata is present', () => {
    const rows = [
      {
        tenantId: null,
        enabled: true,
        rolloutPercentage: 20,
        metadata: {},
      },
    ];

    expect(runtimeControlRowsEnableCanary(rows, { tenantId: 'tenant-1', userId: 'user-1' })).toBe(
      true,
    );
    expect(
      runtimeControlRowsEnableCanary(rows, { tenantId: 'tenant-1', userId: 'control-user' }),
    ).toBe(false);
    expect(runtimeControlRowsEnableCanary(rows, { tenantId: 'tenant-1' })).toBe(false);
  });

  it('does not match a 100 percent percentage cohort without a user identifier', () => {
    expect(
      runtimeControlRowsEnableCanary(
        [
          {
            tenantId: null,
            enabled: true,
            rolloutPercentage: 100,
            metadata: {},
          },
        ],
        { tenantId: 'tenant-1' },
      ),
    ).toBe(false);
  });

  it('lets a tenant-specific row override a global canary row', () => {
    expect(
      runtimeControlRowsEnableCanary(
        [
          { tenantId: null, enabled: true, rolloutPercentage: 100, metadata: {} },
          { tenantId: 'tenant-1', enabled: false, rolloutPercentage: 100, metadata: {} },
        ],
        { tenantId: 'tenant-1', userId: 'user-1' },
      ),
    ).toBe(false);
    expect(
      runtimeControlRowsEnableCanary(
        [
          { tenantId: null, enabled: true, rolloutPercentage: 100, metadata: {} },
          { tenantId: 'tenant-1', enabled: false, rolloutPercentage: 100, metadata: {} },
        ],
        { tenantId: 'tenant-2', userId: 'user-1' },
      ),
    ).toBe(true);
  });

  it('fails closed for malformed canary allowlist metadata', () => {
    expect(
      runtimeControlRowsEnableCanary(
        [
          {
            tenantId: null,
            enabled: true,
            rolloutPercentage: 100,
            metadata: { internalUserIds: 'internal-user' },
          },
        ],
        { tenantId: 'tenant-1', userId: 'internal-user' },
      ),
    ).toBe(false);
  });

  it('fails closed for blank canary allowlist identifiers', () => {
    expect(
      runtimeControlRowsEnableCanary(
        [
          {
            tenantId: null,
            enabled: true,
            rolloutPercentage: 100,
            metadata: { internalUserIds: [''] },
          },
        ],
        { tenantId: 'tenant-1', userId: '' },
      ),
    ).toBe(false);
  });

  it('fails closed for duplicate tenant or global canary rows', () => {
    expect(
      runtimeControlRowsEnableCanary(
        [
          { tenantId: 'tenant-1', enabled: true, rolloutPercentage: 100, metadata: {} },
          { tenantId: 'tenant-1', enabled: false, rolloutPercentage: 100, metadata: {} },
        ],
        { tenantId: 'tenant-1', userId: 'user-1' },
      ),
    ).toBe(false);
    expect(
      runtimeControlRowsEnableCanary(
        [
          { tenantId: null, enabled: true, rolloutPercentage: 100, metadata: {} },
          { tenantId: null, enabled: false, rolloutPercentage: 100, metadata: {} },
        ],
        { tenantId: 'tenant-1', userId: 'user-1' },
      ),
    ).toBe(false);
  });

  it('fails closed for non-object canary metadata', () => {
    expect(
      runtimeControlRowsEnableCanary(
        [
          {
            tenantId: null,
            enabled: true,
            rolloutPercentage: 100,
            metadata: null,
          },
        ],
        { tenantId: 'tenant-1', userId: 'user-1' },
      ),
    ).toBe(false);
  });
});

describe('runtimeControlRowsDenylistUser', () => {
  it('keeps a global denylist effective even when a tenant row is disabled', () => {
    expect(
      runtimeControlRowsDenylistUser(
        [
          { enabled: true, metadata: { userIds: ['user-1'] } },
          { enabled: false, metadata: { userIds: ['user-2'] } },
        ],
        'user-1',
      ),
    ).toBe(true);
  });

  it('does not let duplicate disabled rows hide an enabled matching denylist row', () => {
    expect(
      runtimeControlRowsDenylistUser(
        [
          { enabled: false, metadata: { userIds: ['user-1'] } },
          { enabled: true, metadata: { userIds: ['user-1'] } },
        ],
        'user-1',
      ),
    ).toBe(true);
  });
});

describe('staged rollout scope guardrails', () => {
  it('does not introduce out-of-scope canary UI, deployment mutation, or Python write tools', () => {
    const repoRoot = join(process.cwd(), '../..');

    expect(existsSync(join(repoRoot, 'apps/dashboard/src/canary-rollout-controls.tsx'))).toBe(false);
    expect(existsSync(join(repoRoot, 'apps/dashboard/src/canary-readiness-report.tsx'))).toBe(false);
    expect(existsSync(join(repoRoot, 'agent-service/src/agent_service/tools/command_tool.py'))).toBe(false);
    expect(existsSync(join(repoRoot, 'agent-service/src/agent_service/tools/write_tool.py'))).toBe(false);
    expect(existsSync(join(repoRoot, 'agent-service/deployment/canary-rollout.toml'))).toBe(false);
  });
});
