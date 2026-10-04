import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import {
  createDbClient, surveyDefinitions, surveyQuestions, surveyWindowScoringPolicies,
  surveyWindows, tenants, users,
} from '@entalent/database';
import { activateV2ScoringPolicy } from './activate-v2-scoring-policy';
import { installV2SurveyDefinition } from './install-v2-survey-definition';

async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const client = createDbClient(databaseUrl);
  let tenantId: string | null = null;
  const rubricsFile = join(tmpdir(), `v2-rubrics-${randomUUID()}.json`);
  try {
    const [tenant] = await client.db.insert(tenants).values({
      name: `V2 activation script ${randomUUID()}`,
    }).returning();
    tenantId = tenant!.id;
    const [user] = await client.db.insert(users).values({ tenantId }).returning();
    const definitionId = await installV2SurveyDefinition(databaseUrl, tenantId);
    assert.equal(await installV2SurveyDefinition(databaseUrl, tenantId), definitionId);
    const [definition] = await client.db.select().from(surveyDefinitions)
      .where(eq(surveyDefinitions.id, definitionId));
    assert.equal(definition?.active, false);
    const questions = await client.db.select().from(surveyQuestions)
      .where(eq(surveyQuestions.surveyDefinitionId, definitionId));
    assert.equal(questions.length, 12);
    const periodStart = new Date(Date.now() + 86_400_000);
    const periodEnd = new Date(periodStart.getTime() + 86_400_000);
    const [window] = await client.db.insert(surveyWindows).values({
      tenantId, userId: user!.id, surveyDefinitionId: definitionId, periodStart, periodEnd,
    }).returning();
    const approved = JSON.parse(await readFile(resolve('scripts/data/v2-scoring-policy-1.0.0.json'), 'utf8'));
    const config = { databaseUrl, tenantId, surveyDefinitionId: definitionId,
      periodStart, periodEnd, approvedAt: new Date('2026-10-01T00:00:00Z'),
      policyVersion: '1.0.0', rubricsFile };
    await writeFile(rubricsFile, JSON.stringify({ ...approved,
      autonomy_control_work: { ...approved.autonomy_control_work, anchors: [
        ...approved.autonomy_control_work.anchors.slice(0, 4),
        { score: 100, description: 'Wrong anchor' },
      ] },
    }));
    await assert.rejects(activateV2ScoringPolicy(config), /approved_question_rubrics_incomplete/);
    await writeFile(rubricsFile, JSON.stringify(approved));
    await client.db.update(surveyDefinitions).set({ tenantId: null })
      .where(eq(surveyDefinitions.id, definitionId));
    try {
      await assert.rejects(activateV2ScoringPolicy(config), /approved_v2_definition_required/);
    } finally {
      await client.db.update(surveyDefinitions).set({ tenantId })
        .where(eq(surveyDefinitions.id, definitionId));
    }
    const prepared = await activateV2ScoringPolicy(config);
    assert.equal(prepared.status, 'prepared');
    assert.equal(prepared.boundWindowCount, 1);
    assert.equal((await activateV2ScoringPolicy(config)).status, 'prepared');
    assert.equal((await client.db.select().from(surveyDefinitions)
      .where(eq(surveyDefinitions.id, definitionId)))[0]?.active, false);
    const [oldDefinition] = await client.db.insert(surveyDefinitions).values({
      tenantId, name: 'Prior active definition', version: 'v1', active: true,
    }).returning({ id: surveyDefinitions.id });
    const realDateNow = Date.now;
    Date.now = () => periodStart.getTime() + 1;
    try {
      await assert.rejects(activateV2ScoringPolicy(config), /v2_active_definition_conflict/);
      await client.db.update(surveyDefinitions).set({ active: false })
        .where(eq(surveyDefinitions.id, oldDefinition!.id));
      assert.equal((await activateV2ScoringPolicy(config)).status, 'activated');
      assert.equal((await activateV2ScoringPolicy(config)).status, 'already_active');
    } finally {
      Date.now = realDateNow;
    }
    assert.equal((await client.db.select().from(surveyDefinitions)
      .where(eq(surveyDefinitions.id, definitionId)))[0]?.active, true);
    const [binding] = await client.db.select().from(surveyWindowScoringPolicies)
      .where(eq(surveyWindowScoringPolicies.surveyWindowId, window!.id));
    assert.equal(binding?.scoringPolicyId, prepared.policyId);
    console.log('V2 approved definition and activation integration test passed');
  } finally {
    if (tenantId) await client.db.delete(tenants).where(eq(tenants.id, tenantId));
    await unlink(rubricsFile).catch(() => undefined);
    await client.sql.end({ timeout: 2 });
  }
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
