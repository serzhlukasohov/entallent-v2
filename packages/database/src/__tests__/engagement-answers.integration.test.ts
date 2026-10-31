import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, eq, inArray, sql } from 'drizzle-orm';
import postgres from 'postgres';
import * as schema from '../schema';
import { prepareReportEngagementDefinition } from '../../../../scripts/prepare-report-engagement-definition';
import { activateV2ScoringPolicy } from '../../../../scripts/activate-v2-scoring-policy';
import { installV2SurveyDefinition } from '../../../../scripts/install-v2-survey-definition';
import { EngagementAnswerRepository } from '../../../../apps/worker/src/survey/repositories/engagement-answer.repository';
import { PulseReportScopeRepository } from '../../../../apps/worker/src/survey/repositories/pulse-report-scope.repository';
import { SurveyRepository } from '../../../../apps/worker/src/survey/repositories/survey.repository';
import { ReportingPermissionRepository } from '../../../../apps/worker/src/survey/repositories/reporting-permission.repository';
import { QuestionInsightRepository } from '../../../../apps/worker/src/survey/repositories/question-insight.repository';
import { RetentionRepository } from '../../../../apps/worker/src/retention/retention.repository';
import { SurveyEvidenceProcessor } from '../../../../apps/worker/src/survey/survey-evidence.processor';
import { ConversationProcessor } from '../../../../apps/worker/src/conversation/conversation.processor';
import { lockPulseReportSubject } from '../pulse-report-state';
import { HierarchyMutationService } from '../../../../apps/api/src/hierarchy/hierarchy-mutation.service';
import { PulseBacklogRepository } from '../../../../apps/worker/src/survey/repositories/pulse-backlog.repository';
import { ConversationRepository } from '../../../../apps/worker/src/conversation/repositories/conversation.repository';
import { REPORTING_DISCLOSURE_VERSION, getReportingDisclosureText } from '../../../application/src/utils/reporting-disclosure';
import { CaptureEngagementAnswerUseCase, ProactiveCheckInUseCase, PulseBacklogService } from '@entalent/application';
import { ENGAGEMENT_ANSWER_CONTRACT } from '../../../contracts/src/pulse-engagement';
import { DatabaseService } from '../../../../apps/worker/src/database/database.service';
import { DatabaseService as ApiDatabaseService } from '../../../../apps/api/src/database/database.service';
import type { DbClient } from '../client';

