import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import {
  createDbClient, surveyDefinitions, teamMemberships, teams, tenants, users,
} from '@entalent/database';
import { openSurveyReportingCycle } from './open-survey-reporting-cycle';

async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    console.log('Open survey reporting cycle integration test skipped: DATABASE_URL is absent');
    return;
  }
  const client = createDbClient(databaseUrl);
  let tenantId: string | null = null;
  try {
    const [tenant] = await client.db.insert(tenants).values({
      name: `Cycle open ${randomUUID()}`,
    }).returning();
    tenantId = tenant!.id;
    const [user] = await client.db.insert(users).values({
      tenantId, consentState: { surveyEnabled: true },
    }).returning();
    const [team] = await client.db.insert(teams).values({ tenantId, name: 'Synthetic team' }).returning();
    const periodStart = new Date(Date.now() - 3_600_000);
    const periodEnd = new Date(Date.now() + 86_400_000);
    const openedAt = new Date();
    await client.db.insert(teamMemberships).values({
      userId: user!.id, teamId: team!.id,
      joinedAt: new Date(periodStart.getTime() - 86_400_000),
    });
    const [definition] = await client.db.insert(surveyDefinitions).values({
      tenantId, name: 'Synthetic cycle', version: 'fixture-v1',
    }).returning();
    const config = {
      databaseUrl, tenantId, surveyDefinitionId: definition!.id,
      periodStart, periodEnd, openedAt,
    };
    const first = await openSurveyReportingCycle(config);
    assert.equal(first.length, 1);
    assert.deepEqual(first[0]?.rosterUserIds, [user!.id]);
    assert.equal(first[0]?.periodStart.getTime(), periodStart.getTime());
    const repeated = await openSurveyReportingCycle(config);
    assert.equal(repeated[0]?.id, first[0]?.id);
    console.log('Open survey reporting cycle integration test passed');
  } finally {
    if (tenantId) await client.db.delete(tenants).where(eq(tenants.id, tenantId));
    await client.sql.end({ timeout: 2 });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Survey cycle integration test failed');
  process.exitCode = 1;
});
