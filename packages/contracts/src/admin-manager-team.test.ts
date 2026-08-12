import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
  AdminManagerTeamEmployee,
  AdminManagerTeamKnownPolarity,
  AdminManagerTeamResponse,
} from './admin-manager-team';
import { ADMIN_MANAGER_TEAM_KNOWN_POLARITIES } from './admin-manager-team';

describe('admin manager team contract', () => {
  it('preserves the team overview response envelope', () => {
    const response = {
      tenantId: 'tenant-1',
      teamSize: 1,
      generatedAt: '2026-08-12T00:00:00.000Z',
      employees: [
        {
          userId: 'user-1',
          displayName: 'Alice',
          lastActiveAt: null,
          hasActiveRisk: false,
          surveyWindowId: 'window-1',
          scoredCount: 1,
          totalQuestions: 2,
          coveragePct: 50,
          signals: [
            {
              stableKey: 'q12_1',
              title: 'I know what is expected of me at work',
              dimension: 'engagement',
              assessmentStatus: 'scored',
              polarity: 'positive',
              strength: 0.8,
              confidence: 0.9,
              evidenceSummary: 'Clear positive evidence',
            },
          ],
        },
      ],
    } satisfies AdminManagerTeamResponse;

    expect(response.employees[0]?.displayName).toBe('Alice');
    expect(response.employees[0]?.signals[0]?.polarity).toBe('positive');
    expectTypeOf(response).toMatchTypeOf<AdminManagerTeamResponse>();
  });

  it('keeps dashboard-critical field types narrow', () => {
    expect(ADMIN_MANAGER_TEAM_KNOWN_POLARITIES).toEqual([
      'positive',
      'negative',
      'neutral',
      'mixed',
    ]);
    expectTypeOf<AdminManagerTeamEmployee['displayName']>().toEqualTypeOf<string>();
    expectTypeOf<AdminManagerTeamEmployee['signals'][number]['polarity']>().toEqualTypeOf<
      string | null
    >();
    expectTypeOf<
      (typeof ADMIN_MANAGER_TEAM_KNOWN_POLARITIES)[number]
    >().toEqualTypeOf<AdminManagerTeamKnownPolarity>();
  });
});
