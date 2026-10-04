import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import {
  surveyDefinitions, surveyReportingCohorts, surveyV2ReportSnapshots,
  teams, tenants, workspaceConnections,
} from '@entalent/database';
import { V2ReportSnapshotRepository } from './v2-report-snapshot.repository';

const databaseUrl = process.env['DATABASE_URL'];
describe.runIf(Boolean(databaseUrl))('V2 report snapshots on migrated PostgreSQL', () => {
  const sql = databaseUrl ? postgres(databaseUrl, { max: 1 }) : null;
  const db = sql ? drizzle(sql) : null;
  const repo = db ? new V2ReportSnapshotRepository({ client: db } as never) : null;
  let tenantId: string | null = null;

  afterAll(async () => {
    if (db && tenantId) await db.delete(tenants).where(eq(tenants.id, tenantId));
    await sql?.end();
  });

  it('persists one first snapshot and blocks duplicate or ambiguous delivery', async () => {
    if (!db || !repo) return;
    const [tenant] = await db.insert(tenants).values({ name: `V2 report ${randomUUID()}` }).returning();
    tenantId = tenant!.id;
    const [team] = await db.insert(teams).values({ tenantId, name: 'Synthetic team' }).returning();
    const [definition] = await db.insert(surveyDefinitions).values({
      tenantId, name: 'Synthetic V2', version: 'v2-policy-1.0.0',
    }).returning();
    const [cohort] = await db.insert(surveyReportingCohorts).values({
      tenantId, teamId: team!.id, surveyDefinitionId: definition!.id,
      periodStart: new Date('2026-10-01T00:00:00Z'),
      periodEnd: new Date('2026-11-01T00:00:00Z'),
      rosterUserIds: Array.from({ length: 5 }, () => randomUUID()),
      openedAt: new Date('2026-10-01T00:00:00Z'),
    }).returning();
    const [workspace] = await db.insert(workspaceConnections).values({
      tenantId, channelType: 'slack', externalWorkspaceId: randomUUID(),
      encryptedCredentials: 'synthetic',
    }).returning();
    const contributorUserIds = Array.from({ length: 5 }, () => randomUUID());
    const sourceQuestionInsightIds = Array.from({ length: 15 }, () => randomUUID());
    const input = {
      tenantId, reportingCohortId: cohort!.id, teamId: team!.id,
      questionGroup: 'autonomy', reportKind: 'intermediate' as const,
      snapshotVersion: 1, managerPayload: {
        message: 'Safe team aggregate',
        sourceQuestionInsightIdsByGroupAndUser: { autonomy: Object.fromEntries(
          contributorUserIds.map((userId, index) => [userId, sourceQuestionInsightIds.slice(index * 3, index * 3 + 3)]),
        ) },
        preSendRecoveryVersion: 1 as const,
      },
      contributorUserIds,
      sourceQuestionInsightIds,
      policyVersion: 'fixture-v1', calculationVersion: 'equal-weight-1.0.0',
      workspaceConnectionId: workspace!.id, managerSlackChannelId: 'D-manager',
    };
    const id = await repo.createPending(input);
    expect(id).toBeTruthy();
    expect(await repo.createPending(input)).toBeNull();
    const unattempted = { ...input, questionGroup: 'growth' };
    const unattemptedId = await repo.createPending(unattempted);
    expect(unattemptedId).toBeTruthy();
    expect(await repo.cancelStaleUnattempted(unattempted, new Date(Date.now() + 60_000))).toBe(true);
    expect(await repo.findLatest(unattempted)).toBeNull();
    await repo.markAttemptStarted(id!, new Date());
    expect(await repo.cancelStaleUnattempted(input, new Date(Date.now() + 60_000))).toBe(false);
    await repo.markDeliveryUnknown(id!, new Date());
    expect((await repo.findLatest(input))?.status).toBe('delivery_unknown');
    await expect(repo.markDelivered(id!, '123.456', new Date()))
      .rejects.toThrow('v2_report_snapshot_transition_failed');
    const [stored] = await db.select().from(surveyV2ReportSnapshots)
      .where(eq(surveyV2ReportSnapshots.id, id!));
    expect(stored?.slackExternalMessageId).toBeNull();
  });
});
