import { describe, expect, it, vi } from 'vitest';
import { GroupReportUseCase } from './group-report.use-case';

describe('GroupReportUseCase', () => {
  it('supplies only proof-backed reportable summaries to the report model', async () => {
    const members = Array.from({ length: 5 }, (_, index) => `user-${index + 1}`);
    const surveyRepo = {
      findTeamById: vi.fn().mockResolvedValue({
        teamId: 'team-1',
        managerSlackUserId: 'manager-1',
        activeTeamSize: members.length,
        memberUserIds: members,
      }),
      findConfirmedGroupStates: vi.fn().mockResolvedValue(
        members.map((userId) => ({
          userId,
          status: 'confirmed',
          employeeScore: 8,
          aiSummary: 'Mutable legacy value.',
          reportableSummary: `Displayed summary for ${userId}.`,
        })),
      ),
    };
    const ai = {
      generateGroupReport: vi.fn().mockResolvedValue({
        explanation: 'Explanation.',
        actionItems: ['One', 'Two', 'Three'],
      }),
    };
    const useCase = new GroupReportUseCase(surveyRepo as never, ai as never);

    await useCase.execute({ teamId: 'team-1', questionGroup: 'engagement' });

    expect(ai.generateGroupReport).toHaveBeenCalledWith(
      members.map((userId) => `Displayed summary for ${userId}.`),
      'engagement',
      8,
      null,
    );
  });
});
