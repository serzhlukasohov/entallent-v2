import { describe, expect, it, vi } from 'vitest';
import { GroupReportUseCase } from './group-report.use-case';

const reportingPeriodStart = new Date('2026-07-01T00:00:00.000Z');
const reportingPeriodEnd = new Date('2026-09-30T23:59:59.999Z');
const reportingSurveyDefinitionId = 'definition-1';
const reportScope = (reportingRosterUserIds: string[]) => ({
  reportingCohortId: 'cohort-1',
  surveyDefinitionId: reportingSurveyDefinitionId,
  reportingTeamId: 'team-1',
  reportingRosterUserIds,
  reportingPeriodStart,
  reportingPeriodEnd,
});

describe('GroupReportUseCase', () => {
  it('keeps the frozen five-person denominator after one member opts out', async () => {
    const members = Array.from({ length: 5 }, (_, index) => `user-${index + 1}`);
    const accepted = { status: 'accepted' as const, policyVersion: 'deidentification-v1' as const, reasons: [] };
    const surveyRepo = {
      findTeamById: vi.fn().mockResolvedValue({
        teamId: 'team-1', tenantId: 'tenant-1', managerSlackUserId: 'manager-1',
        activeTeamSize: members.length, memberUserIds: members, reportingCohortId: 'cohort-1',
        reportingSurveyDefinitionId, reportingPeriodStart, reportingPeriodEnd,
      }),
      findConfirmedGroupStates: vi.fn().mockResolvedValue(
        members.slice(0, 4).map((userId) => ({
          ...reportScope(members), reportingCohortId: 'cohort-1', userId,
          tenantId: 'tenant-1', status: 'confirmed', questionGroup: 'growth',
          confirmedAt: new Date('2026-09-01T10:00:00.000Z'), reportableSummary: `Summary ${userId}.`,
          deidentificationDecision: accepted, withdrawnAt: null, employeeScore: 8,
        })),
      ),
    };
    const ai = { generateGroupReport: vi.fn() };
    const useCase = new GroupReportUseCase(surveyRepo as never, ai as never);

    await expect(useCase.execute({
      reportingCohortId: 'cohort-1',
      tenantId: 'tenant-1',
      teamId: 'team-1',
      questionGroup: 'growth',
    })).resolves.toMatchObject({ shouldSend: false, confirmedCount: 4 });
    expect(ai.generateGroupReport).not.toHaveBeenCalled();
  });

  it('uses the final-report floor after the period cutoff instead of the intermediate 80 percent threshold', async () => {
    const members = Array.from({ length: 7 }, (_, index) => `user-${index + 1}`);
    const accepted = { status: 'accepted' as const, policyVersion: 'deidentification-v1' as const, reasons: [] };
    const reportableUsers = members.slice(0, 5);
    const surveyRepo = {
      findTeamById: vi.fn().mockResolvedValue({
        teamId: 'team-1', tenantId: 'tenant-1', managerSlackUserId: 'manager-1',
        activeTeamSize: members.length, memberUserIds: members, reportingCohortId: 'cohort-1',
        reportingSurveyDefinitionId, reportingPeriodStart, reportingPeriodEnd,
      }),
      findConfirmedGroupStates: vi.fn().mockResolvedValue(
        reportableUsers.map((userId) => ({
          ...reportScope(members), userId,
          tenantId: 'tenant-1', status: 'confirmed', questionGroup: 'growth',
          confirmedAt: new Date('2026-09-29T10:00:00.000Z'), reportableSummary: `Summary ${userId}.`,
          deidentificationDecision: accepted, withdrawnAt: null, employeeScore: 8,
        })),
      ),
    };
    const ai = {
      generateGroupReport: vi.fn().mockResolvedValue({ explanation: 'Explanation.', actionItems: ['One', 'Two', 'Three'] }),
    };
    const useCase = new GroupReportUseCase(surveyRepo as never, ai as never);

    await expect(useCase.execute({
      reportingCohortId: 'cohort-1',
      tenantId: 'tenant-1',
      teamId: 'team-1',
      questionGroup: 'growth',
      reportKind: 'final',
      now: new Date('2026-10-01T00:00:00.000Z'),
    })).resolves.toMatchObject({ shouldSend: true, confirmedCount: 5 });
    expect(ai.generateGroupReport).toHaveBeenCalledOnce();
  });

  it('does not generate a final report before the immutable period cutoff', async () => {
    const members = Array.from({ length: 5 }, (_, index) => `user-${index + 1}`);
    const surveyRepo = {
      findTeamById: vi.fn().mockResolvedValue({
        teamId: 'team-1', tenantId: 'tenant-1', managerSlackUserId: 'manager-1',
        activeTeamSize: members.length, memberUserIds: members, reportingCohortId: 'cohort-1',
        reportingSurveyDefinitionId, reportingPeriodStart, reportingPeriodEnd,
      }),
      findConfirmedGroupStates: vi.fn(),
    };
    const ai = { generateGroupReport: vi.fn() };
    const useCase = new GroupReportUseCase(surveyRepo as never, ai as never);

    await expect(useCase.execute({
      reportingCohortId: 'cohort-1',
      tenantId: 'tenant-1',
      teamId: 'team-1',
      questionGroup: 'growth',
      reportKind: 'final',
      now: new Date('2026-09-30T23:00:00.000Z'),
    })).resolves.toMatchObject({ shouldSend: false, confirmedCount: 0 });
    expect(surveyRepo.findConfirmedGroupStates).not.toHaveBeenCalled();
    expect(ai.generateGroupReport).not.toHaveBeenCalled();
  });

  it('counts one employee only once when reportable rows are duplicated', async () => {
    const members = Array.from({ length: 5 }, (_, index) => `user-${index + 1}`);
    const accepted = {
      status: 'accepted' as const,
      policyVersion: 'deidentification-v1' as const,
      reasons: [],
    };
    const surveyRepo = {
      findTeamById: vi.fn().mockResolvedValue({
        teamId: 'team-1',
        tenantId: 'tenant-1',
        managerSlackUserId: 'manager-1',
        activeTeamSize: members.length,
        memberUserIds: members,
        reportingCohortId: 'cohort-1',
        reportingSurveyDefinitionId,
        reportingPeriodStart,
        reportingPeriodEnd,
      }),
      findConfirmedGroupStates: vi.fn().mockResolvedValue(
        [...members.slice(0, 4), members[0]].map((userId) => ({
          ...reportScope(members),
          userId,
          tenantId: 'tenant-1',
          status: 'confirmed',
          questionGroup: 'engagement',
          confirmedAt: new Date('2026-09-01T10:00:00.000Z'),
          employeeScore: 8,
          reportableSummary: `Displayed summary for ${userId}.`,
          deidentificationDecision: accepted,
        })),
      ),
    };
    const ai = {
      generateGroupReport: vi.fn().mockResolvedValue({ explanation: 'Explanation.', actionItems: [] }),
    };
    const useCase = new GroupReportUseCase(surveyRepo as never, ai as never);

    await expect(useCase.execute({ reportingCohortId: 'cohort-1', tenantId: 'tenant-1', teamId: 'team-1', questionGroup: 'engagement' }))
      .resolves.toMatchObject({ shouldSend: false, confirmedCount: 4 });
    expect(ai.generateGroupReport).not.toHaveBeenCalled();
  });

  it('rejects reportable rows outside the job tenant and frozen roster', async () => {
    const members = Array.from({ length: 5 }, (_, index) => `user-${index + 1}`);
    const accepted = { status: 'accepted' as const, policyVersion: 'deidentification-v1' as const, reasons: [] };
    const surveyRepo = {
      findTeamById: vi.fn().mockResolvedValue({
        teamId: 'team-1', tenantId: 'tenant-1', managerSlackUserId: 'manager-1',
        activeTeamSize: members.length, memberUserIds: members, reportingCohortId: 'cohort-1',
        reportingSurveyDefinitionId, reportingPeriodStart, reportingPeriodEnd,
      }),
      findConfirmedGroupStates: vi.fn().mockResolvedValue([
        ...members.slice(0, 4).map((userId) => ({
          ...reportScope(members),
          userId, tenantId: 'tenant-1', status: 'confirmed', questionGroup: 'growth',
          confirmedAt: new Date('2026-09-01T10:00:00.000Z'), reportableSummary: `Summary ${userId}.`,
          deidentificationDecision: accepted, withdrawnAt: null, employeeScore: 8,
        })),
        {
          ...reportScope(members),
          userId: 'user-5', tenantId: 'tenant-2', status: 'confirmed', questionGroup: 'growth',
          confirmedAt: new Date('2026-09-01T10:00:00.000Z'), reportableSummary: 'Foreign tenant.',
          deidentificationDecision: accepted, withdrawnAt: null, employeeScore: 8,
        },
        {
          ...reportScope(members),
          userId: 'outsider', tenantId: 'tenant-1', status: 'confirmed', questionGroup: 'growth',
          confirmedAt: new Date('2026-09-01T10:00:00.000Z'), reportableSummary: 'Foreign team.',
          deidentificationDecision: accepted, withdrawnAt: null, employeeScore: 8,
        },
        {
          ...reportScope(members),
          userId: 'user-5', tenantId: 'tenant-1', status: 'pending_confirmation', questionGroup: 'growth',
          confirmedAt: new Date('2026-09-01T10:00:00.000Z'), reportableSummary: 'Not confirmed.',
          deidentificationDecision: accepted, withdrawnAt: null, employeeScore: 8,
        },
        {
          ...reportScope(members),
          userId: 'user-5', tenantId: 'tenant-1', status: 'confirmed', questionGroup: 'purpose',
          confirmedAt: new Date('2026-09-01T10:00:00.000Z'), reportableSummary: 'Wrong Pulse Index.',
          deidentificationDecision: accepted, withdrawnAt: null, employeeScore: 8,
        },
        {
          ...reportScope(members),
          userId: 'user-5', tenantId: 'tenant-1', status: 'confirmed', questionGroup: 'growth',
          confirmedAt: reportingPeriodEnd, reportableSummary: 'Confirmed at excluded cutoff.',
          deidentificationDecision: accepted, withdrawnAt: null, employeeScore: 8,
        },
        {
          ...reportScope(members),
          reportingPeriodStart: new Date('2026-04-01T00:00:00.000Z'),
          reportingPeriodEnd: new Date('2026-06-30T23:59:59.999Z'),
          userId: 'user-5', tenantId: 'tenant-1', status: 'confirmed', questionGroup: 'growth',
          confirmedAt: new Date('2026-09-01T10:00:00.000Z'), reportableSummary: 'Wrong cycle.',
          deidentificationDecision: accepted, withdrawnAt: null, employeeScore: 8,
        },
      ]),
    };
    const ai = { generateGroupReport: vi.fn() };
    const useCase = new GroupReportUseCase(surveyRepo as never, ai as never);

    await expect(useCase.execute({ reportingCohortId: 'cohort-1', tenantId: 'tenant-1', teamId: 'team-1', questionGroup: 'growth' }))
      .resolves.toMatchObject({ shouldSend: false, confirmedCount: 4 });
    expect(ai.generateGroupReport).not.toHaveBeenCalled();
  });

  it('does not report confirmed summaries without a typed de-identification acceptance', async () => {
    const members = Array.from({ length: 5 }, (_, index) => `user-${index + 1}`);
    const surveyRepo = {
      findTeamById: vi.fn().mockResolvedValue({
        teamId: 'team-1',
        tenantId: 'tenant-1',
        managerSlackUserId: 'manager-1',
        activeTeamSize: members.length,
        memberUserIds: members,
        reportingCohortId: 'cohort-1',
        reportingSurveyDefinitionId,
        reportingPeriodStart,
        reportingPeriodEnd,
      }),
      findConfirmedGroupStates: vi.fn().mockResolvedValue(
        members.map((userId) => ({
          ...reportScope(members),
          userId,
          tenantId: 'tenant-1',
          status: 'confirmed',
          questionGroup: 'engagement',
          confirmedAt: new Date('2026-09-01T10:00:00.000Z'),
          employeeScore: 8,
          reportableSummary: `Alice reported launch-day conflict for Project Apollo ${userId}.`,
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

    await expect(useCase.execute({ reportingCohortId: 'cohort-1', tenantId: 'tenant-1', teamId: 'team-1', questionGroup: 'engagement' }))
      .resolves.toMatchObject({ shouldSend: false, confirmedCount: 0 });
    expect(ai.generateGroupReport).not.toHaveBeenCalled();
  });

  it('supplies only proof-backed reportable summaries to the report model', async () => {
    const members = Array.from({ length: 5 }, (_, index) => `user-${index + 1}`);
    const surveyRepo = {
      findTeamById: vi.fn().mockResolvedValue({
        teamId: 'team-1',
        tenantId: 'tenant-1',
        managerSlackUserId: 'manager-1',
        activeTeamSize: members.length,
        memberUserIds: members,
        reportingCohortId: 'cohort-1',
        reportingSurveyDefinitionId,
        reportingPeriodStart,
        reportingPeriodEnd,
      }),
      findConfirmedGroupStates: vi.fn().mockResolvedValue(
        members.map((userId) => ({
          ...reportScope(members),
          userId,
          tenantId: 'tenant-1',
          status: 'confirmed',
          questionGroup: 'engagement',
          confirmedAt: new Date('2026-09-01T10:00:00.000Z'),
          employeeScore: 8,
          aiSummary: 'Mutable legacy value.',
          reportableSummary: `Displayed summary for ${userId}.`,
          deidentificationDecision: {
            status: 'accepted',
            policyVersion: 'deidentification-v1',
            reasons: [],
          },
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

    await useCase.execute({ reportingCohortId: 'cohort-1', tenantId: 'tenant-1', teamId: 'team-1', questionGroup: 'engagement' });

    expect(surveyRepo.findTeamById).toHaveBeenCalledWith('team-1', 'tenant-1', 'cohort-1');
    expect(surveyRepo.findConfirmedGroupStates).toHaveBeenCalledWith({
      reportingCohortId: 'cohort-1',
      tenantId: 'tenant-1',
      teamId: 'team-1',
      rosterUserIds: members,
      questionGroup: 'engagement',
    });
    expect(ai.generateGroupReport).toHaveBeenCalledWith(
      members.map((userId) => `Displayed summary for ${userId}.`),
      'engagement',
      8,
      null,
    );
  });

  it('does not report withdrawn confirmed summaries', async () => {
    const members = Array.from({ length: 5 }, (_, index) => `user-${index + 1}`);
    const accepted = {
      status: 'accepted' as const,
      policyVersion: 'deidentification-v1' as const,
      reasons: [],
    };
    const surveyRepo = {
      findTeamById: vi.fn().mockResolvedValue({
        teamId: 'team-1',
        tenantId: 'tenant-1',
        managerSlackUserId: 'manager-1',
        activeTeamSize: members.length,
        memberUserIds: members,
        reportingCohortId: 'cohort-1',
        reportingSurveyDefinitionId,
        reportingPeriodStart,
        reportingPeriodEnd,
      }),
      findConfirmedGroupStates: vi.fn().mockResolvedValue(
        members.map((userId, index) => ({
          ...reportScope(members),
          userId,
          tenantId: 'tenant-1',
          status: 'confirmed',
          questionGroup: 'engagement',
          confirmedAt: new Date('2026-09-01T10:00:00.000Z'),
          employeeScore: 8,
          reportableSummary: `Displayed summary for ${userId}.`,
          deidentificationDecision: accepted,
          withdrawnAt: index === 0 ? new Date('2026-09-06T10:00:00.000Z') : null,
        })),
      ),
    };
    const ai = {
      generateGroupReport: vi.fn(),
    };
    const useCase = new GroupReportUseCase(surveyRepo as never, ai as never);

    await expect(useCase.execute({ reportingCohortId: 'cohort-1', tenantId: 'tenant-1', teamId: 'team-1', questionGroup: 'engagement' }))
      .resolves.toMatchObject({ shouldSend: false, confirmedCount: 4 });
    expect(ai.generateGroupReport).not.toHaveBeenCalled();
  });

  it('uses the latest confirmed row per employee and labels the persisted cycle', async () => {
    const members = Array.from({ length: 5 }, (_, index) => `user-${index + 1}`);
    const accepted = {
      status: 'accepted' as const,
      policyVersion: 'deidentification-v1' as const,
      reasons: [],
    };
    const state = (userId: string, summary: string, score: number, confirmedAt: string) => ({
      ...reportScope(members),
      userId,
      tenantId: 'tenant-1',
      status: 'confirmed',
      questionGroup: 'engagement',
      confirmedAt: new Date(confirmedAt),
      employeeScore: score,
      reportableSummary: summary,
      deidentificationDecision: accepted,
      withdrawnAt: null,
    });
    const surveyRepo = {
      findTeamById: vi.fn().mockResolvedValue({
        teamId: 'team-1',
        tenantId: 'tenant-1',
        managerSlackUserId: 'manager-1',
        activeTeamSize: members.length,
        memberUserIds: members,
        reportingCohortId: 'cohort-1',
        reportingSurveyDefinitionId,
        reportingPeriodStart,
        reportingPeriodEnd,
      }),
      findConfirmedGroupStates: vi.fn().mockResolvedValue([
        state('user-1', 'Older summary.', 1, '2026-08-01T10:00:00.000Z'),
        ...members.slice(1).map((userId) => state(userId, `Summary ${userId}.`, 8, '2026-09-01T10:00:00.000Z')),
        state('user-1', 'Latest summary.', 9, '2026-09-02T10:00:00.000Z'),
      ]),
    };
    const ai = {
      generateGroupReport: vi.fn().mockResolvedValue({ explanation: 'Explanation.', actionItems: [] }),
    };
    const useCase = new GroupReportUseCase(surveyRepo as never, ai as never);

    const result = await useCase.execute({
      reportingCohortId: 'cohort-1',
      tenantId: 'tenant-1',
      teamId: 'team-1',
      questionGroup: 'engagement',
    });

    expect(result).toMatchObject({ shouldSend: true, confirmedCount: 5, teamScore: 8.2 });
    expect(result.message).toContain('Q3 2026');
    expect(ai.generateGroupReport).toHaveBeenCalledWith(
      ['Latest summary.', ...members.slice(1).map((userId) => `Summary ${userId}.`)],
      'engagement',
      8.2,
      null,
    );
  });

  it('cancels the sendable candidate when contributors change after AI returns', async () => {
    const members = Array.from({ length: 5 }, (_, index) => `user-${index + 1}`);
    const accepted = {
      status: 'accepted' as const,
      policyVersion: 'deidentification-v1' as const,
      reasons: [],
    };
    const state = (userId: string) => ({
      ...reportScope(members),
      id: `state-${userId}`,
      userId,
      tenantId: 'tenant-1',
      status: 'confirmed',
      questionGroup: 'engagement',
      confirmedAt: new Date('2026-09-01T10:00:00.000Z'),
      employeeScore: 8,
      reportableSummary: `Displayed summary for ${userId}.`,
      deidentificationDecision: accepted,
      withdrawnAt: null,
    });
    const surveyRepo = {
      findTeamById: vi.fn().mockResolvedValue({
        teamId: 'team-1',
        tenantId: 'tenant-1',
        managerSlackUserId: 'manager-1',
        activeTeamSize: members.length,
        memberUserIds: members,
        reportingCohortId: 'cohort-1',
        reportingSurveyDefinitionId,
        reportingPeriodStart,
        reportingPeriodEnd,
      }),
      findConfirmedGroupStates: vi.fn()
        .mockResolvedValueOnce(members.map(state))
        .mockResolvedValueOnce(members.slice(0, 4).map(state)),
    };
    const ai = {
      generateGroupReport: vi.fn().mockResolvedValue({ explanation: 'Explanation.', actionItems: [] }),
    };
    const useCase = new GroupReportUseCase(surveyRepo as never, ai as never);

    await expect(useCase.execute({
      reportingCohortId: 'cohort-1',
      tenantId: 'tenant-1',
      teamId: 'team-1',
      questionGroup: 'engagement',
    })).resolves.toMatchObject({ shouldSend: false, confirmedCount: 4 });
    expect(ai.generateGroupReport).toHaveBeenCalledOnce();
  });

  it('fails closed when the scoped team identity does not match the job', async () => {
    const surveyRepo = {
      findTeamById: vi.fn().mockResolvedValue({
        teamId: 'team-2',
        tenantId: 'tenant-1',
        managerSlackUserId: 'manager-1',
        activeTeamSize: 5,
        memberUserIds: ['user-1', 'user-2', 'user-3', 'user-4', 'user-5'],
        reportingCohortId: 'cohort-1',
        reportingSurveyDefinitionId,
        reportingPeriodStart,
        reportingPeriodEnd,
      }),
      findConfirmedGroupStates: vi.fn(),
    };
    const ai = { generateGroupReport: vi.fn() };
    const useCase = new GroupReportUseCase(surveyRepo as never, ai as never);

    await expect(useCase.execute({
      reportingCohortId: 'cohort-1',
      tenantId: 'tenant-1',
      teamId: 'team-1',
      questionGroup: 'engagement',
    })).resolves.toMatchObject({ shouldSend: false, confirmedCount: 0 });
    expect(surveyRepo.findConfirmedGroupStates).not.toHaveBeenCalled();
    expect(ai.generateGroupReport).not.toHaveBeenCalled();
  });
});
