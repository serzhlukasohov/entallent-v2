import { Injectable } from '@nestjs/common';
import { and, eq, gt, isNull, lte, sql } from 'drizzle-orm';
import { pulseReportDenominator, validateActiveHierarchy, type ActiveHierarchyGraph, type OpenOrgNativeReportCycleInput, type PulseReportCollectionUnavailable, type PulseReportCycleSnapshot, type PulseReportScopeRepositoryPort } from '@entalent/application';
import { lockPulseReportSubject, orgEmployeePlacements, orgTeams, orgUnits, people, surveyCycleScoringPolicies, surveyDefinitions, surveyQuestions, surveyReportCycleOpenings, surveyReportParticipants, surveyReportScopeMemberships, surveyReportScopes, surveyReportWindowBindings, surveyReportingPermissions, surveyWindows, users, withPulseReportSerializableRetry } from '@entalent/database';
import { lockPulseReportCycleExact, readReportCycleExact, lockReportConfiguration } from '@entalent/database';
import { PulseReportFinalScheduleRepository } from './pulse-report-final-schedule.repository';
import { DatabaseService } from '../../database/database.service';

type Tx = Parameters<Parameters<DatabaseService['client']['transaction']>[0]>[0];
@Injectable()
export class PulseReportScopeRepository implements PulseReportScopeRepositoryPort {
  constructor(private readonly db: DatabaseService) {}

  async openOrgNativeCycle(input: OpenOrgNativeReportCycleInput): Promise<PulseReportCycleSnapshot> {
    input = { ...input, tenantId: input.tenantId.toLowerCase(), surveyDefinitionId: input.surveyDefinitionId.toLowerCase() };
    return withPulseReportSerializableRetry(() => this.db.client.transaction(async (tx) => {
      await lockReportConfiguration(tx, input.tenantId);
      const [cycle] = await tx.select().from(surveyCycleScoringPolicies).where(and(
        eq(surveyCycleScoringPolicies.tenantId, input.tenantId), eq(surveyCycleScoringPolicies.surveyDefinitionId, input.surveyDefinitionId),
        eq(surveyCycleScoringPolicies.periodStart, input.periodStart), eq(surveyCycleScoringPolicies.periodEnd, input.periodEnd),
      )).limit(1);
      if (!cycle) throw new Error('pulse_report_approved_cycle_required');
      const [exact] = await tx.execute(sql`select period_start::text as "periodStart",period_end::text as "periodEnd" from survey_cycle_scoring_policies where tenant_id=${input.tenantId}::uuid and id=${cycle.id}::uuid`) as {periodStart:string;periodEnd:string}[];
      await lockPulseReportCycleExact(tx,{tenantId:input.tenantId,surveyDefinitionId:input.surveyDefinitionId,...exact});
      const [existing] = await tx.select().from(surveyReportCycleOpenings).where(and(eq(surveyReportCycleOpenings.tenantId, input.tenantId), eq(surveyReportCycleOpenings.cycleScoringPolicyId, cycle.id)));
      if (existing) {
        await new PulseReportFinalScheduleRepository(this.db).refreshInTransaction(tx,input.tenantId,cycle.id);
        return this.snapshot(tx, input.tenantId, cycle.id);
      }
      const [definition] = await tx.select().from(surveyDefinitions).where(eq(surveyDefinitions.id, input.surveyDefinitionId));
      if (!definition?.active || (definition.tenantId && definition.tenantId !== input.tenantId)) throw new Error('survey_reporting_definition_not_available');
      const persons = await tx.select().from(people).where(eq(people.tenantId, input.tenantId));
      const units = await tx.select().from(orgUnits).where(eq(orgUnits.tenantId, input.tenantId));
      const teams = await tx.select().from(orgTeams).where(eq(orgTeams.tenantId, input.tenantId));
      const placements = await tx.select().from(orgEmployeePlacements).where(eq(orgEmployeePlacements.tenantId, input.tenantId));
      const issues = validateActiveHierarchy({ tenantId: input.tenantId, people: persons, units, teams, placements } as ActiveHierarchyGraph)
        .filter((issue) => !['active_team_without_employee', 'active_unit_without_subordinate'].includes(issue.code));
      if (issues.length) throw new Error('pulse_report_invalid_active_hierarchy');
      await tx.insert(surveyReportCycleOpenings).values({ tenantId: input.tenantId, cycleScoringPolicyId: cycle.id });
      const eligible = await tx.select({ id: people.id, role: people.primaryRole }).from(people)
        .innerJoin(users, and(eq(users.id, people.id), eq(users.tenantId, people.tenantId)))
        .where(and(eq(people.tenantId, input.tenantId), eq(people.lifecycleStatus, 'active'), eq(people.pulseParticipant, true),
          eq(users.status, 'active'), isNull(users.deletedAt), sql`${users.consentState}->'surveyEnabled' = 'true'::jsonb`));
      const eligibleIds = new Set(eligible.map((row) => row.id));
      for (const unit of units.filter((row) => row.lifecycleStatus === 'active').sort((a, b) => a.id.localeCompare(b.id))) {
        const unitTeams = teams.filter((row) => row.lifecycleStatus === 'active' && row.unitId === unit.id).sort((a, b) => a.id.localeCompare(b.id));
        const [overall] = await tx.insert(surveyReportScopes).values({ tenantId: input.tenantId, cycleScoringPolicyId: cycle.id,
          kind: 'manager_overall', orgUnitId: unit.id, label: unit.name, openingOwnerPersonId: unit.managerPersonId,
          historyKey: `${input.tenantId}:manager_overall:${unit.id}`, boundaryFingerprint: unitTeams.map((row) => row.id).join(','),
        }).returning();
        for (const team of unitTeams) {
          const [scope] = await tx.insert(surveyReportScopes).values({ tenantId: input.tenantId, cycleScoringPolicyId: cycle.id,
            kind: 'team', orgUnitId: unit.id, orgTeamId: team.id, parentScopeId: overall.id, label: team.name,
            openingOwnerPersonId: team.teamLeadPersonId, historyKey: `${input.tenantId}:team:${team.id}`, boundaryFingerprint: team.id,
          }).returning();
          const employeeIds = placements.filter((row) => row.lifecycleStatus === 'active' && row.teamId === team.id && row.unitId === unit.id).map((row) => row.employeePersonId);
          const members = [...new Set([...employeeIds, ...(team.teamLeadPersonId ? [team.teamLeadPersonId] : [])])].filter((id) => eligibleIds.has(id)).sort();
          for (const userId of members) {
            await lockPulseReportSubject(tx, input.tenantId, userId);
            const role = userId === team.teamLeadPersonId ? 'team_lead' : 'employee';
            const [participant] = await tx.insert(surveyReportParticipants).values({ tenantId: input.tenantId, cycleScoringPolicyId: cycle.id,
              personId: userId, userId, openingRole: role, originUnitId: unit.id, originTeamId: team.id,
            }).returning();
            await tx.insert(surveyReportScopeMemberships).values([
              { tenantId: input.tenantId, cycleScoringPolicyId: cycle.id, scopeId: overall.id, participantId: participant.id },
              ...(role === 'employee' ? [{ tenantId: input.tenantId, cycleScoringPolicyId: cycle.id, scopeId: scope.id, participantId: participant.id }] : []),
            ]);
          }
        }
      }
      await new PulseReportFinalScheduleRepository(this.db).refreshInTransaction(tx,input.tenantId,cycle.id);
      return this.snapshot(tx, input.tenantId, cycle.id);
    }, { isolationLevel: 'serializable' }));
  }

