import type { AiProviderPort } from '../ports/ai-provider.port';
import type { SurveyRepositoryPort } from '../ports/survey.repository.port';
import type { OutboxPort } from '../ports/outbox.port';

export interface GroupConfirmationInput {
  surveyWindowId: string;
  userId: string;
  tenantId: string;
  questionGroup: string;
  externalWorkspaceId: string;
  externalConversationId: string;
  channelType: string;
}

export class GroupConfirmationUseCase {
  constructor(
    private readonly surveyRepo: SurveyRepositoryPort,
    private readonly ai: AiProviderPort,
    private readonly outbox: OutboxPort,
  ) {}

  async execute(input: GroupConfirmationInput): Promise<void> {
    const questions = await this.surveyRepo.findQuestionsForWindow(input.surveyWindowId);
    const groupQuestions = questions.filter((q) => q.questionGroup === input.questionGroup);

    const evidenceSummaries: Array<{
      questionId: string;
      stableKey: string;
      evidenceSummary: string;
      polarity: string;
    }> = [];

    for (const q of groupQuestions) {
      const evidence = await this.surveyRepo.findEvidenceForQuestion(
        input.userId,
        q.id,
        input.surveyWindowId,
      );
      const latest = evidence.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
      if (latest) {
        evidenceSummaries.push({
          questionId: q.id,
          stableKey: q.stableKey,
          evidenceSummary: latest.evidenceSummary,
          polarity: latest.polarity,
        });
      }
    }

    if (evidenceSummaries.length === 0) return;

    const groupSummary = await this.ai.generateGroupSummary(evidenceSummaries, input.questionGroup);

    await this.surveyRepo.upsertGroupState({
      surveyWindowId: input.surveyWindowId,
      userId: input.userId,
      tenantId: input.tenantId,
      questionGroup: input.questionGroup,
      status: 'pending_confirmation',
      aiSummary: groupSummary.summary,
    });

    // Send confirmation message to employee via outbox
    // Note: MessageSendPayload requires a saved messageId — use a sentinel approach.
    // The outbox enqueueGroupConfirmation will handle direct Slack send without creating a DB message.
    await this.outbox.enqueueGroupConfirmation({
      surveyWindowId: input.surveyWindowId,
      userId: input.userId,
      tenantId: input.tenantId,
      questionGroup: input.questionGroup,
      traceId: `group-confirm-${input.surveyWindowId}-${input.questionGroup}`,
    });
  }
}
