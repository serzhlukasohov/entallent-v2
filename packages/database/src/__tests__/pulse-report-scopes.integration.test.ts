import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, eq, inArray } from 'drizzle-orm';
import postgres from 'postgres';
import * as schema from '../schema';
import { lockPulseReportSubject } from '../pulse-report-state';
import { ConversationOrchestrator, LEGACY_V2_QUESTION_GROUP_BY_STABLE_KEY, isPulseReportCollectionUnavailable, pulseReportDenominator } from '@entalent/application';
import { PulseReportScopeRepository } from '../../../../apps/worker/src/survey/repositories/pulse-report-scope.repository';
import { ReportingPermissionRepository } from '../../../../apps/worker/src/survey/repositories/reporting-permission.repository';
import { QuestionInsightRepository } from '../../../../apps/worker/src/survey/repositories/question-insight.repository';
import { REPORTING_DISCLOSURE_VERSION } from '../../../application/src/utils/reporting-disclosure';
import { DatabaseService } from '../../../../apps/worker/src/database/database.service';
import { ConversationRepository } from '../../../../apps/worker/src/conversation/repositories/conversation.repository';
import { SurveyRepository } from '../../../../apps/worker/src/survey/repositories/survey.repository';
import { HierarchyMutationService } from '../../../../apps/api/src/hierarchy/hierarchy-mutation.service';
import { HierarchyDeactivationService } from '../../../../apps/api/src/hierarchy/hierarchy-deactivation.service';
import { RetentionRepository } from '../../../../apps/worker/src/retention/retention.repository';

