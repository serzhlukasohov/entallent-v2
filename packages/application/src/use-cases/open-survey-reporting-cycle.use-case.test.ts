import { describe, expect, it, vi } from 'vitest';
import { OpenSurveyReportingCycleUseCase } from './open-survey-reporting-cycle.use-case';

describe('OpenSurveyReportingCycleUseCase', () => {
  it('freezes the cycle through the typed repository boundary', async () => {
    const cohort = {
      id: 'cohort-1',
      tenantId: 'tenant-1',
      teamId: 'team-1',
      surveyDefinitionId: 'definition-1',
      periodStart: new Date('2026-07-01T00:00:00.000Z'),
      periodEnd: new Date('2026-10-01T00:00:00.000Z'),
      rosterUserIds: ['user-1', 'user-2', 'user-3', 'user-4', 'user-5'],
      openedAt: new Date('2026-07-01T00:00:00.000Z'),
    };
    const surveyRepo = { openReportingCycle: vi.fn().mockResolvedValue([cohort]) };
    const useCase = new OpenSurveyReportingCycleUseCase(surveyRepo as never);

    await expect(useCase.execute({
      tenantId: cohort.tenantId,
      surveyDefinitionId: cohort.surveyDefinitionId,
      periodStart: cohort.periodStart,
      periodEnd: cohort.periodEnd,
      openedAt: cohort.openedAt,
    })).resolves.toEqual([cohort]);

    expect(surveyRepo.openReportingCycle).toHaveBeenCalledOnce();
  });

  it('rejects a cycle whose opening instant is outside its half-open period', async () => {
    const surveyRepo = { openReportingCycle: vi.fn() };
    const useCase = new OpenSurveyReportingCycleUseCase(surveyRepo as never);

    await expect(useCase.execute({
      tenantId: 'tenant-1',
      surveyDefinitionId: 'definition-1',
      periodStart: new Date('2026-07-01T00:00:00.000Z'),
      periodEnd: new Date('2026-10-01T00:00:00.000Z'),
      openedAt: new Date('2026-10-01T00:00:00.000Z'),
    })).rejects.toThrow('survey_reporting_cycle_invalid_bounds');

    expect(surveyRepo.openReportingCycle).not.toHaveBeenCalled();
  });
});
