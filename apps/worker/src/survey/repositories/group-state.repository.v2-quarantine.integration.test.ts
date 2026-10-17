import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import {
  conversations, messages, surveyDefinitions, surveyGroupStates, surveyReportingCohorts,
  surveyScoringPolicies, surveyWindowScoringPolicies, surveyWindows, teamMemberships,
  teams, tenants, users,
} from '@entalent/database';
import { GroupStateRepository } from './group-state.repository';
import { TeamRepository } from './team.repository';
import { SurveyRepository } from './survey.repository';
import { GroupReportUseCase } from '@entalent/application';
import { GroupReportProcessor } from '../group-report.processor';

const databaseUrl = process.env['DATABASE_URL'];

describe.runIf(Boolean(databaseUrl))('V2 cohort quarantine from V1 group reports', () => {
  const client = databaseUrl ? postgres(databaseUrl, { max: 1 }) : null;
  const db = client ? drizzle(client) : null;
  const repository = db ? new GroupStateRepository({ client: db } as never) : null;
  let tenantId: string | null = null;

  beforeAll(async () => {
    if (!client) return;
    const [row] = await client`select to_regclass('public.survey_window_scoring_policies') as table_name`;
    if (!row?.['table_name']) throw new Error('v2_migrated_schema_required');
  });

  afterAll(async () => {
    if (db && tenantId) await db.delete(tenants).where(eq(tenants.id, tenantId));
    await client?.end();
  });

  it('returns a legacy report input before binding and none after a V2 policy is bound', async () => {
    if (!db || !repository) return;
    const now = Date.now();
    const periodStart = new Date(now - 86_400_000);
    const periodEnd = new Date(now + 86_400_000);
    const shownAt = new Date(now - 7_200_000);
    const confirmedAt = new Date(now - 3_600_000);
    const summary = 'A generalized work experience signal.';
    const accepted = { status: 'accepted', policyVersion: 'deidentification-v1', reasons: [] };
    const [tenant] = await db.insert(tenants).values({ name: `V2 report boundary ${randomUUID()}` }).returning();
    tenantId = tenant!.id;
    const [user] = await db.insert(users).values({ tenantId, consentState: { surveyEnabled: true } }).returning();
    const [team] = await db.insert(teams).values({ tenantId, name: 'Synthetic team' }).returning();
    await db.insert(teamMemberships).values({ teamId: team!.id, userId: user!.id, joinedAt: periodStart });
    const [definition] = await db.insert(surveyDefinitions).values({
      tenantId, name: 'Synthetic definition', version: 'fixture-v1',
    }).returning();
    const [cohort] = await db.insert(surveyReportingCohorts).values({
      tenantId, teamId: team!.id, surveyDefinitionId: definition!.id,
      periodStart, periodEnd, rosterUserIds: [user!.id], openedAt: periodStart,
    }).returning();
    const [window] = await db.insert(surveyWindows).values({
      tenantId, userId: user!.id, surveyDefinitionId: definition!.id,
      reportingCohortId: cohort!.id, reportingTeamId: team!.id,
      reportingRosterUserIds: [user!.id], periodStart, periodEnd,
    }).returning();
    const [conversation] = await db.insert(conversations).values({
      tenantId, userId: user!.id, channelType: 'dev', externalConversationId: randomUUID(),
    }).returning();
    const [prompt, response] = await db.insert(messages).values([
      { tenantId, userId: user!.id, conversationId: conversation!.id,
        direction: 'outbound', senderType: 'agent', text: `${summary} Is that right?`,
        metadata: { confirmationSummary: summary, deidentificationDecision: accepted },
        occurredAt: shownAt, sentAt: shownAt },
      { tenantId, userId: user!.id, conversationId: conversation!.id,
        direction: 'inbound', senderType: 'user', text: 'Yes.', occurredAt: confirmedAt },
    ]).returning();
    const [state] = await db.insert(surveyGroupStates).values({
      surveyWindowId: window!.id, userId: user!.id, tenantId, questionGroup: 'growth',
      status: 'confirmed', aiSummary: summary, employeeScore: '8',
      deidentificationDecision: accepted, confirmedAt,
      reportingDisclosureVersion: 'reporting-disclosure-v1', reportingDisclosureShownAt: shownAt,
      confirmationMessageId: response!.id, confirmationPromptMessageId: prompt!.id,
    }).returning();
    const scope = {
      reportingCohortId: cohort!.id, tenantId, teamId: team!.id,
      rosterUserIds: [user!.id], questionGroup: 'growth',
    };
    expect(await repository.findConfirmedGroupStates(scope)).toHaveLength(1);

    const rosterUserIds = [user!.id];
    for (let index = 0; index < 4; index++) {
      const [member] = await db.insert(users).values({
        tenantId, consentState: { surveyEnabled: true },
      }).returning();
      rosterUserIds.push(member!.id);
      await db.insert(teamMemberships).values({ teamId: team!.id, userId: member!.id, joinedAt: periodStart });
      const [memberWindow] = await db.insert(surveyWindows).values({
        tenantId, userId: member!.id, surveyDefinitionId: definition!.id,
        reportingCohortId: cohort!.id, reportingTeamId: team!.id,
        reportingRosterUserIds: rosterUserIds, periodStart, periodEnd,
      }).returning();
      const [memberConversation] = await db.insert(conversations).values({
        tenantId, userId: member!.id, channelType: 'dev', externalConversationId: randomUUID(),
      }).returning();
      const [memberPrompt, memberResponse] = await db.insert(messages).values([
        { tenantId, userId: member!.id, conversationId: memberConversation!.id,
          direction: 'outbound', senderType: 'agent', text: `${summary} Is that right?`,
          metadata: { confirmationSummary: summary, deidentificationDecision: accepted },
          occurredAt: shownAt, sentAt: shownAt },
        { tenantId, userId: member!.id, conversationId: memberConversation!.id,
          direction: 'inbound', senderType: 'user', text: 'Yes.', occurredAt: confirmedAt },
      ]).returning();
      await db.insert(surveyGroupStates).values({
        surveyWindowId: memberWindow!.id, userId: member!.id, tenantId, questionGroup: 'growth',
        status: 'confirmed', aiSummary: summary, employeeScore: '8',
        deidentificationDecision: accepted, confirmedAt,
        reportingDisclosureVersion: 'reporting-disclosure-v1', reportingDisclosureShownAt: shownAt,
        confirmationMessageId: memberResponse!.id, confirmationPromptMessageId: memberPrompt!.id,
      });
    }
    rosterUserIds.sort();
    await db.update(surveyReportingCohorts).set({ rosterUserIds })
      .where(eq(surveyReportingCohorts.id, cohort!.id));
    await db.update(surveyWindows).set({ reportingRosterUserIds: rosterUserIds })
      .where(eq(surveyWindows.reportingCohortId, cohort!.id));
    const databaseService = { client: db } as never;
    const teamRepository = new TeamRepository(databaseService);
    const surveyRepository = new SurveyRepository(databaseService, repository, teamRepository);
    const generateGroupReport = vi.fn().mockResolvedValue({
      explanation: 'Synthetic explanation.', actionItems: ['One', 'Two', 'Three'],
    });
    const reportUseCase = new GroupReportUseCase(surveyRepository, { generateGroupReport } as never);
    const reportInput = { reportingCohortId: cohort!.id, tenantId, teamId: team!.id,
      questionGroup: 'growth' };
    expect(await reportUseCase.execute(reportInput)).toMatchObject({
      shouldSend: true, confirmedCount: 5,
    });
    expect(generateGroupReport).toHaveBeenCalledOnce();

    const [policy] = await db.insert(surveyScoringPolicies).values({
      tenantId, version: 'synthetic-v2', rubrics: {}, approvedAt: new Date(),
    }).returning();
    await db.insert(surveyWindowScoringPolicies).values({
      surveyWindowId: window!.id, tenantId, scoringPolicyId: policy!.id,
    });
    expect(await repository.findConfirmedGroupStates(scope)).toEqual([]);
    expect(await reportUseCase.execute(reportInput)).toMatchObject({ shouldSend: false });
    const downstream = { findFirstByTenant: vi.fn(), findLatestNonCancelledSnapshot: vi.fn(),
      createPendingSnapshot: vi.fn(), findTeamById: vi.fn() };
    const processor = new GroupReportProcessor(reportUseCase, downstream as never,
      downstream as never, downstream as never);
    await processor.process({ id: 'stale-v1-report', data: { ...reportInput, traceId: 'stale-v1-report' } } as never);
    expect(generateGroupReport).toHaveBeenCalledOnce();
    expect(downstream.findFirstByTenant).not.toHaveBeenCalled();
    expect(downstream.findLatestNonCancelledSnapshot).not.toHaveBeenCalled();
    expect(downstream.createPendingSnapshot).not.toHaveBeenCalled();

    await db.update(surveyGroupStates).set({
      status: 'pending_confirmation', confirmationPromptMessageId: null,
    }).where(eq(surveyGroupStates.id, state!.id));
    expect(await repository.findPendingConfirmationGroups(user!.id, tenantId)).toEqual([]);

    await db.update(surveyGroupStates).set({
      status: 'awaiting_confirmation', confirmationPromptMessageId: prompt!.id,
    }).where(eq(surveyGroupStates.id, state!.id));
    expect(await repository.findAwaitingConfirmationGroups(user!.id, tenantId, conversation!.id)).toEqual([]);

    const [legacyDefinition] = await db.insert(surveyDefinitions).values({
      tenantId, name: 'Other synthetic definition', version: 'fixture-v1',
    }).returning();
    const [legacyCohort] = await db.insert(surveyReportingCohorts).values({
      tenantId, teamId: team!.id, surveyDefinitionId: legacyDefinition!.id,
      periodStart, periodEnd, rosterUserIds: [user!.id], openedAt: periodStart,
    }).returning();
    const [legacyWindow] = await db.insert(surveyWindows).values({
      tenantId, userId: user!.id, surveyDefinitionId: legacyDefinition!.id,
      reportingCohortId: legacyCohort!.id, reportingTeamId: team!.id,
      reportingRosterUserIds: [user!.id], periodStart, periodEnd,
    }).returning();
    const [legacyPending] = await db.insert(surveyGroupStates).values({
      surveyWindowId: legacyWindow!.id, userId: user!.id, tenantId,
      questionGroup: 'purpose', status: 'pending_confirmation',
    }).returning();
    expect((await repository.findPendingConfirmationGroups(user!.id, tenantId)).map((row) => row.id))
      .toEqual([legacyPending!.id]);
  });
});
