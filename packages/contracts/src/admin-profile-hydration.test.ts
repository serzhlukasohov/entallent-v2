import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
  AdminProfileHydrationStatus,
  AdminProfileHydrationStatusResponse,
} from './admin-profile-hydration';
import { ADMIN_PROFILE_HYDRATION_STATUSES } from './admin-profile-hydration';

describe('admin profile hydration contract', () => {
  it('preserves the status response envelope', () => {
    const response = {
      tenantId: 'tenant-1',
      generatedAt: '2026-08-12T00:00:00.000Z',
      summary: {
        channelAccounts: 2,
        missingDisplayNames: 1,
        neverAttempted: 1,
        missingProfile: 0,
        failed: 0,
        failedJobs: 1,
      },
      missingDisplayNames: [
        {
          userId: 'user-1',
          channelType: 'slack',
          externalWorkspaceId: 'T1',
          externalUserId: 'U1',
          preferredName: null,
          channelDisplayName: null,
          status: 'unknown',
          attemptCount: 0,
          lastAttemptAt: null,
          lastSuccessAt: null,
          lastError: null,
          reason: null,
        },
      ],
      failedJobs: [
        {
          id: '42',
          name: 'hydrate',
          failedReason: 'Slack timeout',
          attemptsMade: 3,
          timestamp: 1786492800000,
          finishedOn: 1786492860000,
          data: {
            userId: 'user-1',
            tenantId: 'tenant-1',
            channelType: 'slack',
            traceId: 'trace-1',
          },
        },
      ],
    } satisfies AdminProfileHydrationStatusResponse;

    expect(response.summary.missingDisplayNames).toBe(1);
    expect(response.missingDisplayNames[0]?.status).toBe('unknown');
    expectTypeOf(response).toMatchTypeOf<AdminProfileHydrationStatusResponse>();
  });

  it('keeps status values explicit', () => {
    expect(ADMIN_PROFILE_HYDRATION_STATUSES).toEqual([
      'success',
      'missing_profile',
      'failed',
      'unknown',
    ]);
    expectTypeOf<
      (typeof ADMIN_PROFILE_HYDRATION_STATUSES)[number]
    >().toEqualTypeOf<AdminProfileHydrationStatus>();
  });
});
