import { describe, expect, it } from 'vitest';
import {
  buildProfileHydrationStatusResponse,
  ProfileHydrationStatusController,
  type ChannelAccountHydrationRow,
} from './profile-hydration-status.controller';

describe('profile hydration admin status', () => {
  it('summarizes missing display names by latest hydration status', () => {
    const rows: ChannelAccountHydrationRow[] = [
      row({
        userId: 'u-1',
        profileMetadata: {
          profileHydration: {
            status: 'missing_profile',
            attemptCount: 2,
            lastAttemptAt: '2026-08-12T10:00:00.000Z',
            reason: 'external_profile_unavailable',
          },
        },
      }),
      row({
        userId: 'u-2',
        channelDisplayName: 'Slack Bob',
        profileMetadata: {
          profileHydration: {
            status: 'success',
            attemptCount: 1,
            lastAttemptAt: '2026-08-12T10:00:00.000Z',
            lastSuccessAt: '2026-08-12T10:00:00.000Z',
          },
        },
      }),
      row({
        userId: 'u-3',
        profileMetadata: {},
      }),
    ];

    const response = buildProfileHydrationStatusResponse('tenant-1', rows, [
      {
        id: '42',
        name: 'hydrate',
        failedReason: 'Slack timeout',
        attemptsMade: 3,
        timestamp: 1786492800000,
        finishedOn: null,
        data: { userId: 'u-1', tenantId: 'tenant-1', channelType: 'slack' },
      },
    ]);

    expect(response.summary).toEqual({
      channelAccounts: 3,
      missingDisplayNames: 2,
      neverAttempted: 1,
      missingProfile: 1,
      failed: 0,
      failedJobs: 1,
    });
    expect(response.missingDisplayNames).toEqual([
      expect.objectContaining({
        userId: 'u-1',
        status: 'missing_profile',
        attemptCount: 2,
        reason: 'external_profile_unavailable',
      }),
      expect.objectContaining({
        userId: 'u-3',
        status: 'unknown',
        attemptCount: 0,
      }),
    ]);
  });

  it('does not report users that already have a preferred name', () => {
    const response = buildProfileHydrationStatusResponse(
      'tenant-1',
      [
        row({
          userId: 'u-1',
          preferredName: 'Alice',
          channelDisplayName: null,
          profileMetadata: { profileHydration: { status: 'failed', attemptCount: 3 } },
        }),
      ],
      [],
    );

    expect(response.summary.missingDisplayNames).toBe(0);
    expect(response.missingDisplayNames).toEqual([]);
  });

  it('filters failed jobs to the requested tenant only', async () => {
    const controller = new ProfileHydrationStatusController(
      {
        client: {
          select: () => ({
            from: () => ({
              innerJoin: () => ({
                where: async () => [],
              }),
            }),
          }),
        },
      } as never,
      { get: () => 'redis://localhost:6379' } as never,
    );
    (
      controller as unknown as {
        profileHydrationQueue: { getFailed: () => Promise<unknown[]> };
      }
    ).profileHydrationQueue = {
      getFailed: async () => [
        failedJob({ id: 'tenant-job', data: { tenantId: 'tenant-1', userId: 'u-1' } }),
        failedJob({ id: 'other-tenant-job', data: { tenantId: 'tenant-2', userId: 'u-2' } }),
        failedJob({ id: 'missing-tenant-job', data: { userId: 'u-3' } }),
      ],
    };

    const response = await controller.getStatus('tenant-1');

    expect(response.failedJobs.map((job) => job.id)).toEqual(['tenant-job']);
    expect(response.summary.failedJobs).toBe(1);
  });

  it('rejects a blank tenant id', async () => {
    const controller = makeController();

    await expect(controller.getStatus('   ')).rejects.toThrow('tenantId is required');
  });

  it('still returns database status when the queue read fails', async () => {
    const controller = makeController([row({ userId: 'u-1' })]);
    (
      controller as unknown as {
        profileHydrationQueue: { getFailed: () => Promise<unknown[]> };
      }
    ).profileHydrationQueue = {
      getFailed: async () => {
        throw new Error('Redis unavailable');
      },
    };

    const response = await controller.getStatus('tenant-1');

    expect(response.summary.missingDisplayNames).toBe(1);
    expect(response.failedJobs).toEqual([]);
  });
});

function row(overrides: Partial<ChannelAccountHydrationRow>): ChannelAccountHydrationRow {
  return {
    userId: 'u-1',
    preferredName: null,
    channelType: 'slack',
    externalWorkspaceId: 'T1',
    externalUserId: 'U1',
    channelDisplayName: null,
    profileMetadata: {},
    ...overrides,
  };
}

function failedJob(overrides: { id: string; data: Record<string, unknown> }) {
  return {
    id: overrides.id,
    name: 'hydrate',
    failedReason: 'failed',
    attemptsMade: 3,
    timestamp: 1786492800000,
    finishedOn: null,
    data: overrides.data,
  };
}

function makeController(rows: ChannelAccountHydrationRow[] = []): ProfileHydrationStatusController {
  return new ProfileHydrationStatusController(
    {
      client: {
        select: () => ({
          from: () => ({
            innerJoin: () => ({
              where: async () => rows,
            }),
          }),
        }),
      },
    } as never,
    { get: () => 'redis://localhost:6379' } as never,
  );
}