  async scopeDenominator(tenantId: string, scopeId: string): Promise<{ denominator: number; threshold: number }> {
    const rows = await this.db.client.execute(sql`select count(*)::int as frozen, count(*) filter (where permission.full_reporting_denied)::int as withdrawn
      from survey_report_scope_memberships membership
      join survey_report_participants participant on participant.id = membership.participant_id and participant.tenant_id = membership.tenant_id and participant.cycle_scoring_policy_id = membership.cycle_scoring_policy_id
      left join survey_reporting_permissions permission on permission.tenant_id = participant.tenant_id and permission.user_id = participant.user_id
      where membership.tenant_id = ${tenantId}::uuid and membership.scope_id = ${scopeId}::uuid`) as unknown as { frozen: number; withdrawn: number }[];
    return pulseReportDenominator(rows[0]?.frozen ?? 0, rows[0]?.withdrawn ?? 0);
  }

  private async snapshot(tx: Tx, tenantId: string, cycleId: string): Promise<PulseReportCycleSnapshot> {
    const [opening] = await tx.select().from(surveyReportCycleOpenings).where(and(eq(surveyReportCycleOpenings.tenantId, tenantId), eq(surveyReportCycleOpenings.cycleScoringPolicyId, cycleId)));
    const scopes = await tx.select().from(surveyReportScopes).where(and(eq(surveyReportScopes.tenantId, tenantId), eq(surveyReportScopes.cycleScoringPolicyId, cycleId))).orderBy(surveyReportScopes.id);
    const members = await tx.select({ scopeId: surveyReportScopeMemberships.scopeId, userId: surveyReportParticipants.userId })
      .from(surveyReportScopeMemberships).innerJoin(surveyReportParticipants, and(eq(surveyReportParticipants.id, surveyReportScopeMemberships.participantId), eq(surveyReportParticipants.tenantId, surveyReportScopeMemberships.tenantId)))
      .where(and(eq(surveyReportScopeMemberships.tenantId, tenantId), eq(surveyReportScopeMemberships.cycleScoringPolicyId, cycleId)));
    return { tenantId, cycleScoringPolicyId: cycleId, openedAt: opening.openedAt, scopeContractVersion: opening.scopeContractVersion,
      scopes: scopes.map((scope) => ({ ...scope, kind: scope.kind as 'team' | 'manager_overall', participantUserIds: members.filter((row) => row.scopeId === scope.id).map((row) => row.userId).sort() })) };
  }