const url = process.env['DATABASE_URL'];
const policy = JSON.parse(readFileSync(resolve(__dirname,'../../../../scripts/data/v2-scoring-policy-1.0.0.json'),'utf8'));
describe.runIf(Boolean(url))('RPT-03 literal answer durable native path', () => {
  const client = postgres(url!, { max: 8 }); const db = drizzle(client, { schema });
  const database = new DatabaseService({ get: () => url } as never);
  (database as unknown as { _client: DbClient })._client = { db, sql: client };
  const apiDatabase = new ApiDatabaseService({ get: () => url } as never);
  (apiDatabase as unknown as { _client: DbClient })._client = { db, sql: client };
  const capture = new EngagementAnswerRepository(database); const scope = new PulseReportScopeRepository(database);
  const survey = new SurveyRepository(database, {} as never, { findTeamByMemberId: async () => null } as never);
  const rights = new ReportingPermissionRepository(database);
  const tenants: string[]=[];
  afterAll(async()=> { if(tenants.length) await db.delete(schema.tenants).where(inArray(schema.tenants.id,tenants)); await client.end(); });

  async function fixture(open=true) {
    const [tenant]=await db.insert(schema.tenants).values({name:`RPT03 ${randomUUID()}`,timezone:'UTC'}).returning(); tenants.push(tenant.id);
    const sourceId=await installV2SurveyDefinition(url!,tenant.id);
    const definitionId=await prepareReportEngagementDefinition(url!,tenant.id,sourceId);
    async function person(role:'manager'|'team_lead'|'employee') {
      const [user]=await db.insert(schema.users).values({tenantId:tenant.id,consentState:{surveyEnabled:true}}).returning();
      await db.insert(schema.people).values({id:user.id,tenantId:tenant.id,customerEmployeeId:user.id,workEmail:`${user.id}@fixture.invalid`,displayName:role,primaryRole:role,pulseParticipant:role!=='manager',lifecycleStatus:'active'});
      return user.id;
    }
    const manager=await person('manager'),lead=await person('team_lead'),userId=await person('employee');
    const [unit]=await db.insert(schema.orgUnits).values({tenantId:tenant.id,customerUnitKey:'unit',name:'Unit',managerPersonId:manager,lifecycleStatus:'active'}).returning();
    const [team]=await db.insert(schema.orgTeams).values({tenantId:tenant.id,unitId:unit.id,customerTeamKey:'team',name:'Team',teamLeadPersonId:lead,lifecycleStatus:'active'}).returning();
    await db.insert(schema.orgEmployeePlacements).values({tenantId:tenant.id,employeePersonId:userId,unitId:unit.id,teamId:team.id,lifecycleStatus:'active'});
    const spare=await person('employee');await db.insert(schema.orgEmployeePlacements).values({tenantId:tenant.id,employeePersonId:spare,unitId:unit.id,teamId:team.id,lifecycleStatus:'active'});
    const questions=await db.select().from(schema.surveyQuestions).where(eq(schema.surveyQuestions.surveyDefinitionId,definitionId));
    const numeric=questions.filter(q=>q.responseType==='numeric_1_10_integer').sort((a,b)=>a.displayOrder-b.displayOrder);
    await db.update(schema.surveyDefinitions).set({active:true}).where(eq(schema.surveyDefinitions.id,definitionId));
    const [scoring]=await db.insert(schema.surveyScoringPolicies).values({tenantId:tenant.id,version:'1.0.0',approvedAt:new Date(),rubrics:policy}).returning();
    const periodStart=new Date(Date.now()+150),periodEnd=new Date(periodStart.getTime()+86_400_000);
    const [cycle]=await db.insert(schema.surveyCycleScoringPolicies).values({tenantId:tenant.id,surveyDefinitionId:definitionId,periodStart,periodEnd,scoringPolicyId:scoring.id}).returning();
    await new Promise(r=>setTimeout(r,Math.max(0,periodStart.getTime()-Date.now()+5)));
    if(open) await scope.openOrgNativeCycle({tenantId:tenant.id,surveyDefinitionId:definitionId,periodStart,periodEnd});
    const window=open?await survey.findOrCreateActiveWindow(userId,tenant.id):null;
    if(open && (!window || 'kind' in window)) throw new Error('fixture_window_unavailable');
    const [conversation]=await db.insert(schema.conversations).values({tenantId:tenant.id,userId,channelType:'dev',externalConversationId:randomUUID()}).returning();
    return {tenantId:tenant.id,userId,definitionId,sourceId,questions,numeric,cycle,unit,team,window:window as schema.DbSurveyWindow,conversationId:conversation.id};
  }
  type F=Awaited<ReturnType<typeof fixture>>;
  async function prompt(f:F,index=0,sentAt=new Date(),delivered=true) {
    const q=f.numeric[index];
    const [message]=await db.insert(schema.messages).values({tenantId:f.tenantId,userId:f.userId,conversationId:f.conversationId,direction:'outbound',senderType:'agent',text:q.title,occurredAt:sentAt,sentAt:delivered?sentAt:null,
      metadata:{containsSurveyProbe:true,surveyProbeQuestionId:q.id,engagementProbe:{contractVersion:ENGAGEMENT_ANSWER_CONTRACT,surveyDefinitionId:f.definitionId,surveyWindowId:f.window.id,questionId:q.id,questionVersion:q.version,stableKey:q.stableKey,displayedFormHash:createHash('sha256').update(q.title).digest('hex')}}}).returning();
    return message;
  }
  async function answer(f:F,text='7',receivedAt=new Date(Date.now()+10),id:string=randomUUID()) {
    await db.insert(schema.messages).values({id,tenantId:f.tenantId,userId:f.userId,conversationId:f.conversationId,direction:'inbound',senderType:'user',text,occurredAt:new Date(),receivedAt});
    return {tenantId:f.tenantId,userId:f.userId,conversationId:f.conversationId,inboundMessageId:id};
  }
  const rows=async(f:F)=>db.select().from(schema.surveyEngagementAnswerRevisions).where(eq(schema.surveyEngagementAnswerRevisions.tenantId,f.tenantId));
  const withdrawal=(f:F,lineageIds?:string[])=>({tenantId:f.tenantId,userId:f.userId,personId:f.userId,requestId:randomUUID(),provenance:{kind:'verified_subject' as const,tenantId:f.tenantId,userId:f.userId,personId:f.userId,verificationId:randomUUID(),receivedAt:new Date()},target:lineageIds?{kind:'partial_reporting' as const,lineageIds}:{kind:'full_reporting' as const}});

  it('prepares inactive distinct15-question catalog idempotently without changing legacy installer/defaults',async()=>{
    const f=await fixture();
    const activation=await activateV2ScoringPolicy({databaseUrl:url!,tenantId:f.tenantId,surveyDefinitionId:f.definitionId,periodStart:f.cycle.periodStart,periodEnd:f.cycle.periodEnd,approvedAt:new Date(),policyVersion:'1.0.0',rubricsFile:resolve(__dirname,'../../../../scripts/data/v2-scoring-policy-1.0.0.json')});
    expect(activation.status).toBe('already_active');
    expect(await prepareReportEngagementDefinition(url!,f.tenantId,f.sourceId)).toBe(f.definitionId);
    expect(await installV2SurveyDefinition(url!,f.tenantId)).toBe(f.sourceId);
    expect(f.questions).toHaveLength(15); expect(f.numeric).toHaveLength(3);
    const repo=new QuestionInsightRepository(database,{} as never);
    expect(await repo.getWindowMode({tenantId:f.tenantId,userId:f.userId,surveyWindowId:f.window.id})).toBe('v2');
    await expect(db.update(schema.surveyQuestions).set({title:'changed'}).where(eq(schema.surveyQuestions.id,f.numeric[0].id))).rejects.toThrow('engagement_question_immutable');
  });
  it('fails closed with active new catalog and missing native opening before creating a legacy window',async()=>{
    const f=await fixture(false); await expect(survey.findOrCreateActiveWindow(f.userId,f.tenantId)).rejects.toThrow('org_native_reporting_opening_required');
    expect(await db.select().from(schema.surveyWindows).where(eq(schema.surveyWindows.tenantId,f.tenantId))).toHaveLength(0);
  });
  it('persists raw answers once, survives private-text purge, and never writes legacy scores or groups',async()=>{
    const f=await fixture(); await prompt(f); const input=await answer(f,'8/10');
    expect((await capture.capture(input)).status).toBe('accepted'); expect((await capture.capture(input)).replayed).toBe(true);
    expect((await rows(f))[0].value).toBe(8);expect((await rows(f))[0].promptAcknowledgedAt).not.toBeNull(); expect(await capture.coveredQuestionIds(f.tenantId,f.userId,f.window.id)).toEqual([f.numeric[0].id]);
    await db.delete(schema.messages).where(eq(schema.messages.conversationId,f.conversationId));
    expect((await rows(f))[0].value).toBe(8); expect((await capture.capture(input)).replayed).toBe(true);
    expect(await db.select().from(schema.surveyAssessments).where(eq(schema.surveyAssessments.surveyWindowId,f.window.id))).toHaveLength(0);
    expect(await db.select().from(schema.surveyGroupStates).where(eq(schema.surveyGroupStates.surveyWindowId,f.window.id))).toHaveLength(0);
  });
  it.each(['0','-1','11','7.5','10.5/10','7 meetings','not 7','7 or 8','I feel fine'])('rejects %s while preserving previous accepted revision',async(text)=>{
    const f=await fixture();await prompt(f);await capture.capture(await answer(f));
    expect((await capture.capture(await answer(f,text))).status).toBe('invalid');expect(await rows(f)).toHaveLength(1);
  });
  it('binds delayed capture/backfill to last positive delivery strictly before immutable receipt',async()=>{
    const f=await fixture();await prompt(f,0);const at=new Date(Date.now()+2);const input=await answer(f,'6',at);
    await new Promise(r=>setTimeout(r,5));await prompt(f,1,new Date(at.getTime()+2));
    await capture.captureConversation({tenantId:f.tenantId,userId:f.userId,conversationId:f.conversationId});
    expect((await rows(f))[0].surveyQuestionId).toBe(f.numeric[0].id);expect((await capture.capture(input)).replayed).toBe(true);
  });
  it('an intervening delivered non-probe clears binding and unsent probes do not bind',async()=>{
    const f=await fixture();await prompt(f);await db.insert(schema.messages).values({tenantId:f.tenantId,userId:f.userId,conversationId:f.conversationId,direction:'outbound',senderType:'agent',text:'Coaching reply',occurredAt:new Date(Date.now()+2),sentAt:new Date(Date.now()+2)});
    expect((await capture.capture(await answer(f))).status).toBe('not_applicable');expect(await rows(f)).toHaveLength(0);
  });
  it('capture precedes committed resume/coalescing and survives generation failure in actual ConversationProcessor',async()=>{
    const f=await fixture();await prompt(f);const input=await answer(f,'10');
    const orchestrator={resumeCommittedTurn:vi.fn(async()=>false),orchestrate:vi.fn(async()=>{throw new Error('model unavailable');})};
    const conv={isUserRuntimeEligible:async()=>true,markInboundConversationJobProcessed:vi.fn()};
    const processor=new ConversationProcessor(orchestrator as never,{} as never,{record:async()=>{}} as never,database,conv as never,{hasUnresolvedQuestionConfirmationForInbound:async()=>false} as never,{} as never,new CaptureEngagementAnswerUseCase(capture));
    await expect(processor.process({name:'conversation',data:{...input,messageId:input.inboundMessageId},opts:{attempts:3},attemptsMade:0} as never)).rejects.toThrow('conversation_processing_failed');
    expect((await rows(f))[0].value).toBe(10);expect(orchestrator.orchestrate).toHaveBeenCalledOnce();
  });
  it('concurrent reversed jobs retain receipt history with exact PostgreSQL UUID tie ordering',async()=>{
    const f=await fixture();await prompt(f);const at=new Date(Date.now()+10);const prefix=randomUUID().slice(0,-12);const a=await answer(f,'6',at,prefix+'000000000001'),b=await answer(f,'8',at,prefix+'000000000002');
    await Promise.all([capture.capture(b),capture.capture(a)]);
    const history=await client`select value from survey_engagement_answer_revisions where tenant_id=${f.tenantId} order by answer_received_at,inbound_receipt_id`;
    expect(history.map(r=>r.value)).toEqual([6,8]);expect(await rows(f)).toHaveLength(2);
  });
  it('partial withdrawal removes only matching scalar content and blocks replay/correction',async()=>{
    const f=await fixture();await prompt(f);const first=await answer(f);await capture.capture(first);await prompt(f,1,new Date(Date.now()+15));await capture.capture(await answer(f,'8',new Date(Date.now()+30)));
    const lineage=(await rows(f)).find(r=>r.surveyQuestionId===f.numeric[0].id)!.lineageId;
    await rights.withdraw(withdrawal(f,[lineage]));expect(await rows(f)).toHaveLength(1);expect((await capture.capture(first)).status).toBe('withdrawn');
    await prompt(f,0,new Date(Date.now()+40));expect((await capture.capture(await answer(f,'9',new Date(Date.now()+50)))).status).toBe('withdrawn');
  });
  it('full withdrawal first prevents even an older queued receipt and subject erase cascades safely',async()=>{
    const f=await fixture();await prompt(f);const old=await answer(f);await rights.withdraw(withdrawal(f));
    expect((await capture.capture(old)).status).toBe('withdrawn');expect(await rows(f)).toHaveLength(0);
    await db.delete(schema.orgEmployeePlacements).where(eq(schema.orgEmployeePlacements.employeePersonId,f.userId));
    await db.delete(schema.users).where(eq(schema.users.id,f.userId));
    expect(await db.select().from(schema.surveyEngagementCaptureEvents).where(eq(schema.surveyEngagementCaptureEvents.userId,f.userId))).toHaveLength(0);
  });
  it('preserves microsecond receipt precision and the earlier revision for a future strict cutoff',async()=>{
    const f=await fixture();await prompt(f);const base=new Date(Date.now()+10).toISOString();
    const stamp1=base.replace('Z','123Z'),stamp2=base.replace('Z','124Z');
    const inputs=[];
    for(const [text,stamp] of [['6',stamp1],['8',stamp2]]) {
      const id=randomUUID();await db.execute(sql`insert into messages(id,tenant_id,user_id,conversation_id,direction,sender_type,text,occurred_at,received_at)
        values(${id}::uuid,${f.tenantId}::uuid,${f.userId}::uuid,${f.conversationId}::uuid,'inbound','user',${text},clock_timestamp(),${stamp}::timestamptz)`);
      inputs.push({tenantId:f.tenantId,userId:f.userId,conversationId:f.conversationId,inboundMessageId:id});
    }
    await capture.capture(inputs[1]);await capture.capture(inputs[0]);
    const history=await client`select value,answer_received_at::text as at from survey_engagement_answer_revisions where tenant_id=${f.tenantId} order by answer_received_at,inbound_receipt_id`;
    expect(history.map(r=>r.value)).toEqual([6,8]);expect(history[0].at).toContain('123+');expect(history[1].at).toContain('124+');
    const earlier=await client`select value from survey_engagement_answer_revisions where tenant_id=${f.tenantId} and answer_received_at<${stamp2}::timestamptz order by answer_received_at desc,inbound_receipt_id desc limit 1`;
    expect(earlier[0].value).toBe(6);
  });
  it.each(['capture_first','cleanup_first'])('first capture and analytical cleanup serialize terminal expiry: %s',async(order)=>{
    const f=await fixture();await prompt(f);const input=await answer(f);
    await db.update(schema.tenants).set({retentionPolicy:{messagesRetentionDays:365,memoryRetentionDays:0.000001,riskSignalRetentionDays:90,auditLogRetentionDays:2555}}).where(eq(schema.tenants.id,f.tenantId));
    await new Promise(r=>setTimeout(r,130));
    const now=new Date(),old=new Date(Date.now()-365*86_400_000);const params={tenantId:f.tenantId,now,messagesCutoff:old,memoryCutoff:now,riskSignalCutoff:old,auditLogCutoff:old};
    if(order==='capture_first') {expect((await capture.capture(input)).status).toBe('expired');await new RetentionRepository(database).applyRetention(params);}
    else {
      let release!:()=>void,ready!:()=>void,fail!:(error:unknown)=>void;const gate=new Promise<void>(r=>release=r),locked=new Promise<void>((r,reject)=>{ready=r;fail=reject;});
      const cleanup=db.transaction(async tx=>{await lockPulseReportSubject(tx,f.tenantId,f.userId);ready();await gate;await new RetentionRepository({client:tx} as never).applyRetention(params);});
      void cleanup.catch(fail);await locked;const waiting=capture.capture(input);release();await cleanup;expect((await waiting).status).toBe('expired');
    }
    expect(await rows(f)).toHaveLength(0);expect((await capture.capture(input)).status).toBe('expired');
  });
  it('retention deletes only scalar content, leaves content-free tombstones and never revives older scores',async()=>{
    const f=await fixture();await prompt(f);const first=await answer(f,'6');await capture.capture(first);await capture.capture(await answer(f,'8',new Date(Date.now()+15)));
    await db.update(schema.tenants).set({retentionPolicy:{messagesRetentionDays:365,memoryRetentionDays:0.000001,riskSignalRetentionDays:90,auditLogRetentionDays:2555}}).where(eq(schema.tenants.id,f.tenantId));
    await new Promise(r=>setTimeout(r,150));
    const old=new Date(Date.now()-365*86_400_000),now=new Date();await new RetentionRepository(database).applyRetention({tenantId:f.tenantId,now,messagesCutoff:old,memoryCutoff:now,riskSignalCutoff:old,auditLogCutoff:old});
    expect(await rows(f)).toHaveLength(0);expect((await capture.capture(first)).status).toBe('expired');expect(await capture.coveredQuestionIds(f.tenantId,f.userId,f.window.id)).toEqual([]);
    const events=await db.select().from(schema.surveyEngagementCaptureEvents).where(eq(schema.surveyEngagementCaptureEvents.tenantId,f.tenantId));
    expect(events.every(e=>e.status==='expired')).toBe(true);expect(Object.keys(events[0])).not.toContain('value');
  });
  it.each(['capture_first','transfer_first'])('native transfer keeps timely origin answers and rejects later receipts: %s',async(order)=>{
    const f=await fixture();await prompt(f);await new Promise(r=>setTimeout(r,2));const input=await answer(f,'7',new Date());
    expect(await db.select().from(schema.orgEmployeePlacements).where(eq(schema.orgEmployeePlacements.teamId,f.team.id))).toHaveLength(2);
    const hierarchy=new HierarchyMutationService(apiDatabase);
    if(order==='capture_first') {await capture.capture(input);await hierarchy.moveEmployee(f.tenantId,f.userId,f.unit.id,null,{type:'internal_operator',operatorId:'fixture'} as never);}
    else {
      let release!:()=>void,ready!:()=>void,fail!:(error:unknown)=>void;const gate=new Promise<void>(r=>release=r),locked=new Promise<void>((r,reject)=>{ready=r;fail=reject;});
      const transfer=db.transaction(async tx=>{await lockPulseReportSubject(tx,f.tenantId,f.userId);await new HierarchyMutationService({client:tx} as never).moveEmployee(f.tenantId,f.userId,f.unit.id,null,{type:'internal_operator',operatorId:'fixture'} as never);ready();await gate;});
      void transfer.catch(fail);await locked;const waiting=capture.capture(input);release();await transfer;expect((await waiting).status).toBe('accepted');
    }
    const [participant]=await db.select().from(schema.surveyReportParticipants).where(and(eq(schema.surveyReportParticipants.tenantId,f.tenantId),eq(schema.surveyReportParticipants.userId,f.userId)));
    expect(participant.originTeamId).toBe(f.team.id);expect(participant.collectionStoppedAt).not.toBeNull();
    expect((await capture.capture(await answer(f,'9',new Date(Date.now()+5)))).status).toBe('ineligible');expect(await rows(f)).toHaveLength(1);
  });
  it('intentional source/probe erasure is terminal while malformed retained probe proof remains retryable',async()=>{
    const f=await fixture();const p=await prompt(f,0,new Date(),false);
    await db.update(schema.messages).set({metadata:{engagementProbe:{contractVersion:'wrong'}}}).where(eq(schema.messages.id,p.id));
    await db.update(schema.messages).set({sentAt:new Date()}).where(eq(schema.messages.id,p.id));const input=await answer(f);
    await expect(capture.capture(input)).rejects.toThrow('engagement_prompt_proof_unavailable');expect(await rows(f)).toHaveLength(0);
    await db.delete(schema.messages).where(eq(schema.messages.id,p.id));expect((await capture.capture(input)).status).toBe('ineligible');
    const source=await answer(f);await db.delete(schema.messages).where(eq(schema.messages.id,source.inboundMessageId));expect((await capture.capture(source)).status).toBe('source_deleted');
  });
  it('database guards reject cross-subject/source/value/contract bypass and immutable history edits',async()=>{
    const f=await fixture();await prompt(f);await capture.capture(await answer(f));const [row]=await rows(f);
    await expect(db.update(schema.surveyEngagementAnswerRevisions).set({value:9}).where(eq(schema.surveyEngagementAnswerRevisions.inboundReceiptId,row.inboundReceiptId))).rejects.toThrow('engagement_answer_immutable');
    await expect(db.delete(schema.surveyEngagementAnswerRevisions).where(eq(schema.surveyEngagementAnswerRevisions.inboundReceiptId,row.inboundReceiptId))).rejects.toThrow('engagement_answer_history_immutable');
    const input=await answer(f);await db.insert(schema.surveyEngagementCaptureEvents).values({tenantId:f.tenantId,userId:f.userId,inboundReceiptId:input.inboundMessageId,status:'accepted',answerReceivedAt:(await client`select received_at::text as at from messages where id=${input.inboundMessageId}`)[0].at,surveyWindowId:f.window.id,lineageId:row.lineageId,contractVersion:ENGAGEMENT_ANSWER_CONTRACT});
    await expect(db.insert(schema.surveyEngagementAnswerRevisions).values({...row,inboundReceiptId:input.inboundMessageId,value:11})).rejects.toThrow();
    await expect(db.insert(schema.surveyEngagementAnswerRevisions).values({...row,inboundReceiptId:input.inboundMessageId,contractVersion:'wrong'})).rejects.toThrow();
    await expect(db.insert(schema.surveyEngagementCaptureEvents).values({tenantId:f.tenantId,userId:f.userId,inboundReceiptId:randomUUID(),status:'accepted',answerReceivedAt:new Date().toISOString(),surveyWindowId:randomUUID(),lineageId:row.lineageId,contractVersion:ENGAGEMENT_ANSWER_CONTRACT})).rejects.toThrow('engagement_event_window_mismatch');
  });

  it.each(['full_capture_first','full_withdrawal_first','partial_capture_first','partial_withdrawal_first'])('withdrawal and capture share the subject lock: %s',async(order)=>{
    const f=await fixture();await prompt(f);const input=await answer(f,'7',new Date(Date.now()+5));
    // Establish the stable topic lineage before the raced acceptance.
    const lineage=(await client`select pulse_report_lineage(${f.window.id},${f.numeric[0].id}) as id`)[0].id;
    const target=order.startsWith('partial')?[lineage]:undefined;
    let release!:()=>void,ready!:()=>void,fail!:(error:unknown)=>void;
    const gate=new Promise<void>(r=>release=r),locked=new Promise<void>((r,reject)=>{ready=r;fail=reject;});
    if(order.endsWith('capture_first')) {
      const first=db.transaction(async tx=>{await lockPulseReportSubject(tx,f.tenantId,f.userId);await new EngagementAnswerRepository({client:tx} as never).capture(input);ready();await gate;});
      void first.catch(fail);await locked;const waiting=rights.withdraw(withdrawal(f,target));release();await first;await waiting;
    } else {
      const first=db.transaction(async tx=>{await lockPulseReportSubject(tx,f.tenantId,f.userId);await new ReportingPermissionRepository({client:tx} as never).withdraw(withdrawal(f,target));ready();await gate;});
      void first.catch(fail);await locked;const waiting=capture.capture(input);release();await first;expect((await waiting).status).toBe('withdrawn');
    }
    expect(await rows(f)).toHaveLength(0);expect((await capture.capture(input)).status).toBe('withdrawn');
  });

  it('a positive delivery recorded after the inbound cannot rebind it using an earlier provider timestamp',async()=>{
    const f=await fixture();const older=await prompt(f,1);const p=await prompt(f,0,new Date(),false);
    expect(older.sentAt).not.toBeNull();
    expect(await new ConversationRepository(database).claimCommittedMessageSendAttempt({messageId:p.id,tenantId:f.tenantId,userId:f.userId,conversationId:f.conversationId})).toBe('not_tracked');
    const attempted=(await client`select delivery_attempted_at::text at from messages where id=${p.id}`)[0].at;
    await db.update(schema.messages).set({deliveryAttemptedAt:new Date(0).toISOString()}).where(eq(schema.messages.id,p.id));
    expect((await client`select delivery_attempted_at::text at from messages where id=${p.id}`)[0].at).toBe(attempted);
    const input=await answer(f,'8',new Date(Date.now()+2));await new Promise(r=>setTimeout(r,5));
    await expect(capture.capture(input)).rejects.toThrow('engagement_delivery_proof_unavailable');
    await db.update(schema.messages).set({sentAt:new Date(Date.now()-1000)}).where(eq(schema.messages.id,p.id));
    expect((await capture.capture(input)).status).toBe('ineligible');expect(await rows(f)).toHaveLength(0);
  });

  it('real proactive producer -> delivery -> ConversationProcessor -> ledger drives3 distinct backlog questions',async()=>{
    const f=await fixture();const conversation=new ConversationRepository(database);
    await answer(f,'Hello');await db.insert(schema.messages).values({tenantId:f.tenantId,userId:f.userId,conversationId:f.conversationId,direction:'outbound',senderType:'agent',text:getReportingDisclosureText('en'),occurredAt:new Date(),sentAt:new Date(),metadata:{reportingDisclosureVersion:REPORTING_DISCLOSURE_VERSION}});
    const backlog=new PulseBacklogService(new PulseBacklogRepository(database),survey,new QuestionInsightRepository(database,{} as never),capture);
    const generated=vi.fn(async(_turns:unknown,_strategy:unknown,context:{proactiveCheckIn?:{probeQuestion?:{id:string;probeStrategies:string[]}}})=>({text:context.proactiveCheckIn!.probeQuestion!.probeStrategies[0],confidence:1,containsSurveyProbe:true,surveyProbeQuestionId:context.proactiveCheckIn!.probeQuestion!.id}));
    const producer=new ProactiveCheckInUseCase(conversation,{generateResponse:generated} as never,{enqueueMessageSend:vi.fn()} as never,undefined,backlog);
    const processor=new ConversationProcessor({resumeCommittedTurn:async()=>true} as never,{} as never,{} as never,database,{markInboundConversationJobProcessed:async()=>{}} as never,{hasUnresolvedQuestionConfirmationForInbound:async()=>false} as never,{} as never,new CaptureEngagementAnswerUseCase(capture));
    const asked:string[]=[];
    for(const value of ['6','8','10']) {
      const output=await producer.execute({tenantId:f.tenantId,userId:f.userId,conversationId:f.conversationId,externalWorkspaceId:'fixture',externalConversationId:f.conversationId,traceId:'synthetic'});
      asked.push(output.probeQuestionId!);await db.update(schema.messages).set({sentAt:new Date()}).where(eq(schema.messages.id,output.outboundMessageId));
      const input=await answer(f,value,new Date(Date.now()+5));
      await processor.process({name:'conversation',data:{...input,messageId:input.inboundMessageId},opts:{attempts:1},attemptsMade:0} as never);
    }
    expect(new Set(asked).size).toBe(3);expect((await rows(f)).map(r=>r.value).sort((a,b)=>a-b)).toEqual([6,8,10]);
    expect(await capture.coveredQuestionIds(f.tenantId,f.userId,f.window.id)).toHaveLength(3);
  });

  it('accepted numeric content and replay events erase safely with the subject before withdrawal',async()=>{
    const f=await fixture();await prompt(f);await capture.capture(await answer(f));
    await db.delete(schema.orgEmployeePlacements).where(eq(schema.orgEmployeePlacements.employeePersonId,f.userId));
    await db.delete(schema.users).where(eq(schema.users.id,f.userId));
    expect(await rows(f)).toHaveLength(0);expect(await db.select().from(schema.surveyEngagementCaptureEvents).where(eq(schema.surveyEngagementCaptureEvents.userId,f.userId))).toHaveLength(0);
  });
  it('rapid-message coalescing and failing evidence finalization cannot lose the literal receipt',async()=>{
    const f=await fixture();await prompt(f);const input=await answer(f,'7');const orchestrate=vi.fn();
    const processor=new ConversationProcessor({resumeCommittedTurn:async()=>false,orchestrate} as never,{} as never,{} as never,database,{isUserRuntimeEligible:async()=>true,shouldSkipInboundMessage:async()=>true,markInboundConversationJobProcessed:async()=>{}} as never,{hasUnresolvedQuestionConfirmationForInbound:async()=>false} as never,{} as never,new CaptureEngagementAnswerUseCase(capture));
    await processor.process({name:'conversation',data:{...input,messageId:input.inboundMessageId,rapidMessageCoalescing:true},opts:{attempts:1},attemptsMade:0} as never);
    expect(orchestrate).not.toHaveBeenCalled();expect(await rows(f)).toHaveLength(1);
    const evidenceInput=await answer(f,'8');
    const recovery=new SurveyEvidenceProcessor({assertConversationOwner:async()=>{}} as never,{executePending:async()=>{throw new Error('synthetic finalizer failure');}} as never,undefined,new CaptureEngagementAnswerUseCase(capture));
    await expect(recovery.process({data:{...evidenceInput,traceId:'synthetic',mode:'live'}} as never)).rejects.toThrow('v2_question_finalization_failed');
    expect(await rows(f)).toHaveLength(2);
  });

  it('first positive acknowledgement receipt remains immutable across a directSQL sentAt clear/re-set',async()=>{
    const f=await fixture();const p=await prompt(f);await new Promise(r=>setTimeout(r,2));const input=await answer(f,'7',new Date());
    const before=(await client`select delivery_recorded_at::text as at from messages where id=${p.id}`)[0].at;
    await expect(db.update(schema.messages).set({sentAt:null}).where(eq(schema.messages.id,p.id))).rejects.toThrow('engagement_delivered_form_immutable');await new Promise(r=>setTimeout(r,5));
    await db.update(schema.messages).set({sentAt:p.sentAt}).where(eq(schema.messages.id,p.id));
    const after=(await client`select delivery_recorded_at::text as at from messages where id=${p.id}`)[0].at;
    expect(after).toBe(before);expect((await capture.capture(input)).status).toBe('accepted');
    expect((await client`select prompt_acknowledged_at=(select delivery_recorded_at from messages where id=${p.id}) as matches from survey_engagement_answer_revisions where inbound_receipt_id=${input.inboundMessageId}`)[0].matches).toBe(true);
  });

  it('keeps historical and unopened collection jobs outside the new receipt contract',async()=>{
    const f=await fixture(false);const input=await answer(f,'7');
    expect((await capture.capture(input)).status).toBe('not_applicable');expect(await rows(f)).toHaveLength(0);
  });

  it('R1 binds actual positive delivery order when persistence and delivery orders disagree',async()=>{
    const f=await fixture();const a=await prompt(f,0,new Date(),false);const b=await prompt(f,1,new Date(),false);
    await db.update(schema.messages).set({sentAt:new Date()}).where(eq(schema.messages.id,b.id));await new Promise(r=>setTimeout(r,3));
    await db.update(schema.messages).set({sentAt:new Date()}).where(eq(schema.messages.id,a.id));await new Promise(r=>setTimeout(r,3));
    await capture.capture(await answer(f,'7',new Date()));expect((await rows(f))[0].surveyQuestionId).toBe(f.numeric[0].id);
  });
  it('R1 a known never-attempted queued message does not mask a positively delivered probe',async()=>{
    const f=await fixture();await prompt(f,0);await prompt(f,1,new Date(),false);await new Promise(r=>setTimeout(r,3));
    expect((await capture.capture(await answer(f,'7',new Date()))).status).toBe('accepted');expect((await rows(f))[0].surveyQuestionId).toBe(f.numeric[0].id);
  });
  it('R1 delivery attempted only after receipt cannot retrospectively mask the timely delivered probe',async()=>{
    const f=await fixture();await prompt(f,0);const queued=await prompt(f,1,new Date(),false);await new Promise(r=>setTimeout(r,2));const input=await answer(f,'7',new Date());await new Promise(r=>setTimeout(r,3));
    await new ConversationRepository(database).claimCommittedMessageSendAttempt({messageId:queued.id,tenantId:f.tenantId,userId:f.userId,conversationId:f.conversationId});
    await db.update(schema.messages).set({sentAt:new Date(Date.now()-1000)}).where(eq(schema.messages.id,queued.id));
    expect((await capture.capture(input)).status).toBe('accepted');expect((await rows(f))[0].surveyQuestionId).toBe(f.numeric[0].id);
  });
  it('R1 erasing the last delivered prompt preserves a terminal receipt despite reversed persistence order',async()=>{
    const f=await fixture();const last=await prompt(f,0,new Date(),false);const earlier=await prompt(f,1);await new Promise(r=>setTimeout(r,2));await db.update(schema.messages).set({sentAt:new Date()}).where(eq(schema.messages.id,last.id));await new Promise(r=>setTimeout(r,2));const input=await answer(f,'7',new Date());
    await db.delete(schema.messages).where(eq(schema.messages.id,last.id));expect(earlier.sentAt).not.toBeNull();expect((await capture.capture(input)).status).toBe('ineligible');expect(await rows(f)).toHaveLength(0);
  });
  async function historicalQueued(f:F) {
    // Task-only fixture models a pre-clock-migration row without inventing historical receipt times.
    return db.transaction(async tx=>{
      await tx.execute(sql`set local session_replication_role=replica`);
      const [message]=await tx.insert(schema.messages).values({tenantId:f.tenantId,userId:f.userId,conversationId:f.conversationId,direction:'outbound',senderType:'agent',text:'Historical queued reply',occurredAt:new Date()}).returning();
      await tx.execute(sql`set local session_replication_role=origin`);
      expect(message.persistedAt).toBeNull();expect(message.deliveryRecordedAt).toBeNull();return message;
    });
  }
  it.each([{deleted:false,lateAck:false},{deleted:true,lateAck:false},{deleted:false,lateAck:true},{deleted:true,lateAck:true}])('R1 historical NULL persistence retains attempt protection deleted=$deleted lateAck=$lateAck',async({deleted,lateAck})=>{
    const f=await fixture();const historical=await historicalQueued(f);await prompt(f);
    await new ConversationRepository(database).claimCommittedMessageSendAttempt({messageId:historical.id,tenantId:f.tenantId,userId:f.userId,conversationId:f.conversationId});await new Promise(r=>setTimeout(r,2));const input=await answer(f,'7',new Date());
    const [attempted]=await db.select().from(schema.messages).where(eq(schema.messages.id,historical.id));expect(attempted.persistedAt).toBeNull();expect(attempted.deliveryAttemptedAt).not.toBeNull();
    if(lateAck) { await new Promise(r=>setTimeout(r,2));await db.update(schema.messages).set({sentAt:new Date(Date.now()-1000)}).where(eq(schema.messages.id,historical.id)); }
    if(deleted) { await db.delete(schema.messages).where(eq(schema.messages.id,historical.id));expect((await capture.capture(input)).status).toBe('ineligible'); }
    else if(lateAck) expect((await capture.capture(input)).status).toBe('ineligible');
    else await expect(capture.capture(input)).rejects.toThrow('engagement_delivery_proof_unavailable');
    expect(await rows(f)).toHaveLength(0);
  });
  it('R1 independent SQL rejects historical NULL-persistence unknown attempt',async()=>{
    const f=await fixture();const historical=await historicalQueued(f);await prompt(f);await capture.capture(await answer(f));const [valid]=await rows(f);
    await new ConversationRepository(database).claimCommittedMessageSendAttempt({messageId:historical.id,tenantId:f.tenantId,userId:f.userId,conversationId:f.conversationId});await new Promise(r=>setTimeout(r,2));const input=await answer(f,'7',new Date());const receipt=(await client`select received_at::text at from messages where id=${input.inboundMessageId}`)[0].at;
    await expect(db.transaction(async tx=>{
      await tx.insert(schema.surveyEngagementCaptureEvents).values({inboundReceiptId:input.inboundMessageId,tenantId:f.tenantId,userId:f.userId,status:'accepted',answerReceivedAt:receipt,surveyWindowId:f.window.id,lineageId:valid.lineageId,contractVersion:ENGAGEMENT_ANSWER_CONTRACT});
      await tx.insert(schema.surveyEngagementAnswerRevisions).values({...valid,inboundReceiptId:input.inboundMessageId,answerReceivedAt:receipt});
    })).rejects.toThrow('engagement_delivery_ambiguous');
  });
  it('R2 shortened analytical retention reopens done numeric backlog through the real ledger projection',async()=>{
    const f=await fixture();const backlog=new PulseBacklogService(new PulseBacklogRepository(database),survey,new QuestionInsightRepository(database,{} as never),capture);
    const first=await backlog.getNextProbeQuestion(f.userId,f.tenantId);expect(first!.question.id).toBe(f.numeric[0].id);
    await prompt(f);await capture.capture(await answer(f,'7'));await backlog.getNextProbeQuestion(f.userId,f.tenantId);
    expect((await db.select().from(schema.pulseBacklog).where(and(eq(schema.pulseBacklog.surveyWindowId,f.window.id),eq(schema.pulseBacklog.surveyQuestionId,f.numeric[0].id))))[0].status).toBe('done');
    const before=(await db.select().from(schema.pulseBacklog).where(and(eq(schema.pulseBacklog.surveyWindowId,f.window.id),eq(schema.pulseBacklog.surveyQuestionId,f.numeric[0].id))))[0];
    await db.update(schema.pulseBacklog).set({ignoreCount:2}).where(eq(schema.pulseBacklog.id,before.id));
    const staleSnapshot=new Date(Date.now()-1000);
    await db.update(schema.tenants).set({retentionPolicy:{messagesRetentionDays:365,memoryRetentionDays:0.000001,riskSignalRetentionDays:90,auditLogRetentionDays:2555}}).where(eq(schema.tenants.id,f.tenantId));await new Promise(r=>setTimeout(r,150));
    const old=new Date(Date.now()-365*86_400_000),now=new Date();await new RetentionRepository(database).applyRetention({tenantId:f.tenantId,now,messagesCutoff:old,memoryCutoff:now,riskSignalCutoff:old,auditLogCutoff:old});
    await capture.reconcileBacklog({tenantId:f.tenantId,userId:f.userId,surveyWindowId:f.window.id,coverageSnapshotAt:staleSnapshot});
    expect((await db.select().from(schema.pulseBacklog).where(eq(schema.pulseBacklog.id,before.id)))[0].status).toBe('done');
    expect((await backlog.getNextProbeQuestion(f.userId,f.tenantId))!.question.id).toBe(f.numeric[0].id);
    const reopened=(await db.select().from(schema.pulseBacklog).where(eq(schema.pulseBacklog.id,before.id)))[0];expect(reopened.position).toBe(before.position);expect(reopened.ignoreCount).toBe(2);
  });
  it('R4 partial numeric withdrawal closes the active topic without blocking the other two',async()=>{
    const f=await fixture();const backlog=new PulseBacklogService(new PulseBacklogRepository(database),survey,new QuestionInsightRepository(database,{} as never),capture);
    const first=await backlog.getNextProbeQuestion(f.userId,f.tenantId);await backlog.recordProbeSent(f.userId,f.window.id,first!.question.id,new Date());
    const lineage=(await client`select pulse_report_lineage(${f.window.id},${first!.question.id}) as id`)[0].id;await rights.withdraw(withdrawal(f,[lineage]));
    const next=await backlog.getNextProbeQuestion(f.userId,f.tenantId);expect(next).not.toBeNull();expect(next!.question.id).not.toBe(first!.question.id);
    expect((await db.select().from(schema.pulseBacklog).where(and(eq(schema.pulseBacklog.surveyWindowId,f.window.id),eq(schema.pulseBacklog.surveyQuestionId,first!.question.id))))[0].status).toBe('done');
  });
  it('R6 positive delivery freezes shown text and probe identity while permitting unrelated metadata',async()=>{
    const f=await fixture();const p=await prompt(f);const changed='On a scale from 1 to 10, how is the weather? Please reply with one whole number.';
    await expect(db.update(schema.messages).set({text:changed,metadata:{...(p.metadata as object),engagementProbe:{...(p.metadata as {engagementProbe:object}).engagementProbe,displayedFormHash:createHash('sha256').update(changed).digest('hex')}}}).where(eq(schema.messages.id,p.id))).rejects.toThrow('engagement_delivered_form_immutable');
    await db.update(schema.messages).set({metadata:{...(p.metadata as object),deliveryDiagnostic:'content-free'}}).where(eq(schema.messages.id,p.id));
  });
  it('R8 permanent receipt and DB-authored capture/acceptance clocks remain distinct and immutable',async()=>{
    const f=await fixture();await prompt(f);await new Promise(r=>setTimeout(r,3));const input=await answer(f,'7',new Date());await new Promise(r=>setTimeout(r,8));await capture.capture(input);
    const [revision]=await rows(f);const [event]=await db.select().from(schema.surveyEngagementCaptureEvents).where(eq(schema.surveyEngagementCaptureEvents.inboundReceiptId,input.inboundMessageId));
    expect(Date.parse(event.capturedAt!)).toBeGreaterThan(Date.parse(event.answerReceivedAt));expect(Date.parse(revision.acceptedAt!)).toBeGreaterThanOrEqual(Date.parse(event.capturedAt!));
    await expect(db.update(schema.surveyEngagementCaptureEvents).set({capturedAt:new Date().toISOString()}).where(eq(schema.surveyEngagementCaptureEvents.inboundReceiptId,input.inboundMessageId))).rejects.toThrow('engagement_capture_event_immutable');
    await expect(db.update(schema.surveyEngagementAnswerRevisions).set({acceptedAt:new Date().toISOString()}).where(eq(schema.surveyEngagementAnswerRevisions.inboundReceiptId,input.inboundMessageId))).rejects.toThrow('engagement_answer_immutable');
    await db.delete(schema.messages).where(inArray(schema.messages.id,[input.inboundMessageId,revision.promptMessageId]));
    expect((await rows(f))[0].acceptedAt).toBe(revision.acceptedAt);expect((await db.select().from(schema.surveyEngagementCaptureEvents).where(eq(schema.surveyEngagementCaptureEvents.inboundReceiptId,input.inboundMessageId)))[0].capturedAt).toBe(event.capturedAt);
  });

  async function orphanTarget(f:F):Promise<F> {
    const [definition]=await db.select().from(schema.surveyDefinitions).where(eq(schema.surveyDefinitions.id,f.definitionId));
    const [orphan]=await db.insert(schema.surveyDefinitions).values({...definition,id:randomUUID(),active:false,name:'orphan collection without envelope'}).returning();
    const questions=await db.insert(schema.surveyQuestions).values(f.questions.map(q=>({...q,id:randomUUID(),surveyDefinitionId:orphan.id}))).returning();
    const numeric=questions.filter(q=>q.responseType==='numeric_1_10_integer').sort((a,b)=>a.displayOrder-b.displayOrder);
    await db.insert(schema.surveyEngagementContractQuestions).values(numeric.map(q=>({surveyDefinitionId:orphan.id,surveyQuestionId:q.id,stableKey:q.stableKey,questionVersion:q.version,contractVersion:ENGAGEMENT_ANSWER_CONTRACT,displayedTextHash:createHash('sha256').update(q.title).digest('hex')})));
    await db.update(schema.surveyDefinitions).set({active:true}).where(eq(schema.surveyDefinitions.id,orphan.id));
    const periodStart=new Date(Date.now()+150),periodEnd=new Date(periodStart.getTime()+86_400_000);
    const [cycle]=await db.insert(schema.surveyCycleScoringPolicies).values({...f.cycle,id:randomUUID(),surveyDefinitionId:orphan.id,periodStart,periodEnd}).returning();
    await new Promise(r=>setTimeout(r,Math.max(0,periodStart.getTime()-Date.now()+5)));
    await scope.openOrgNativeCycle({tenantId:f.tenantId,surveyDefinitionId:orphan.id,periodStart:cycle.periodStart,periodEnd:cycle.periodEnd});
    const [window]=await db.insert(schema.surveyWindows).values({...f.window,id:randomUUID(),surveyDefinitionId:orphan.id,periodStart,periodEnd}).returning();
    const [participant]=await db.select().from(schema.surveyReportParticipants).where(and(eq(schema.surveyReportParticipants.cycleScoringPolicyId,cycle.id),eq(schema.surveyReportParticipants.userId,f.userId)));
    await db.insert(schema.surveyReportWindowBindings).values({tenantId:f.tenantId,surveyWindowId:window.id,cycleScoringPolicyId:cycle.id,participantId:participant.id});
    return {...f,definitionId:orphan.id,questions,numeric,cycle,window};
  }
  it('R5 adapter and independent SQL refuse orphan target even with another legitimate collection window',async()=>{
    const legitimate=await fixture();await prompt(legitimate);await capture.capture(await answer(legitimate));const [valid]=await rows(legitimate);
    const f=await orphanTarget(legitimate);const p=await prompt(f);const input=await answer(f);const receipt=(await client`select received_at::text at from messages where id=${input.inboundMessageId}`)[0].at;
    await expect(db.transaction(async tx=>{
      const lineage=(await tx.execute(sql`select pulse_report_lineage(${f.window.id}::uuid,${f.numeric[0].id}::uuid) id`) as unknown as {id:string}[])[0].id;
      await tx.insert(schema.surveyEngagementCaptureEvents).values({inboundReceiptId:input.inboundMessageId,tenantId:f.tenantId,userId:f.userId,status:'accepted',answerReceivedAt:receipt,surveyWindowId:f.window.id,lineageId:lineage,contractVersion:ENGAGEMENT_ANSWER_CONTRACT});
      await tx.insert(schema.surveyEngagementAnswerRevisions).values({...valid,inboundReceiptId:input.inboundMessageId,answerReceivedAt:receipt,surveyWindowId:f.window.id,surveyDefinitionId:f.definitionId,cycleScoringPolicyId:f.cycle.id,lineageId:lineage,surveyQuestionId:f.numeric[0].id,stableKey:f.numeric[0].stableKey,promptMessageId:p.id,promptSentAt:p.sentAt!.toISOString(),promptAcknowledgedAt:p.deliveryRecordedAt!,displayedFormHash:createHash('sha256').update(p.text).digest('hex')});
    })).rejects.toThrow('engagement_answer_scope_mismatch');
    expect((await capture.capture(input)).status).toBe('ineligible');expect(await rows(f)).toHaveLength(1);
  });
  it.each(['surveyDefinitionId','stableKey'] as const)('R7 independent SQL rejects contradictory delivered metadata %s',async(field)=>{
    const f=await fixture();await prompt(f);await capture.capture(await answer(f));const [valid]=await rows(f);
    const p=await prompt(f,0,new Date(),false);const probe=(p.metadata as {engagementProbe:Record<string,unknown>}).engagementProbe;
    await db.update(schema.messages).set({metadata:{engagementProbe:{...probe,[field]:field==='surveyDefinitionId'?randomUUID():'engagement_motivation'}}}).where(eq(schema.messages.id,p.id));
    const [delivered]=await db.update(schema.messages).set({sentAt:new Date()}).where(eq(schema.messages.id,p.id)).returning();const input=await answer(f);const receipt=(await client`select received_at::text at from messages where id=${input.inboundMessageId}`)[0].at;
    await expect(db.transaction(async tx=>{
      await tx.insert(schema.surveyEngagementCaptureEvents).values({inboundReceiptId:input.inboundMessageId,tenantId:f.tenantId,userId:f.userId,status:'accepted',answerReceivedAt:receipt,surveyWindowId:f.window.id,lineageId:valid.lineageId,contractVersion:ENGAGEMENT_ANSWER_CONTRACT});
      await tx.insert(schema.surveyEngagementAnswerRevisions).values({...valid,inboundReceiptId:input.inboundMessageId,answerReceivedAt:receipt,promptMessageId:p.id,promptSentAt:delivered.sentAt!.toISOString(),promptAcknowledgedAt:delivered.deliveryRecordedAt!});
    })).rejects.toThrow('engagement_prompt_identity_mismatch');
  });

});
