import { predictCycleProgress, type SurveyQuestionRecord, type SurveyWindowRecord } from '@entalent/application';
import { z } from 'zod';
import { SIM_TENANT_ID, SIM_USER_ID } from '../../harness/coach-harness';
import type { SimQuestion } from '../../fakes/question-confirmation';
import type { LoadedTest } from '../schema';
import { satisfied, type FixtureModule } from './types';

const DAY_MS = 86_400_000;
const CLOSED = new Set(['confirmed', 'declined']);

const params = z
  .object({
    surveyWindowId: z.string().min(1),
    /** Questions of the active V2 window; `confirmed` and `declined` are closed. */
    questions: z
      .array(
        z
          .object({
            surveyQuestionId: z.string().min(1),
            questionVersion: z.string().min(1),
            questionGroup: z.string().min(1),
            workingSummary: z.string().min(1),
            title: z.string().min(1),
            status: z.enum(['pending', 'ready', 'confirmed', 'disputed', 'declined']),
          })
          .strict(),
      )
      .min(1),
    /** Topics still open in the cycle, with the canonical questions the judge may consult (P-07). */
    uncoveredTopics: z
      .array(z.object({ topic: z.string().min(1), canonicalQuestions: z.array(z.string().min(1)).min(1) }).strict())
      .min(1),
  })
  .strict()
  .superRefine((value, ctx) => {
    value.uncoveredTopics.forEach((uncovered, index) => {
      const open = value.questions.some((question) => question.questionGroup === uncovered.topic && !CLOSED.has(question.status));
      if (!open) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['uncoveredTopics', index, 'topic'],
          message: `topic ${uncovered.topic} has no question that is not confirmed or declined`,
        });
      }
    });
  });

export type PulseCycleParams = z.infer<typeof params>;

/**
 * An open pulse cycle (AD-4, L1 only): the V2 question-confirmation window with per-question
 * statuses, plus the survey repository's active window and questions, so the real survey
 * evidence extraction and the topic backlog see the same cycle. Verified by reading the
 * cycle progress back and predicting its open topics: every declared uncovered topic must be
 * open. It refuses (apply throws) when a V2 window is already seeded or `confirmationState`
 * is also in the test's setup, and when the level has no survey repository.
 */
export const pulseCycleFixture: FixtureModule<PulseCycleParams> = {
  name: 'pulseCycle',
  params,
  create(context, value) {
    const scope = { tenantId: SIM_TENANT_ID, userId: SIM_USER_ID };
    return {
      async apply() {
        const survey = context.survey;
        if (!survey) throw new Error('pulseCycle needs a survey repository, which this level does not provide');
        if (context.test.setup.some((ref) => ref.name === 'confirmationState')) {
          throw new Error('pulseCycle and confirmationState both seed the V2 window; use one of them');
        }
        if ((await context.state.questionConfirmationRepo.findCycleProgress(scope)) !== null) {
          throw new Error('a V2 question-confirmation window is already seeded');
        }

        const questions: SimQuestion[] = value.questions.map(({ title: _title, ...question }) => ({ ...question }));
        context.state.questionConfirmationRepo.seedWindow({ ...scope, surveyWindowId: value.surveyWindowId, questions });
        survey.state.seedWindow({
          window: surveyWindow(value.surveyWindowId, context.start),
          questions: value.questions.map((question, index) => surveyQuestion(question, index, value)),
          uncoveredTopics: value.uncoveredTopics.map((uncovered) => uncovered.topic),
          closedQuestionIds: value.questions.filter((question) => CLOSED.has(question.status)).map((question) => question.surveyQuestionId),
        });
      },
      async verify() {
        const snapshot = await context.state.questionConfirmationRepo.findCycleProgress(scope);
        const open = predictCycleProgress(snapshot).openTopics;
        const missing = value.uncoveredTopics.map((uncovered) => uncovered.topic).filter((topic) => !open.includes(topic));
        const ok = open.length > 0 && missing.length === 0;
        return satisfied(
          'pulseCycle',
          ok,
          ok ? `open topics: ${open.join(', ')}` : `open topics: ${open.join(', ') || 'none'}; not open: ${missing.join(', ')}`,
        );
      },
    };
  },
};

/**
 * The group `questionProgress` reads at L1 (AD-10): the first uncovered topic of the test's
 * `pulseCycle` fixture, or null when the test applies none (or its params are invalid).
 */
export function pulseCycleGroupOf(test: Pick<LoadedTest, 'setup'>): string | null {
  const ref = test.setup.find((fixture) => fixture.name === 'pulseCycle');
  if (!ref) return null;
  const parsed = params.safeParse(ref.params ?? {});
  return parsed.success ? parsed.data.uncoveredTopics[0]!.topic : null;
}

function surveyWindow(id: string, start: Date): SurveyWindowRecord {
  // A quarter around the run start, ending well after the engagement unlock window.
  return {
    id,
    tenantId: SIM_TENANT_ID,
    userId: SIM_USER_ID,
    surveyDefinitionId: 'sim-definition',
    periodType: 'quarter',
    periodStart: new Date(start.getTime() - 30 * DAY_MS),
    periodEnd: new Date(start.getTime() + 60 * DAY_MS),
    status: 'active',
  };
}

function surveyQuestion(question: PulseCycleParams['questions'][number], index: number, value: PulseCycleParams): SurveyQuestionRecord {
  const topic = value.uncoveredTopics.find((uncovered) => uncovered.topic === question.questionGroup);
  return {
    id: question.surveyQuestionId,
    surveyDefinitionId: 'sim-definition',
    stableKey: question.surveyQuestionId,
    title: question.title,
    canonicalMeaning: question.title,
    dimension: question.questionGroup,
    positiveIndicators: [],
    negativeIndicators: [],
    probeStrategies: topic ? [...topic.canonicalQuestions] : [],
    contraindications: [],
    confidenceThreshold: 0.72,
    completenessThreshold: 0.65,
    minimumEvidenceCount: 1,
    cooldownDays: 14,
    maxFollowUpProbes: 3,
    displayOrder: index + 1,
    version: question.questionVersion,
    questionGroup: question.questionGroup,
    responseType: 'open_ended',
  };
}
