import { describe, expect, it, vi } from 'vitest';
import { CloseSurveyReportingCycleUseCase } from './close-survey-reporting-cycle.use-case';

describe('CloseSurveyReportingCycleUseCase', () => {
  it('enqueues one final report job per closed cohort cycle', async () => {
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
    const surveyRepo = {
      findReportingCohortsReadyForFinalReports: vi.fn().mockResolvedValue([cohort]),
      expireTemporaryGroupStatesForClosedCohorts: vi.fn().mockResolvedValue(3),
    };
    const enqueued: unknown[] = [];
    const outbox = {
      enqueueGroupReport: vi.fn(async (payload: unknown) => {
        enqueued.push(payload);
      }),
    };
    const useCase = new CloseSurveyReportingCycleUseCase(surveyRepo as never, outbox as never);

    await expect(useCase.execute({
      tenantId: 'tenant-1',
      surveyDefinitionId: 'definition-1',
      now: new Date('2026-10-01T00:00:00.000Z'),
    })).resolves.toEqual({ cohortCount: 1, queuedReportCount: 1, expiredTemporaryCount: 3 });

    expect(enqueued).toEqual([
      {
        reportingCohortId: 'cohort-1',
        tenantId: 'tenant-1',
        teamId: 'team-1',
        questionGroup: 'cycle',
        questionGroups: ['autonomy', 'growth', 'purpose', 'belonging', 'engagement'],
        reportKind: 'final',
        traceId: 'final-report:cohort-1:cycle:2026-10-01T00:00:00.000Z',
      },
    ]);
    expect(surveyRepo.expireTemporaryGroupStatesForClosedCohorts).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      surveyDefinitionId: 'definition-1',
      now: new Date('2026-10-01T00:00:00.000Z'),
    });
  });

  it('returns the number of unconfirmed temporary states expired at close', async () => {
    const surveyRepo = {
      findReportingCohortsReadyForFinalReports: vi.fn().mockResolvedValue([]),
      expireTemporaryGroupStatesForClosedCohorts: vi.fn().mockResolvedValue(2),
    };
    const outbox = { enqueueGroupReport: vi.fn() };
    const useCase = new CloseSurveyReportingCycleUseCase(surveyRepo as never, outbox as never);

    await expect(useCase.execute({
      tenantId: 'tenant-1',
      now: new Date('2026-10-01T00:00:00.000Z'),
    })).resolves.toEqual({ cohortCount: 0, queuedReportCount: 0, expiredTemporaryCount: 2 });
  });

  it('rejects invalid close inputs before touching the repository', async () => {
    const surveyRepo = {
      findReportingCohortsReadyForFinalReports: vi.fn(),
      expireTemporaryGroupStatesForClosedCohorts: vi.fn(),
    };
    const outbox = { enqueueGroupReport: vi.fn() };
    const useCase = new CloseSurveyReportingCycleUseCase(surveyRepo as never, outbox as never);

    await expect(useCase.execute({
      tenantId: '',
      now: new Date('2026-10-01T00:00:00.000Z'),
    })).rejects.toThrow('survey_reporting_cycle_close_invalid_input');

    expect(surveyRepo.findReportingCohortsReadyForFinalReports).not.toHaveBeenCalled();
    expect(surveyRepo.expireTemporaryGroupStatesForClosedCohorts).not.toHaveBeenCalled();
    expect(outbox.enqueueGroupReport).not.toHaveBeenCalled();
  });
});
