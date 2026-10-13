import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  surveyCycleScoringPolicies, surveyDefinitions, surveyGroupStates, surveyQuestions,
  surveyScoringPolicies, surveyWindowScoringPolicies, surveyWindows, tenants, users,
} from '../schema';
import { closeTestDb, describeIntegration, getTestDb, runMigrationsOnce } from './integration-setup';

describeIntegration('V2 company-cycle activation (integration)', () => {
  let tenantId: string;

  beforeAll(async () => {
    await runMigrationsOnce();
  });

  afterAll(async () => {
    const { db } = getTestDb();
    if (tenantId) await db.delete(tenants).where(eq(tenants.id, tenantId));
    await closeTestDb();
  });

  it('binds existing and later windows to one complete pre-cycle policy', async () => {
    const { db } = getTestDb();
    const [tenant] = await db.insert(tenants).values({ name: `V2 activation ${randomUUID()}` }).returning();
    tenantId = tenant!.id;
    const people = await db.insert(users).values([{ tenantId }, { tenantId }]).returning();
    const [definition] = await db.insert(surveyDefinitions).values({
      tenantId, name: 'Synthetic V2 definition', version: 'fixture-v2',
    }).returning();
    const questionGroups = {
      q12_expectations: 'autonomy', q12_strengths_opportunity: 'autonomy', q12_opinions_count: 'autonomy',
      wellbeing_at_work: 'belonging', q12_supervisor_cares: 'belonging',
      belonging_psychological_safety: 'belonging',
      role_clarity: 'growth', professional_growth: 'growth', q12_progress_discussion: 'growth',
      q12_recognition: 'purpose', purpose_meaning: 'purpose', purpose_contribution: 'purpose',
    };
    const questions = await db.insert(surveyQuestions).values(Object.entries(questionGroups)
      .map(([stableKey, questionGroup]) => ({
        surveyDefinitionId: definition!.id, stableKey,
        title: stableKey, canonicalMeaning: `Synthetic ${stableKey}`,
        dimension: questionGroup, questionGroup, responseType: 'open_ended', version: 'v2',
      }))).returning();
    const rubric = { version: 'fixture-v1', instructions: 'Synthetic test only.', anchors: [
      { score: 0, description: 'Low' }, { score: 100, description: 'High' },
    ] };
    const completeRubrics = Object.fromEntries(questions.map((question) => [question.stableKey, rubric]));
    const policies = await db.insert(surveyScoringPolicies).values([
      { tenantId, version: 'incomplete', rubrics: {}, approvedAt: new Date() },
      { tenantId, version: 'complete', rubrics: completeRubrics, approvedAt: new Date() },
    ]).returning();
    const periodStart = new Date(Date.now() + 86_400_000);
    const periodEnd = new Date(periodStart.getTime() + 86_400_000);
    const [existingWindow] = await db.insert(surveyWindows).values({
      tenantId, userId: people[0]!.id, surveyDefinitionId: definition!.id,
      periodStart, periodEnd,
    }).returning();
    const scope = {
      tenantId, surveyDefinitionId: definition!.id, periodStart, periodEnd,
    };
    await expect(db.insert(surveyCycleScoringPolicies).values({
      ...scope, scoringPolicyId: policies[0]!.id,
    })).rejects.toThrow('survey_insight_v2_cycle_policy_incomplete');

    await db.update(surveyQuestions).set({ questionGroup: 'growth' })
      .where(eq(surveyQuestions.id, questions.find((question) => question.stableKey === 'q12_expectations')!.id));
    await db.update(surveyQuestions).set({ questionGroup: 'autonomy' })
      .where(eq(surveyQuestions.id, questions.find((question) => question.stableKey === 'role_clarity')!.id));
    await expect(db.insert(surveyCycleScoringPolicies).values({
      ...scope, scoringPolicyId: policies[1]!.id,
    })).rejects.toThrow('survey_insight_v2_cycle_question_map_invalid');
    await db.update(surveyQuestions).set({ questionGroup: 'autonomy' })
      .where(eq(surveyQuestions.id, questions.find((question) => question.stableKey === 'q12_expectations')!.id));
    await db.update(surveyQuestions).set({ questionGroup: 'growth' })
      .where(eq(surveyQuestions.id, questions.find((question) => question.stableKey === 'role_clarity')!.id));

    const [cycle] = await db.insert(surveyCycleScoringPolicies).values({
      ...scope, scoringPolicyId: policies[1]!.id,
    }).returning();
    const canonicalQuestion = questions.find((question) => question.stableKey === 'q12_expectations')!;
    await expect(db.update(surveyQuestions).set({ questionGroup: 'growth' })
      .where(eq(surveyQuestions.id, canonicalQuestion.id)))
      .rejects.toThrow('survey_insight_v2_cycle_question_map_immutable');
    for (const change of [
      { version: 'v3' },
      { canonicalMeaning: 'Changed meaning' },
      { title: 'Changed question' },
      { evidenceRequirements: { changed: true } },
    ]) {
      await expect(db.update(surveyQuestions).set(change)
        .where(eq(surveyQuestions.id, canonicalQuestion.id)))
        .rejects.toThrow('survey_insight_v2_cycle_question_map_immutable');
    }
    await db.update(surveyQuestions).set({ version: canonicalQuestion.version })
      .where(eq(surveyQuestions.id, canonicalQuestion.id));
    await expect(db.delete(surveyQuestions).where(eq(surveyQuestions.id, canonicalQuestion.id)))
      .rejects.toThrow('survey_insight_v2_cycle_question_map_immutable');
    await expect(db.insert(surveyQuestions).values({
      surveyDefinitionId: definition!.id, stableKey: 'unexpected_extra',
      title: 'Unexpected', canonicalMeaning: 'Unexpected', dimension: 'autonomy',
      questionGroup: 'autonomy', responseType: 'open_ended', version: 'v2',
    })).rejects.toThrow('survey_insight_v2_cycle_question_map_immutable');
    const [draftDefinition] = await db.insert(surveyDefinitions).values({
      tenantId, name: 'Unactivated V2 draft', version: 'fixture-v2',
    }).returning();
    const [draftQuestion] = await db.insert(surveyQuestions).values({
      surveyDefinitionId: draftDefinition!.id, stableKey: 'draft_question',
      title: 'Draft', canonicalMeaning: 'Draft meaning', dimension: 'growth',
      questionGroup: 'growth', responseType: 'open_ended', version: 'v2',
    }).returning();
    await db.update(surveyQuestions).set({
      version: 'v3', canonicalMeaning: 'Edited draft meaning', title: 'Edited draft',
    }).where(eq(surveyQuestions.id, draftQuestion!.id));
    const [existingBinding] = await db.select().from(surveyWindowScoringPolicies)
      .where(eq(surveyWindowScoringPolicies.surveyWindowId, existingWindow!.id));
    expect(existingBinding?.scoringPolicyId).toBe(policies[1]!.id);

    const [lateWindow] = await db.insert(surveyWindows).values({
      tenantId, userId: people[1]!.id, surveyDefinitionId: definition!.id,
      periodStart, periodEnd,
    }).returning();
    const [lateBinding] = await db.select().from(surveyWindowScoringPolicies)
      .where(eq(surveyWindowScoringPolicies.surveyWindowId, lateWindow!.id));
    expect(lateBinding?.scoringPolicyId).toBe(policies[1]!.id);
    await expect(db.update(surveyCycleScoringPolicies).set({ scoringPolicyId: policies[0]!.id })
      .where(eq(surveyCycleScoringPolicies.id, cycle!.id)))
      .rejects.toThrow('survey_insight_v2_cycle_immutable');
    await expect(db.delete(surveyCycleScoringPolicies)
      .where(eq(surveyCycleScoringPolicies.id, cycle!.id)))
      .rejects.toThrow('survey_insight_v2_cycle_immutable');
    await expect(db.update(surveyScoringPolicies).set({
      rubrics: { ...completeRubrics, q12_expectations: { ...rubric, instructions: 'Changed after activation.' } },
    }).where(eq(surveyScoringPolicies.id, policies[1]!.id)))
      .rejects.toThrow('survey_insight_v2_immutable_survey_scoring_policies');
    const [unchangedPolicy] = await db.select({ rubrics: surveyScoringPolicies.rubrics })
      .from(surveyScoringPolicies).where(eq(surveyScoringPolicies.id, policies[1]!.id));
    expect(unchangedPolicy?.rubrics).toEqual(completeRubrics);

    const nextStart = new Date(periodEnd.getTime() + 86_400_000);
    const nextEnd = new Date(nextStart.getTime() + 86_400_000);
    const [legacyWindow] = await db.insert(surveyWindows).values({
      tenantId, userId: people[0]!.id, surveyDefinitionId: definition!.id,
      periodStart: nextStart, periodEnd: nextEnd,
    }).returning();
    await db.insert(surveyGroupStates).values({
      tenantId, userId: people[0]!.id, surveyWindowId: legacyWindow!.id,
      questionGroup: 'growth', status: 'in_progress',
    });
    await expect(db.insert(surveyCycleScoringPolicies).values({
      tenantId, surveyDefinitionId: definition!.id,
      periodStart: nextStart, periodEnd: nextEnd, scoringPolicyId: policies[1]!.id,
    })).rejects.toThrow('survey_insight_v2_cycle_legacy_or_conflicting_state');
  });
});