const url = process.env['DATABASE_URL'];
describe.runIf(Boolean(url))('RPT-02 frozen org scopes, receipts and negative permission', () => {
  const client = postgres(url!, { max: 8 });
  const db = drizzle(client, { schema });
  const database = { client: db } as never;
  const scopes = new PulseReportScopeRepository(database);
  const rights = new ReportingPermissionRepository(database);
  const questionsRepo = new QuestionInsightRepository(database, { findCurrentHierarchyIdentifiers: async () => [] } as never);
  const legacy = new SurveyRepository(database, {} as never, { findTeamByMemberId: async () => null } as never);
  const tenants: string[] = [];
  afterAll(async () => {
    if (tenants.length) await db.delete(schema.tenants).where(inArray(schema.tenants.id, tenants));
    await client.end();
  });

  async function fixture(durationMs = 86_400_000) {
    const [tenant] = await db.insert(schema.tenants).values({ name: `RPT02 ${randomUUID()}`, timezone: 'UTC' }).returning();
    const tenantId = tenant.id; tenants.push(tenantId);
    async function person(role: 'employee' | 'team_lead' | 'manager' | 'leadership') {
      const [user] = await db.insert(schema.users).values({ tenantId, consentState: { surveyEnabled: true } }).returning();
      await db.insert(schema.people).values({ id: user.id, tenantId, customerEmployeeId: user.id, workEmail: `${user.id}@fixture.invalid`, displayName: role, primaryRole: role, pulseParticipant: role === 'employee' || role === 'team_lead', lifecycleStatus: 'active' });
      return user.id;
    }
    const manager = await person('manager');
    const leadership = await person('leadership');
    const [unit] = await db.insert(schema.orgUnits).values({ tenantId, customerUnitKey: 'unit', name: 'Unit', managerPersonId: manager, lifecycleStatus: 'active' }).returning();
    const teams = [];
    const employees: string[] = [];
    const leads: string[] = [];
    for (let i = 0; i < 2; i++) {
      const lead = await person('team_lead'); leads.push(lead);
      const [team] = await db.insert(schema.orgTeams).values({ tenantId, unitId: unit.id, customerTeamKey: `team-${i}`, name: `Team ${i}`, teamLeadPersonId: lead, lifecycleStatus: 'active' }).returning(); teams.push(team);
      for (let j = 0; j < 5; j++) {
        const employee = await person('employee'); employees.push(employee);
        await db.insert(schema.orgEmployeePlacements).values({ tenantId, employeePersonId: employee, unitId: unit.id, teamId: team.id, lifecycleStatus: 'active' });
      }
    }
    const unitOnly = await person('employee');
    await db.insert(schema.orgEmployeePlacements).values({ tenantId, employeePersonId: unitOnly, unitId: unit.id, lifecycleStatus: 'active' });
    const [definition] = await db.insert(schema.surveyDefinitions).values({ tenantId, name: 'Pulse fixture', version: 'fixture-v2' }).returning();
    const questions = await db.insert(schema.surveyQuestions).values(Object.entries(LEGACY_V2_QUESTION_GROUP_BY_STABLE_KEY).map(([stableKey, questionGroup], index) => ({ surveyDefinitionId: definition.id, stableKey, title: stableKey, canonicalMeaning: stableKey, dimension: 'engagement', questionGroup, version: 'fixture-v1', displayOrder: index }))).returning();
    const [policy] = await db.insert(schema.surveyScoringPolicies).values({ tenantId, version: 'rpt02-fixture-v1', approvedAt: new Date(), rubrics: Object.fromEntries(questions.map((q) => [q.stableKey, { version: 'v1', instructions: 'Synthetic rubric only', anchors: [{ score: 0, description: 'low' }, { score: 100, description: 'high' }] }])) }).returning();
    const periodStart = new Date(Date.now() + 300);
    const periodEnd = new Date(periodStart.getTime() + durationMs);
    const [cycle] = await db.insert(schema.surveyCycleScoringPolicies).values({ tenantId, surveyDefinitionId: definition.id, periodStart, periodEnd, scoringPolicyId: policy.id }).returning();
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, periodStart.getTime() - Date.now() + 10)));
    const openingInput = { tenantId, surveyDefinitionId: definition.id, periodStart, periodEnd, openedAt: new Date() };
    return { tenantId, manager, leadership, unit, teams, leads, employees, unitOnly, definition, questions, cycle, policy, openingInput };
  }
  async function productWindow(f: Awaited<ReturnType<typeof fixture>>, userId = f.employees[0]) {
    const window = await legacy.findOrCreateActiveWindow(userId, f.tenantId);
    if (!window || isPulseReportCollectionUnavailable(window)) throw new Error('fixture_window_unavailable');
    return window;
  }
  function withdrawal(f: Awaited<ReturnType<typeof fixture>>, userId: string, lineageIds?: string[]) {
    return { tenantId: f.tenantId, userId, personId: userId, requestId: randomUUID(), provenance: { kind: 'verified_subject' as const, tenantId: f.tenantId, userId, personId: userId, verificationId: randomUUID(), receivedAt: new Date() }, target: lineageIds ? { kind: 'partial_reporting' as const, lineageIds } : { kind: 'full_reporting' as const } };
  }
  async function confirmed(f: Awaited<ReturnType<typeof fixture>>, userId = f.employees[0], skipVerdict = false) {
    const window = await productWindow(f, userId);
    const [conversation] = await db.insert(schema.conversations).values({ tenantId: f.tenantId, userId, channelType: 'dev', externalConversationId: randomUUID() }).returning();
    const [source] = await db.insert(schema.messages).values({ tenantId: f.tenantId, userId, conversationId: conversation.id, direction: 'inbound', senderType: 'user', text: 'Synthetic receipt-backed answer', occurredAt: new Date(), receivedAt: new Date() }).returning();
    const group = f.questions.filter((q) => q.questionGroup === 'autonomy');
    for (const q of group) expect(await questionsRepo.captureMeaning({ tenantId: f.tenantId, userId, conversationId: conversation.id, surveyWindowId: window.id, surveyQuestionId: q.id, questionVersion: q.version, sourceMessageId: source.id, meaning: `Synthetic meaning ${q.stableKey}`, sufficientMeaning: true, driverCaptured: true, driverDeclined: false })).toBe('captured');
    const components = group.map((q) => ({ surveyQuestionId: q.id, questionVersion: q.version, statement: `Synthetic statement ${q.stableKey}`, expectedWorkingSummary: `Synthetic meaning ${q.stableKey}` }));
    const text = `Please confirm:\n${components.map((c, index) => `${index + 1}. ${c.statement}`).join('\n')}\nIs that correct?`;
    const [prompt] = await db.insert(schema.messages).values({ tenantId: f.tenantId, userId, conversationId: conversation.id, direction: 'outbound', senderType: 'assistant', text, occurredAt: new Date() }).returning();
    const bundleId = await questionsRepo.stageQuestionConfirmationBundle({ tenantId: f.tenantId, userId, conversationId: conversation.id, surveyWindowId: window.id, questionGroup: 'autonomy', promptMessageId: prompt.id, displayedText: text, components });
    if (typeof bundleId !== 'string') throw new Error('fixture_stage_unavailable');
    const sentAt = new Date();
    await db.update(schema.messages).set({ sentAt }).where(eq(schema.messages.id, prompt.id));
    await questionsRepo.activateDeliveredQuestionBundle({ tenantId: f.tenantId, conversationId: conversation.id, promptMessageId: prompt.id, deliveredAt: sentAt });
    const receivedAt = new Date(sentAt.getTime() + 1);
    const [confirmation] = await db.insert(schema.messages).values({ tenantId: f.tenantId, userId, conversationId: conversation.id, direction: 'inbound', senderType: 'user', text: 'agree', occurredAt: receivedAt, receivedAt }).returning();
    if (!skipVerdict) expect(await questionsRepo.applyQuestionBundleVerdict({ tenantId: f.tenantId, userId, conversationId: conversation.id, inboundMessageId: confirmation.id, bundleId, verdict: { kind: 'agree' } })).toBe(true);
    const [working] = await db.select().from(schema.surveyQuestionWorkingInsights).where(and(eq(schema.surveyQuestionWorkingInsights.surveyWindowId, window.id), eq(schema.surveyQuestionWorkingInsights.surveyQuestionId, group[0].id)));
    return { window, conversation, source, confirmation, working, question: group[0], bundleId };
  }
  async function finalize(f: Awaited<ReturnType<typeof fixture>>, c: Awaited<ReturnType<typeof confirmed>>, userId = f.employees[0], repository = questionsRepo) {
    return repository.persistFinalAndPurge({ workingInsightId: c.working.id, expectedWorkingUpdatedAt: c.working.updatedAt,
      final: { tenantId: f.tenantId, userId, surveyWindowId: c.window.id, surveyDefinitionId: f.definition.id, surveyQuestionId: c.question.id, questionVersion: c.question.version, questionGroup: c.question.questionGroup, deidentifiedSummary: 'Synthetic deidentified analytical meaning', outcome: 'scored', score: 50, signalDirection: 'mixed', signalSeverity: 'low', rootCauseCategory: 'clarity', confidence: 0.8, scoringPolicyVersion: f.policy.version, questionRubricVersion: 'v1', modelId: 'synthetic', promptVersion: 'fixture-v1', privacyPolicyVersion: 'fixture-v1', confirmedAt: c.working.confirmedAt!, scoredAt: new Date() } });
  }

  it('rolls back an expired native stage through real DatabaseService UOW and commits exactly one coaching fallback', async () => {
    const f = await fixture(4_000);
    await scopes.openOrgNativeCycle(f.openingInput);
    const window = await productWindow(f);
    const scope = { tenantId: f.tenantId, userId: f.employees[0] };
    const [conversation] = await db.insert(schema.conversations).values({ ...scope, channelType: 'dev', externalConversationId: randomUUID() }).returning();
    const [source] = await db.insert(schema.messages).values({ ...scope, conversationId: conversation.id, direction: 'inbound', senderType: 'user', text: 'Synthetic new meaning.', occurredAt: new Date(), receivedAt: new Date() }).returning();
    for (const q of f.questions.filter((q) => q.questionGroup === 'autonomy')) {
      expect(await questionsRepo.captureMeaning({ ...scope, conversationId: conversation.id, surveyWindowId: window.id, surveyQuestionId: q.id, questionVersion: q.version, sourceMessageId: source.id, meaning: `Meaning ${q.stableKey}.`, sufficientMeaning: true, driverCaptured: true, driverDeclined: false })).toBe('captured');
    }
    const transactionDb = new DatabaseService({ get: () => url } as never); transactionDb.onModuleInit();
    try {
      const actualConversation = new ConversationRepository(transactionDb);
      const actualQuestions = new QuestionInsightRepository(transactionDb, { findCurrentHierarchyIdentifiers: async () => [] } as never);
      expect(await actualQuestions.findReadyQuestionBundle(scope)).not.toBeNull();
      const writes: string[] = [];
      const saveMessage = vi.fn(async (input: Parameters<ConversationRepository['saveMessage']>[0]) => {
        const saved = await actualConversation.saveMessage(input); writes.push(saved.id); return saved;
      });
      const stage = vi.spyOn(actualQuestions, 'stageQuestionConfirmationBundle').mockImplementation(async (input) => {
        // This write and the already-persisted outbound must both disappear with the denied stage.
        await transactionDb.client.update(schema.conversations).set({ activeTopic: { label: 'must roll back', source: 'user', startedAt: new Date().toISOString(), lastMentionedAt: new Date().toISOString() } as never }).where(eq(schema.conversations.id, conversation.id));
        await new Promise((resolve) => setTimeout(resolve, Math.max(0, f.openingInput.periodEnd.getTime() - Date.now() + 20)));
        const result = await QuestionInsightRepository.prototype.stageQuestionConfirmationBundle.call(actualQuestions, input);
        expect(isPulseReportCollectionUnavailable(result)).toBe(true);
        return result;
      });
      const conversationRepo = {
        findById: async () => ({ id: conversation.id, ...scope, channelType: 'dev', externalConversationId: conversation.externalConversationId, userDisplayName: 'Synthetic', userLocale: 'en', userTimezone: 'UTC' }),
        findRecentMessages: async () => [{ ...source, metadata: undefined }],
        findLatestDeliveredReportingDisclosure: async () => ({ messageId: randomUUID(), version: REPORTING_DISCLOSURE_VERSION, shownAt: new Date(source.occurredAt.getTime() - 1000) }),
        saveMessage, updateActiveTopic: vi.fn(),
      };
      const ai = {
        classifySituation: vi.fn().mockResolvedValue({ primaryIntent: 'casual_conversation', secondaryIntents: [], emotionalState: [], urgency: 'low', confidence: 0.9, surveyAllowed: true, requiresSafetyCheck: false, reasoningSummary: 'synthetic', reminderRequest: null, dialogueAct: 'new_substance', latestUserSubstance: source.text, topicAnchor: null }),
        detectRisk: vi.fn().mockResolvedValue({ riskType: null, severity: 'none', confidence: 0.9, evidence: [], immediateResponseRequired: false, escalationRecommended: false, surveyMustBeBlocked: false, proactiveMessagesMustBePaused: false, reasoningSummary: 'synthetic' }),
        composeQuestionBundle: vi.fn(async (_turns: unknown, questions: Array<{ surveyQuestionId: string; workingSummary: string }>) => ({ text: `${questions.map((q) => q.workingSummary).join(' ')} Is that right?`, statements: questions.map((q) => ({ surveyQuestionId: q.surveyQuestionId, statement: q.workingSummary })) })),
        generateResponse: vi.fn(async (_turns: unknown, _strategy: unknown, context: { trailingBundle?: { text: string } }) => ({ text: `Coaching response.\n\n${context.trailingBundle?.text}`, replyText: 'Coaching response.', bundleText: context.trailingBundle?.text, confidence: 0.9, containsSurveyProbe: false })),
        scoreSentiment: vi.fn().mockResolvedValue(0.9),
      };
      const outbox = { enqueueMessageSend: vi.fn(), enqueueMemoryExtraction: vi.fn(), enqueueSurveyEvidence: vi.fn(), enqueueStyleAnalysis: vi.fn(), enqueueProfileHydration: vi.fn() };
      const surveyRepo = { findPulseCaptureForConversation: async () => [], findPendingConfirmationGroups: async () => [], findAwaitingConfirmationGroups: async () => [], findCurrentHierarchyIdentifiers: async () => [] };
      const uow = { run: vi.fn((callback: () => Promise<unknown>) => transactionDb.withTransaction(callback)) };
      const orchestrator = new ConversationOrchestrator(conversationRepo as never, ai as never, outbox as never, undefined, surveyRepo as never, undefined, undefined, { isEnabled: async () => true } as never, undefined, undefined, undefined, undefined, actualQuestions, uow as never);
      const result = await orchestrator.orchestrate({ ...scope, messageId: source.id, conversationId: conversation.id, externalWorkspaceId: 'synthetic', externalConversationId: conversation.externalConversationId!, traceId: randomUUID() });
      expect(stage).toHaveBeenCalledOnce();
      expect(result.responseText).toBe('Coaching response.');
      expect(stage).toHaveBeenCalledOnce(); expect(uow.run).toHaveBeenCalledTimes(2);
      expect(saveMessage).toHaveBeenCalledTimes(2); expect(writes[0]).toBe(writes[1]);
      const outbound = await db.select().from(schema.messages).where(and(eq(schema.messages.conversationId, conversation.id), eq(schema.messages.direction, 'outbound')));
      expect(outbound).toHaveLength(1); expect(outbound[0].text).toBe('Coaching response.');
      expect(outbound[0].metadata).not.toHaveProperty('v2ConfirmationBundle');
      expect((await db.select().from(schema.conversations).where(eq(schema.conversations.id, conversation.id)))[0].activeTopic).toBeNull();
      expect(await db.select().from(schema.surveyQuestionConfirmationBundles).where(eq(schema.surveyQuestionConfirmationBundles.userId, scope.userId))).toHaveLength(0);
      expect(outbox.enqueueMessageSend).toHaveBeenCalledOnce(); expect(outbox.enqueueSurveyEvidence).not.toHaveBeenCalled();
      expect(ai.generateResponse).toHaveBeenCalledOnce(); expect(ai.composeQuestionBundle).toHaveBeenCalledOnce();
    } finally { await transactionDb.onModuleDestroy(); }
  }, 15_000);

  it('freezes 12 overall/5 each without legacy mappings; replay and membership immutability', async () => {
    const f = await fixture();
    const [a, b] = await Promise.all([scopes.openOrgNativeCycle(f.openingInput), scopes.openOrgNativeCycle(f.openingInput)]);
    expect(a).toEqual(b);
    expect(a.scopes.find((s) => s.kind === 'manager_overall')?.participantUserIds).toHaveLength(12);
    expect(a.scopes.filter((s) => s.kind === 'team').map((s) => s.participantUserIds.length)).toEqual([5, 5]);
    expect(a.scopes.flatMap((s) => s.participantUserIds)).not.toContain(f.unitOnly);
    const window = await productWindow(f);
    const [stored] = await db.select().from(schema.surveyWindows).where(eq(schema.surveyWindows.id, window.id));
    expect([stored.reportingCohortId, stored.reportingTeamId, stored.reportingRosterUserIds]).toEqual([null, null, []]);
    expect(await db.select().from(schema.surveyReportQuestionLineages).where(eq(schema.surveyReportQuestionLineages.userId, f.employees[0]))).toHaveLength(12);
    await expect(client`update survey_report_participants set origin_team_id = ${f.teams[1].id} where tenant_id = ${f.tenantId}`).rejects.toThrow('pulse_report_frozen_update');
    await expect(client`update survey_report_window_bindings set participant_id = gen_random_uuid() where survey_window_id = ${window.id}`).rejects.toThrow('pulse_report_binding_immutable');
    await expect(legacy.openReportingCycle(f.openingInput)).rejects.toThrow('pulse_report_scope_mode_conflict');
    expect(await legacy.findOrCreateActiveWindow(f.manager, f.tenantId)).toEqual({ kind: 'collection_unavailable', reason: 'nonparticipant' });
  });

  it('rejects malformed active graph atomically and preserves empty team scopes', async () => {
    const f = await fixture();
    await db.insert(schema.orgEmployeePlacements).values({ tenantId: f.tenantId, employeePersonId: f.leads[0], unitId: f.unit.id, teamId: f.teams[0].id, lifecycleStatus: 'active' });
    await expect(scopes.openOrgNativeCycle(f.openingInput)).rejects.toThrow('pulse_report_invalid_active_hierarchy');
    expect(await db.select().from(schema.surveyReportCycleOpenings).where(eq(schema.surveyReportCycleOpenings.tenantId, f.tenantId))).toHaveLength(0);
    await db.delete(schema.orgEmployeePlacements).where(eq(schema.orgEmployeePlacements.employeePersonId, f.leads[0]));
    await db.update(schema.orgEmployeePlacements).set({ teamId: null }).where(eq(schema.orgEmployeePlacements.teamId, f.teams[1].id));
    const opening = await scopes.openOrgNativeCycle(f.openingInput);
    expect(opening.scopes.find((s) => s.orgTeamId === f.teams[1].id)?.participantUserIds).toHaveLength(0);
  });

  it('serializes legacy versus product opens under the shared cycle lock', async () => {
    const f = await fixture();
    await db.insert(schema.teams).values({ tenantId: f.tenantId, name: 'Synthetic pilot team' });
    const results = await Promise.allSettled([legacy.openReportingCycle(f.openingInput), scopes.openOrgNativeCycle(f.openingInput)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(String((results.find((result) => result.status === 'rejected') as PromiseRejectedResult).reason)).toContain('pulse_report_scope_mode_conflict');
    const [counts] = await client`select (select count(*)::int from survey_report_cycle_openings where tenant_id = ${f.tenantId}) as product, (select count(*)::int from survey_reporting_cohorts where tenant_id = ${f.tenantId}) as legacy`;
    expect(counts.product + counts.legacy).toBe(1);
  });

  it('uses receipt lower/upper bounds, retains original affiliation for pre-stop finalization', async () => {
    const f = await fixture(); const opening = await scopes.openOrgNativeCycle(f.openingInput); const c = await confirmed(f);
    const [bad] = await db.insert(schema.messages).values({ tenantId: f.tenantId, userId: f.employees[0], conversationId: c.conversation.id, direction: 'inbound', senderType: 'user', text: 'pre-opening', occurredAt: new Date(), receivedAt: new Date(opening.openedAt.getTime() - 1) }).returning();
    expect(await questionsRepo.collectionAdmission({ tenantId: f.tenantId, userId: f.employees[0], surveyWindowId: c.window.id, sourceMessageId: bad.id })).toBe('stopped');
    await expect(db.update(schema.messages).set({ receivedAt: null }).where(eq(schema.messages.id,bad.id))).rejects.toThrow('pulse_receipt_identity_immutable');
    expect(await questionsRepo.collectionAdmission({tenantId:f.tenantId,userId:f.employees[0],surveyWindowId:c.window.id,sourceMessageId:randomUUID()})).toBe('missing_proof');
    const hierarchy = new HierarchyMutationService(database);
    await hierarchy.moveEmployee(f.tenantId, f.employees[0], f.unit.id, f.teams[1].id, { type: 'internal_operator', operatorId: 'fixture' } as never);
    const [participant] = await db.select().from(schema.surveyReportParticipants).where(and(eq(schema.surveyReportParticipants.tenantId, f.tenantId), eq(schema.surveyReportParticipants.userId, f.employees[0])));
    expect(participant.originTeamId).toBe(f.teams[0].id); expect(participant.collectionStoppedAt).not.toBeNull(); expect(participant.collectionStopMutationId).not.toBeNull();
    expect(await finalize(f, c)).toBe('finalized');
    const [revision] = await db.select().from(schema.surveyReportInsightRevisions).where(eq(schema.surveyReportInsightRevisions.userId, f.employees[0]));
    expect(revision.proofStatus).toBe('receipt_backed'); expect(revision.confirmationMessageId).toBe(c.confirmation.id); expect(JSON.stringify(revision.acceptedSourceReceipts)).toContain(c.source.id);
    expect(await legacy.findOrCreateActiveWindow(f.employees[0], f.tenantId)).toEqual({ kind: 'collection_unavailable', reason: 'stopped' });
    const [atStop]=await client`insert into messages(tenant_id,user_id,conversation_id,direction,sender_type,text,occurred_at,received_at)values(${f.tenantId},${f.employees[0]},${c.conversation.id},'inbound','user','stop-boundary',clock_timestamp(),(select collection_stopped_at from survey_report_participants where id=${participant.id})) returning id`;
    expect(await questionsRepo.collectionAdmission({tenantId:f.tenantId,userId:f.employees[0],surveyWindowId:c.window.id,sourceMessageId:atStop.id})).toBe('stopped');
  });

  it('partial exclusions are lineage-specific; full withdrawal is durable/idempotent and cannot be recreated', async () => {
    const f = await fixture(); await scopes.openOrgNativeCycle(f.openingInput); const c = await confirmed(f);
    const lineages = await db.select().from(schema.surveyReportQuestionLineages).where(eq(schema.surveyReportQuestionLineages.userId, f.employees[0]));
    const lineage = lineages.find((row) => row.surveyQuestionId === c.question.id)!;
    const input = withdrawal(f, f.employees[0], [lineage.id]);
    const receipt = await rights.withdraw(input); expect(receipt.permissionRevision).toBe(1);
    expect((await rights.withdraw(input)).replayed).toBe(true);
    expect(await finalize(f, c)).toBe('stale');
    expect(await questionsRepo.collectionAdmission({ tenantId: f.tenantId, userId: f.employees[0], surveyWindowId: c.window.id, surveyQuestionId: c.question.id })).toBe('lineage_excluded');
    expect(await questionsRepo.collectionAdmission({ tenantId: f.tenantId, userId: f.employees[0], surveyWindowId: c.window.id, surveyQuestionId: f.questions.find((q) => q.questionGroup === 'growth')!.id })).toBe('allowed');
    expect(pulseReportDenominator(10, 0)).toEqual({ denominator: 10, threshold: 8 });
    await expect(rights.withdraw(withdrawal(f, f.employees[1], [lineage.id]))).rejects.toThrow('reporting_rights_lineage_subject_mismatch');
    await expect(rights.withdraw({ ...input, requestId: randomUUID(), provenance: { ...input.provenance, kind: 'company_admin' as never } })).rejects.toThrow('reporting_rights_verification_required');
    await rights.withdraw(withdrawal(f, f.employees[0])); await rights.withdraw(withdrawal(f, f.employees[1]));
    expect(pulseReportDenominator(10, 2)).toEqual({ denominator: 8, threshold: 7 });
    expect(await legacy.findOrCreateActiveWindow(f.employees[0], f.tenantId)).toEqual({ kind: 'collection_unavailable', reason: 'full_withdrawal' });
    await expect(client`delete from survey_reporting_permissions where tenant_id = ${f.tenantId}`).rejects.toThrow('pulse_report_suppression_retained');
  });

  it('preserves earliest stops through promotion, team deactivation and person deactivation', async () => {
    const f = await fixture(); const opening = await scopes.openOrgNativeCycle(f.openingInput);
    const hierarchy = new HierarchyMutationService(database);
    const deactivation = new HierarchyDeactivationService(database);
    const actor = { type: 'internal_operator' as const, operatorId: 'fixture' };
    await hierarchy.promoteTeamLead(f.tenantId, f.teams[0].id, f.employees[0], 'become_employee', actor);
    let participants = await db.select().from(schema.surveyReportParticipants).where(eq(schema.surveyReportParticipants.tenantId, f.tenantId));
    expect(participants.find((row) => row.userId === f.employees[0])?.collectionStopCause).toBe('promoted');
    expect(participants.find((row) => row.userId === f.leads[0])?.collectionStoppedAt).not.toBeNull();
    const first = participants.find((row) => row.userId === f.employees[0])!.collectionStoppedAt;
    await deactivation.deactivateTeam(f.tenantId, f.teams[0].id, 'become_employee', actor);
    await deactivation.deactivatePerson(f.tenantId, f.employees[1], actor);
    participants = await db.select().from(schema.surveyReportParticipants).where(eq(schema.surveyReportParticipants.tenantId, f.tenantId));
    expect(participants.filter((row) => row.originTeamId === f.teams[0].id).every((row) => row.collectionStoppedAt !== null)).toBe(true);
    expect(participants.find((row) => row.userId === f.employees[0])!.collectionStoppedAt).toEqual(first);
    const overall = opening.scopes.find((scope) => scope.kind === 'manager_overall')!;
    expect(await scopes.scopeDenominator(f.tenantId, overall.id)).toEqual({ denominator: 12, threshold: 10 });
  });

  it('serializes partial withdrawal/finalization and stop/full-withdrawal cross-type races', async () => {
    const f = await fixture(); const opening = await scopes.openOrgNativeCycle(f.openingInput); const c = await confirmed(f);
    const [lineage] = await db.select().from(schema.surveyReportQuestionLineages).where(and(eq(schema.surveyReportQuestionLineages.userId, f.employees[0]), eq(schema.surveyReportQuestionLineages.surveyQuestionId, c.question.id)));
    type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
    let held!: () => void; let release!: () => void;
    const lockHeld = new Promise<void>((resolve) => { held = resolve; });
    const releaseHolder = new Promise<void>((resolve) => { release = resolve; });
    const delayed = new QuestionInsightRepository({ client: { transaction: (run: (tx: Tx) => Promise<unknown>) => db.transaction(async (tx) => {
      await lockPulseReportSubject(tx, f.tenantId, f.employees[0]); held(); await releaseHolder;
      return run(tx);
    }) } } as never, {} as never);
    const finalization = finalize(f, c, f.employees[0], delayed);
    await lockHeld;
    const withdrawing = rights.withdraw(withdrawal(f, f.employees[0], [lineage.id]));
    let waiting = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const [state] = await client`select exists(select 1 from pg_locks lock join pg_stat_activity activity on activity.pid = lock.pid where lock.locktype = 'advisory' and not lock.granted and activity.datname = current_database()) as waiting`;
      if (state.waiting) { waiting = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    release();
    expect(waiting).toBe(true);
    const result = await Promise.all([finalization, withdrawing]);
    expect(['finalized', 'stale']).toContain(result[0]);
    const insights = await db.select().from(schema.surveyQuestionInsights).where(eq(schema.surveyQuestionInsights.userId, f.employees[0]));
    expect(insights.every((row) => row.withdrawnAt !== null)).toBe(true);
    expect(await finalize(f, c)).not.toBe('finalized');
    const hierarchy = new HierarchyMutationService(database);
    await Promise.all([
      hierarchy.moveEmployee(f.tenantId, f.employees[1], f.unit.id, f.teams[1].id, { type: 'internal_operator', operatorId: 'fixture' }),
      rights.withdraw(withdrawal(f, f.employees[1])),
    ]);
    const [participant] = await db.select().from(schema.surveyReportParticipants).where(and(eq(schema.surveyReportParticipants.tenantId, f.tenantId), eq(schema.surveyReportParticipants.userId, f.employees[1])));
    expect(participant.collectionStoppedAt).not.toBeNull(); expect(participant.originTeamId).toBe(f.teams[0].id);
    // The immutable roster stays twelve; only full denial changes the effective unpublished denominator.
    const overall = opening.scopes.find((scope) => scope.kind === 'manager_overall')!;
    expect(await scopes.scopeDenominator(f.tenantId, overall.id)).toEqual({ denominator: 11, threshold: 9 });
  });

  it('retains full denial and lineage tombstones after analytical retention, and permits account erasure', async () => {
    const f = await fixture(); const opening = await scopes.openOrgNativeCycle(f.openingInput); const c = await confirmed(f);
    expect(await finalize(f, c)).toBe('finalized');
    const [revision] = await db.select().from(schema.surveyReportInsightRevisions).where(eq(schema.surveyReportInsightRevisions.userId, f.employees[0]));
    await rights.withdraw(withdrawal(f, f.employees[0], [revision.lineageId]));
    await rights.withdraw(withdrawal(f, f.employees[0]));
    const future = new Date(Date.now() + 10_000);
    await new RetentionRepository(database, f.tenantId).applyRetention({ tenantId: f.tenantId, now: future, messagesCutoff: future, memoryCutoff: future, riskSignalCutoff: future, auditLogCutoff: future });
    expect(await db.select().from(schema.surveyQuestionInsights).where(eq(schema.surveyQuestionInsights.userId, f.employees[0]))).toHaveLength(0);
    expect(await db.select().from(schema.surveyReportInsightRevisions).where(eq(schema.surveyReportInsightRevisions.userId, f.employees[0]))).toHaveLength(0);
    expect(await db.select().from(schema.surveyReportingLineageExclusions).where(eq(schema.surveyReportingLineageExclusions.userId, f.employees[0]))).toHaveLength(1);
    expect(await legacy.findOrCreateActiveWindow(f.employees[0], f.tenantId)).toEqual({ kind: 'collection_unavailable', reason: 'full_withdrawal' });
    // Existing hierarchy must be removed as part of its independent erasure contract.
    await db.delete(schema.orgEmployeePlacements).where(eq(schema.orgEmployeePlacements.employeePersonId, f.employees[0]));
    const [erasedParticipant] = await db.select().from(schema.surveyReportParticipants).where(eq(schema.surveyReportParticipants.userId, f.employees[0]));
    await db.delete(schema.users).where(eq(schema.users.id, f.employees[0]));
    expect(await db.select().from(schema.surveyReportScopeMemberships).where(eq(schema.surveyReportScopeMemberships.participantId, erasedParticipant.id))).toHaveLength(0);
    expect(await db.select().from(schema.surveyReportParticipants).where(eq(schema.surveyReportParticipants.userId, f.employees[0]))).toHaveLength(0);
    expect(await db.select().from(schema.surveyReportingPermissions).where(eq(schema.surveyReportingPermissions.userId, f.employees[0]))).toHaveLength(0);
    expect((await scopes.openOrgNativeCycle(f.openingInput)).scopes.map((scope) => scope.historyKey)).toEqual(opening.scopes.map((scope) => scope.historyKey));
  });

  it('backfills all historical revisions using metadata, leaves unresolved rows ineligible and honors legacy V2 exclusions', async () => {
    const [tenant] = await db.insert(schema.tenants).values({ name: `RPT02 historical ${randomUUID()}` }).returning(); tenants.push(tenant.id);
    const tenantId = tenant.id;
    const [user] = await db.insert(schema.users).values({ tenantId, consentState: { surveyEnabled: true } }).returning();
    await db.insert(schema.people).values({ id: user.id, tenantId, customerEmployeeId: user.id, workEmail: `${user.id}@fixture.invalid`, displayName: 'Historical', primaryRole: 'employee', pulseParticipant: true });
    const [definition] = await db.insert(schema.surveyDefinitions).values({ tenantId, name: 'Historical V2', version: 'fixture-v2' }).returning();
    const questions = await db.insert(schema.surveyQuestions).values(Object.entries(LEGACY_V2_QUESTION_GROUP_BY_STABLE_KEY).map(([stableKey, questionGroup]) => ({ surveyDefinitionId: definition.id, stableKey, title: stableKey, canonicalMeaning: stableKey, dimension: 'engagement', questionGroup, version: 'fixture-v1' }))).returning();
    const [policy] = await db.insert(schema.surveyScoringPolicies).values({ tenantId, version: 'history-v1', approvedAt: new Date(), rubrics: Object.fromEntries(questions.map((q) => [q.stableKey, { version: 'v1', instructions: 'Synthetic rubric', anchors: [{ score: 0, description: 'low' }, { score: 100, description: 'high' }] }])) }).returning();
    const periodStart = new Date(Date.now() + 10_000); const periodEnd = new Date(periodStart.getTime() + 86_400_000);
    const [window, unresolved] = await db.insert(schema.surveyWindows).values([
      { tenantId, userId: user.id, surveyDefinitionId: definition.id, periodStart, periodEnd },
      { tenantId, userId: user.id, surveyDefinitionId: definition.id, periodStart: new Date(periodEnd.getTime() + 1), periodEnd: new Date(periodEnd.getTime() + 86_400_000), status: 'closed' },
    ]).returning();
    await db.insert(schema.surveyWindowScoringPolicies).values([window, unresolved].map((w) => ({ tenantId, surveyWindowId: w.id, scoringPolicyId: policy.id })));
    const insight = { tenantId, userId: user.id, surveyWindowId: window.id, surveyDefinitionId: definition.id, surveyQuestionId: questions[0].id, questionVersion: questions[0].version, questionGroup: questions[0].questionGroup, deidentifiedSummary: 'Historical synthetic deidentified meaning', score: '50', signalDirection: 'mixed', signalSeverity: 'low', rootCauseCategory: 'clarity', confidence: '0.8', scoringPolicyVersion: policy.version, questionRubricVersion: 'v1', modelId: 'synthetic', promptVersion: 'v1', privacyPolicyVersion: 'v1', confirmedAt: new Date(periodStart.getTime() + 10), scoredAt: new Date() };
    const inserted = await db.insert(schema.surveyQuestionInsights).values([
      { ...insight, isCurrent: false, withdrawnAt: new Date() }, { ...insight }, { ...insight, surveyWindowId: unresolved.id },
    ]).returning({ id: schema.surveyQuestionInsights.id });
    // These surviving revisions predate the cycle metadata, matching the migration's backfill case.
    expect(await db.select().from(schema.surveyReportInsightRevisions).where(eq(schema.surveyReportInsightRevisions.tenantId, tenantId))).toHaveLength(0);
    await db.insert(schema.surveyCycleScoringPolicies).values({ tenantId, surveyDefinitionId: definition.id, periodStart, periodEnd, scoringPolicyId: policy.id });
    const [counts] = await client`select * from pulse_report_backfill_lineages(${tenantId}::uuid)`;
    expect(counts).toEqual({ resolved: 2, unresolved: 1 });
    const revisions = await db.select().from(schema.surveyReportInsightRevisions).where(eq(schema.surveyReportInsightRevisions.tenantId, tenantId));
    expect(new Set(revisions.map((row) => row.lineageId)).size).toBe(1);
    expect(revisions.every((row) => row.proofStatus === 'unverified_historical' && row.acceptedSourceReceipts === null)).toBe(true);
    const request = { tenantId, userId: user.id, personId: user.id, requestId: randomUUID(), provenance: { kind: 'verified_subject' as const, tenantId, userId: user.id, personId: user.id, verificationId: randomUUID(), receivedAt: new Date() }, target: { kind: 'partial_reporting' as const, lineageIds: [revisions[0].lineageId] } };
    await rights.withdraw(request);
    const surviving = await db.select().from(schema.surveyQuestionInsights).where(and(eq(schema.surveyQuestionInsights.tenantId, tenantId), inArray(schema.surveyQuestionInsights.id, inserted.slice(0, 2).map((row) => row.id))));
    expect(surviving.every((row) => row.withdrawnAt !== null)).toBe(true);
    await expect(db.insert(schema.surveyQuestionInsights).values({ ...insight, isCurrent: false })).rejects.toThrow('pulse_report_finalization_excluded');
    await expect(db.update(schema.surveyQuestionInsights).set({ withdrawnAt: null }).where(eq(schema.surveyQuestionInsights.id, inserted[0].id))).rejects.toThrow('pulse_report_withdrawal_immutable');
  });


  it('keeps delivered/attempted/unknown snapshot bytes and cancels only unattempted pending snapshots', async () => {
    const f = await fixture(); const opening = await scopes.openOrgNativeCycle(f.openingInput); const c = await confirmed(f);
    expect(await finalize(f, c)).toBe('finalized');
    const [insight] = await db.select().from(schema.surveyQuestionInsights).where(eq(schema.surveyQuestionInsights.userId, f.employees[0]));
    const [team] = await db.insert(schema.teams).values({ tenantId: f.tenantId, name: 'Historical pilot snapshot team' }).returning();
    const [cohort] = await db.insert(schema.surveyReportingCohorts).values({ tenantId: f.tenantId, teamId: team.id, surveyDefinitionId: f.definition.id,
      periodStart: new Date(f.openingInput.periodStart.getTime() - 172_800_000), periodEnd: new Date(f.openingInput.periodStart.getTime() - 86_400_000), rosterUserIds: f.employees, openedAt: new Date(f.openingInput.periodStart.getTime() - 172_800_000) }).returning();
    const snapshots = await db.insert(schema.surveyV2ReportSnapshots).values([
      { status: 'delivered', deliveryAttemptedAt: new Date(), slackExternalMessageId: 'synthetic-delivered' },
      { status: 'pending', deliveryAttemptedAt: new Date() },
      { status: 'delivery_unknown', deliveryAttemptedAt: new Date(), failureReason: 'delivery_unknown' },
      { status: 'pending', failureReason: 'delivery_unknown' },
      { status: 'pending' },
    ].map((state, index) => ({ tenantId: f.tenantId, teamId: team.id, reportingCohortId: cohort.id, questionGroup: 'autonomy', reportKind: 'intermediate', snapshotVersion: index + 1, managerPayload: { synthetic: index }, contributorUserIds: [f.employees[0]], sourceQuestionInsightIds: [insight.id], policyVersion: 'fixture-v1', calculationVersion: 'fixture-v1', ...state }))).returning();
    const [revision] = await db.select().from(schema.surveyReportInsightRevisions).where(eq(schema.surveyReportInsightRevisions.insightId, insight.id));
    await rights.withdraw(withdrawal(f, f.employees[0], [revision.lineageId]));
    const after = await db.select().from(schema.surveyV2ReportSnapshots).where(eq(schema.surveyV2ReportSnapshots.tenantId, f.tenantId));
    for (const prior of snapshots.slice(0, 4)) expect(JSON.stringify(after.find((row) => row.id === prior.id))).toBe(JSON.stringify(prior));
    expect(after.find((row) => row.id === snapshots[4].id)?.status).toBe('cancelled');
    const overall = opening.scopes.find((scope) => scope.kind === 'manager_overall')!;
    await rights.withdraw(withdrawal(f, f.leads[0])); await rights.withdraw(withdrawal(f, f.leads[1]));
    expect(await scopes.scopeDenominator(f.tenantId, overall.id)).toEqual({ denominator: 10, threshold: 8 });
    await rights.withdraw(withdrawal(f, f.employees[0])); await rights.withdraw(withdrawal(f, f.employees[1]));
    expect(await scopes.scopeDenominator(f.tenantId, overall.id)).toEqual({ denominator: 8, threshold: 7 });
    expect(await db.select().from(schema.surveyReportScopeMemberships).where(eq(schema.surveyReportScopeMemberships.scopeId, overall.id))).toHaveLength(12);
  });

  it('excludes only the requested question while other confirmed meanings in that topic finalize', async () => {
    const f = await fixture(); await scopes.openOrgNativeCycle(f.openingInput); const c = await confirmed(f);
    const [lineage] = await db.select().from(schema.surveyReportQuestionLineages).where(and(eq(schema.surveyReportQuestionLineages.userId, f.employees[0]), eq(schema.surveyReportQuestionLineages.surveyQuestionId, c.question.id)));
    await rights.withdraw(withdrawal(f, f.employees[0], [lineage.id]));
    const others = await db.select().from(schema.surveyQuestionWorkingInsights).where(and(eq(schema.surveyQuestionWorkingInsights.surveyWindowId, c.window.id), eq(schema.surveyQuestionWorkingInsights.status, 'confirmed')));
    let finalized = 0;
    for (const working of others) {
      const question = f.questions.find((q) => q.id === working.surveyQuestionId)!;
      if (await finalize(f, { ...c, working, question }) === 'finalized') finalized++;
    }
    expect(finalized).toBe(2);
    expect(await db.select().from(schema.surveyQuestionInsights).where(eq(schema.surveyQuestionInsights.userId, f.employees[0]))).toHaveLength(2);
  });


  it('atomically stops an entire transferred Unit without rewriting destination audiences', async () => {
    const f = await fixture();
    const [manager] = await db.insert(schema.users).values({ tenantId: f.tenantId }).returning();
    await db.insert(schema.people).values({ id: manager.id, tenantId: f.tenantId, customerEmployeeId: manager.id, workEmail: `${manager.id}@fixture.invalid`, displayName: 'Target manager', primaryRole: 'manager', pulseParticipant: false, lifecycleStatus: 'active' });
    const [target] = await db.insert(schema.orgUnits).values({ tenantId: f.tenantId, customerUnitKey: 'target', name: 'Target Unit', managerPersonId: manager.id, lifecycleStatus: 'active' }).returning();
    await db.update(schema.orgEmployeePlacements).set({ unitId: target.id }).where(eq(schema.orgEmployeePlacements.employeePersonId, f.unitOnly));
    const opening = await scopes.openOrgNativeCycle(f.openingInput);
    const deactivation = new HierarchyDeactivationService(database);
    await deactivation.transferAndDeactivateUnit(f.tenantId, f.unit.id, target.id, 'deactivate', { type: 'internal_operator', operatorId: 'fixture' });
    const participants = await db.select().from(schema.surveyReportParticipants).where(eq(schema.surveyReportParticipants.tenantId, f.tenantId));
    expect(participants).toHaveLength(12);
    expect(participants.every((row) => row.originUnitId === f.unit.id && row.collectionStoppedAt !== null && row.collectionStopCause === 'unit_changed')).toBe(true);
    const replay = await scopes.openOrgNativeCycle(f.openingInput);
    expect(replay).toEqual(opening);
    expect(replay.scopes.find((scope) => scope.kind === 'manager_overall' && scope.orgUnitId === target.id)?.participantUserIds).toHaveLength(0);
    expect(await legacy.findOrCreateActiveWindow(f.employees[0], f.tenantId)).toEqual({ kind: 'collection_unavailable', reason: 'stopped' });
  });

  it('rejects post-stop confirmation and missing source proof without editing immutable receipt clocks',async()=>{
    const f=await fixture();await scopes.openOrgNativeCycle(f.openingInput);const c=await confirmed(f,f.employees[0],true);await new HierarchyMutationService(database).moveEmployee(f.tenantId,f.employees[0],f.unit.id,f.teams[1].id,{type:'internal_operator',operatorId:'fixture'});const [late]=await db.insert(schema.messages).values({tenantId:f.tenantId,userId:f.employees[0],conversationId:c.conversation.id,direction:'inbound',senderType:'user',text:'agree',occurredAt:c.confirmation.occurredAt}).returning();
    expect(await questionsRepo.applyQuestionBundleVerdict({tenantId:f.tenantId,userId:f.employees[0],conversationId:c.conversation.id,inboundMessageId:late.id,bundleId:c.bundleId,verdict:{kind:'agree'}})).toEqual({kind:'collection_unavailable',reason:'stopped'});
    const other=await fixture();await scopes.openOrgNativeCycle(other.openingInput);const timely=await confirmed(other);await db.delete(schema.messages).where(eq(schema.messages.id,timely.source.id));expect(await finalize(other,timely)).toBe('stale');expect(await db.select().from(schema.surveyQuestionInsights).where(eq(schema.surveyQuestionInsights.userId,other.employees[0]))).toHaveLength(0);
  });

  it.each(['agree', 'partial'] as const)('settles an excluded shown component while confirming surviving siblings from %s original verdict', async (kind) => {
    const f = await fixture(); await scopes.openOrgNativeCycle(f.openingInput); const c = await confirmed(f, f.employees[0], true);
    const [lineage] = await db.select().from(schema.surveyReportQuestionLineages).where(and(eq(schema.surveyReportQuestionLineages.userId, f.employees[0]), eq(schema.surveyReportQuestionLineages.surveyQuestionId, c.question.id)));
    const [before] = await db.select().from(schema.surveyQuestionConfirmationBundles).where(eq(schema.surveyQuestionConfirmationBundles.id, c.bundleId));
    await rights.withdraw(withdrawal(f, f.employees[0], [lineage.id]));
    const [after] = await db.select().from(schema.surveyQuestionConfirmationBundles).where(eq(schema.surveyQuestionConfirmationBundles.id, c.bundleId));
    expect(after.displayedText).toBe(before.displayedText); expect(after.components).toEqual(before.components); expect(after.promptMessageId).toBe(before.promptMessageId);
    const awaiting = await questionsRepo.findAwaitingQuestionBundle({ tenantId: f.tenantId, userId: f.employees[0], conversationId: c.conversation.id, inboundMessageId: c.confirmation.id });
    expect(awaiting?.components).toHaveLength(3);
    expect(awaiting?.displayedText).toBe(before.displayedText);
    expect(awaiting?.components.map((component) => component.statement)).toEqual((before.components as Array<{ statement: string }>).map((component) => component.statement));
    expect(awaiting?.components.map((component) => component.surveyQuestionId)).toEqual((before.components as Array<{ surveyQuestionId: string }>).map((component) => component.surveyQuestionId));
    expect(await questionsRepo.applyQuestionBundleVerdict({ tenantId: f.tenantId, userId: f.employees[0], conversationId: c.conversation.id, inboundMessageId: c.confirmation.id, bundleId: c.bundleId, verdict: kind === 'agree' ? { kind: 'agree' } : { kind: 'partial', acceptedQuestionIds: f.questions.filter((q) => q.questionGroup === 'autonomy').map((q) => q.id), disputedQuestionIds: [], declinedQuestionIds: [] } })).toBe(true);
    const working = await db.select().from(schema.surveyQuestionWorkingInsights).where(eq(schema.surveyQuestionWorkingInsights.surveyWindowId, c.window.id));
    expect(working.find((row) => row.surveyQuestionId === c.question.id)?.status).toBe('no_data');
    expect(working.filter((row) => row.status === 'confirmed')).toHaveLength(2);
  });

  it('closes a wholly excluded shown bundle while preserving its original display and delivery identity', async () => {
    const f = await fixture(); await scopes.openOrgNativeCycle(f.openingInput); const c = await confirmed(f, f.employees[0], true);
    const [before] = await db.select().from(schema.surveyQuestionConfirmationBundles).where(eq(schema.surveyQuestionConfirmationBundles.id, c.bundleId));
    const lineageIds = (await db.select().from(schema.surveyReportQuestionLineages).where(and(eq(schema.surveyReportQuestionLineages.userId, f.employees[0]), inArray(schema.surveyReportQuestionLineages.surveyQuestionId, f.questions.filter((q) => q.questionGroup === 'autonomy').map((q) => q.id))))).map((row) => row.id);
    await rights.withdraw(withdrawal(f, f.employees[0], lineageIds));
    const [after] = await db.select().from(schema.surveyQuestionConfirmationBundles).where(eq(schema.surveyQuestionConfirmationBundles.id, c.bundleId));
    expect(after).toEqual({ ...before, status: 'resolved' });
    expect(await questionsRepo.findAwaitingQuestionBundle({ tenantId: f.tenantId, userId: f.employees[0], conversationId: c.conversation.id, inboundMessageId: c.confirmation.id })).toBeNull();
    expect((await db.select().from(schema.surveyQuestionWorkingInsights).where(eq(schema.surveyQuestionWorkingInsights.surveyWindowId, c.window.id))).every((row) => row.status === 'no_data')).toBe(true);
  });

  it('settles an excluded pending clarification without blocking unrelated ready meanings', async () => {
    const f = await fixture(); await scopes.openOrgNativeCycle(f.openingInput); const c = await confirmed(f, f.employees[0], true);
    const siblings = f.questions.filter((q) => q.questionGroup === 'autonomy' && q.id !== c.question.id);
    expect(await questionsRepo.applyQuestionBundleVerdict({ tenantId: f.tenantId, userId: f.employees[0], conversationId: c.conversation.id, inboundMessageId: c.confirmation.id, bundleId: c.bundleId,
      verdict: { kind: 'partial', acceptedQuestionIds: siblings.map((q) => q.id), disputedQuestionIds: [c.question.id], declinedQuestionIds: [] } })).toBe(true);
    const [lineage] = await db.select().from(schema.surveyReportQuestionLineages).where(and(eq(schema.surveyReportQuestionLineages.userId, f.employees[0]), eq(schema.surveyReportQuestionLineages.surveyQuestionId, c.question.id)));
    await rights.withdraw(withdrawal(f, f.employees[0], [lineage.id]));
    const growth = f.questions.filter((q) => q.questionGroup === 'growth');
    for (const q of growth) expect(await questionsRepo.captureMeaning({ tenantId: f.tenantId, userId: f.employees[0], conversationId: c.conversation.id, surveyWindowId: c.window.id, surveyQuestionId: q.id, questionVersion: q.version, sourceMessageId: c.source.id, meaning: `Growth ${q.stableKey}`, sufficientMeaning: true, driverCaptured: true, driverDeclined: false })).toBe('captured');
    expect((await questionsRepo.findReadyQuestionBundle({ tenantId: f.tenantId, userId: f.employees[0] }))?.questionGroup).toBe('growth');
  });

  it('uses receivedAt consistently for a new driver decline despite an older source provider clock in the future', async () => {
    const f = await fixture(); await scopes.openOrgNativeCycle(f.openingInput); const c = await confirmed(f);
    const q = f.questions.find((item) => item.questionGroup === 'growth')!;
    const [source, decline] = await db.insert(schema.messages).values([
      { tenantId: f.tenantId, userId: f.employees[0], conversationId: c.conversation.id, direction: 'inbound', senderType: 'user', text: 'status', occurredAt: new Date(f.openingInput.periodEnd.getTime() + 1000), receivedAt: new Date() },
      { tenantId: f.tenantId, userId: f.employees[0], conversationId: c.conversation.id, direction: 'inbound', senderType: 'user', text: 'prefer not to explain', occurredAt: f.openingInput.periodStart, receivedAt: new Date(Date.now() + 10) },
    ]).returning();
    expect(await questionsRepo.captureMeaning({ tenantId: f.tenantId, userId: f.employees[0], conversationId: c.conversation.id, surveyWindowId: c.window.id, surveyQuestionId: q.id, questionVersion: q.version, sourceMessageId: source.id, meaning: 'status only', sufficientMeaning: true, driverCaptured: false, driverDeclined: false })).toBe('captured');
    expect(await questionsRepo.recordDriverDeclined({ tenantId: f.tenantId, userId: f.employees[0], conversationId: c.conversation.id, surveyWindowId: c.window.id, surveyQuestionId: q.id, questionVersion: q.version, sourceMessageId: decline.id })).toBe(true);
  });

  it('returns typed denial for staged clarification work settled by a concurrent lineage withdrawal', async () => {
    const f = await fixture(); await scopes.openOrgNativeCycle(f.openingInput); const c = await confirmed(f, f.employees[0], true);
    const siblings = f.questions.filter((q) => q.questionGroup === 'autonomy' && q.id !== c.question.id);
    expect(await questionsRepo.applyQuestionBundleVerdict({ tenantId: f.tenantId, userId: f.employees[0], conversationId: c.conversation.id, inboundMessageId: c.confirmation.id, bundleId: c.bundleId, verdict: { kind: 'partial', acceptedQuestionIds: siblings.map((q) => q.id), disputedQuestionIds: [c.question.id], declinedQuestionIds: [] } })).toBe(true);
    const [prompt] = await db.insert(schema.messages).values({ tenantId: f.tenantId, userId: f.employees[0], conversationId: c.conversation.id, direction: 'outbound', senderType: 'assistant', text: 'What part should change?', occurredAt: new Date() }).returning();
    const clarification = { tenantId: f.tenantId, userId: f.employees[0], conversationId: c.conversation.id, workingInsightId: c.working.id, promptMessageId: prompt.id, displayedText: prompt.text };
    expect(await questionsRepo.stageQuestionClarificationPrompt(clarification)).toBe(true);
    const [lineage] = await db.select().from(schema.surveyReportQuestionLineages).where(and(eq(schema.surveyReportQuestionLineages.userId, f.employees[0]), eq(schema.surveyReportQuestionLineages.surveyQuestionId, c.question.id)));
    await rights.withdraw(withdrawal(f, f.employees[0], [lineage.id]));
    const results = await Promise.all([
      questionsRepo.stageQuestionClarificationPrompt(clarification),
      questionsRepo.applyQuestionClarificationVerdict({ ...clarification, inboundMessageId: c.confirmation.id, verdict: { kind: 'clarified', correctedSummary: 'Corrected synthetic meaning.' } }),
    ]);
    expect(results).toEqual([{ kind: 'collection_unavailable', reason: 'lineage_excluded' }, { kind: 'collection_unavailable', reason: 'lineage_excluded' }]);
    expect(await questionsRepo.stageQuestionClarificationPrompt({ ...clarification, userId: f.employees[1] })).toBe(false);
    expect(await questionsRepo.applyQuestionClarificationVerdict({ ...clarification, userId: f.employees[1], inboundMessageId: c.confirmation.id, verdict: { kind: 'declined' } })).toBe(false);
  });

  it.each(['bundle', 'clarification'] as const)('reopens native %s decline using receipt order despite a future provider clock', async (kind) => {
    const f = await fixture(); await scopes.openOrgNativeCycle(f.openingInput); const c = await confirmed(f, f.employees[0], true);
    const group = f.questions.filter((q) => q.questionGroup === 'autonomy');
    const input = { tenantId: f.tenantId, userId: f.employees[0], conversationId: c.conversation.id };
    if (kind === 'bundle') {
      await db.update(schema.messages).set({ occurredAt: new Date(f.openingInput.periodEnd.getTime() + 1000) }).where(eq(schema.messages.id, c.confirmation.id));
      expect(await questionsRepo.applyQuestionBundleVerdict({ ...input, inboundMessageId: c.confirmation.id, bundleId: c.bundleId, verdict: { kind: 'partial', acceptedQuestionIds: [], disputedQuestionIds: [], declinedQuestionIds: group.map((q) => q.id) } })).toBe(true);
    } else {
      expect(await questionsRepo.applyQuestionBundleVerdict({ ...input, inboundMessageId: c.confirmation.id, bundleId: c.bundleId, verdict: { kind: 'partial', acceptedQuestionIds: group.filter((q) => q.id !== c.question.id).map((q) => q.id), disputedQuestionIds: [c.question.id], declinedQuestionIds: [] } })).toBe(true);
      const [prompt] = await db.insert(schema.messages).values({ ...input, direction: 'outbound', senderType: 'assistant', text: 'What part should change?', occurredAt: new Date() }).returning();
      expect(await questionsRepo.stageQuestionClarificationPrompt({ ...input, workingInsightId: c.working.id, promptMessageId: prompt.id, displayedText: prompt.text })).toBe(true);
      const sentAt = new Date(); await db.update(schema.messages).set({ sentAt }).where(eq(schema.messages.id, prompt.id));
      const [decline] = await db.insert(schema.messages).values({ ...input, direction: 'inbound', senderType: 'user', text: 'Skip that.', occurredAt: new Date(f.openingInput.periodEnd.getTime() + 1000), receivedAt: new Date(sentAt.getTime() + 1) }).returning();
      expect(await questionsRepo.applyQuestionClarificationVerdict({ ...input, workingInsightId: c.working.id, inboundMessageId: decline.id, verdict: { kind: 'declined' } })).toBe(true);
    }
    const [reopen] = await db.insert(schema.messages).values({ ...input, direction: 'inbound', senderType: 'user', text: 'I want to revisit that.', occurredAt: f.openingInput.periodStart, receivedAt: new Date(Date.now() + 50) }).returning();
    expect(await questionsRepo.reopenDeclinedQuestion({ ...input, surveyWindowId: c.window.id, surveyQuestionId: c.question.id, questionVersion: c.question.version, sourceMessageId: reopen.id })).toBe(true);
    expect((await db.select().from(schema.surveyQuestionWorkingInsights).where(eq(schema.surveyQuestionWorkingInsights.id, c.working.id)))[0].status).toBe('reset');
  });

  it('uses durable confirmation receipt to order a correction rather than its future provider confirmedAt', async () => {
    const f = await fixture(); await scopes.openOrgNativeCycle(f.openingInput); let c = await confirmed(f);
    const futureProviderTime = new Date(f.openingInput.periodEnd.getTime() + 1000);
    await db.update(schema.messages).set({ occurredAt: futureProviderTime }).where(eq(schema.messages.id, c.confirmation.id));
    await db.update(schema.surveyQuestionWorkingInsights).set({ confirmedAt: futureProviderTime }).where(eq(schema.surveyQuestionWorkingInsights.id, c.working.id));
    c = { ...c, working: { ...c.working, confirmedAt: futureProviderTime } };
    expect(await finalize(f, c)).toBe('finalized');
    const [correction] = await db.insert(schema.messages).values({ tenantId: f.tenantId, userId: f.employees[0], conversationId: c.conversation.id, direction: 'inbound', senderType: 'user', text: 'corrected status', occurredAt: f.openingInput.periodStart, receivedAt: new Date(Date.now() + 10) }).returning();
    expect(await questionsRepo.captureMeaning({ tenantId: f.tenantId, userId: f.employees[0], conversationId: c.conversation.id, surveyWindowId: c.window.id, surveyQuestionId: c.question.id, questionVersion: c.question.version, sourceMessageId: correction.id, meaning: 'corrected status', sufficientMeaning: true, driverCaptured: true, driverDeclined: false })).toBe('captured');
  });

});
