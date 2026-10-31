import {acceptanceCalendarClose,isPrivateAcceptanceSql,orderedAcceptanceClosers} from '../../../../scripts/pulse-report-acceptance-evidence';
import { randomUUID } from 'node:crypto';
import {AsyncLocalStorage} from 'node:async_hooks';
import { Queue, QueueEvents, Worker } from 'bullmq';
import Redis from 'ioredis';
import { encryptField } from '@entalent/crypto-utils';
import { ConversationOrchestrator, CaptureEngagementAnswerUseCase, PulseBacklogService,
  ProactiveCheckInUseCase, SurveyEvidenceExtractionUseCase, FinalizeQuestionInsightUseCase,
  FEATURE_FLAGS, PreparePulseLanguageUseCase } from '@entalent/application';
import { PULSE_ENGLISH_RESOURCES, type PulseResourceKind } from '@entalent/contracts';
import { ConversationProcessor } from '../../../../apps/worker/src/conversation/conversation.processor';
import { MessageSendProcessor } from '../../../../apps/worker/src/message-send/message-send.processor';
import { SurveyEvidenceProcessor } from '../../../../apps/worker/src/survey/survey-evidence.processor';
import { QuestionInsightRepository } from '../../../../apps/worker/src/survey/repositories/question-insight.repository';
import { PulseBacklogRepository } from '../../../../apps/worker/src/survey/repositories/pulse-backlog.repository';
import { SurveyEvidenceIntentRepository } from '../../../../apps/worker/src/survey/repositories/survey-evidence-intent.repository';
import { PulseReportProgressRepository } from '../../../../apps/worker/src/survey/repositories/pulse-report-progress.repository';
import { PulseLanguageRepository } from '../../../../apps/worker/src/survey/repositories/pulse-language.repository';
import { FeatureFlagRepository } from '../../../../apps/worker/src/feature-flags/feature-flag.repository';
import { WorkspaceConnectionRepository } from '../../../../apps/worker/src/conversation/repositories/workspace-connection.repository';
import { LlmRunRepository } from '../../../../apps/worker/src/conversation/llm-run.repository';
import { OutboxService } from '../../../../apps/worker/src/conversation/outbox.service';
import { IngestionService } from '../../../../apps/api/src/channel/ingestion.service';
import { EventIdempotencyService } from '../../../../apps/api/src/channel/event-idempotency.service';
import { SlackIngestService } from '../../../../apps/api/src/channel/slack-ingest.service';
import { BuildPulseReportUseCase, FormPulseReportUseCase } from '@entalent/application';
import { ExpireQuestionInsightsAtCutoffUseCase, RecoverConfirmedQuestionInsightsUseCase } from '@entalent/application';
import { QuestionCutoffProcessor } from '../../../../apps/worker/src/survey/question-cutoff.processor';
import type { PulseLabels, PulseNarrativeRequest } from '@entalent/contracts';
import { PulseReportLifecycleRepository } from '../../../../apps/worker/src/survey/repositories/pulse-report-lifecycle.repository';
import { PulseReportPresentationRepository } from '../../../../apps/worker/src/survey/repositories/pulse-report-presentation.repository';
import { PulseReportHistoryRepository } from '../../../../apps/worker/src/survey/repositories/pulse-report-history.repository';
import { PulseReportRecipientRepository } from '../../../../apps/worker/src/survey/repositories/pulse-report-recipient.repository';
import { PulseReportSnapshotRepository } from '../../../../apps/worker/src/survey/repositories/pulse-report-snapshot.repository';
import { PulseReportDeliveryRepository } from '../../../../apps/worker/src/survey/repositories/pulse-report-delivery.repository';
import { PulseReportDeliveryService } from '../../../../apps/worker/src/survey/pulse-report-delivery.service';
import { PulseReportLifecycleScheduler } from '../../../../apps/worker/src/survey/pulse-report-lifecycle.scheduler';
import { PulseReportLifecycleProcessor } from '../../../../apps/worker/src/survey/pulse-report-lifecycle.processor';
import { readFileSync,mkdirSync,writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { eq,sql as nativeQuery } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { createDbClient } from '../client';
import * as schema from '../schema';
import { reserveFixtureCycle, waitForDbTime } from './pulse-report-inputs.fixture';
import { installV2SurveyDefinition } from '../../../../scripts/install-v2-survey-definition';
import { prepareReportEngagementDefinition } from '../../../../scripts/prepare-report-engagement-definition';
import { PulseReportScopeRepository } from '../../../../apps/worker/src/survey/repositories/pulse-report-scope.repository';
import { SurveyRepository } from '../../../../apps/worker/src/survey/repositories/survey.repository';
import { EngagementAnswerRepository } from '../../../../apps/worker/src/survey/repositories/engagement-answer.repository';
import { ConversationRepository } from '../../../../apps/worker/src/conversation/repositories/conversation.repository';
import { PulseReportFinalScheduleRepository } from '../../../../apps/worker/src/survey/repositories/pulse-report-final-schedule.repository';
import { PulseReportInputRepository } from '../../../../apps/worker/src/survey/repositories/pulse-report-input.repository';
import { PulseReportSettlementRepository } from '../../../../apps/worker/src/survey/repositories/pulse-report-settlement.repository';
import { PreparePulseReportInputsUseCase } from '@entalent/application';
import { ReportConfigurationService } from '../../../../apps/api/src/report-configuration/report-configuration.service';
import { DatabaseService } from '../../../../apps/worker/src/database/database.service';
import { TeamRepository } from '../../../../apps/worker/src/survey/repositories/team.repository';
import { GroupStateRepository } from '../../../../apps/worker/src/survey/repositories/group-state.repository';

let acceptanceProviderReceiptCounter=0;

export async function closeAcceptanceResources(closers:readonly (()=>Promise<unknown>)[]){
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{
    const outcomes=await Promise.race([orderedAcceptanceClosers(closers),new Promise<never>((_resolve,reject)=>{
      timer=setTimeout(()=>{
        if(process.env.RPT08_OUTPUT_DIR){mkdirSync(process.env.RPT08_OUTPUT_DIR,{recursive:true});writeFileSync(resolve(process.env.RPT08_OUTPUT_DIR,'cleanup-failure.json'),JSON.stringify({runId:process.env.RPT08_RUN_ID,sourceHash:process.env.RPT08_SOURCE_HASH,status:'failed',reason:'owned_handle_shutdown_timeout'}),{mode:0o600});}
        reject(Error('acceptance_cleanup_timeout'));
      },12_000);
    })]);
    if(outcomes.some(outcome=>outcome.status==='rejected'))throw Error('acceptance_cleanup_failed');
  }finally{clearTimeout(timer);}
}

export function acceptanceSeedSuite() {
  const url = process.env.DATABASE_URL!,
    client = createDbClient(url),
    db = client.db,
    raw = client.sql,
    database = new DatabaseService({ get: () => url } as never);
  database.onModuleInit();
  const scopes = new PulseReportScopeRepository(database),
    survey = new SurveyRepository(
      database,
      new GroupStateRepository(database),
      new TeamRepository(database),
    ),
    capture = new EngagementAnswerRepository(database),
    conversation = new ConversationRepository(database),
    timing = new PulseReportFinalScheduleRepository(database),
    settlement = new PulseReportSettlementRepository(database),
    inputs = new PreparePulseReportInputsUseCase(new PulseReportInputRepository(database));
  async function fixture(count = 6, durationDays = 8, teamCount = 1, createWindows = true) {
    const calendarClose=acceptanceCalendarClose(Date.now(),durationDays);
    const target=new URL(url),runId=process.env.RPT08_RUN_ID;
    if(process.env.PULSE_ACCEPTANCE_OPT_IN!=='local-synthetic'||!runId
      ||!['127.0.0.1','localhost'].includes(target.hostname)||!target.port
      ||!target.pathname.startsWith('/entalent_rpt08_'+runId+'_'))throw Error('acceptance_owned_target_required');
    const owner=await raw`select run_id,owner_nonce,source_hash,queue_prefix from rpt08_acceptance.owner`;
    if(owner.length!==1||owner[0]!.run_id!==runId||(process.env.RPT08_OWNER_NONCE&&owner[0]!.owner_nonce!==process.env.RPT08_OWNER_NONCE)||(process.env.RPT08_SOURCE_HASH&&owner[0]!.source_hash!==process.env.RPT08_SOURCE_HASH))throw Error('acceptance_database_owner_mismatch');
    const foreign=await raw`select t.id from tenants t left join rpt08_acceptance.fixtures f on f.tenant_id=t.id and f.run_id=${runId} where f.tenant_id is null limit 1`;
    if(foreign.length)throw Error('acceptance_foreign_tenant_inventory');
    const [tenant] = await db
      .insert(schema.tenants)
      .values({ name: 'RPT08-synthetic ' + randomUUID(), timezone: 'UTC', locale: 'en' })
      .returning();
    const tenantId = tenant.id;
    await raw`insert into rpt08_acceptance.fixtures values(${tenantId},${runId},'native_connected')`;
    await new ReportConfigurationService(database as never).saveCalendar(
      tenantId,
      { timezone: 'UTC', workingDays: [1, 2, 3, 4, 5, 6, 7], workStart: '00:00', workEnd: calendarClose.toISOString().slice(11,16) },
      'fixture',
      0,
    );
    await new ReportConfigurationService(database as never).saveLanguage(tenantId,'de',1,
      {type:'internal_operator',operatorId:'synthetic-rpt08'});
    const source = await installV2SurveyDefinition(url, tenantId),
      definitionId = await prepareReportEngagementDefinition(url, tenantId, source);
    await db
      .update(schema.surveyDefinitions)
      .set({ active: true })
      .where(eq(schema.surveyDefinitions.id, definitionId));
    const person = async (role: 'employee' | 'team_lead' | 'manager') => {
      const [u] = await db
        .insert(schema.users)
        .values({ tenantId, consentState: { surveyEnabled: true }, preferredName: 'Synthetic member', timezone: 'UTC', timezoneUpdatedAt: new Date(), locale: 'uk' })
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
      periodEnd: new Date(calendarClose.getTime()+1_000),
    });
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
        .values({ tenantId, userId, channelType: 'slack', externalConversationId: 'D' + userId.replaceAll('-', '') })
        .returning();
      conversations.set(userId, c.id);
    }
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
  return { fixture, db, raw, database, scopes, survey, conversation, timing, settlement, inputs, capture, cleanup: async () => { await database.onModuleDestroy(); await raw.end({timeout: 5}); } };
}

