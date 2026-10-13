import type { SurveyRepositoryPort } from '../ports/survey.repository.port';

type CutoffRepository = Pick<SurveyRepositoryPort,
  'findTenantsWithClosedTemporaryQuestionInsights' | 'expireTemporaryQuestionInsightsForClosedWindows' |
  'countOverdueQuestionConfirmationReplies'>;

export interface QuestionCutoffResult {
  tenantsProcessed: number;
  expiredQuestionCount: number;
  overdueReplyCount: number;
}

/** Keep the privacy cutoff independent of final-report generation. */
export class ExpireQuestionInsightsAtCutoffUseCase {
  constructor(private readonly repository: CutoffRepository) {}

  async execute(now: Date): Promise<QuestionCutoffResult> {
    if (!Number.isFinite(now.getTime())) throw new Error('v2_question_cutoff_invalid_time');
    const tenantIds = await this.repository.findTenantsWithClosedTemporaryQuestionInsights(now);
    let expiredQuestionCount = 0;
    for (const tenantId of tenantIds) {
      if (!tenantId.trim()) throw new Error('v2_question_cutoff_invalid_tenant');
      expiredQuestionCount += await this.repository.expireTemporaryQuestionInsightsForClosedWindows({
        tenantId,
        now,
      });
    }
    const overdueReplyCount = await this.repository.countOverdueQuestionConfirmationReplies(now);
    return { tenantsProcessed: tenantIds.length, expiredQuestionCount, overdueReplyCount };
  }
}
