import { eq } from 'drizzle-orm';
import * as schema from '../schema';
import type { rpt05FixtureSuite } from './pulse-report-inputs.fixture';
import { QuestionInsightRepository } from '../../../../apps/worker/src/survey/repositories/question-insight.repository';
/** Native RPT01 confirmations/finalization with synthetic scorer and deidentifier; no model/network. */
export async function stageLanguageTopics(
  s: ReturnType<typeof rpt05FixtureSuite>,
  f: Awaited<ReturnType<ReturnType<typeof rpt05FixtureSuite>['fixture']>>,
  userId: string,
) {
  const repo = new QuestionInsightRepository(s.database, {
    findCurrentHierarchyIdentifiers: async () => [],
  } as never);
  const source = await s.inbound(
    f,
    userId,
    'Synthetic employee statement about decision ownership.',
  );
  await s.capture.capture(source);
  const questions = f.questions.filter((q) => q.questionGroup === 'autonomy');
  const windowId = f.windows.get(userId)!;
  for (const q of questions)
    await repo.captureMeaning({
      ...source,
      surveyWindowId: windowId,
      surveyQuestionId: q.id,
      questionVersion: q.version,
      sourceMessageId: source.inboundMessageId,
      meaning: 'Synthetic autonomy meaning ' + q.stableKey,
      sufficientMeaning: true,
      driverCaptured: true,
      driverDeclined: false,
    });
  await s.commit(source);
  const components = questions.map((q) => ({
    surveyQuestionId: q.id,
    questionVersion: q.version,
    statement: 'Synthetic statement ' + q.stableKey,
    expectedWorkingSummary: 'Synthetic autonomy meaning ' + q.stableKey,
  }));
  const text = components.map((c) => c.statement).join('\n');
  const [prompt] = await s.db
    .insert(schema.messages)
    .values({
      tenantId: f.tenantId,
      userId,
      conversationId: source.conversationId,
      direction: 'outbound',
      senderType: 'agent',
      text,
      occurredAt: new Date(),
    })
    .returning();
  const bundleId = await repo.stageQuestionConfirmationBundle({
    ...source,
    surveyWindowId: windowId,
    questionGroup: 'autonomy',
    promptMessageId: prompt.id,
    displayedText: text,
    components,
  });
  if (typeof bundleId !== 'string') throw Error('stage failed');
  await s.db
    .update(schema.messages)
    .set({ sentAt: new Date() })
    .where(eq(schema.messages.id, prompt.id));
  const confirmation = await s.inbound(f, userId, 'agree');
  await s.capture.capture(confirmation);
  const token = await s.conversation.claimNativeInput({
    ...confirmation,
    messageId: confirmation.inboundMessageId,
  });
  await repo.applyQuestionBundleVerdict({
    ...confirmation,
    nativeReportClaimToken: token!,
    bundleId,
    verdict: { kind: 'agree' },
  });
  await s.commit(confirmation, { token: token! });
  return { repo, source, questions, windowId };
}
