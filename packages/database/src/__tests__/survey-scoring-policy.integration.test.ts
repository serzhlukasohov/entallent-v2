import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  surveyDefinitions, surveyScoringPolicies, surveyWindowScoringPolicies,
  surveyWindows, tenants, users,
} from '../schema';
import { closeTestDb, describeIntegration, getTestDb, runMigrationsOnce } from './integration-setup';

describeIntegration('V2 company-cycle scoring policy (integration)', () => {
  let tenantId: string;

  beforeAll(async () => {
    await runMigrationsOnce();
  });

  afterAll(async () => {
    const { db } = getTestDb();
    if (tenantId) await db.delete(tenants).where(eq(tenants.id, tenantId));
    await closeTestDb();
  });

  it('requires one immutable policy across employee windows in a company cycle', async () => {
    const { db } = getTestDb();
    const [tenant] = await db.insert(tenants).values({ name: `Scoring policy ${randomUUID()}` }).returning();
    tenantId = tenant!.id;
    const people = await db.insert(users).values(Array.from({ length: 3 }, () => ({ tenantId }))).returning();
    const [definition] = await db.insert(surveyDefinitions).values({
      tenantId, name: 'Synthetic V2', version: 'fixture-v2',
    }).returning();
    const policies = await db.insert(surveyScoringPolicies).values([
      { tenantId, version: 'fixture-a', rubrics: {}, approvedAt: new Date() },
      { tenantId, version: 'fixture-b', rubrics: {}, approvedAt: new Date() },
    ]).returning();
    const periodStart = new Date('2026-07-01T00:00:00Z');
    const periodEnd = new Date('2026-10-01T00:00:00Z');
    const windows = await db.insert(surveyWindows).values(people.map((person, index) => ({
      tenantId, userId: person.id, surveyDefinitionId: definition!.id,
      periodStart: index === 2 ? periodEnd : periodStart,
      periodEnd: index === 2 ? new Date('2027-01-01T00:00:00Z') : periodEnd,
    }))).returning();

    await db.insert(surveyWindowScoringPolicies).values({
      tenantId, surveyWindowId: windows[0]!.id, scoringPolicyId: policies[0]!.id,
    });
    await expect(db.insert(surveyWindowScoringPolicies).values({
      tenantId, surveyWindowId: windows[1]!.id, scoringPolicyId: policies[1]!.id,
    })).rejects.toThrow('survey_insight_v2_company_cycle_policy_mismatch');
    await db.insert(surveyWindowScoringPolicies).values({
      tenantId, surveyWindowId: windows[1]!.id, scoringPolicyId: policies[0]!.id,
    });
    await expect(db.update(surveyWindowScoringPolicies)
      .set({ scoringPolicyId: policies[1]!.id })
      .where(eq(surveyWindowScoringPolicies.surveyWindowId, windows[1]!.id)))
      .rejects.toThrow('survey_insight_v2_immutable_survey_window_scoring_policies');
    await expect(db.delete(surveyWindowScoringPolicies)
      .where(eq(surveyWindowScoringPolicies.surveyWindowId, windows[1]!.id)))
      .rejects.toThrow('survey_insight_v2_binding_immutable');

    await expect(db.insert(surveyWindowScoringPolicies).values({
      tenantId, surveyWindowId: windows[2]!.id, scoringPolicyId: policies[1]!.id,
    })).resolves.toBeDefined();

    const concurrentPeople = await db.insert(users).values([{ tenantId }, { tenantId }]).returning();
    const concurrentWindows = await db.insert(surveyWindows).values(concurrentPeople.map((person) => ({
      tenantId, userId: person.id, surveyDefinitionId: definition!.id,
      periodStart: new Date('2027-01-01T00:00:00Z'),
      periodEnd: new Date('2027-04-01T00:00:00Z'),
    }))).returning();
    const competing = await Promise.allSettled(concurrentWindows.map((window, index) =>
      db.insert(surveyWindowScoringPolicies).values({
        tenantId, surveyWindowId: window.id, scoringPolicyId: policies[index]!.id,
      })));
    expect(competing.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(competing.filter((result) => result.status === 'rejected')).toHaveLength(1);
  });
});
