import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { acceptanceEmployeeDriver, acceptanceSeedSuite,closeAcceptanceResources, acceptanceNativeDriver, waitAcceptanceDue, ACCEPTANCE_ORACLES } from './pulse-report-acceptance.fixture';
import {ApiKeyGuard} from '../../../../apps/api/src/auth/api-key.guard';
import {HierarchyMutationService} from '../../../../apps/api/src/hierarchy/hierarchy-mutation.service';
import {HierarchyDeactivationService} from '../../../../apps/api/src/hierarchy/hierarchy-deactivation.service';
import * as schema from '../schema';

vi.mock('@entalent/channel-slack', async (original) => ({
  ...await original<object>(),
  SlackAdapter: class {
    async sendMessage(input: { conversationId: string }) {
      return { externalMessageId: (Date.now() / 1000).toFixed(6), externalConversationId: input.conversationId, sentAt: new Date() };
    }
  },
}));

describe.runIf(process.env.PULSE_ACCEPTANCE_OPT_IN==='local-synthetic')('RPT08 actual normalized ingress acceptance', () => {
  it('produces native shown confirmation and permanent scored source through real queues', async () => {
    if (process.env.PULSE_ACCEPTANCE_OPT_IN !== 'local-synthetic') throw Error('acceptance_explicit_opt_in_required');
    const seed = acceptanceSeedSuite();
    let driver: Awaited<ReturnType<typeof acceptanceEmployeeDriver>> | undefined;
    let noticeDriver: Awaited<ReturnType<typeof acceptanceEmployeeDriver>> | undefined;
    try {
      const f = await seed.fixture(10, 4, 2);
      const noticeFixture = await seed.fixture(4,4,1);
      driver = await acceptanceEmployeeDriver(seed, f);
      noticeDriver=await acceptanceEmployeeDriver(seed,noticeFixture);
      const people = [...f.users, ...f.leadList];
      for (const turn of ['substance', 'disclosure', 'bundle', 'agree']) {
        await Promise.all(people.map(async (person) => {
          const text = turn === 'substance' ? 'Synthetic autonomy experience: ' + person + ' I choose work methods because decisions are delegated.'
            : turn === 'disclosure' ? 'Could you reflect what I said about work methods.'
            : turn === 'bundle' ? 'Please reflect the work methods experience now.' : 'Yes, that is correct.';
          const admitted = await driver!.inbound(person, text);
          expect(admitted.received_at).toBeTruthy();
        }));
      }
      const rows = await seed.raw`select user_id,score from survey_question_insights where tenant_id=${f.tenantId}`;
      expect(rows).toHaveLength(36);
      const company=await seed.raw`select locale from tenants where id=${f.tenantId}`;expect(company[0]!.locale).toBe('de');
      for (const person of people) {
        const actual=rows.filter(row=>row.user_id===person).map(row=>Number(row.score)).sort((a,b)=>a-b),mean=driver.scores.get(person)!;
        expect(actual).toEqual([mean-11,mean+2,mean+9]);expect(actual.reduce((sum,score)=>sum+score,0)/3).toBe(mean);expect(actual).not.toContain(mean);
      }
      for (const numeric of [6,8,10]) {
        await Promise.all(people.map((person) => driver!.probe(person)));
        await Promise.all(people.map((person) => driver!.inbound(person, String(numeric))));
      }
      const answers = await seed.raw`select user_id,value from survey_engagement_answer_revisions where tenant_id=${f.tenantId}`;
      expect(answers).toHaveLength(36);
      expect(driver.calls.scoreConfirmedMeaning).toBe(36);
      const privateTrap='PRIVATE_SOURCE_TRAP_RPT08';
      await seed.db.insert(schema.messages).values({tenantId:f.tenantId,userId:f.users[0]!,conversationId:f.conversations.get(f.users[0]!)!,direction:'outbound',senderType:'agent',text:privateTrap,occurredAt:new Date()});
      const privateQuestion=f.questions.find(q=>q.questionGroup==='growth')!;
      await seed.db.insert(schema.surveyQuestionWorkingInsights).values({tenantId:f.tenantId,userId:f.users[0]!,surveyWindowId:f.windows.get(f.users[0]!)!,surveyQuestionId:privateQuestion.id,questionVersion:privateQuestion.version,workingSummary:'PRIVATE_WORKING_TRAP_RPT08'});

      const native = await acceptanceNativeDriver(seed);
      try {
        const privateControls=['select id from messages limit 0','select id from public.messages limit 0','select id from "public"."messages" limit 0','select id from public."survey_question_working_insights" limit 0','select id from "public".memories limit 0','select id from "public"."conversation_summaries" limit 0'];
        for(const query of privateControls){await expect(native.checkTransactionObservation(query)).rejects.toThrow();await expect(native.checkRawObservation(query)).rejects.toThrow();}
        await native.checkRawObservation('select id from public.survey_report_scopes limit 0');
        expect(native.observation.privateReadAttempts).toBe(privateControls.length*2);
        const genericAdmin={actorId:f.users[0]!,role:'admin',tenantId:f.tenantId};
        const guard=new ApiKeyGuard({get:()=> 'synthetic-rpt08-admin'} as never,{get:()=>undefined} as never);
        expect(guard.canActivate({getHandler:()=>function fixtureHandler(){},switchToHttp:()=>({getRequest:()=>({headers:{'x-api-key':'synthetic-rpt08-admin'}})})} as unknown as Parameters<ApiKeyGuard['canActivate']>[0])).toBe(true);
        const legitimate=await native.recipients.resolve(f.tenantId,f.overallId);
        expect(legitimate?.personId).toBe(f.manager);
        const [adminAccount]=await seed.raw`select id,external_user_id from channel_accounts where tenant_id=${genericAdmin.tenantId} and user_id=${genericAdmin.actorId}`;
        const adminCandidate={...legitimate!,personId:genericAdmin.actorId,userId:genericAdmin.actorId,accountId:String(adminAccount.id),slackUserId:String(adminAccount.external_user_id)};
        expect(await native.recipients.verify(adminCandidate,{workspaceId:adminCandidate.workspaceId,slackUserId:adminCandidate.slackUserId,channelId:'D'+adminCandidate.slackUserId,botUserId:'Bsynthetic',privateDm:true})).toBeNull();
        for (let i=0;i<4;i++) await native.tick();
        const intermediate = await seed.raw`select audience,purpose,status from survey_report_obligations where tenant_id=${f.tenantId}`;
        expect(intermediate.filter((r) => r.purpose === 'intermediate' && r.status === 'delivered').length).toBeGreaterThanOrEqual(3);
const [validManagerReport]=await seed.raw`select p.route from survey_report_snapshot_payloads p join survey_report_native_snapshots s on s.id=p.snapshot_id where s.tenant_id=${f.tenantId} and p.presentation->>'variant'='manager_intermediate'`;
expect(validManagerReport).toBeTruthy();
await seed.database.client.transaction(async tx=>{
 expect(await native.recipients.validate(tx as never,validManagerReport!.route)).toBe(true);
 expect(await native.recipients.validate(tx as never,{...validManagerReport!.route,...adminCandidate})).toBe(false);
});

        const candidates = await seed.raw`select id,scope_id,metrics from survey_report_input_candidates where tenant_id=${f.tenantId} and purpose='intermediate'`;
        const overall = candidates.find((c)=>c.scope_id===f.overallId)!;
        expect(overall.metrics.find((m:{metricKey:string})=>m.metricKey==='autonomy').rawMean).toBeCloseTo(ACCEPTANCE_ORACLES.overallMean,10);
        const overallMembers=await seed.raw`select distinct user_id from survey_report_candidate_sources where candidate_id=${overall.id}`;
        expect(overallMembers.map((r)=>String(r.user_id)).sort()).toEqual([...people].sort());

        for (const [index, team] of f.teamList.entries()) {
          const [scope] = await seed.raw`select id from survey_report_scopes where tenant_id=${f.tenantId} and org_team_id=${team.id}`;
          const candidate = candidates.find((c)=>c.scope_id===scope.id)!;
          expect(candidate.metrics.find((m:{metricKey:string})=>m.metricKey==='autonomy').rawMean).toBe(index===0?60:80);
          const members=await seed.raw`select distinct user_id from survey_report_candidate_sources where candidate_id=${candidate.id}`;
          expect(members.map((r)=>String(r.user_id)).sort()).toEqual(f.users.slice(index*5,(index+1)*5).sort());
        }
        const actor={type:'internal_operator' as const,operatorId:'synthetic-rpt08'};
        await new HierarchyMutationService(seed.database as never).moveEmployee(f.tenantId,f.users[0]!,f.unit.id,f.teamList[1]!.id,actor);
        await new HierarchyDeactivationService(seed.database as never).deactivatePerson(f.tenantId,f.users[1]!,actor);
        const stopped=await seed.raw`select user_id,origin_team_id,collection_stopped_at from survey_report_participants where tenant_id=${f.tenantId} and user_id in (${f.users[0]!},${f.users[1]!})`;
        expect(stopped).toHaveLength(2);
        expect(stopped.every((p)=>p.origin_team_id===f.teamList[0]!.id&&p.collection_stopped_at)).toBe(true);
        const afterStop=await driver.inbound(f.users[0]!,'Synthetic autonomy experience: '+f.users[0]+' New destination work must not enter the old cycle.');
        expect(await driver.questions.collectionAdmission({tenantId:f.tenantId,userId:f.users[0]!,surveyWindowId:f.windows.get(f.users[0]!)!,sourceMessageId:String(afterStop.id)})).toBe('stopped');
        const [nextCycle]=await seed.db.insert(schema.surveyCycleScoringPolicies).values({tenantId:f.tenantId,surveyDefinitionId:f.definitionId,
          periodStart:f.cycle.periodEnd,periodEnd:new Date(f.cycle.periodEnd.getTime()+86_400_000),scoringPolicyId:f.policy.id}).returning();
        const [timing] = await seed.raw`select final_due_at,clock_timestamp() now from survey_report_final_timings where tenant_id=${f.tenantId}`;
        expect(new Date(timing.final_due_at).getTime()).toBeGreaterThan(new Date(timing.now).getTime());
        const deadline = Date.now()+15*60_000;
        while (Date.now()<deadline) {
          const [clock] = await seed.raw`select clock_timestamp()>=final_due_at due from survey_report_final_timings where tenant_id=${f.tenantId}`;
          if(clock.due)break;
          await new Promise((r)=>setTimeout(r,500));
        }
        await waitAcceptanceDue(seed,noticeFixture);
      for(let i=0;i<6;i++) await native.tick();
        const finals = await seed.raw`select audience,purpose,status from survey_report_obligations where tenant_id=${f.tenantId} and purpose='final'`;
        expect(finals).toHaveLength(3);
        expect(finals.every((r)=>r.status==='delivered')).toBe(true);
        const [finalCandidate]=await seed.raw`select id,metrics from survey_report_input_candidates where tenant_id=${f.tenantId} and scope_id=${f.overallId} and purpose='final'`;
        expect(finalCandidate!.metrics.find((m:{metricKey:string})=>m.metricKey==='engagement').rawMean).toBe(8);
        const [frontier] = await seed.raw`select status,formation_started_at=report_data_cutoff same_cutoff,formation_started_at>=final_due_at due from survey_report_final_timings where tenant_id=${f.tenantId}`;
        expect(frontier).toMatchObject({status:'started',same_cutoff:true,due:true});
        while(Date.now()<f.cycle.periodEnd.getTime()+5)await new Promise((r)=>setTimeout(r,25));
        const nextOpening=await seed.scopes.openOrgNativeCycle({tenantId:f.tenantId,surveyDefinitionId:f.definitionId,periodStart:nextCycle!.periodStart,periodEnd:nextCycle!.periodEnd});
        const nextTeamA=nextOpening.scopes.find((s)=>s.orgTeamId===f.teamList[0]!.id)!;
        const nextTeamB=nextOpening.scopes.find((s)=>s.orgTeamId===f.teamList[1]!.id)!;
        expect(nextTeamA.participantUserIds.sort()).toEqual(f.users.slice(2,5).sort());
        expect(nextTeamB.participantUserIds.sort()).toEqual([f.users[0]!,...f.users.slice(5,10)].sort());
        expect(nextOpening.scopes.flatMap((s)=>s.participantUserIds)).not.toContain(f.users[1]);
        const snapshots = await seed.raw`select s.id,s.purpose,s.artifact_hash,p.presentation,p.manifest,p.provenance,p.contracts,p.route from survey_report_native_snapshots s join survey_report_snapshot_payloads p on p.snapshot_id=s.id where s.tenant_id=${f.tenantId}`;
        expect(snapshots).toHaveLength(6);
        const notices=await seed.raw`select s.id,s.purpose,s.artifact_hash,p.presentation,p.manifest,p.provenance,p.contracts,p.route from survey_report_native_snapshots s join survey_report_snapshot_payloads p on p.snapshot_id=s.id where s.tenant_id=${noticeFixture.tenantId}`;
        expect(notices).toHaveLength(2);
        expect(notices.every((n)=>n.presentation.sections[0].status==='insufficient_data')).toBe(true);
        for(const [audience,purpose,count]of [['team_lead','intermediate',2],['manager','intermediate',3],['team_lead','final',2],['manager','final',3]] as const)expect(native.narrativeInputs.filter(input=>input.audience===audience&&input.purpose===purpose)).toHaveLength(count);
        expect(native.narrativeTenants.filter(tenant=>tenant===f.tenantId)).toHaveLength(10);expect(native.narrativeTenants.filter(tenant=>tenant===noticeFixture.tenantId)).toHaveLength(0);
        snapshots.push(...notices);
        expect(new Set(snapshots.map((s)=>s.presentation.variant))).toEqual(new Set(['team_lead_intermediate','manager_intermediate','team_lead_final','manager_final']));
        for (const snapshot of snapshots) {
          const parts = await seed.raw`select b.payload from survey_report_parts p join survey_report_part_payloads b on b.part_id=p.id where p.snapshot_id=${snapshot.id} order by p.ordinal`;
          expect(parts.length).toBeGreaterThan(0);
          snapshot.storedParts=parts.map((p)=>p.payload);
          const json = JSON.stringify(parts);
          for(const person of people) expect(json).not.toContain(person);
          expect(json).not.toContain('PRIVATE_SOURCE_TRAP_RPT08');
          expect(json).not.toContain('PRIVATE_WORKING_TRAP_RPT08');
          if(snapshot.presentation.variant==='team_lead_intermediate')expect(json).not.toContain('68.3');
        }
        const [receipts] = await seed.raw`select count(*)::int n from survey_report_receipts where tenant_id=${f.tenantId}`;
        expect(receipts.n).toBe(native.posted.filter((p)=>p.tenantId===f.tenantId).length);
        expect(receipts.n).toBeGreaterThanOrEqual(6);
      expect(native.observation.queries).toBeGreaterThan(0);
      expect(native.observation.privateReadAttempts).toBe(privateControls.length*2);
      expect(JSON.stringify(native.narrativeInputs)).not.toContain('PRIVATE_SOURCE_TRAP_RPT08');
      expect(JSON.stringify(native.narrativeInputs)).not.toContain('PRIVATE_WORKING_TRAP_RPT08');
        if(process.env.RPT08_OUTPUT_DIR){
          mkdirSync(process.env.RPT08_OUTPUT_DIR,{recursive:true});
          writeFileSync(resolve(process.env.RPT08_OUTPUT_DIR,'connected-preview-input.json'),JSON.stringify({synthetic:true,sourceHash:process.env.RPT08_SOURCE_HASH,companyLocale:String(company[0]!.locale),personalLocales:['uk'],snapshots},null,2));
        }

        const priorRaw=finalCandidate!.metrics.find((metric:{metricKey:string})=>metric.metricKey==='autonomy').rawMean;
        expect(priorRaw).toBeCloseTo(820/12,10);
        const priorCompletion=await seed.raw`select c.candidate_id,c.canonical_snapshot_id from survey_report_final_completions c join survey_report_input_candidates input on input.id=c.candidate_id join survey_report_native_snapshots s on s.id=c.canonical_snapshot_id and s.tenant_id=input.tenant_id and s.purpose='final' where c.candidate_id=${finalCandidate!.id}`;
        expect(priorCompletion).toHaveLength(1);
        const currentPeople=people.filter(person=>person!==f.users[1]);
        expect(currentPeople).toHaveLength(11);
        for(const [index,person] of currentPeople.entries()){
          const window=await seed.survey.findOrCreateActiveWindow(person,f.tenantId);
          if(!window||'kind' in window)throw Error('acceptance_successor_window_missing');
          expect(window.id).not.toBe(f.windows.get(person));f.windows.set(person,window.id);
          driver.scores.set(person,index===currentPeople.length-1?71:68);
        }
        for(const turn of ['substance','disclosure','bundle','agree'])await Promise.all(currentPeople.map(person=>driver!.inbound(person,turn==='substance'?'Synthetic autonomy experience: '+person+' Revised work decisions delegated weekly.':turn==='disclosure'?'Could you reflect what I said about work methods.':turn==='bundle'?'Please reflect work methods experience now.':'Yes, correct.')));
        for(let index=0;index<4;index++)await native.tick();
        const [currentReport]=await seed.raw`select s.id,p.provenance,p.presentation,p.contracts from survey_report_native_snapshots s join survey_report_snapshot_payloads p on p.snapshot_id=s.id where s.tenant_id=${f.tenantId} and s.cycle_id=${nextCycle!.id} and s.purpose='intermediate' and p.presentation->>'variant'='manager_intermediate' and p.presentation->>'indexKey'='autonomy'`;
        expect(currentReport).toBeTruthy();
        const currentSection=currentReport!.provenance.sections.find((section:{context:{scopeKind:string}})=>section.context.scopeKind==='manager_overall');
        const currentMetric=currentSection.metrics.find((metric:{metricKey:string})=>metric.metricKey==='autonomy');
        expect(currentMetric.rawMean).toBeCloseTo(751/11,10);
        const baseline=currentSection.baselines.autonomy;
        expect(baseline).toMatchObject({status:'comparable',priorCycleId:f.cycle.id,direction:'declining',compositionChanged:true});
        expect(baseline.previousRawMean).toBe(priorRaw);expect(baseline.rawDelta).toBeCloseTo(751/11-820/12,10);expect(baseline.rawDelta).toBeLessThan(0);
        const displayed=currentReport!.presentation.sections[0].metric;
        expect(displayed).toMatchObject({kind:'index',indexKey:'autonomy',value:'68.3',direction:'declining',compositionChanged:true});
        expect(displayed.value).toBe(priorRaw.toFixed(1));expect(currentMetric.rawMean).not.toBe(priorRaw);
        expect(currentSection.baselineInventory).toHaveLength(1);expect(currentSection.baselineInventory[0]).toMatchObject({candidateId:finalCandidate!.id,cycleId:f.cycle.id,authorized:true});
        expect(currentReport!.contracts.sourceCandidateIds).toContain(finalCandidate!.id);
        const currentMembers=await seed.raw`select distinct user_id from survey_report_candidate_sources where candidate_id=${currentSection.candidateId}`;
        expect(currentMembers.map(row=>String(row.user_id)).sort()).toEqual([...currentPeople].sort());
        const currentReceipts=await seed.raw`select provider_timestamp from survey_report_receipts where snapshot_id=${currentReport!.id}`;
        expect(currentReceipts.length).toBeGreaterThan(0);expect(currentReceipts.every(row=>Boolean(row.provider_timestamp))).toBe(true);
        if(process.env.RPT08_OUTPUT_DIR)writeFileSync(resolve(process.env.RPT08_OUTPUT_DIR,'connected-history-evidence.json'),JSON.stringify({sourceHash:process.env.RPT08_SOURCE_HASH,status:'passed',priorCycleId:f.cycle.id,priorCandidateId:finalCandidate!.id,priorCanonicalSnapshotId:priorCompletion[0]!.canonical_snapshot_id,currentSnapshotId:currentReport!.id,priorRaw,currentRaw:currentMetric.rawMean,rawDelta:baseline.rawDelta,displayedValue:displayed.value,priorRawFormatted:priorRaw.toFixed(1),priorAutonomyLiteralDisplayed:false,direction:baseline.direction,currentRosterCount:currentPeople.length,receiptCount:currentReceipts.length},null,2));
      } finally { await native.close(); }
    } finally {
      await closeAcceptanceResources([...(driver?[()=>driver!.close()]:[]),...(noticeDriver?[()=>noticeDriver!.close()]:[]),()=>seed.cleanup()]);
    }
  }, 1_020_000);
  it('delivers eligible finals with exactly one two three or four changed contributors after native intermediates',async()=>{
    const seed=acceptanceSeedSuite();
    const drivers:Awaited<ReturnType<typeof acceptanceEmployeeDriver>>[]=[];
    const native=await acceptanceNativeDriver(seed);
    try{
      const fixtures=[];
      for(const changedCount of [1,2,3,4]){
        const f=await seed.fixture(5,4,1),driver=await acceptanceEmployeeDriver(seed,f);
        drivers.push(driver);
        const people=[...f.users,...f.leadList];
        for(const turn of ['substance','disclosure','bundle','agree']){
          await Promise.all(people.map(person=>driver.inbound(person,turn==='substance'
            ?'Synthetic autonomy experience: '+person+' I choose methods because decisions are delegated.'
            :turn==='disclosure'?'Continue this question.':turn==='bundle'?'That reflects my experience.':'Yes, all of these are accurate.')));
        }
        for(const answer of [6,8,10]){
          await Promise.all(people.map(person=>driver.probe(person)));
          await Promise.all(people.map(person=>driver.inbound(person,String(answer))));
        }
        for(let tick=0;tick<4;tick++)await native.tick();
        const [intermediate]=await seed.raw`select id from survey_report_input_candidates where tenant_id=${f.tenantId} and scope_id=${f.overallId} and purpose='intermediate'`;
        expect(intermediate).toBeTruthy();
        const before=await seed.raw`select source.user_id,source.lineage_id,source.revision_id from survey_report_candidate_sources source join survey_report_question_lineages lineage on lineage.id=source.lineage_id and lineage.tenant_id=source.tenant_id join survey_questions question on question.id=lineage.survey_question_id where source.candidate_id=${intermediate!.id} and lineage.answer_kind='open_ended' and question.question_group='autonomy' order by source.user_id,source.lineage_id,source.revision_id`;
        expect(before).toHaveLength(people.length*3);
        const numericBefore=await seed.raw`select user_id,lineage_id,inbound_receipt_id,value from survey_engagement_answer_revisions where tenant_id=${f.tenantId} and cycle_scoring_policy_id=${f.cycleId} order by user_id,lineage_id,inbound_receipt_id`;
        expect(numericBefore).toHaveLength(people.length*3);
        const intermediatePublication=()=>seed.raw`select o.id obligation_id,o.audience,o.status,s.id snapshot_id,s.artifact_hash,
          (select jsonb_agg(jsonb_build_object('id',p.id,'ordinal',p.ordinal,'bodyHash',p.body_hash) order by p.ordinal) from survey_report_parts p where p.snapshot_id=s.id) parts,
          (select count(*)::int from survey_report_receipts r where r.snapshot_id=s.id) receipts
          from survey_report_obligations o join survey_report_native_snapshots s on s.obligation_id=o.id where o.tenant_id=${f.tenantId} and o.purpose='intermediate' order by o.id`;
        const publishedIntermediate=await intermediatePublication();
        expect(publishedIntermediate).toHaveLength(2);
        expect(new Set(publishedIntermediate.map(row=>row.audience))).toEqual(new Set(['team_lead','manager']));
        expect(publishedIntermediate.every(row=>row.status==='delivered'&&row.parts.length>0&&row.receipts===row.parts.length)).toBe(true);
        const intermediatePosted=native.posted.filter(post=>post.tenantId===f.tenantId);
        expect(intermediatePosted).toHaveLength(publishedIntermediate.reduce((sum,row)=>sum+row.receipts,0));
        const intermediatePublicationBefore=JSON.stringify(publishedIntermediate),intermediatePostedBefore=JSON.stringify(intermediatePosted),intermediatePostedCount=intermediatePosted.length;
        const changedPeople=f.users.slice(0,changedCount);
        for(const person of changedPeople){
          driver.scores.set(person,70);
          for(const text of ['Synthetic autonomy experience: '+person+' Revised work decisions are delegated weekly.','Continue this question.','That reflects my revised experience.','Yes, all of these are accurate.'])await driver.inbound(person,text);
          const revisions=await seed.raw`select id from survey_question_insights where tenant_id=${f.tenantId} and user_id=${person}`;
          expect(revisions.length).toBeGreaterThan(3);
        }
        fixtures.push({f,before,numericBefore,changedPeople,intermediatePublication,intermediatePublicationBefore,intermediatePostedBefore,intermediatePostedCount});
      }
      await waitAcceptanceDue(seed,fixtures.at(-1)!.f);
      for(let tick=0;tick<7;tick++)await native.tick();
      const results=[];
      for(const {f,before,numericBefore,changedPeople,intermediatePublication,intermediatePublicationBefore,intermediatePostedBefore,intermediatePostedCount}of fixtures){
        const [final]=await seed.raw`select id from survey_report_input_candidates where tenant_id=${f.tenantId} and scope_id=${f.overallId} and purpose='final'`;
        expect(final).toBeTruthy();
        const after=await seed.raw`select source.user_id,source.lineage_id,source.revision_id from survey_report_candidate_sources source join survey_report_question_lineages lineage on lineage.id=source.lineage_id and lineage.tenant_id=source.tenant_id join survey_questions question on question.id=lineage.survey_question_id where source.candidate_id=${final!.id} and lineage.answer_kind='open_ended' and question.question_group='autonomy' order by source.user_id,source.lineage_id,source.revision_id`;
        expect(after).toHaveLength(before.length);
        expect(after.map(row=>row.lineage_id).sort()).toEqual(before.map(row=>row.lineage_id).sort());
        expect(await seed.raw`select user_id,lineage_id,inbound_receipt_id,value from survey_engagement_answer_revisions where tenant_id=${f.tenantId} and cycle_scoring_policy_id=${f.cycleId} order by user_id,lineage_id,inbound_receipt_id`).toEqual(numericBefore);
        const selectedNumeric=await seed.raw`select source.revision_id from survey_report_candidate_sources source join survey_report_question_lineages lineage on lineage.id=source.lineage_id and lineage.tenant_id=source.tenant_id where source.candidate_id=${final!.id} and lineage.answer_kind='numeric_1_10_integer' order by source.revision_id`;
        expect(selectedNumeric.map(row=>row.revision_id).sort()).toEqual(numericBefore.map(row=>row.inbound_receipt_id).sort());
        const people=[...f.users,...f.leadList];
        const signature=(rows:typeof before,person:string)=>rows.filter(r=>r.user_id===person).map(r=>String(r.revision_id)).sort().join(',');
        expect(people.filter(person=>signature(before,person)!==signature(after,person)).sort()).toEqual([...changedPeople].sort());
        const finals=await seed.raw`select status,id from survey_report_obligations where tenant_id=${f.tenantId} and purpose='final'`;
        expect(finals).toHaveLength(2);
        expect(finals.every(row=>row.status==='delivered')).toBe(true);
        const [receipts]=await seed.raw`select count(*)::int n from survey_report_receipts where tenant_id=${f.tenantId}`;
        expect(receipts!.n).toBe(native.posted.filter(p=>p.tenantId===f.tenantId).length);
        expect(JSON.stringify(await intermediatePublication())).toBe(intermediatePublicationBefore);
        expect(JSON.stringify(native.posted.filter(post=>post.tenantId===f.tenantId).slice(0,intermediatePostedCount))).toBe(intermediatePostedBefore);
        results.push({changedCount:changedPeople.length,status:'passed',finals:finals.length,receipts:receipts!.n,intermediatePublication:JSON.parse(intermediatePublicationBefore)});
      }
      if(process.env.RPT08_OUTPUT_DIR)writeFileSync(resolve(process.env.RPT08_OUTPUT_DIR,'changed-people.json'),JSON.stringify({runId:process.env.RPT08_RUN_ID,sourceHash:process.env.RPT08_SOURCE_HASH,results}));
    }finally{
      await closeAcceptanceResources([()=>native.close(),...drivers.map(driver=>()=>driver.close()),()=>seed.cleanup()]);
    }
  },1_020_000);

});
