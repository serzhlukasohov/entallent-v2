import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { eq, inArray, sql } from 'drizzle-orm';
import { createDbClient } from '../client';
import * as schema from '../schema';
import { installV2SurveyDefinition } from '../../../../scripts/install-v2-survey-definition';
import { prepareReportEngagementDefinition } from '../../../../scripts/prepare-report-engagement-definition';
import { PulseReportScopeRepository } from '../../../../apps/worker/src/survey/repositories/pulse-report-scope.repository';
import { SurveyRepository } from '../../../../apps/worker/src/survey/repositories/survey.repository';
import { EngagementAnswerRepository } from '../../../../apps/worker/src/survey/repositories/engagement-answer.repository';
import { ConversationRepository } from '../../../../apps/worker/src/conversation/repositories/conversation.repository';
import { PulseReportFinalScheduleRepository } from '../../../../apps/worker/src/survey/repositories/pulse-report-final-schedule.repository';
import { PulseReportInputRepository } from '../../../../apps/worker/src/survey/repositories/pulse-report-input.repository';
import { PulseReportSettlementRepository } from '../../../../apps/worker/src/survey/repositories/pulse-report-settlement.repository';
import { PreparePulseReportInputsUseCase } from '../../../application/src/use-cases/prepare-pulse-report-inputs.use-case';
import { ReportConfigurationService } from '../../../../apps/api/src/report-configuration/report-configuration.service';
import { ENGAGEMENT_ANSWER_CONTRACT } from '../../../contracts/src/pulse-engagement';
type FixtureDb = ReturnType<typeof createDbClient>['db'];
type FixtureRaw = ReturnType<typeof createDbClient>['sql'];
/**
 * Load budget for short real-clock cycles: the whole window must contain every fixture setup
 * write (window binding, topic staging, numeric answers) even on a loaded host (2.5x the old 4 s).
 * Upper bound: the RPT07 "R3 selected prior" test keeps a fixed 0.0002-day (17.28 s) retention
 * oracle that must still cover this window plus successor setup, so do not grow it past ~10 s.
 * Real activation/admission/first-start guards stay enabled; only the budget is sized.
 */