export type AcceptanceSeed = ReturnType<typeof acceptanceSeedSuite>;
export type AcceptanceWorkforce = Awaited<ReturnType<AcceptanceSeed['fixture']>>;

export async function waitAcceptanceDue(seed:AcceptanceSeed,f:AcceptanceWorkforce){
  const deadline=Date.now()+15*60_000;
  while(Date.now()<deadline){
    const [clock]=await seed.raw`select clock_timestamp()>=final_due_at due from survey_report_final_timings where tenant_id=${f.tenantId}`;
    if(clock?.due)return;
    await new Promise((r)=>setTimeout(r,250));
  }
  throw Error('real_calendar_due_timeout');
}

export async function acceptanceNativeDriver(_seed: AcceptanceSeed) {
  const publicationDatabase=new DatabaseService({get:()=>process.env.DATABASE_URL!} as never);
  publicationDatabase.onModuleInit();
  const observation={queries:0,privateReadAttempts:0};
  const slot=publicationDatabase as unknown as {_client:ReturnType<typeof createDbClient>};
  const observe=(query:string)=>{observation.queries++;if(isPrivateAcceptanceSql(query)){observation.privateReadAttempts++;throw Error('publication_private_query_forbidden');}};
  type PublicationSql=ReturnType<typeof createDbClient>['sql'];
  const observedSql=(client:PublicationSql):PublicationSql=>new Proxy(client,{
    apply(target,_receiver,args){if(Array.isArray(args[0])&&typeof args[0][0]==='string')observe(args[0].join(' '));return Reflect.apply(target,target,args);},
    get(target,key,receiver){
      const member=Reflect.get(target,key,receiver);
      if(key==='unsafe')return(query:string,...args:unknown[])=>{observe(query);return Reflect.apply(member,target,[query,...args]);};
      if(key==='begin'||key==='savepoint')return(...args:unknown[])=>Reflect.apply(member,target,args.map(arg=>typeof arg==='function'?(tx:PublicationSql)=>arg(observedSql(tx)):arg));
      return typeof member==='function'?member.bind(target):member;
    },
  });
  slot._client.sql=observedSql(slot._client.sql);
  slot._client.db=drizzle(slot._client.sql,{schema});

  const presentation = new PulseReportPresentationRepository(publicationDatabase);
  const inputs = new PreparePulseReportInputsUseCase(new PulseReportInputRepository(publicationDatabase),
    new PulseReportHistoryRepository(publicationDatabase));
  const schedule = new PulseReportFinalScheduleRepository(publicationDatabase);
  const lifecycle = new PulseReportLifecycleRepository(publicationDatabase, inputs, presentation, schedule);
  const posted: Array<{ tenantId: string; channel: string; body: unknown }> = [];
  let postGate:{tenantId:string;entered:()=>void;release:()=>void;released:Promise<void>}|undefined;
  function holdNextPost(tenantId:string){
    if(postGate)throw Error('acceptance_post_gate_already_held');
    let enter!:()=>void,release!:()=>void;
    const entered=new Promise<void>(resolve=>{enter=resolve;}),released=new Promise<void>(resolve=>{release=resolve;});
    const gate={tenantId,entered:enter,release,released};postGate=gate;
    return {entered,release:()=>{gate.release();if(postGate===gate)postGate=undefined;}};
  }
  const routeOwners = new Map<string,string>();
  let uncertainTenant:string|undefined;
  const transport = {
    prove: async (candidate: { workspaceId: string; slackUserId: string; tenantId: string }) => {
      routeOwners.set('D' + candidate.slackUserId,candidate.tenantId);
      return {...candidate, channelId:'D'+candidate.slackUserId,botUserId:'Bsynthetic',privateDm:true as const};
    },
    post: async (_token: string, channel: string, body: unknown) => {
      posted.push({ tenantId: routeOwners.get(channel) ?? 'unproved', channel, body });
      const gate=postGate;
      if(gate&&gate.tenantId===routeOwners.get(channel)){gate.entered();await gate.released;}
      if(uncertainTenant&&routeOwners.get(channel)===uncertainTenant)return {status:'unknown' as const,reason:'timeout' as const};
      return { status: 'accepted' as const, channel, timestamp: '1793350000.' + String(++acceptanceProviderReceiptCounter).padStart(6, '0') };
    },
  };
  const recipients = new PulseReportRecipientRepository(publicationDatabase,
    () => JSON.stringify({ botToken: 'synthetic-only' }));
  const snapshots = new PulseReportSnapshotRepository(publicationDatabase, presentation, recipients, transport);
  const delivery = new PulseReportDeliveryRepository(publicationDatabase, presentation, recipients, transport, true);
  const narrativeInputs: PulseNarrativeRequest[] = [];
  const publicationJobs=new AsyncLocalStorage<string>(),narrativeTenants:string[]=[];
  const narrative = {
    async draft(input: PulseNarrativeRequest) {
      narrativeInputs.push(input);narrativeTenants.push(publicationJobs.getStore()??'direct-test');
      return { explanation: [{ text: 'Beschäftigte beschreiben Entscheidungsfreiheit bei ihren Arbeitsmethoden und die gemeinsame Abstimmung im Team. '.repeat(9),
        references: [input.evidence[0]!.handle] }], focus: { kind: 'none_supported' }, actions: [] };
    },
    review: async () => ({ verdict: 'pass', violations: [] }),
    localize: async (_locale: string, _meanings: PulseLabels) => ({ ...ACCEPTANCE_GERMAN_LABELS }),
    reviewLabels: async () => ({ verdict: 'pass', violations: [] }),
  };
  const builder = new BuildPulseReportUseCase(presentation, inputs, narrative, lifecycle);
  const form = new FormPulseReportUseCase(lifecycle, builder, snapshots);
  const processor = new PulseReportLifecycleProcessor(publicationDatabase, form,
    new PulseReportDeliveryService(delivery), true);
  const url = new URL(process.env.REDIS_URL!);
  const connection = { host: url.hostname, port: Number(url.port), db: Number(url.pathname.slice(1)) };
  const queue = new Queue((process.env.RPT08_QUEUE_PREFIX??'rpt08-debug')+'-native-' + randomUUID(), { connection });
  const events = new QueueEvents(queue.name, { connection }); await events.waitUntilReady();
  const worker = new Worker(queue.name, (job) => publicationJobs.run(job.data.tenantId,()=>processor.process(job.data)), { connection });
  const failures: string[] = [];
  worker.on('failed', (_job, error) => failures.push(error.message));
  const scheduler = new PulseReportLifecycleScheduler(lifecycle, queue, true);
  async function tick() {
    const result = await scheduler.runOnce(100);
    const until = Date.now() + 30_000;
    while (Date.now() < until) {
      const counts = await queue.getJobCounts('active', 'waiting', 'delayed');
      if (failures.length) throw Error('native_worker_failed');
      if (counts.active === 0 && counts.waiting === 0 && counts.delayed === 0) return result;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw Error('native_queue_timeout');
  }
  return { lifecycle, presentation, inputs, schedule, recipients, snapshots, delivery, builder,
    form, processor, scheduler, queue, events, worker, narrativeInputs,narrativeTenants, posted, tick, holdNextPost, observation,
    checkTransactionObservation:(query='select id from messages limit 0')=>publicationDatabase.withTransaction(async()=>{await publicationDatabase.client.execute(nativeQuery.raw(query));}),
    checkRawObservation:async(query:string)=>{await slot._client.sql.unsafe(query);},
    makeTransportUncertain(tenantId:string){uncertainTenant=tenantId;},
    async close() { postGate?.release();postGate=undefined;await closeAcceptanceResources([()=>worker.close(),()=>events.close(),()=>queue.close(),()=>publicationDatabase.onModuleDestroy()]); },
  };
}

export const ACCEPTANCE_ORACLES = Object.freeze({
  employeeCount: 10, teamACount: 5, teamBCount: 5, overallCount: 12,
  teamAScore: 60, teamBScore: 80, leaderScores: [90, 30],
  overallNumerator: 820, overallDenominator: 12, overallMean: 68.33333333333333,
  personScores: [60, 80, 70], personMean: 70, engagementAnswers: [6, 8, 10], engagementMean: 8,
});

export const ACCEPTANCE_GERMAN_LABELS: PulseLabels = {
  title_tl_intermediate:'Vorläufiger Bericht für Teamleitungen',title_tl_final:'Abschlussbericht für Teamleitungen',
  title_manager_intermediate:'Vorläufiger Bericht für Führungskräfte',title_manager_final:'Abschlussbericht für Führungskräfte',
  title_insufficient_final:'Abschlussbericht',index_autonomy:'Autonomie',index_growth:'Entwicklung',
  index_purpose:'Sinn',index_belonging:'Zugehörigkeit',engagement:'Engagement',period:'Zeitraum',
  overall_scope:'Gesamtbereich',teams_management:'Teams im Verantwortungsbereich',explanation:'Erläuterung',
  main_focus:'Hauptfokus',actions:'Maßnahmen',state_healthy:'Gesund',state_attention:'Aufmerksamkeit erforderlich',
  state_critical:'Kritisch',direction_improving:'Verbesserung',direction_stable:'Stabil',direction_declining:'Verschlechterung',
  baseline_established:'Ausgangsbasis festgelegt',
  preliminary_notice:'Diese Ergebnisse und Empfehlungen sind vorläufig. Der Abschlussbericht folgt am letzten Arbeitstag des Zyklus.',
  insufficient_data:'Unzureichende Daten',none_supported_problem:'Die verfügbaren Informationen belegen derzeit keinen konkreten Schwerpunkt.',
  none_supported_action:'Die verfügbaren Informationen begründen derzeit keine konkrete Maßnahme.',
  composition_caveat:'Änderungen der Zusammensetzung können den Vergleich beeinflussen.',part:'Teil',continued:'Fortsetzung',
};

/** All persistence and queue adapters are real; provider tape is deliberately synthetic. */
export async function acceptanceEmployeeDriver(seed: AcceptanceSeed, workforce: AcceptanceWorkforce) {
  const db = seed.database, f = workforce;
  const connectionUrl = new URL(process.env.REDIS_URL!);
  const connection = { host: connectionUrl.hostname, port: Number(connectionUrl.port),
    db: Number(connectionUrl.pathname.slice(1)), maxRetriesPerRequest: null };
  const prefix = (process.env.RPT08_QUEUE_PREFIX ?? 'rpt08-' + process.env.RPT08_RUN_ID) + '-employee-' + randomUUID();
  const queues = Array.from({ length: 9 }, (_, i) => new Queue(prefix + '-' + i, { connection }));
  const [conversationQueue, messageQueue, memoryQueue, followupQueue, evidenceQueue,
    groupQueue, styleQueue, profileQueue, onboardingQueue] = queues as [Queue, Queue, Queue, Queue, Queue, Queue, Queue, Queue, Queue];
  const events = await Promise.all(queues.map(async (q) => {
    const value = new QueueEvents(q.name, { connection }); await value.waitUntilReady(); return value;
  }));
  const redis = new Redis(process.env.REDIS_URL!);
  const teams = new TeamRepository(db), groups = new GroupStateRepository(db);
  const questions = new QuestionInsightRepository(db, teams);
  const survey = new SurveyRepository(db, groups, teams);
  const engagement = new CaptureEngagementAnswerUseCase(new EngagementAnswerRepository(db));
  const backlog = new PulseBacklogService(new PulseBacklogRepository(db), survey, questions,
    new EngagementAnswerRepository(db));
  const language = new PulseLanguageRepository(db);
  for (const locale of ['de', 'uk']) for (const [kind, source] of Object.entries(PULSE_ENGLISH_RESOURCES)) {
    await new PreparePulseLanguageUseCase(language, { modelId: 'synthetic-only',
      generate: async () => ({ ...source }), review: async () => ({ semanticPass: true,
        modelId: 'synthetic-review', promptVersion: 'rpt08-v1' }) }).execute({
          locale, kind: kind as PulseResourceKind, source,
        });
  }

  const flags = new FeatureFlagRepository(db);
  const calls: Record<string, number> = {};
  let evidenceFailureBudget=0,scoringFailureBudget=0,expectedBoundaryFailures=0,controlledFailureCount=0,scoreWaitCount=0;
  let scoreGate:Promise<void>|undefined,releaseScoreGate:(()=>void)|undefined;
  const expectedFailedJobIds=new Set<string>();
  const mark = (name: string) => { calls[name] = (calls[name] ?? 0) + 1; };
  const scores = new Map([...f.users, ...f.leadList].map((u, i) => [u,
    i < 5 ? 60 : i < 10 ? 80 : i === 10 ? 90 : 30]));
  const nativeQuestionScore=(userId:string,questionId:string)=>{
    const index=f.questions.filter(question=>question.questionGroup==='autonomy').sort((a,b)=>a.displayOrder-b.displayOrder).findIndex(question=>question.id===questionId);
    if(index<0||index>2)throw Error('acceptance_scoring_question_mismatch');
    return (scores.get(userId)??70)+[-11,2,9][index]!;
  };
  const ai = {
    async detectRisk() { mark('detectRisk'); return { severity: 'none', confidence: .99,
      reasoningSummary: 'synthetic', riskType: null, evidence: [], immediateResponseRequired: false,
      escalationRecommended: false, surveyMustBeBlocked: false, proactiveMessagesMustBePaused: false }; },
    async classifySituation(turns: Array<{ content: string }>) {
      mark('classifySituation'); const text = turns.at(-1)?.content ?? '';
      return { primaryIntent: 'casual_conversation', secondaryIntents: [], emotionalState: [],
        urgency: 'low', confidence: .99, surveyAllowed: true, requiresSafetyCheck: false,
        reasoningSummary: 'synthetic', reminderRequest: null,
        dialogueAct: text.startsWith('Yes') ? 'acknowledgement' : 'new_substance',
        latestUserSubstance: text, topicAnchor: null };
    },
    async composeQuestionBundle(_turns: unknown, requested: Array<{ surveyQuestionId: string; workingSummary: string }>) {
      mark('composeQuestionBundle'); return { text: requested.map((q) => q.workingSummary).join(' ') + ' Is that fair?',
        statements: requested.map((q) => ({ surveyQuestionId: q.surveyQuestionId, statement: q.workingSummary })) };
    },
    async interpretQuestionBundleResponse() { mark('interpretQuestionBundleResponse'); return { kind: 'agree' as const }; },
    async evaluateSurveyEvidence(turns: Array<{ content: string }>, requested: Array<{ id: string; questionGroup: string; stableKey: string }>) {
      mark('evaluateSurveyEvidence');
      if(evidenceFailureBudget>0){evidenceFailureBudget--;expectedBoundaryFailures++;throw Error('synthetic_evidence_boundary_failure');}
      const fresh = turns.at(-1)?.content.startsWith('Synthetic autonomy experience:');
      const selected = requested.filter((q) => f.questions.some((fq) => fq.id === q.id && fq.questionGroup === 'autonomy'));
      return { candidateQuestionIds: selected.map((q) => q.id), voluntaryReopenQuestionIds: turns.at(-1)?.content.includes('Revised')?selected.map(q=>q.id):[],
        evidence: fresh ? selected.map((q) => ({ questionId: q.id,
          evidenceSummary: (q.stableKey.includes('control') ? 'You choose work methods because decisions are delegated. ' : q.stableKey.includes('voice') ? 'Your ideas influence decisions because the team asks for them. ' : 'Expected results are clear because the team explains goals. ') + (turns.at(-1)?.content.match(/[a-f0-9-]{36}/)?.[0] ?? '')+(turns.at(-1)?.content.includes('Revised')?' Revised work decisions are delegated weekly.':''),
          polarity: 'positive' as const, strength: .9, completeness: 1, confidence: .9,
          followUpProbeNeeded: false, thresholdReached: true, assessmentShouldRemainUnknown: false,
          driverCaptured: true })) : [] };
    },
    async generateResponse(_turns: unknown, _strategy: unknown, context: {
      trailingBundle?: { text: string }; topicQuestion?: unknown;
      surveyProbeQuestion?: { id: string; stableKey: string; responseType: string; probeStrategies: string[] };
      proactiveCheckIn?: { probeQuestion?: { id: string; stableKey: string; responseType: string; probeStrategies: string[] } };
      languagePolicy?: { resources?: { engagement?: { texts: Record<string, string> } } };
    }) {
      mark('generateResponse');
      if (context.trailingBundle) return { text: 'I understand.\n\n' + context.trailingBundle.text,
        replyText: 'I understand.', bundleText: context.trailingBundle.text, confidence: .99, containsSurveyProbe: false };
      const probe = context.surveyProbeQuestion ?? context.proactiveCheckIn?.probeQuestion;
      if (probe?.responseType === 'numeric_1_10_integer') {
        const form = context.languagePolicy?.resources?.engagement?.texts[probe.stableKey] ?? probe.probeStrategies[0]!;
        return { text: 'Thank you. ' + form, confidence: .99, containsSurveyProbe: true,
          surveyProbeQuestionId: probe.id };
      }
      if (context.topicQuestion) return { text: 'Thank you. How does that affect your work?', replyText: 'Thank you.',
        topicQuestion: 'How does that affect your work?', confidence: .99, containsSurveyProbe: false };
      return { text: 'Thank you for sharing.', confidence: .99, containsSurveyProbe: false };
    },
  };
  const provider = new Proxy(ai, { get(target, key) {
    if (key in target) return target[key as keyof typeof target];
    throw Error('unexpected_synthetic_provider_method_' + String(key));
  } });
  const outbox = new OutboxService(messageQueue, memoryQueue, followupQueue, evidenceQueue,
    groupQueue, styleQueue, profileQueue);
  const orchestrator = new ConversationOrchestrator(seed.conversation, provider as never, outbox,
    undefined, survey, undefined, undefined, flags, undefined, backlog, undefined, undefined,
    questions, { run: (callback) => db.withTransaction(callback) });
  const checkIn = new ProactiveCheckInUseCase(seed.conversation, provider as never, outbox,
    undefined, backlog, flags);
  const processor = new ConversationProcessor(orchestrator, checkIn, new LlmRunRepository(db),
    db, seed.conversation, survey, conversationQueue, engagement);
  const config = { get: () => process.env.FIELD_ENCRYPTION_KEY! };
  const message = new MessageSendProcessor(new WorkspaceConnectionRepository(db, config as never),
    seed.conversation, groups, undefined as never, undefined as never, questions);
  const makeFinalizer=(repository=questions)=>new FinalizeQuestionInsightUseCase(repository, {
    async scoreConfirmedMeaning(input) {
      mark('scoreConfirmedMeaning');
      if(scoringFailureBudget>0){scoringFailureBudget--;expectedBoundaryFailures++;throw Error('synthetic_scoring_boundary_failure');}
      if(scoreGate){scoreWaitCount++;await scoreGate;}
      const [working] = await seed.raw`select user_id from survey_question_working_insights where survey_question_id=${input.questionId} and confirmed_semantic_summary=${input.semanticSummary} order by updated_at desc limit 1`;
      return { outcome: 'scored', score: nativeQuestionScore(String(working?.user_id),input.questionId), confidence: .9,
        modelId: 'synthetic-rpt08', promptVersion: 'rpt08-v1', direction: 'favorable', severity: 'low', rootCauseCategory: 'autonomy' };
    },
  }, { async deidentify() { mark('deidentify'); return 'Beschäftigte beschreiben Entscheidungsfreiheit, weil das Team Entscheidungen delegiert.'; } }, language);
  const finalizer=makeFinalizer();
  const evidence = new SurveyEvidenceProcessor(new SurveyEvidenceExtractionUseCase(provider as never,
    seed.conversation, survey, backlog, questions, engagement), finalizer,
    new SurveyEvidenceIntentRepository(db), engagement, new PulseReportProgressRepository(db));
  const workers: Worker[] = [
    new Worker(conversationQueue.name, (job) => processor.process(job), { connection, concurrency: 4 }),
    new Worker(messageQueue.name, (job) => message.process(job), { connection, concurrency: 1 }),
    new Worker(evidenceQueue.name, (job) => evidence.process(job), { connection, concurrency: 1 }),
  ];
  const failures: string[] = [];
  const observeWorker=(worker:Worker,evidenceWorker=false)=>worker.on('failed',(job,error)=>{
    if(evidenceWorker&&expectedBoundaryFailures>0){expectedBoundaryFailures--;controlledFailureCount++;if(job?.id)expectedFailedJobIds.add(job.id);return;}
    failures.push(error.message);
  });
  workers.forEach((worker,index)=>observeWorker(worker,index===2));
  for (const q of [memoryQueue, followupQueue, groupQueue, styleQueue, profileQueue, onboardingQueue])
    workers.push(new Worker(q.name, async () => { failures.push('unexpected_side_effect_' + q.name); throw Error('unexpected_side_effect'); return undefined; }, { connection }));
  const ingestion = new SlackIngestService(new IngestionService(db as never, config as never),
    new EventIdempotencyService({ client: redis } as never), conversationQueue, onboardingQueue);
  await seed.db.insert(schema.featureFlags).values({ tenantId: f.tenantId,
    key: FEATURE_FLAGS.CONVERSATIONAL_SURVEY, enabled: true, rolloutPercentage: 100 });
  const workspace = 'T' + f.tenantId.replaceAll('-', '');
  await seed.db.insert(schema.workspaceConnections).values({ tenantId: f.tenantId,
    channelType: 'slack', externalWorkspaceId: workspace,
    encryptedCredentials: encryptField(JSON.stringify({ botToken: 'synthetic-only', signingSecret: 'synthetic-only' }), process.env.FIELD_ENCRYPTION_KEY!) });
  for (const userId of [...f.users, ...f.leadList, f.manager])
    await seed.db.insert(schema.channelAccounts).values({ tenantId: f.tenantId, userId,
      channelType: 'slack', externalWorkspaceId: workspace, externalUserId: 'U' + userId.replaceAll('-', '') });
  async function drain() {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const counts = await Promise.all(queues.map((q) => q.getJobCounts('active', 'waiting', 'delayed', 'failed')));
      if(failures.length)throw Error('acceptance_worker_failed_'+failures.join('_'));
      for(const [index,count]of counts.entries())if(count.failed){
        const failed=await queues[index]!.getFailed();
        if(failed.some(job=>!expectedFailedJobIds.has(job.id!)))throw Error('acceptance_unexpected_failed_job');
      }
      if (counts.every((c) => c.active === 0 && c.waiting === 0 && c.delayed === 0)) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw Error('acceptance_drain_timeout');
  }
  async function enqueueInbound(userId: string, text: string) {
    const eventId = 'rpt08-' + process.env.RPT08_RUN_ID + '-' + randomUUID();
    await ingestion.processBody({ type: 'event_callback', event_id: eventId, team_id: workspace,
      event: { type: 'message', channel_type: 'im', channel: 'D' + userId.replaceAll('-', ''),
        user: 'U' + userId.replaceAll('-', ''), text, ts: (Date.now() / 1000).toFixed(6) } });
    const [record] = await seed.raw`select m.id,m.received_at from messages m join conversation_job_admissions a on a.message_id=m.id where a.event_id=${eventId}`;
    if (!record) throw Error('normalized_ingress_did_not_admit');
    return record;
  }
  async function inbound(userId: string, text: string) {
    const record = await enqueueInbound(userId,text); await drain(); return record;
  }
  const cutoffQueue = new Queue(prefix+'-cutoff',{connection});
  let cutoff = new QuestionCutoffProcessor(new ExpireQuestionInsightsAtCutoffUseCase(survey),
    new RecoverConfirmedQuestionInsightsUseCase(questions,finalizer),cutoffQueue,survey,conversationQueue,
    seed.conversation,messageQueue,profileQueue,styleQueue,memoryQueue,evidenceQueue,followupQueue,groupQueue,
    new PulseReportProgressRepository(db));
  async function showAutonomyBundle(userId:string,revised=false){
    const turns=revised?['Synthetic autonomy experience: '+userId+' Revised work decisions delegated weekly.','Continue question.']:['Synthetic autonomy experience: '+userId+' I choose work methods because decisions delegated.','Could you reflect what I said about work methods.','Please reflect work methods experience now.'];
    for(const text of turns)await inbound(userId,text);
    const [shown]=await seed.raw`select status from survey_question_confirmation_bundles where tenant_id=${f.tenantId} and user_id=${userId} order by created_at desc limit 1`;
    if(shown?.status!=='awaiting_confirmation')throw Error('acceptance_native_bundle_not_shown');
  }
  async function confirmAutonomy(userId:string){
    await showAutonomyBundle(userId);await inbound(userId,'Yes, correct.');
    const [proof]=await seed.raw`select count(*)::int n from survey_question_insights where tenant_id=${f.tenantId} and user_id=${userId}`;
    if(proof!.n<3)throw Error('acceptance_native_confirmation_not_permanent');
  }
  async function recreateEvidenceWorker(){
    await closeAcceptanceResources([()=>workers[2]!.close()]);
    const freshTeams=new TeamRepository(db),freshGroups=new GroupStateRepository(db);
    const freshQuestions=new QuestionInsightRepository(db,freshTeams);
    const freshSurvey=new SurveyRepository(db,freshGroups,freshTeams);
    const freshEngagement=new CaptureEngagementAnswerUseCase(new EngagementAnswerRepository(db));
    const freshBacklog=new PulseBacklogService(new PulseBacklogRepository(db),freshSurvey,freshQuestions,new EngagementAnswerRepository(db));
    const freshFinalizer=makeFinalizer(freshQuestions);
    const freshProcessor=new SurveyEvidenceProcessor(new SurveyEvidenceExtractionUseCase(provider as never,seed.conversation,freshSurvey,freshBacklog,freshQuestions,freshEngagement),freshFinalizer,new SurveyEvidenceIntentRepository(db),freshEngagement,new PulseReportProgressRepository(db));
    workers[2]=new Worker(evidenceQueue.name,job=>freshProcessor.process(job),{connection,concurrency:1});observeWorker(workers[2],true);
    cutoff=new QuestionCutoffProcessor(new ExpireQuestionInsightsAtCutoffUseCase(freshSurvey),new RecoverConfirmedQuestionInsightsUseCase(freshQuestions,freshFinalizer),cutoffQueue,freshSurvey,conversationQueue,seed.conversation,messageQueue,profileQueue,styleQueue,memoryQueue,evidenceQueue,followupQueue,groupQueue,new PulseReportProgressRepository(db));
  }
  async function recreateMessageWorker(){
    await closeAcceptanceResources([()=>workers[1]!.close()]);
    const freshTeams=new TeamRepository(db),freshGroups=new GroupStateRepository(db),freshQuestions=new QuestionInsightRepository(db,freshTeams);
    const freshMessage=new MessageSendProcessor(new WorkspaceConnectionRepository(db,config as never),new ConversationRepository(db),freshGroups,undefined as never,undefined as never,freshQuestions);
    workers[1]=new Worker(messageQueue.name,job=>freshMessage.process(job),{connection,concurrency:1});observeWorker(workers[1]);
  }
  async function probe(userId: string) {
    await conversationQueue.add('check-in', { tenantId: f.tenantId, userId,
      conversationId: f.conversations.get(userId)!, externalWorkspaceId: workspace,
      externalConversationId: 'D' + userId.replaceAll('-', ''), eventId: randomUUID(), traceId: randomUUID() });
    await drain();
  }
  return { inbound, enqueueInbound, showAutonomyBundle,confirmAutonomy,probe, drain, queues, workers, questions, survey, engagement, finalizer, calls,get cutoff(){return cutoff;},recreateEvidenceWorker,recreateMessageWorker,
    failNextEvidence(){evidenceFailureBudget++;},failNextScoring(){scoringFailureBudget++;},
    get controlledFailureCount(){return controlledFailureCount;},get scoreWaitCount(){return scoreWaitCount;},
    holdScoring(){if(scoreGate)throw Error('score_gate_already_held');scoreGate=new Promise<void>(resolve=>{releaseScoreGate=resolve;});return()=>{releaseScoreGate?.();scoreGate=undefined;};},
    processor, evidence, evidenceQueue, outbox, workspace, prefix, failures, scores,
    async close() {
      releaseScoreGate?.();scoreGate=undefined;
      await closeAcceptanceResources([async()=>{
      const result = await Promise.allSettled(workers.map((w) => w.close()));
      const remaining = await Promise.allSettled([...events.map((e) => e.close()), ...queues.map((q) => q.close()),cutoffQueue.close(), redis.quit()]);
      if ([...result, ...remaining].some((r) => r.status === 'rejected')) throw Error('acceptance_cleanup_failed');
      }]);
    },
  };
}
