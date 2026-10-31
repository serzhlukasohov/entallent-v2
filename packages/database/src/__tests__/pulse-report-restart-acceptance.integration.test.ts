import { describe, expect, it, vi } from 'vitest';
import { acceptanceEmployeeDriver, acceptanceSeedSuite,closeAcceptanceResources,acceptanceNativeDriver,waitAcceptanceDue } from './pulse-report-acceptance.fixture';
import type { Job } from 'bullmq';
import {WithdrawReportingPermissionUseCase} from '@entalent/application';
import {PulseReportHistoryRepository} from '../../../../apps/worker/src/survey/repositories/pulse-report-history.repository';
import {ReportingPermissionRepository} from '../../../../apps/worker/src/survey/repositories/reporting-permission.repository';
import {randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pulsePublicationHash} from '../pulse-report-publication-state';

vi.mock('@entalent/channel-slack', async (original) => ({ ...await original<object>(),
  SlackAdapter: class {
    async sendMessage() { return { externalMessageId:(Date.now()/1000).toFixed(6),sentAt:new Date() }; }
  },
}));

describe.runIf(process.env.PULSE_ACCEPTANCE_OPT_IN==='local-synthetic')('RPT08 native queue loss and reconstruction',()=>{
  it('recovers lost dispatch hints for a committed turn with actual cutoff processor and never regenerates committed turns',async()=>{
    const seed=acceptanceSeedSuite();let driver:Awaited<ReturnType<typeof acceptanceEmployeeDriver>>|undefined,heldDriver:Awaited<ReturnType<typeof acceptanceEmployeeDriver>>|undefined;
    try{
      const f=await seed.fixture(1,6),held=await seed.fixture(1,6);
      driver=await acceptanceEmployeeDriver(seed,f);heldDriver=await acceptanceEmployeeDriver(seed,held);
      const user=f.users[0]!,heldUser=held.users[0]!;
      await driver.queues[1]!.pause();await driver.evidenceQueue.pause();
      const source=await driver.enqueueInbound(user,'Synthetic autonomy experience: '+user+' I choose work methods because decisions are delegated.');
      const checkpointDeadline=Date.now()+30_000;
      let checkpoint:Record<string,unknown>|undefined;
      while(Date.now()<checkpointDeadline){
        [checkpoint]=await seed.raw`select e.inbound_message_id,e.outbound_message_id,a.message_id admission_id,a.request_id,w.evidence,w.failure_code,m.sent_at
          from conversation_turn_effects e join conversation_job_admissions a on a.message_id=e.inbound_message_id
          join survey_report_inbound_work w on w.inbound_receipt_id=e.inbound_message_id join messages m on m.id=e.outbound_message_id
          where e.inbound_message_id=${source.id}`;
        if(checkpoint?.evidence==='pending')break;
        await new Promise(resolve=>setTimeout(resolve,25));
      }
      expect(checkpoint).toMatchObject({inbound_message_id:source.id,admission_id:source.id,evidence:'pending',failure_code:null,sent_at:null});
      expect(checkpoint!.request_id).toBeTruthy();expect(driver.calls.generateResponse).toBe(1);expect(driver.calls.evaluateSurveyEvidence??0).toBe(0);
      let original=await driver.queues[0]!.getJob('conversation-'+source.id);
      while(Date.now()<checkpointDeadline&&(await original?.getState())!=='completed'){
        await new Promise(resolve=>setTimeout(resolve,25));original=await driver.queues[0]!.getJob('conversation-'+source.id);
      }
      expect(original).toBeTruthy();expect(await original!.getState()).toBe('completed');await original!.remove();
      const evidenceHint=await driver.evidenceQueue.getJob('survey-evidence-'+source.id);
      expect(evidenceHint).toBeTruthy();expect(['waiting','paused']).toContain(await evidenceHint!.getState());await evidenceHint!.remove();
      const sendHints=(await driver.queues[1]!.getJobs(['waiting','paused'])).filter(job=>job.data.messageId===checkpoint!.outbound_message_id);
      expect(sendHints).toHaveLength(1);const lostSendHint=sendHints[0]!.id!;await sendHints[0]!.remove();
      const [pendingDispatch]=await seed.raw`select i.kind,i.completed_at,i.last_queued_at,m.sent_at from conversation_dispatch_intents i join messages m on m.id=i.target_id where i.inbound_message_id=${source.id} and i.kind='message_send'`;
      expect(pendingDispatch).toMatchObject({kind:'message_send',completed_at:null,sent_at:null});expect(pendingDispatch!.last_queued_at).toBeTruthy();
      const [pendingCounts]=await seed.raw`select count(*)::int n from conversation_dispatch_intents where inbound_message_id=${source.id} and completed_at is null`;
      expect(pendingCounts!.n).toBe(2);
      await driver.recreateMessageWorker();await driver.recreateEvidenceWorker();
      await heldDriver.queues[0]!.pause();
      const heldSource=await heldDriver.enqueueInbound(heldUser,'Synthetic autonomy experience: '+heldUser+' This uncommitted input lost its only hint.');
      const uncommittedHint=await heldDriver.queues[0]!.getJob('conversation-'+heldSource.id);expect(uncommittedHint).toBeTruthy();await uncommittedHint!.remove();
      expect(await seed.raw`select inbound_message_id from conversation_turn_effects where inbound_message_id=${heldSource.id}`).toHaveLength(0);expect(heldDriver.calls.generateResponse??0).toBe(0);
      const native=await acceptanceNativeDriver(seed);
      try{
      await waitAcceptanceDue(seed,f);await waitAcceptanceDue(seed,held);await native.tick();
      expect(await seed.raw`select id from survey_report_native_snapshots where tenant_id in (${f.tenantId},${held.tenantId})`).toHaveLength(0);
      const [age]=await seed.raw`select clock_timestamp()>=last_queued_at+interval '5 minutes' ready from conversation_dispatch_intents where inbound_message_id=${source.id} and kind='message_send'`;
      expect(age!.ready).toBe(true);
      await driver.cutoff.process({name:'cutoff'} as Job);
      const recoveredHints=(await driver.queues[1]!.getJobs(['waiting','paused'])).filter(job=>job.data.messageId===checkpoint!.outbound_message_id);
      expect(recoveredHints).toHaveLength(1);expect(recoveredHints[0]!.id).toMatch(/^message-send-recovery-/);expect(recoveredHints[0]!.id).not.toBe(lostSendHint);
      const recoveredEvidenceHint=await driver.evidenceQueue.getJob(evidenceHint!.id!);
      expect(recoveredEvidenceHint).toBeTruthy();expect(recoveredEvidenceHint!.id).toBe(evidenceHint!.id);
      expect(recoveredEvidenceHint!.data.inboundMessageId).toBe(source.id);expect(['waiting','paused']).toContain(await recoveredEvidenceHint!.getState());
      const [heldWork]=await seed.raw`select failure_code from survey_report_inbound_work where inbound_receipt_id=${heldSource.id}`;
      expect(heldWork!.failure_code).toBe('manual_reconciliation');
      await driver.queues[1]!.resume();await driver.evidenceQueue.resume();await driver.drain();
      const [resumed]=await seed.raw`select e.inbound_message_id,e.outbound_message_id,w.evidence,m.sent_at from conversation_turn_effects e join survey_report_inbound_work w on w.inbound_receipt_id=e.inbound_message_id join messages m on m.id=e.outbound_message_id where e.inbound_message_id=${source.id}`;
      expect(resumed).toMatchObject({inbound_message_id:source.id,outbound_message_id:checkpoint!.outbound_message_id,evidence:'applied'});expect(resumed!.sent_at).toBeTruthy();
      expect(await recoveredHints[0]!.getState()).toBe('completed');expect(driver.calls.generateResponse).toBe(1);expect(driver.calls.evaluateSurveyEvidence).toBe(1);
      const calls={...driver.calls};await driver.cutoff.process({name:'cutoff'} as Job);await driver.drain();expect(driver.calls).toEqual(calls);
      expect(await seed.raw`select inbound_message_id from conversation_turn_effects where inbound_message_id=${source.id}`).toHaveLength(1);
      expect(heldDriver.calls.generateResponse??0).toBe(0);expect(await heldDriver.queues[0]!.getJob('conversation-'+heldSource.id)).toBeUndefined();
      expect(await seed.raw`select id from survey_report_native_snapshots where tenant_id=${held.tenantId}`).toHaveLength(0);
      native.makeTransportUncertain(f.tenantId);
      await native.tick();
      const raceSnapshots=await seed.raw`select s.id snapshot_id,s.obligation_id,o.audience from survey_report_native_snapshots s join survey_report_obligations o on o.id=s.obligation_id where s.tenant_id=${f.tenantId}`;
      expect(raceSnapshots).toHaveLength(2);expect(native.posted.filter(post=>post.tenantId===f.tenantId)).toHaveLength(0);
      const target=raceSnapshots.find(row=>row.audience==='team_lead')!,other=raceSnapshots.find(row=>row.audience==='manager')!;
      expect(target).toBeTruthy();expect(other).toBeTruthy();
      await native.queue.pause();
      const otherHints=(await native.queue.getJobs(['waiting','paused'])).filter(job=>job.data.tenantId===f.tenantId&&job.data.obligationId===other.obligation_id);
      const removedOtherHintIds=otherHints.map(job=>job.id);for(const job of otherHints)await job.remove();
      const raceInventory=(await native.queue.getJobs(['active','waiting','paused'])).filter(job=>job.data.tenantId===f.tenantId);expect(raceInventory).toHaveLength(0);
      const gate=native.holdNextPost(f.tenantId);let barrierTimer:ReturnType<typeof setTimeout>|undefined;
      const raceData={tenantId:f.tenantId,obligationId:String(target.obligation_id),action:'deliver' as const};
      let overlap:Record<string,unknown>|undefined;
      native.worker.concurrency=2;
      try{
        const first=await native.queue.add('deliver',raceData,{jobId:'rpt08-race-first-'+randomUUID(),attempts:1});
        await native.queue.resume();
        await Promise.race([gate.entered,new Promise<never>((_resolve,reject)=>{barrierTimer=setTimeout(()=>reject(Error('acceptance_post_barrier_timeout')),30_000);})]);clearTimeout(barrierTimer);
        expect(await first.getState()).toBe('active');expect(native.posted.filter(post=>post.tenantId===f.tenantId)).toHaveLength(1);
        const twin=await native.queue.add('deliver',raceData,{jobId:'rpt08-race-twin-'+randomUUID(),attempts:1});
        expect(twin.data.obligationId).toBe(first.data.obligationId);expect(twin.data.tenantId).toBe(first.data.tenantId);
        await twin.waitUntilFinished(native.events,30_000);
        expect(await twin.getState()).toBe('completed');expect(await first.getState()).toBe('active');
        expect(native.posted.filter(post=>post.tenantId===f.tenantId)).toHaveLength(1);
        overlap={obligationId:target.obligation_id,firstJobId:first.id,twinJobId:twin.id,firstStateBeforeRelease:'active',twinStateBeforeRelease:'completed',postsBeforeRelease:1};
        gate.release();await first.waitUntilFinished(native.events,30_000);expect(await first.getState()).toBe('completed');
      }finally{clearTimeout(barrierTimer);gate.release();native.worker.concurrency=1;}
      for(let i=0;i<4;i++)await native.tick();
      const holds=await seed.raw`select o.id,s.id snapshot_id from survey_report_obligations o join survey_report_native_snapshots s on s.obligation_id=o.id where o.tenant_id=${f.tenantId} and o.status='reconciliation_required'`;
      expect(holds).toHaveLength(2);
      const posted=native.posted.filter((p)=>p.tenantId===f.tenantId).length;
      expect(posted).toBe(2);
      for(let i=0;i<3;i++)await native.tick();
      expect(native.posted.filter((p)=>p.tenantId===f.tenantId)).toHaveLength(posted);
      const [attempt]=await seed.raw`select a.*,p.route from survey_report_attempts a join survey_report_snapshot_payloads p on p.snapshot_id=a.snapshot_id where a.snapshot_id=${target.snapshot_id}`;
      const acceptedTarget=native.posted.filter(post=>post.tenantId===f.tenantId&&post.channel===attempt.route.channelId);
      expect(acceptedTarget).toHaveLength(1);expect(pulsePublicationHash(acceptedTarget[0]!.body)).toBe(attempt.body_hash);
      const command={tenantId:f.tenantId,snapshotId:String(attempt.snapshot_id),attemptId:String(attempt.id),token:Number(attempt.token),
        operator:{actorId:'synthetic-operator',tenantId:f.tenantId,snapshotId:String(attempt.snapshot_id),authorizationRef:'application_operator_fixture'},
        reason:'synthetic definitive provider evidence',evidenceRef:'fixture:positive-receipt',decision:'confirmed_delivered' as const,
        evidence:{kind:'provider_receipt' as const,channel:String(attempt.route.channelId),timestamp:'1793350000.999999',bodyHash:String(attempt.body_hash),ownerTerminated:true}};
      expect((await native.delivery.reconcile({...command,token:command.token+1})).status).toBe('stale_or_mismatched_evidence');
      expect((await native.delivery.reconcile(command)).status).toBe('confirmed_delivered');
      expect((await native.delivery.reconcile(command)).status).toBe('stale_or_mismatched_evidence');
      expect(heldDriver.calls.generateResponse??0).toBe(0);
      expect(await seed.raw`select id from survey_report_native_snapshots where tenant_id=${held.tenantId}`).toHaveLength(0);
      if(process.env.RPT08_OUTPUT_DIR)writeFileSync(resolve(process.env.RPT08_OUTPUT_DIR,'restart-dispatch-evidence.json'),JSON.stringify({runId:process.env.RPT08_RUN_ID,sourceHash:process.env.RPT08_SOURCE_HASH,status:'passed',scenario:'lost_committed_turn_dispatch_hints',inboundMessageId:source.id,outboundMessageId:checkpoint!.outbound_message_id,committedEffects:1,pendingDispatchesBeforeLoss:pendingCounts!.n,nativeEvidenceBefore:'pending',outboundSentBefore:false,lostQueuedHintIds:{messageSend:lostSendHint,evidence:evidenceHint!.id},recoveredQueuedHintIds:{messageSend:recoveredHints[0]!.id,evidence:recoveredEvidenceHint!.id},nativeEvidenceAfter:resumed!.evidence,outboundSentAfter:!!resumed!.sent_at,generateResponseBefore:1,generateResponseAfter:driver.calls.generateResponse,recreatedMessageWorker:true,recreatedEvidenceWorker:true,uncommittedHold:{inboundMessageId:heldSource.id,generatedResponses:heldDriver.calls.generateResponse??0,disposition:heldWork!.failure_code,snapshots:0},unknownSnapshots:holds.map(row=>row.snapshot_id),potentialProviderSends:posted,overlap,removedOtherHintIds,positiveReconciliationSnapshotId:target.snapshot_id,positiveReconciliationBodyHash:attempt.body_hash,currentTenantJobsBeforeRace:raceInventory.length,reconciliation:{scope:'application_operator_fixture',positive:'confirmed_delivered',wrongToken:'stale_or_mismatched_evidence',duplicate:'stale_or_mismatched_evidence'}}));
      }finally{await native.close();}
    }finally{await closeAcceptanceResources([...(driver?[()=>driver!.close()]:[]),...(heldDriver?[()=>heldDriver!.close()]:[]),()=>seed.cleanup()]);}
  },600_000);
  it('recovers exhausted evidence and lost native hints with recreated repositories under one real cutoff',async()=>{
    const seed=acceptanceSeedSuite();let driver:Awaited<ReturnType<typeof acceptanceEmployeeDriver>>|undefined,native:Awaited<ReturnType<typeof acceptanceNativeDriver>>|undefined;
    let releaseScore:(()=>void)|undefined;
    try{
      const f=await seed.fixture(8,4);driver=await acceptanceEmployeeDriver(seed,f);native=await acceptanceNativeDriver(seed);
      const ready=f.users,pendingUser=f.users[4]!,people=[...f.users,...f.leadList];
      await Promise.all(people.map(user=>driver!.confirmAutonomy(user)));
      for(const value of [6,8,10]){await Promise.all(people.map(user=>driver!.probe(user)));await Promise.all(people.map(user=>driver!.inbound(user,String(value))));}
      for(let tick=0;tick<4;tick++)await native.tick();
      const intermediate=await seed.raw`select s.id,s.artifact_hash from survey_report_native_snapshots s where tenant_id=${f.tenantId} and purpose='intermediate' order by s.id`;
      expect(intermediate).toHaveLength(2);
      const intermediateOwners=await seed.raw`select status from survey_report_obligations where tenant_id=${f.tenantId} and purpose='intermediate'`;
      expect(intermediateOwners).toHaveLength(2);expect(intermediateOwners.every(row=>row.status==='delivered')).toBe(true);
      const intermediateEvidence=async()=>JSON.stringify(await seed.raw`select s.id,s.artifact_hash,
        (select jsonb_agg(jsonb_build_object('id',p.id,'ordinal',p.ordinal,'bodyHash',p.body_hash) order by p.ordinal) from survey_report_parts p where p.snapshot_id=s.id) parts,
        (select jsonb_agg(to_jsonb(a) order by a.id) from survey_report_attempts a where a.snapshot_id=s.id) attempts,
        (select jsonb_agg(to_jsonb(r) order by r.attempt_id) from survey_report_receipts r where r.snapshot_id=s.id) receipts
        from survey_report_native_snapshots s where s.tenant_id=${f.tenantId} and s.purpose='intermediate' order by s.id`);
      const immutableIntermediateEvidence=await intermediateEvidence();
      const intermediatePublished=native.posted;
      const intermediateBodies=JSON.stringify(intermediatePublished.filter(post=>post.tenantId===f.tenantId));
      const rights=new WithdrawReportingPermissionUseCase(new ReportingPermissionRepository(seed.database));
      const withdrawal=(userId:string,lineageIds?:string[])=>({tenantId:f.tenantId,userId,personId:userId,requestId:randomUUID(),provenance:{kind:'authorized_internal_rights_request' as const,tenantId:f.tenantId,userId,personId:userId,verificationId:'application_rights_fixture:'+randomUUID(),receivedAt:new Date()},target:lineageIds?{kind:'partial_reporting' as const,lineageIds}:{kind:'full_reporting' as const}});
      const fullyWithdrawn=f.users.slice(6,8);
      for(const userId of fullyWithdrawn)await rights.execute(withdrawal(userId));
      const afterFull=await seed.scopes.scopeDenominator(f.tenantId,f.overallId);expect(afterFull.denominator).toBe(7);
      const partialSources=await seed.raw`select distinct l.id from survey_report_candidate_sources source join survey_report_input_candidates candidate on candidate.id=source.candidate_id join survey_report_question_lineages l on l.id=source.lineage_id and l.tenant_id=source.tenant_id join survey_questions q on q.id=l.survey_question_id join survey_report_insight_revisions revision on revision.insight_id=source.revision_id and revision.lineage_id=l.id where candidate.tenant_id=${f.tenantId} and candidate.scope_id=${f.overallId} and candidate.purpose='intermediate' and source.user_id=${f.users[5]!} and q.question_group='autonomy' and revision.proof_status='receipt_backed' order by l.id`;
      expect(partialSources).toHaveLength(3);const partial=partialSources[0]!;
      const contributedBeforePartial=await seed.raw`select distinct source.lineage_id from survey_report_candidate_sources source join survey_report_input_candidates candidate on candidate.id=source.candidate_id where candidate.tenant_id=${f.tenantId} and candidate.scope_id=${f.overallId} and candidate.purpose='intermediate' and source.user_id=${f.users[5]!}`;
      expect(contributedBeforePartial).toHaveLength(6);
      expect(contributedBeforePartial.map(row=>row.lineage_id)).toContain(partial.id);

      await rights.execute(withdrawal(f.users[5]!,[String(partial!.id)]));
      expect(await seed.scopes.scopeDenominator(f.tenantId,f.overallId)).toEqual(afterFull);
      expect(JSON.stringify(intermediatePublished.filter(post=>post.tenantId===f.tenantId))).toBe(intermediateBodies);

      const [retainedBodies]=await seed.raw`select count(*)::int n from survey_report_part_payloads p join survey_report_parts x on x.id=p.part_id join survey_report_native_snapshots s on s.id=x.snapshot_id where s.tenant_id=${f.tenantId} and s.purpose='intermediate'`;
      expect(retainedBodies!.n).toBe(0);
      expect(await intermediateEvidence()).toBe(immutableIntermediateEvidence);
      const purgedDelivered=await seed.raw`select o.status,s.purged_at from survey_report_obligations o join survey_report_native_snapshots s on s.obligation_id=o.id where o.tenant_id=${f.tenantId} and o.purpose='intermediate'`;
      expect(purgedDelivered.every(row=>row.status==='delivered'&&row.purged_at)).toBe(true);
      await driver.showAutonomyBundle(pendingUser,true);
      driver.failNextScoring();
      const failedSource=await driver.inbound(pendingUser,'Yes, correct.');
      const failedJob=await driver.evidenceQueue.getJob('survey-evidence-'+failedSource.id);
      expect(failedJob).toBeTruthy();expect(await failedJob!.getState()).toBe('failed');expect(failedJob!.attemptsMade).toBe(1);expect(driver.controlledFailureCount).toBe(1);
      const [pendingNative]=await seed.raw`select native_verdict,finalization,failure_code from survey_report_inbound_work where inbound_receipt_id=${failedSource.id}`;
      expect(pendingNative).toMatchObject({native_verdict:'applied',finalization:'pending',failure_code:null});
      const [failedReceipt]=await seed.raw`select r.inbound_message_id,r.verdict_kind,r.bundle_id,b.status,m.sent_at from survey_question_verdict_receipts r join survey_question_confirmation_bundles b on b.id=r.bundle_id join messages m on m.id=b.prompt_message_id where r.inbound_message_id=${failedSource.id}`;
      expect(failedReceipt).toMatchObject({inbound_message_id:failedSource.id,verdict_kind:'agree',status:'resolved'});expect(failedReceipt!.sent_at).toBeTruthy();
      await driver.recreateEvidenceWorker();
      await driver.showAutonomyBundle(ready[0]!,true);
      releaseScore=driver.holdScoring();
      const confirmation=await driver.enqueueInbound(ready[0]!,'Yes, that is correct.');
      const scoreDeadline=Date.now()+20_000;
      while(driver.scoreWaitCount===0&&Date.now()<scoreDeadline)await new Promise(resolve=>setTimeout(resolve,25));
      expect(driver.scoreWaitCount).toBeGreaterThan(0);
      await waitAcceptanceDue(seed,f);await native.tick();
      const [cutoff]=await seed.raw`select report_data_cutoff from survey_report_final_timings where tenant_id=${f.tenantId}`;
      expect(cutoff!.report_data_cutoff).toBeTruthy();
      const [timely]=await seed.raw`select received_at<${cutoff!.report_data_cutoff}::timestamptz timely from messages where id=${confirmation.id}`;
      expect(timely!.timely).toBe(true);
      expect(await seed.raw`select id from survey_report_native_snapshots where tenant_id=${f.tenantId} and purpose='final'`).toHaveLength(0);
      releaseScore();releaseScore=undefined;await driver.drain();
      await native.tick();
      expect(await seed.raw`select id from survey_report_native_snapshots where tenant_id=${f.tenantId} and purpose='final'`).toHaveLength(0);
      const responses=driver.calls.generateResponse;
      await driver.cutoff.process({name:'cutoff'} as Job);await driver.drain();
      expect(driver.calls.generateResponse).toBe(responses);
      const [recovered]=await seed.raw`select evidence,finalization from survey_report_inbound_work where inbound_receipt_id=${failedSource.id}`;
      expect(recovered).toMatchObject({evidence:'applied',finalization:'applied'});
      expect(await failedJob!.getState()).toBe('failed');
      await native.queue.pause();await native.scheduler.runOnce(100);
      const owners=await seed.raw`select id from survey_report_obligations where tenant_id=${f.tenantId} and purpose='final' order by id`;
      expect(owners).toHaveLength(2);
      const jobs=await native.queue.getJobs(['waiting','paused']);
      const ownJobs=jobs.filter(job=>job.data.tenantId===f.tenantId&&job.data.action==='form');
      expect(ownJobs.length).toBeGreaterThan(0);for(const job of ownJobs)await job.remove();
      await native.close();native=await acceptanceNativeDriver(seed);
      for(let count=0;count<6;count++)await native.tick();
      const finals=await seed.raw`select o.id,o.status,p.presentation from survey_report_obligations o join survey_report_native_snapshots s on s.obligation_id=o.id join survey_report_snapshot_payloads p on p.snapshot_id=s.id where o.tenant_id=${f.tenantId} and o.purpose='final' order by o.id`;
      expect(finals.map(row=>row.id)).toEqual(owners.map(row=>row.id));expect(finals.every(row=>row.status==='delivered'&&row.presentation.sections[0].status==='eligible')).toBe(true);
      const [after]=await seed.raw`select report_data_cutoff from survey_report_final_timings where tenant_id=${f.tenantId}`;
      expect(after!.report_data_cutoff).toEqual(cutoff!.report_data_cutoff);
      expect(await seed.raw`select s.id,s.artifact_hash from survey_report_native_snapshots s where tenant_id=${f.tenantId} and purpose='intermediate' order by s.id`).toEqual(intermediate);
      const selectedSources=await seed.raw`select distinct s.user_id,s.lineage_id from survey_report_candidate_sources s join survey_report_input_candidates c on c.id=s.candidate_id where c.tenant_id=${f.tenantId} and c.purpose='final' and c.invalidated_at is null`;
      expect(selectedSources.every(row=>!fullyWithdrawn.includes(String(row.user_id))&&row.lineage_id!==partial!.id)).toBe(true);
      expect(selectedSources.filter(row=>row.user_id===f.users[5]!)).toHaveLength(5);
      expect(JSON.stringify(intermediatePublished.filter(post=>post.tenantId===f.tenantId))).toBe(intermediateBodies);
      expect(await intermediateEvidence()).toBe(immutableIntermediateEvidence);
      const committedCalls={...driver.calls};await driver.cutoff.process({name:'cutoff'} as Job);await driver.drain();await native.tick();expect(driver.calls).toEqual(committedCalls);
      const terminalIdentity=await seed.raw`select o.id obligation_id,o.status,s.id snapshot_id,s.artifact_hash from survey_report_obligations o join survey_report_native_snapshots s on s.obligation_id=o.id where o.tenant_id=${f.tenantId} order by o.id`;
      const finalPublished=JSON.stringify(native.posted);
      await seed.raw`update users set status='deleted',deleted_at=clock_timestamp() where id=${f.users[1]!} and tenant_id=${f.tenantId}`;
      await seed.raw`delete from org_employee_placements where employee_person_id=${f.users[2]!} and tenant_id=${f.tenantId}`;
      await seed.raw`delete from users where id=${f.users[2]!} and tenant_id=${f.tenantId}`;
      await seed.raw`update tenants set retention_policy=retention_policy||'{"memoryRetentionDays":0.000000001}'::jsonb where id=${f.tenantId}`;
      await seed.raw`select pulse_publication_payload_purge(${f.tenantId},'-infinity'::timestamptz)`;
      const [expired]=await seed.raw`select (select count(*)::int from survey_report_input_candidates where tenant_id=${f.tenantId} and invalidated_at is null) live_candidates,(select count(*)::int from survey_report_snapshot_payloads where tenant_id=${f.tenantId}) payloads`;
      expect(expired).toMatchObject({live_candidates:0,payloads:0});
      const [scope]=await seed.raw`select history_key from survey_report_scopes where id=${f.overallId}`;
      const latest=await new PulseReportHistoryRepository(seed.database).completed(f.tenantId,String(scope!.history_key));
      expect(latest.length).toBeGreaterThan(0);expect(latest[0]!.authorized).toBe(false);
      for(const row of terminalIdentity)expect((await native.delivery.deliverNext(f.tenantId,String(row.snapshot_id))).status).toBe('not_claimed');
      await native.tick();
      expect(await seed.raw`select o.id obligation_id,o.status,s.id snapshot_id,s.artifact_hash from survey_report_obligations o join survey_report_native_snapshots s on s.obligation_id=o.id where o.tenant_id=${f.tenantId} order by o.id`).toEqual(terminalIdentity);
      expect(JSON.stringify(native.posted)).toBe(finalPublished);expect(await intermediateEvidence()).toBe(immutableIntermediateEvidence);
      if(process.env.RPT08_OUTPUT_DIR)writeFileSync(resolve(process.env.RPT08_OUTPUT_DIR,'restart-native-evidence.json'),JSON.stringify({runId:process.env.RPT08_RUN_ID,sourceHash:process.env.RPT08_SOURCE_HASH,status:'passed',failedJobId:failedJob!.id,failedSourceId:failedSource.id,failedBundleId:failedReceipt!.bundle_id,failedVerdictReceiptId:failedReceipt!.inbound_message_id,heldConfirmationId:confirmation.id,cutoff:cutoff!.report_data_cutoff,obligationIds:owners.map(row=>row.id),finals:finals.length,recreatedEvidenceWorker:true,recreatedNativeRepositories:true,rightsFixture:'application_rights_fixture',publishedBytes:'unchanged',retainedPrivatePayloads:'purged',immutableDeliveryEvidence:'unchanged',fullWithdrawalCount:2,remainingOverallDenominator:7,partialLineageId:partial!.id,softHardErasure:'passed',shortenedRetention:'passed',noPublishedIdentityRecreation:true}));
    }finally{
      releaseScore?.();
      await closeAcceptanceResources([...(native?[()=>native!.close()]:[]),...(driver?[()=>driver!.close()]:[]),()=>seed.cleanup()]);
    }
  },1_020_000);

});
