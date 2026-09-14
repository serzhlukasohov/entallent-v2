import type {
  OpenSurveyReportingCycleParams,
  SurveyRepositoryPort,
} from '../ports/survey.repository.port';
import type { SurveyReportingCohortRecord } from '../types/records';

export class OpenSurveyReportingCycleUseCase {
  constructor(private readonly surveyRepo: SurveyRepositoryPort) {}

  async execute(input: OpenSurveyReportingCycleParams): Promise<SurveyReportingCohortRecord[]> {
    const [periodStart, periodEnd, openedAt] = [
      input.periodStart.getTime(),
      input.periodEnd.getTime(),
      input.openedAt.getTime(),
    ];
    if (
      !input.tenantId.trim()
      || !input.surveyDefinitionId.trim()
      || ![periodStart, periodEnd, openedAt].every(Number.isFinite)
      || periodStart >= periodEnd
      || openedAt < periodStart
      || openedAt >= periodEnd
    ) {
      throw new Error('survey_reporting_cycle_invalid_bounds');
    }
    return this.surveyRepo.openReportingCycle(input);
  }
}