  /** undefined means no product cycle; unavailable never falls back to a legacy/destination team. */
  async findOrCreateWindow(tenantId: string, userId: string, definitionId: string, exactSource?:{cycleId:string;inboundReceiptId:string}): Promise<typeof surveyWindows.$inferSelect | PulseReportCollectionUnavailable | undefined> {
    return withPulseReportSerializableRetry(() => this.db.client.transaction(async (tx) => {
      const now = new Date();
      const cycles = await tx.select({ cycle: surveyCycleScoringPolicies, opening: surveyReportCycleOpenings })
        .from(surveyReportCycleOpenings).innerJoin(surveyCycleScoringPolicies, and(eq(surveyCycleScoringPolicies.id, surveyReportCycleOpenings.cycleScoringPolicyId), eq(surveyCycleScoringPolicies.tenantId, surveyReportCycleOpenings.tenantId)))
        .where(and(eq(surveyReportCycleOpenings.tenantId, tenantId), eq(surveyCycleScoringPolicies.surveyDefinitionId, definitionId), ...(exactSource?[eq(surveyCycleScoringPolicies.id,exactSource.cycleId)]:[lte(surveyCycleScoringPolicies.periodStart, now), gt(surveyCycleScoringPolicies.periodEnd, now)])));
      if (!cycles.length) return undefined;
      if (cycles.length !== 1) throw new Error('pulse_report_cycle_ambiguous');
      const { cycle } = cycles[0];
      const exact=await readReportCycleExact(tx,tenantId,cycle.id);
      if(!exact)throw new Error('pulse_report_cycle_missing');
      await lockPulseReportCycleExact(tx,exact);
      await lockPulseReportSubject(tx, tenantId, userId);
      const [participant] = await tx.select().from(surveyReportParticipants).where(and(eq(surveyReportParticipants.tenantId, tenantId), eq(surveyReportParticipants.cycleScoringPolicyId, cycle.id), eq(surveyReportParticipants.userId, userId)));
      if (!participant) return { kind: 'collection_unavailable', reason: 'nonparticipant' };
      if(exactSource){const source=await tx.execute(sql`select 1 from survey_report_inbound_work w where w.inbound_receipt_id=${exactSource.inboundReceiptId}::uuid and w.tenant_id=${tenantId}::uuid and w.user_id=${userId}::uuid and pulse_input_receipt_in_scope(w.tenant_id,w.user_id,${cycle.id}::uuid,w.received_at,null,false)`);if(!source.length)return {kind:'collection_unavailable',reason:'missing_proof'};}
      const [permission] = await tx.select().from(surveyReportingPermissions).where(and(eq(surveyReportingPermissions.tenantId, tenantId), eq(surveyReportingPermissions.userId, userId)));
      if (permission?.fullReportingDenied) return { kind: 'collection_unavailable', reason: 'full_withdrawal' };
      if (participant.collectionStoppedAt && !exactSource) return { kind: 'collection_unavailable', reason: 'stopped' };
      const [binding] = await tx.select().from(surveyReportWindowBindings).where(and(eq(surveyReportWindowBindings.tenantId, tenantId), eq(surveyReportWindowBindings.cycleScoringPolicyId, cycle.id), eq(surveyReportWindowBindings.participantId, participant.id)));
      if (binding) {
        const [window] = await tx.select().from(surveyWindows).where(and(eq(surveyWindows.id, binding.surveyWindowId), eq(surveyWindows.tenantId, tenantId), eq(surveyWindows.userId, userId)));
        if (!window) throw new Error('pulse_report_window_binding_missing');
        return window;
      }
      const [newer] = exactSource ? await tx.select({ id: surveyWindows.id }).from(surveyWindows).where(and(eq(surveyWindows.tenantId, tenantId), eq(surveyWindows.userId, userId), eq(surveyWindows.status, 'active'), gt(surveyWindows.periodStart, cycle.periodStart))).limit(1) : [];
      const historical = Boolean(exactSource && (cycle.periodEnd <= now || newer));
      if (!historical) await tx.update(surveyWindows).set({ status: 'closed', completedAt: now }).where(and(eq(surveyWindows.tenantId, tenantId), eq(surveyWindows.userId, userId), eq(surveyWindows.status, 'active')));
      const [window] = await tx.insert(surveyWindows).values({ tenantId, userId, surveyDefinitionId: definitionId, periodType: 'quarter', periodStart: sql`${exact.periodStart}::timestamptz`, periodEnd: sql`${exact.periodEnd}::timestamptz`, reportingCohortId: null, reportingTeamId: null, reportingRosterUserIds: [], status: historical ? 'closed' : 'active', ...(historical ? { completedAt: now } : {}) }).returning();
      await tx.insert(surveyReportWindowBindings).values({ tenantId, cycleScoringPolicyId: cycle.id, participantId: participant.id, surveyWindowId: window.id });
      const questions = await tx.select({ id: surveyQuestions.id }).from(surveyQuestions).where(and(eq(surveyQuestions.surveyDefinitionId, definitionId), eq(surveyQuestions.responseType, 'open_ended'))).orderBy(surveyQuestions.id);
      for (const question of questions) await tx.execute(sql`select pulse_report_lineage(${window.id}::uuid, ${question.id}::uuid)`);
      return window;
    }, { isolationLevel: 'serializable' }));
  }
}