export const SHORT_WINDOW_DAYS = 10 / 86400;
const cycleMs = (days: number) => Math.trunc(days * 86_400_000);
async function readCycle(db: FixtureDb, id: string) {
  const [cycle] = await db
    .select()
    .from(schema.surveyCycleScoringPolicies)
    .where(eq(schema.surveyCycleScoringPolicies.id, id));
  if (!cycle) throw Error('fixture_cycle_missing');
  return cycle;
}
/** Anchors period_start to the DB clock inside the insert statement, so the activation trigger's statement_timestamp() check never races JS time. */
export async function reserveFixtureCycle(
  db: FixtureDb,
  raw: FixtureRaw,
  input: { tenantId: string; definitionId: string; policyId: string } & (
    | { durationDays: number }
    | { periodEnd: Date }
  ),
) {
  const durationMs = 'durationDays' in input ? cycleMs(input.durationDays) : 0,
    periodEnd = 'periodEnd' in input ? input.periodEnd.toISOString() : null;
  const [row] =
    await raw`with anchor as (select date_trunc('milliseconds',clock_timestamp()+interval '150 milliseconds') period_start) insert into survey_cycle_scoring_policies(tenant_id,survey_definition_id,period_start,period_end,scoring_policy_id) select ${input.tenantId}::uuid,${input.definitionId}::uuid,period_start,coalesce(${periodEnd}::timestamptz,period_start+${durationMs}::bigint*interval '1 millisecond'),${input.policyId}::uuid from anchor returning id`;
  return readCycle(db, String(row.id));
}
/** Reservation only (no opening): successor starts exactly at the previous period_end. */
export async function reserveSuccessorCycle(
  db: FixtureDb,
  raw: FixtureRaw,
  previousCycleId: string,
  days: number,
) {
  const [row] =
    await raw`insert into survey_cycle_scoring_policies(tenant_id,survey_definition_id,period_start,period_end,scoring_policy_id) select tenant_id,survey_definition_id,period_end,period_end+${cycleMs(days)}::bigint*interval '1 millisecond',scoring_policy_id from survey_cycle_scoring_policies where id=${previousCycleId}::uuid returning id`;
  return readCycle(db, String(row.id));
}
/** Waits on the DB clock (the clock the guards use), not JS Date.now(). */
export async function waitForDbTime(raw: FixtureRaw, at: Date) {
  const iso = at.toISOString();
  for (;;) {
    const [r] =
      await raw`select clock_timestamp()>=${iso}::timestamptz reached,greatest(0,extract(epoch from(${iso}::timestamptz-clock_timestamp()))*1000)::float8 ms`;
    if (r.reached) return;
    await new Promise((resolve) => setTimeout(resolve, Math.min(250, Number(r.ms) + 1)));
  }
}
export function rpt05FixtureSuite() {
  const url = process.env.DATABASE_URL!,
    client = createDbClient(url),
    db = client.db,
    raw = client.sql,
    context = new AsyncLocalStorage<typeof db>(),
    database = {
      get client() {
        return context.getStore() ?? db;
      },
      withTransaction: async <T>(run: () => Promise<T>) =>
        db.transaction((tx) => context.run(tx as unknown as typeof db, run)),
    } as never,
    created: string[] = [];
  const scopes = new PulseReportScopeRepository(database),
    survey = new SurveyRepository(
      database,
      {} as never,
      { findTeamByMemberId: async () => null } as never,
    ),
    capture = new EngagementAnswerRepository(database),
    conversation = new ConversationRepository(database),
    timing = new PulseReportFinalScheduleRepository(database),
    settlement = new PulseReportSettlementRepository(database),
    inputs = new PreparePulseReportInputsUseCase(new PulseReportInputRepository(database));
  async function fixture(
    count = 6,
    durationDays = 1,
    teamCount = 1,
    createWindows = true,
    successorDays: number[] = [],
  ) {
    const [tenant] = await db
      .insert(schema.tenants)
      .values({ name: 'RPT05 ' + randomUUID(), timezone: 'UTC', locale: 'en' })
      .returning();
    created.push(tenant.id);
    const tenantId = tenant.id;
    await new ReportConfigurationService(database).saveCalendar(
      tenantId,
      { timezone: 'UTC', workingDays: [1, 2, 3, 4, 5, 6, 7], workStart: '00:00', workEnd: '23:59' },
      'fixture',
      0,
    );
    const source = await installV2SurveyDefinition(url, tenantId),
      definitionId = await prepareReportEngagementDefinition(url, tenantId, source);
    await db
      .update(schema.surveyDefinitions)
      .set({ active: true })
      .where(eq(schema.surveyDefinitions.id, definitionId));
    const person = async (role: 'employee' | 'team_lead' | 'manager') => {
      const [u] = await db
        .insert(schema.users)
        .values({ tenantId, consentState: { surveyEnabled: true } })
        .returning();
      await db.insert(schema.people).values({
        id: u.id,
        tenantId,
        customerEmployeeId: u.id,
        workEmail: u.id + '@fixture.invalid',
        displayName: role,
        primaryRole: role,
        pulseParticipant: role !== 'manager',
        lifecycleStatus: 'active',
      });
      return u.id;
    };
    const manager = await person('manager'),
      lead = await person('team_lead');
    const [unit] = await db
      .insert(schema.orgUnits)
      .values({
        tenantId,
        customerUnitKey: 'unit',
        name: 'Unit',
        managerPersonId: manager,
        lifecycleStatus: 'active',
      })
      .returning();
    const [team] = await db
      .insert(schema.orgTeams)
      .values({
        tenantId,
        unitId: unit.id,
        customerTeamKey: 'team',
        name: 'Team',
        teamLeadPersonId: lead,
        lifecycleStatus: 'active',
      })
      .returning();
    const teamList = [team],
      leadList = [lead];
    for (let i = 1; i < teamCount; i++) {
      const nextLead = await person('team_lead');
      leadList.push(nextLead);
      const [nextTeam] = await db
        .insert(schema.orgTeams)
        .values({
          tenantId,
          unitId: unit.id,
          customerTeamKey: 'team-' + i,
          name: 'Team ' + i,
          teamLeadPersonId: nextLead,
          lifecycleStatus: 'active',
        })
        .returning();
      teamList.push(nextTeam);
    }
    const users: string[] = [];
    for (let i = 0; i < count; i++) {
      const u = await person('employee');
      users.push(u);
      await db.insert(schema.orgEmployeePlacements).values({
        tenantId,
        employeePersonId: u,
        unitId: unit.id,
        teamId: teamList[Math.floor((i * teamCount) / count)].id,
        lifecycleStatus: 'active',
      });
    }
    const questions = await db
      .select()
      .from(schema.surveyQuestions)
      .where(eq(schema.surveyQuestions.surveyDefinitionId, definitionId));
    const [policy] = await db
      .insert(schema.surveyScoringPolicies)
      .values({
        tenantId,
        version: '1.0.0',
        approvedAt: new Date(),
        rubrics: JSON.parse(
          readFileSync(
            resolve(__dirname, '../../../../scripts/data/v2-scoring-policy-1.0.0.json'),
            'utf8',
          ),
        ),
      })
      .returning();
    const cycle = await reserveFixtureCycle(db, raw, {
      tenantId,
      definitionId,
      policyId: policy.id,
      durationDays,
    });
    // Successors are reserved up front so a late reservation can never land after its start.
    let previousCycleId = cycle.id;
    for (const days of successorDays)
      previousCycleId = (await reserveSuccessorCycle(db, raw, previousCycleId, days)).id;
    const { periodStart, periodEnd } = cycle;
    await waitForDbTime(raw, periodStart);
    await scopes.openOrgNativeCycle({
      tenantId,
      surveyDefinitionId: definitionId,
      periodStart,
      periodEnd,
    });
    const [overall] =
      await raw`select id from survey_report_scopes where tenant_id=${tenantId} and kind='manager_overall'`;
    const [teamScope] =
      await raw`select id from survey_report_scopes where tenant_id=${tenantId} and kind='team'`;
    const windows = new Map<string, string>(),
      conversations = new Map<string, string>();
    for (const userId of [...users, ...leadList]) {
      if (createWindows) {
        const w = await survey.findOrCreateActiveWindow(userId, tenantId);
        if (!w || 'kind' in w) throw Error('fixture_window');
        windows.set(userId, w.id);
      }
      const [c] = await db
        .insert(schema.conversations)
        .values({ tenantId, userId, channelType: 'dev', externalConversationId: userId })
        .returning();
      conversations.set(userId, c.id);
    }
    // Only scheduling metadata is historical synthetic setup. Real admission and first-start guards stay enabled.
    await raw.begin(async (tx) => {
      await tx`set local session_replication_role=replica`;
      await tx`update survey_report_final_timings set status='scheduled',blocked_reason=null,timezone=coalesce(timezone,'UTC'),local_date=coalesce(local_date,'2026-10-27'),local_work_end=coalesce(local_work_end,'23:59'),final_due_at=(select period_start+interval '1 microsecond' from survey_cycle_scoring_policies where id=survey_report_final_timings.cycle_scoring_policy_id) where tenant_id=${tenantId}`;
      await tx`set local session_replication_role=origin`;
    });
    return {
      tenantId,
      definitionId,
      cycleId: cycle.id,
      cycle,
      questions,
      numeric: questions
        .filter((q) => q.responseType === 'numeric_1_10_integer')
        .sort((a, b) => a.displayOrder - b.displayOrder),
      policy,
      users,
      lead,
      leadList,
      manager,
      team,
      teamList,
      unit,
      windows,
      conversations,
      overallId: String(overall.id),
      teamScopeId: String(teamScope.id),
    };
  }
  type F = Awaited<ReturnType<typeof fixture>>;
  async function inbound(f: F, userId: string, text = '7', explicit?: string) {
    const id = randomUUID(),
      conversationId = f.conversations.get(userId)!;
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`insert into messages(id,tenant_id,user_id,conversation_id,direction,sender_type,text,occurred_at,received_at)values(${id}::uuid,${f.tenantId}::uuid,${userId}::uuid,${conversationId}::uuid,'inbound','user',${text},clock_timestamp(),${explicit ?? null}::timestamptz)`,
      );
      await tx.insert(schema.conversationJobAdmissions).values({
        messageId: id,
        tenantId: f.tenantId,
        userId,
        conversationId,
        externalWorkspaceId: 'fixture',
        externalConversationId: userId,
        eventId: id,
        requestId: randomUUID(),
        traceId: randomUUID(),
      });
    });
    return { tenantId: f.tenantId, userId, conversationId, inboundMessageId: id };
  }
  async function commit(
    input: Awaited<ReturnType<typeof inbound>>,
    options: { evidence?: boolean; fallback?: boolean; token?: string } = {},
  ) {
    const token =
      options.token ??
      (await conversation.claimNativeInput({ ...input, messageId: input.inboundMessageId }));
    await db.transaction(async (tx) => {
      const repo = new ConversationRepository({ client: tx } as never);
      const out = await repo.saveMessage({
        conversationId: input.conversationId,
        tenantId: input.tenantId,
        userId: input.userId,
        direction: 'outbound',
        text: 'Synthetic coaching reply',
        metadata: {
          sourceInboundMessageId: input.inboundMessageId,
          ...(options.fallback ? { conversationOutcome: 'processing_failed' } : {}),
        },
      });
      await repo.recordCommittedTurn({
        ...input,
        nativeReportClaimToken: token ?? undefined,
        outboundMessageId: out.id,
        dispatchKinds: options.evidence ? ['message_send', 'survey_evidence'] : ['message_send'],
      });
    });
  }
  async function numeric(f: F, userId: string, index: number, value = '7', complete = true) {
    const q = f.numeric[index],
      conversationId = f.conversations.get(userId)!;
    await db.insert(schema.messages).values({
      tenantId: f.tenantId,
      userId,
      conversationId,
      direction: 'outbound',
      senderType: 'agent',
      text: q.title,
      occurredAt: new Date(),
      sentAt: new Date(),
      metadata: {
        engagementProbe: {
          contractVersion: ENGAGEMENT_ANSWER_CONTRACT,
          surveyDefinitionId: f.definitionId,
          surveyWindowId: f.windows.get(userId),
          questionId: q.id,
          questionVersion: q.version,
          stableKey: q.stableKey,
          displayedFormHash: createHash('sha256').update(q.title).digest('hex'),
        },
      },
    });
    const input = await inbound(f, userId, value);
    await capture.capture(input);
    if (complete) await commit(input);
    return input;
  }
  const request = (f: F, purpose: 'final' | 'intermediate' = 'final') => ({
    tenantId: f.tenantId,
    cycleId: f.cycleId,
    scopeId: f.overallId,
    purpose,
  });
  const start = (f: F) => timing.begin(f.tenantId, f.cycleId, 1);
  /** Returns the successor reserved at fixture time, or reserves it now when none was requested. */
  async function successor(previousCycleId: string, days: number) {
    const [reserved] =
      await raw`select next.id from survey_cycle_scoring_policies previous join survey_cycle_scoring_policies next on next.tenant_id=previous.tenant_id and next.survey_definition_id=previous.survey_definition_id and next.period_start=previous.period_end where previous.id=${previousCycleId}::uuid`;
    if (!reserved) return reserveSuccessorCycle(db, raw, previousCycleId, days);
    const cycle = await readCycle(db, String(reserved.id));
    if (cycle.periodEnd.getTime() - cycle.periodStart.getTime() !== cycleMs(days))
      throw Error('fixture_reserved_successor_length');
    return cycle;
  }
  const cleanup = async () => {
    if (created.length) await db.delete(schema.tenants).where(inArray(schema.tenants.id, created));
    await raw.end();
  };
  return {
    db,
    raw,
    database,
    fixture,
    inbound,
    commit,
    numeric,
    start,
    successor,
    waitForDbTime: (at: Date) => waitForDbTime(raw, at),
    request,
    capture,
    conversation,
    survey,
    settlement,
    inputs,
    cleanup,
  };
}
