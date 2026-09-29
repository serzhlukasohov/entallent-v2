import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import {
  createDbClient, surveyDefinitions, surveyQuestions, surveyWindowScoringPolicies,
  surveyWindows, tenants, users,
} from '@entalent/database';
import { activateV2ScoringPolicy } from './activate-v2-scoring-policy';

async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    console.log('V2 scoring policy activation integration test skipped: DATABASE_URL is absent');
    return;
  }
  const client = createDbClient(databaseUrl);
  let tenantId: string | null = null;
  let rubricsFile: string | null = null;
  try {
    const [tenant] = await client.db.insert(tenants).values({
      name: `V2 activation script ${randomUUID()}`,
    }).returning();
    tenantId = tenant!.id;
    const [user] = await client.db.insert(users).values({ tenantId }).returning();
    const [definition] = await client.db.insert(surveyDefinitions).values({
      tenantId, name: 'Synthetic V2 script fixture', version: 'fixture-v2',
    }).returning();
    const questionGroups = {
      q12_expectations: 'autonomy', q12_strengths_opportunity: 'autonomy', q12_opinions_count: 'autonomy',
      wellbeing_at_work: 'belonging', q12_supervisor_cares: 'belonging',
      belonging_psychological_safety: 'belonging',
      role_clarity: 'growth', professional_growth: 'growth', q12_progress_discussion: 'growth',
      q12_recognition: 'purpose', purpose_meaning: 'purpose', purpose_contribution: 'purpose',
    };
    const questions = await client.db.insert(surveyQuestions).values(Object.entries(questionGroups)
      .map(([stableKey, questionGroup]) => ({
        surveyDefinitionId: definition!.id, stableKey,
        title: stableKey, canonicalMeaning: 'Synthetic meaning',
        dimension: questionGroup, questionGroup, responseType: 'open_ended', version: 'v2',
      }))).returning();
    const rubrics = Object.fromEntries(questions.map((question) => [question.stableKey, {
      version: 'fixture-v1', instructions: 'Synthetic test only.', anchors: [
        { score: 0, description: 'Low' }, { score: 100, description: 'High' },
      ],
    }]));
    rubricsFile = join(tmpdir(), `v2-rubrics-${randomUUID()}.json`);
    await writeFile(rubricsFile, JSON.stringify(rubrics));
    const periodStart = new Date(Date.now() + 86_400_000);
    const periodEnd = new Date(periodStart.getTime() + 86_400_000);
    const [window] = await client.db.insert(surveyWindows).values({
      tenantId, userId: user!.id, surveyDefinitionId: definition!.id, periodStart, periodEnd,
    }).returning();
    const config = {
      databaseUrl, tenantId, surveyDefinitionId: definition!.id,
      periodStart, periodEnd, approvedAt: new Date(),
      policyVersion: 'fixture-v1', rubricsFile,
    };
    await writeFile(rubricsFile, JSON.stringify({ ...rubrics, purpose_meaning: {
      ...rubrics['purpose_meaning'], anchors: [
        { score: 50, description: 'Low' }, { score: 50, description: 'High' },
      ],
    } }));
    await assert.rejects(activateV2ScoringPolicy(config), /approved_question_rubrics_incomplete/);
    await writeFile(rubricsFile, JSON.stringify(rubrics));
    const activated = await activateV2ScoringPolicy(config);
    assert.equal(activated.status, 'activated');
    assert.equal(activated.boundWindowCount, 1);
    assert.match(activated.rubricsSha256, /^[0-9a-f]{64}$/);
    const repeated = await activateV2ScoringPolicy(config);
    assert.equal(repeated.status, 'already_active');
    assert.equal(repeated.policyId, activated.policyId);
    const [binding] = await client.db.select().from(surveyWindowScoringPolicies)
      .where(eq(surveyWindowScoringPolicies.surveyWindowId, window!.id));
    assert.equal(binding?.scoringPolicyId, activated.policyId);
    console.log('V2 scoring policy activation integration test passed');
  } finally {
    if (tenantId) await client.db.delete(tenants).where(eq(tenants.id, tenantId));
    if (rubricsFile) await unlink(rubricsFile);
    await client.sql.end({ timeout: 2 });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'V2 activation integration test failed');
  process.exitCode = 1;
});
