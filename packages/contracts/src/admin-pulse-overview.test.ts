import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
  AdminPulseBacklogSummary,
  AdminPulseEmployeeRow,
  AdminPulseGroupRow,
  AdminPulseOverviewResponse,
} from './admin-pulse-overview';

describe('admin pulse overview contract', () => {
  it('preserves the pulse overview response envelope', () => {
    const response = {
      tenantId: 'tenant-1',
      generatedAt: '2026-08-12T00:00:00.000Z',
      allGroups: ['autonomy', 'belonging', 'engagement', 'growth', 'purpose'],
      employees: [
        {
          userId: 'user-1',
          displayName: null,
          groups: [
            {
              questionGroup: 'engagement',
              status: null,
              employeeScore: null,
              confirmedAt: null,
              questions: [
                {
                  stableKey: 'q12_1',
                  title: 'I know what is expected of me at work',
                  assessmentStatus: null,
                },
              ],
            },
          ],
          backlog: {
            doneCount: 1,
            pendingCount: 0,
            totalIgnoreCount: 2,
            nextQuestion: null,
          },
        },
      ],
    } satisfies AdminPulseOverviewResponse;

    expect(response.employees[0]?.displayName).toBeNull();
    expect(response.employees[0]?.groups[0]?.questions[0]?.assessmentStatus).toBeNull();
    expect(response.employees[0]?.backlog.nextQuestion).toBeNull();
    expectTypeOf(response).toMatchTypeOf<AdminPulseOverviewResponse>();
  });

  it('keeps dashboard-critical nullable fields stable', () => {
    expectTypeOf<AdminPulseEmployeeRow['displayName']>().toEqualTypeOf<string | null>();
    expectTypeOf<AdminPulseGroupRow['status']>().toEqualTypeOf<string | null>();
    expectTypeOf<AdminPulseGroupRow['employeeScore']>().toEqualTypeOf<number | null>();
    expectTypeOf<AdminPulseGroupRow['confirmedAt']>().toEqualTypeOf<string | null>();
    expectTypeOf<AdminPulseBacklogSummary['nextQuestion']>().toEqualTypeOf<{
      stableKey: string;
      group: string;
    } | null>();
  });
});
