import type { QuestionFinalizationRepositoryPort, FinalizeQuestionInsightUseCase } from './finalize-question-insight.use-case';

export interface QuestionRecoveryResult {
  usersScanned: number;
  finalizedQuestionCount: number;
  failedUserCount: number;
}

/** Retry confirmed questions even when no further employee message arrives. */
export class RecoverConfirmedQuestionInsightsUseCase {
  constructor(
    private readonly repository: Pick<QuestionFinalizationRepositoryPort, 'listPendingConfirmedUsers'>,
    private readonly finalizer: Pick<FinalizeQuestionInsightUseCase, 'executePending'>,
  ) {}

  async execute(): Promise<QuestionRecoveryResult> {
    const users = await this.repository.listPendingConfirmedUsers();
    let finalizedQuestionCount = 0;
    let failedUserCount = 0;
    for (const user of users) {
      if (!user.tenantId.trim() || !user.userId.trim()) {
        failedUserCount += 1;
        continue;
      }
      try {
        finalizedQuestionCount += await this.finalizer.executePending(user);
      } catch {
        failedUserCount += 1;
      }
    }
    return { usersScanned: users.length, finalizedQuestionCount, failedUserCount };
  }
}
