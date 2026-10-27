import { z } from 'zod';
import { SIM_CONVERSATION_ID, SIM_TENANT_ID, SIM_USER_ID } from '../../harness/coach-harness';
import type { SimQuestion } from '../../fakes/question-confirmation';
import { satisfied, type FixtureModule } from './types';

const params = z
  .object({
    surveyWindowId: z.string().min(1),
    /** Questions of the active V2 window; `confirmed` is an applied, agreed verdict. */
    questions: z
      .array(
        z
          .object({
            surveyQuestionId: z.string().min(1),
            questionVersion: z.string().min(1),
            questionGroup: z.string().min(1),
            workingSummary: z.string().min(1),
            status: z.enum(['pending', 'ready', 'confirmed', 'disputed', 'declined']),
          })
          .strict(),
      )
      .min(1),
    /** A bundle already shown and awaiting the employee's verdict. */
    stagedBundle: z
      .object({
        questionGroup: z.string().min(1),
        displayedText: z.string().min(1),
        questionIds: z.array(z.string().min(1)).min(1),
        promptMessageId: z.string().min(1).default('confirmation-state-prompt'),
      })
      .strict()
      .optional(),
    /** A disputed statement waiting for the employee's clarification. */
    pendingClarification: z
      .object({
        surveyQuestionId: z.string().min(1),
        disputedStatement: z.string().min(1),
        workingInsightId: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const byId = new Map(value.questions.map((question) => [question.surveyQuestionId, question]));
    value.stagedBundle?.questionIds.forEach((id, index) => {
      const path = ['stagedBundle', 'questionIds', index];
      const question = byId.get(id);
      if (!question) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path, message: `unknown question ${id}` });
      } else if (question.status !== 'ready' && question.status !== 'pending') {
        // Staging moves its questions to awaiting, which would rewrite a recorded verdict.
        ctx.addIssue({ code: z.ZodIssueCode.custom, path, message: `question ${id} is ${question.status}; staged questions are ready or pending` });
      } else if (question.questionGroup !== value.stagedBundle!.questionGroup) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path, message: `question ${id} is not in group ${value.stagedBundle!.questionGroup}` });
      }
    });
    if (value.pendingClarification) {
      const question = byId.get(value.pendingClarification.surveyQuestionId);
      const path = ['pendingClarification', 'surveyQuestionId'];
      if (!question) ctx.addIssue({ code: z.ZodIssueCode.custom, path, message: 'unknown question' });
      else if (question.status !== 'disputed') {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path, message: `a pending clarification needs a disputed question, ${question.surveyQuestionId} is ${question.status}` });
      }
    }
  });

type ConfirmationStateParams = z.infer<typeof params>;

/**
 * V2 question-confirmation state for later P-09 / P-10 moments (AD-4): the window and its
 * per-question statuses (applied verdicts), an optional staged bundle written through the
 * recorded `questionConfirmationRepo.stageQuestionConfirmationBundle`, and an optional
 * pending clarification. Verified by reading progress, staged count and the clarification back.
 */
export const confirmationStateFixture: FixtureModule<ConfirmationStateParams> = {
  name: 'confirmationState',
  params,
  create(context, value) {
    const byId = new Map(value.questions.map((question) => [question.surveyQuestionId, question]));
    return {
      async apply() {
        const questions: SimQuestion[] = value.questions.map((question) => ({ ...question }));
        context.state.questionConfirmationRepo.seedWindow({
          tenantId: SIM_TENANT_ID,
          userId: SIM_USER_ID,
          surveyWindowId: value.surveyWindowId,
          questions,
        });
        if (value.stagedBundle) {
          const staged = value.stagedBundle;
          await context.ports.questionConfirmationRepo.stageQuestionConfirmationBundle({
            tenantId: SIM_TENANT_ID,
            userId: SIM_USER_ID,
            conversationId: SIM_CONVERSATION_ID,
            surveyWindowId: value.surveyWindowId,
            questionGroup: staged.questionGroup,
            promptMessageId: staged.promptMessageId,
            displayedText: staged.displayedText,
            components: staged.questionIds.map((id) => {
              const question = byId.get(id)!;
              return {
                surveyQuestionId: id,
                questionVersion: question.questionVersion,
                statement: question.workingSummary,
                expectedWorkingSummary: question.workingSummary,
              };
            }),
          });
        }
        if (value.pendingClarification) {
          const pending = value.pendingClarification;
          const question = byId.get(pending.surveyQuestionId)!;
          context.state.questionConfirmationRepo.seedPendingClarification({
            workingInsightId: pending.workingInsightId ?? `working-insight-${pending.surveyQuestionId}`,
            tenantId: SIM_TENANT_ID,
            userId: SIM_USER_ID,
            surveyWindowId: value.surveyWindowId,
            surveyQuestionId: pending.surveyQuestionId,
            questionVersion: question.questionVersion,
            questionGroup: question.questionGroup,
            workingSummary: question.workingSummary,
            disputedStatement: pending.disputedStatement,
            clarificationPromptMessageId: null,
            clarificationPromptSentAt: null,
          });
        }
      },
      async verify() {
        const repo = context.state.questionConfirmationRepo;
        const progress = repo.questionProgress();
        const expectedConfirmed = value.questions.filter((question) => question.status === 'confirmed').length;
        const problems: string[] = [];
        if (progress.total !== value.questions.length || progress.answered !== expectedConfirmed) {
          problems.push(`progress ${progress.answered}/${progress.total}`);
        }
        if (repo.stagedBundleCount() !== (value.stagedBundle ? 1 : 0)) problems.push(`staged ${repo.stagedBundleCount()}`);
        if (Boolean(repo.pendingClarification()) !== Boolean(value.pendingClarification)) problems.push('pending clarification');
        return satisfied('confirmationState', problems.length === 0, problems.length > 0 ? problems.join(', ') : undefined);
      },
    };
  },
};
