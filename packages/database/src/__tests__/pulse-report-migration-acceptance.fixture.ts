import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { randomUUID } from 'node:crypto';
import { sql as query } from 'drizzle-orm';
import { observePulseInputFrontier,pulseCandidateAuthorizationToken } from '../pulse-report-input-state';
import { pulsePublicationHash } from '../pulse-report-publication-state';
import { reportSourceFingerprint } from '../pulse-report-configuration';
import { selectPulseReportBaseline } from '../../../application/src/use-cases/select-pulse-report-baseline';
import { renderPulseReportForSlack } from '../../../channel-slack/src/pulse-report-renderer';
import { PULSE_ENGLISH_LABELS,PULSE_PRESENTATION_CONTRACT,PULSE_LABEL_VERSION,
  PulseReportPresentationSchema,type PulseReportPresentation } from '../../../contracts/src/pulse-report-presentation';
import type {PulseMetricCandidate,PulseCompletedFinal} from '../../../contracts/src/pulse-report-inputs';

export function acceptanceObligationIndexKey(purpose: 'final' | 'intermediate') {
  return purpose === 'intermediate' ? 'autonomy' : 'final';
}

export const RPT08_MIGRATION_PINS = Object.freeze({
  journal: '3e548de795070068cf27dc00b73d078f2e05c194cae4a6457f934cea40cee4fa',
  prefix: '67706c3991b78b7e5d4584192a3bc3e3982d7f06040dc5ecbcdb1178fce6141d',
  manifest: '5504da19cd7c0c6651bed35dc4c50b365438213a2ef467af83ed6be73c931281',
  snapshot91: '99bfef9a4ac8adf3616183b7e7c195ee54656bf79ac2998d1ec27cc2b02e1c4e',
  snapshot98: '236ad283ae52a9a099dbfe6cd0fc456e612ff19ead5699e69c5660c26a95eab9',
});
export const migrationHash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export function canonicalMigrationValue(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalMigrationValue).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => JSON.stringify(k) + ':' + canonicalMigrationValue(v)).join(',') + '}';
  return JSON.stringify(value);
}
export async function seedAcceptanceOldLanguageSources(root:string,url:string){
  const raw=postgres(url,{max:1,onnotice:()=>undefined});
  try{
    await raw.begin(async tx=>{
      await tx`select set_config('rpt08.existing_tenant','',true),set_config('rpt08.rubrics',${readFileSync(join(root,'scripts/data/v2-scoring-policy-1.0.0.json'),'utf8')},true)`;
      await tx.unsafe(readFileSync(join(root,'packages/database/src/__tests__/fixtures/rpt08/0091-native-upgrade.sql'),'utf8'));
      await tx.unsafe(readFileSync(join(root,'packages/database/src/__tests__/fixtures/rpt08/0091-language-upgrade.sql'),'utf8'));
    });
    const rows=await raw`select f.kind,f.id,f.tenant_id,q.score::float8 score,
      (select count(*)::int from survey_report_insight_revisions r where r.insight_id=q.id and r.proof_status='receipt_backed') receipts,
      (select count(*)::int from survey_report_topic_watermarks w where w.insight_id=q.id and w.state='retained' and w.expires_at>clock_timestamp()) watermarks
      from rpt08_fixture.inventory f join survey_question_insights q on q.id=f.id
      where f.tenant_id=current_setting('rpt08.last_tenant')::uuid order by f.kind`;
    return rows;
  }finally{await raw.end({timeout:5});}
}

export async function seedAcceptanceOldSchema(root:string,url:string,scenario: 'safe_first_cycle'|'safe_delivered'|'unsafe_untracked_history'|'unsafe_extra_metric'|'unsafe_unknown'|'safe_cache'|'unsafe_cache'|'safe_selected_history'|'unsafe_delivered'|'unsafe_intermediate'|'unsafe_insufficient_final'|'history_source'='safe_first_cycle',previous?:{tenantId:string;candidateId:string;cycleId:string}){
  const raw=postgres(url,{max:1,onnotice:()=>undefined});
  try{
    const missing=await raw`select table_name from information_schema.tables where table_name in ('pulse_language_resources','pulse_analytical_source_authorities')`;
    if(missing.length)throw Error('fixture_requires_actual_0091_schema');
    if(previous){
      const until=Date.now()+120_000;
      for(;;){const [clock]=await raw`select period_end<=clock_timestamp() due from survey_cycle_scoring_policies where id=${previous.cycleId}`;if(clock!.due)break;if(Date.now()>=until)throw Error('old_prior_cycle_end_timeout');await new Promise(resolve=>setTimeout(resolve,100));}
    }
    await raw.begin(async tx=>{
      await tx`select set_config('rpt08.existing_tenant',${previous?.tenantId??''},true)`;
      await tx`select set_config('rpt08.participant_count',${scenario==='unsafe_insufficient_final'?'4':'5'},true)`;
      await tx`select set_config('rpt08.rubrics',${readFileSync(join(root,'scripts/data/v2-scoring-policy-1.0.0.json'),'utf8')},true)`;
      await tx.unsafe(readFileSync(join(root,'packages/database/src/__tests__/fixtures/rpt08/0091-native-upgrade.sql'),'utf8'));
      if(scenario==='unsafe_intermediate'||scenario==='history_source'||scenario==='unsafe_cache')await tx.unsafe(readFileSync(join(root,'packages/database/src/__tests__/fixtures/rpt08/0091-index-upgrade.sql'),'utf8'));
    });
    const [inventory]=await raw`select t.id tenant_id,c.id cycle_id,s.id scope_id,c.scoring_policy_id,c.period_start,c.period_end,
      s.label,s.history_key,s.boundary_fingerprint,p.version policy_version from tenants t join survey_cycle_scoring_policies c on c.tenant_id=t.id
      join survey_report_scopes s on s.cycle_scoring_policy_id=c.id join survey_scoring_policies p on p.id=c.scoring_policy_id
      where t.id=current_setting('rpt08.last_tenant')::uuid and c.id=current_setting('rpt08.last_cycle')::uuid`;
    if(!inventory)throw Error('old_fixture_inventory_missing');
    const [indexSources]=await raw`select count(*)::int n,count(distinct q.user_id)::int people,avg(q.score)::float8 mean from survey_question_insights q join survey_report_window_bindings b on b.survey_window_id=q.survey_window_id and b.tenant_id=q.tenant_id where b.tenant_id=${inventory.tenant_id} and b.cycle_scoring_policy_id=${inventory.cycle_id}`;
    const expectsIndex=scenario==='unsafe_intermediate'||scenario==='history_source'||scenario==='unsafe_cache';
    if(indexSources!.n!==(expectsIndex?15:0)||indexSources!.people!==(expectsIndex?5:0)||indexSources!.mean!==(expectsIndex?70:null))throw Error('old_fixture_current_cycle_index_sources_invalid');
    const [answers]=await raw`select count(*)::int n,count(distinct user_id)::int people,avg(value)::float mean from survey_engagement_answer_revisions where tenant_id=${inventory.tenant_id} and cycle_scoring_policy_id=${inventory.cycle_id}`;
    if(answers!.n!==(scenario==='unsafe_insufficient_final'?12:15)||answers!.people!==(scenario==='unsafe_insufficient_final'?4:5)||answers!.mean!==8)throw Error('old_fixture_native_answers_missing');
    const due=new Date(Math.ceil((Date.now()+5_000)/60_000)*60_000);
    const calendar={timezone:'UTC',workingDays:[1,2,3,4,5,6,7],workStart:'00:00',workEnd:due.toISOString().slice(11,16),holidays:[],dateOverrides:[]};
    const configRevision=await raw.begin(async tx=>{
      await tx`select pg_advisory_xact_lock(hashtextextended(${'rpt08-old-config:'+inventory.tenant_id},0))`;
    await tx`insert into tenant_work_calendars(tenant_id,timezone,working_days,work_start,work_end,updated_by)values(${inventory.tenant_id},'UTC',array[1,2,3,4,5,6,7]::smallint[],'00:00',${calendar.workEnd},'rpt08-old-fixture') on conflict(tenant_id) do update set work_end=excluded.work_end,updated_at=clock_timestamp()`;
    const [revisionRow]=await tx`select (coalesce(max(revision),0)+1)::int revision from tenant_report_config_revisions where tenant_id=${inventory.tenant_id}`;
    const revision=Number(revisionRow!.revision);
    await tx`insert into tenant_report_config_revisions(tenant_id,revision,locale,calendar,source_fingerprint,actor_type,actor_id)values(${inventory.tenant_id},${revision},'en',${raw.json(calendar as never)}::jsonb,${reportSourceFingerprint({locale:'en',calendar})},'internal_operator','rpt08-old-fixture')`;
    await tx`insert into survey_report_final_timings(tenant_id,cycle_scoring_policy_id,config_revision,algorithm_version,status,timezone,local_date,local_work_end,final_due_at)
      values(${inventory.tenant_id},${inventory.cycle_id},${revision},'company-working-close-v1','scheduled','UTC',${due.toISOString().slice(0,10)},${calendar.workEnd},${due})`;
      return revision;
    });
    const purpose=scenario==='unsafe_intermediate'?'intermediate' as const:'final' as const;
    const deadline=Date.now()+75_000;
    if(purpose==='final'){
    while(Date.now()<deadline){const [r]=await raw`select clock_timestamp()>=${due} due`;if(r?.due)break;await new Promise(r=>setTimeout(r,100));}
    await raw`update survey_report_final_timings set status='started' where tenant_id=${inventory.tenant_id} and cycle_scoring_policy_id=${inventory.cycle_id}`;
    }
    const db=drizzle(raw);
    const observed=await db.transaction(tx=>observePulseInputFrontier(tx as never,{tenantId:String(inventory.tenant_id),cycleId:String(inventory.cycle_id),scopeId:String(inventory.scope_id),purpose,projection:'manager_overall',...(purpose==='intermediate'?{indexKey:'autonomy'}:{})}));
    if('reason' in observed)throw Error('old_fixture_unsettled_'+observed.reason);
    const context=observed.context;
    const catalog=await raw`select q.question_group,case when e.survey_question_id is not null then 'engagement' else q.question_group end metric_key from survey_cycle_scoring_policies cp join survey_questions q on q.survey_definition_id=cp.survey_definition_id left join survey_engagement_contract_questions e on e.survey_question_id=q.id and e.contract_version='engagement-1-10-v1' where cp.tenant_id=${inventory.tenant_id} and cp.id=${inventory.cycle_id} order by q.display_order,q.id`;
    const metricKeys=[...new Set(catalog.map(row=>String(row.metric_key)))].filter(key=>purpose==='final'||key!=='engagement');
    const metrics:PulseMetricCandidate[]=metricKeys.map(metricKey=>metricKey==='engagement'?{metricKey,kind:'engagement',rawMean:8,completeCount:scenario==='unsafe_insufficient_final'?4:5,status:scenario==='unsafe_insufficient_final'?'insufficient_data':'eligible',requiredCount:5}:{metricKey,kind:'index',rawMean:expectsIndex&&metricKey==='autonomy'?70:null,completeCount:expectsIndex&&metricKey==='autonomy'?5:0,status:expectsIndex&&metricKey==='autonomy'?'eligible':'insufficient_data',requiredCount:5});
    if(metrics.length!==(purpose==='final'?5:4))throw Error('old_fixture_metric_catalog_shape');
    const candidateId=randomUUID();
    await raw`insert into survey_report_input_candidates(id,tenant_id,cycle_id,scope_id,purpose,frontier,generation,calculation_contract,context,metrics,expires_at)
      values(${candidateId},${inventory.tenant_id},${inventory.cycle_id},${inventory.scope_id},${purpose},${context.frontier},${context.generation},'pulse-calculation-v1',${JSON.stringify(context)}::jsonb,${JSON.stringify(metrics)}::jsonb,(select min(expires_at) from survey_engagement_answer_revisions where tenant_id=${inventory.tenant_id} and cycle_scoring_policy_id=${inventory.cycle_id}))`;
    await raw`insert into survey_report_candidate_sources(candidate_id,tenant_id,user_id,lineage_id,revision_id)
      select ${candidateId}::uuid,tenant_id,user_id,lineage_id,inbound_receipt_id from survey_engagement_answer_revisions where tenant_id=${inventory.tenant_id} and cycle_scoring_policy_id=${inventory.cycle_id}
      union all select ${candidateId}::uuid,r.tenant_id,r.user_id,r.lineage_id,r.insight_id from survey_report_insight_revisions r join survey_report_question_lineages l on l.id=r.lineage_id and l.tenant_id=r.tenant_id where l.tenant_id=${inventory.tenant_id} and l.cycle_scoring_policy_id=${inventory.cycle_id} and r.proof_status='receipt_backed'`;
    const [sourceInventory]=await raw`select count(*)::int n,count(distinct lineage_id)::int lineages from survey_report_candidate_sources where candidate_id=${candidateId}`;
    if(sourceInventory!.n!==answers!.n+indexSources!.n||sourceInventory!.lineages!==sourceInventory!.n)throw Error('old_fixture_candidate_source_inventory');
    const [authorization]=await db.execute(query`select ${pulseCandidateAuthorizationToken()} token from survey_report_input_candidates c where c.id=${candidateId}::uuid`);
    const [timing]=await raw`select formation_started_at::text started,report_data_cutoff::text cutoff from survey_report_final_timings where tenant_id=${inventory.tenant_id} and cycle_scoring_policy_id=${inventory.cycle_id}`;
    const request={tenantId:String(inventory.tenant_id),cycleId:String(inventory.cycle_id),overallScopeId:String(inventory.scope_id),audience:'manager' as const,purpose,...(purpose==='intermediate'?{indexKey:'autonomy' as const}:{})};
    const scopes=[{scopeId:String(inventory.scope_id),kind:'manager_overall' as const,label:String(inventory.label),parentScopeId:null}];
    const assembly={request,scopes,locale:'en',timezone:'UTC',configRevision,
      configurationToken:pulsePublicationHash({revision:configRevision,locale:'en',calendar,scopes,timing:purpose==='final'?['started',timing!.started,timing!.cutoff,'UTC']:null}),
      periodStart:context.periodStart,periodEnd:context.periodEnd};
    const section={status:'prepared' as const,candidateId,candidateAuthorizationToken:String(authorization!.token),context,metrics,qualitative:[],finalGate:scenario==='unsafe_insufficient_final'?'insufficient_data' as const:'eligible' as const,
      baselineInventory:[] as PulseCompletedFinal[],baselines:Object.fromEntries(metrics.map(m=>[m.metricKey,selectPulseReportBaseline(context,m,[])]))};
    if(previous){
      const [prior]=await raw`select context,metrics from survey_report_input_candidates where id=${previous.candidateId}`;
      if(typeof prior!.context==='string')prior!.context=JSON.parse(prior!.context);
      if(typeof prior!.metrics==='string')prior!.metrics=JSON.parse(prior!.metrics);
      const [priorAuthorization]=await db.execute(query`select ${pulseCandidateAuthorizationToken()} token from survey_report_input_candidates c where c.id=${previous.candidateId}::uuid`);
      const history={candidateId:previous.candidateId,authorizationToken:String(priorAuthorization!.token),cycleId:previous.cycleId,periodStart:prior!.context.periodStart,periodEnd:prior!.context.periodEnd,
       historyKey:prior!.context.historyKey,boundaryFingerprint:prior!.context.boundaryFingerprint,compositionFingerprint:prior!.context.compositionFingerprint,compatibilitySignature:prior!.context.compatibilitySignature,
       authorized:true,metrics:prior!.metrics.filter((metric:PulseMetricCandidate)=>metric.metricKey===(purpose==='intermediate'?'autonomy':'engagement'))};
      section.baselineInventory=[history];
      section.baselines=Object.fromEntries(metrics.map(metric=>[metric.metricKey,selectPulseReportBaseline(context,metric,[history])])) as typeof section.baselines;
    }
    if(scenario.startsWith('unsafe_')&&previous){
      const [prior]=await raw`select metrics from survey_report_input_candidates where id=${previous.candidateId}`;
      const priorMetrics=typeof prior!.metrics==='string'?JSON.parse(prior!.metrics):prior!.metrics;
      section.baselineInventory=section.baselineInventory.map(history=>({...history,metrics:priorMetrics}));
    }else if(scenario.startsWith('unsafe_')){
      const priorId=scenario==='unsafe_extra_metric'?candidateId:randomUUID();
      Object.assign(section,{baselineInventory:[{candidateId:priorId,cycleId:context.cycleId,periodStart:context.periodStart,periodEnd:context.periodEnd,historyKey:context.historyKey,
        boundaryFingerprint:context.boundaryFingerprint,compositionFingerprint:context.compositionFingerprint,compatibilitySignature:context.compatibilitySignature,authorized:true,
        metrics:[{metricKey:'engagement',kind:'engagement',rawMean:8,completeCount:5,status:'eligible',requiredCount:5},{metricKey:'autonomy',kind:'index',rawMean:10,completeCount:5,status:'eligible',requiredCount:5}]}],
        baselines:{...section.baselines,engagement:{status:'comparable',priorCycleId:context.cycleId,priorRawMean:8,delta:0,compositionChanged:false}}});
    }
    const presentation=PulseReportPresentationSchema.parse({contract:PULSE_PRESENTATION_CONTRACT,locale:'en',period:'Synthetic old schema period',labels:PULSE_ENGLISH_LABELS,
      labelVersion:PULSE_LABEL_VERSION,labelHash:migrationHash(JSON.stringify(PULSE_ENGLISH_LABELS)),variant:purpose==='final'?'manager_final':'manager_intermediate',purpose,audience:'manager',...(purpose==='intermediate'?{indexKey:'autonomy'}:{}),sections:scenario==='unsafe_insufficient_final'?[{sectionKey:'sA',label:inventory.label,status:'insufficient_data'}]:[{sectionKey:'sA',label:inventory.label,status:'eligible',
        metric:{kind:purpose==='final'?'engagement':'index',value:purpose==='final'?'8.0':'70.0',...(purpose==='intermediate'?{indexKey:'autonomy'}:{}),direction:previous?'stable':'baseline_established',compositionChanged:false},
        narrative:{explanation:['Employees describe their work experience.'],focus:{kind:'none_supported'},actions:[]}}]});
    const rendered=renderPulseReportForSlack(presentation as PulseReportPresentation);
    const [bindingRow]=await raw`select a.id account_id,a.binding_revision account_revision,a.external_user_id,w.id workspace_id,w.binding_revision workspace_revision,w.external_workspace_id,p.id person_id from channel_accounts a join people p on p.id=a.user_id and p.tenant_id=a.tenant_id join workspace_connections w on w.tenant_id=a.tenant_id and w.external_workspace_id=a.external_workspace_id where a.tenant_id=${inventory.tenant_id}`;
    const binding={tenantId:String(inventory.tenant_id),scopeId:String(inventory.scope_id),personId:String(bindingRow!.person_id),userId:String(bindingRow!.person_id),accountId:String(bindingRow!.account_id),
      accountRevision:Number(bindingRow!.account_revision),workspaceConnectionId:String(bindingRow!.workspace_id),workspaceRevision:Number(bindingRow!.workspace_revision),workspaceId:String(bindingRow!.external_workspace_id),
      slackUserId:String(bindingRow!.external_user_id),channelId:'D'+String(bindingRow!.external_user_id),botUserId:'Bsynthetic'};
    const proofId=randomUUID();
    await raw`insert into survey_report_recipient_proofs(id,tenant_id,scope_id,binding,expires_at)values(${proofId},${inventory.tenant_id},${inventory.scope_id},${JSON.stringify(binding)}::jsonb,clock_timestamp()+interval '1 day')`;
    const route={...binding,proofId};
    const obligationId=randomUUID(),snapshotId=randomUUID(),partIds:string[]=[];
    const provenance={context:assembly,sections:[section]};
    const contracts={input:'pulse-inputs-v1',calculation:'pulse-calculation-v1',privacy:'question-deidentification-v2',engagement:'engagement-1-10-v1',presentation:PULSE_PRESENTATION_CONTRACT,labels:PULSE_LABEL_VERSION,
      renderer:'pulse-slack-v1',delivery:'pulse-delivery-v1',scoringPolicyId:String(inventory.scoring_policy_id),scoringVersion:String(inventory.policy_version),sourceCandidateIds:[candidateId,...(previous?[previous.candidateId]:[])]};
    const artifactHash=pulsePublicationHash({contracts,presentation,provenance,manifest:rendered.manifest,parts:rendered.parts,route});
    await raw.begin(async tx=>{
      await tx`insert into survey_report_obligations(id,tenant_id,cycle_id,scope_id,audience,purpose,index_key,status,assembly_token,frontier,config_revision)values(${obligationId},${inventory.tenant_id},${inventory.cycle_id},${inventory.scope_id},'manager',${purpose},${acceptanceObligationIndexKey(purpose)},'assembling',1,${context.frontier},${configRevision})`;
      if(scenario.endsWith('_cache')){
        await tx`insert into survey_report_assembly_inputs(obligation_id,tenant_id,context,sections,expires_at)values(${obligationId},${inventory.tenant_id},${JSON.stringify(assembly)}::jsonb,${JSON.stringify([section])}::jsonb,(select expires_at from survey_report_input_candidates where id=${candidateId}))`;
        return;
      }
      await tx`insert into survey_report_native_snapshots(id,tenant_id,obligation_id,cycle_id,scope_id,purpose,artifact_hash,part_count,expires_at)values(${snapshotId},${inventory.tenant_id},${obligationId},${inventory.cycle_id},${inventory.scope_id},${purpose},${artifactHash},${rendered.parts.length},(select expires_at from survey_report_input_candidates where id=${candidateId}))`;
      await tx`insert into survey_report_snapshot_payloads(snapshot_id,tenant_id,contracts,presentation,provenance,manifest,route)values(${snapshotId},${inventory.tenant_id},${JSON.stringify(contracts)}::jsonb,${JSON.stringify(presentation)}::jsonb,${JSON.stringify(provenance)}::jsonb,${JSON.stringify(rendered.manifest)}::jsonb,${JSON.stringify(route)}::jsonb)`;
      for(const [i,part]of rendered.parts.entries()){
        const partId=randomUUID();partIds.push(partId);await tx`insert into survey_report_parts(id,tenant_id,snapshot_id,ordinal,body_hash)values(${partId},${inventory.tenant_id},${snapshotId},${i+1},${pulsePublicationHash(part)})`;
        await tx`insert into survey_report_part_payloads(part_id,payload)values(${partId},${JSON.stringify(part)}::jsonb)`;
      }
      if(purpose==='final'&&scenario!=='unsafe_insufficient_final'){
      for(const metric of metrics.filter(metric=>metric.status==='eligible'&&metric.completeCount>=5&&metric.rawMean!==null))await tx`insert into survey_report_completion_supports(snapshot_id,candidate_id,tenant_id,cycle_id,history_key,metric_key,context_hash)values(${snapshotId},${candidateId},${inventory.tenant_id},${inventory.cycle_id},${context.historyKey},${metric.metricKey},${pulsePublicationHash(context)})`;
      await tx`insert into survey_report_final_completions(candidate_id,canonical_snapshot_id)values(${candidateId},${snapshotId})`;
      }
      await tx`update survey_report_obligations set status='snapshot_ready',completed_at=clock_timestamp() where id=${obligationId}`;
      if(scenario==='safe_delivered'||scenario==='unsafe_delivered'||scenario==='unsafe_unknown'){
        const attemptId=randomUUID();
        await tx`insert into survey_report_attempts(id,tenant_id,snapshot_id,part_id,token,artifact_hash,body_hash,route_hash,authorization_receipt)values(${attemptId},${inventory.tenant_id},${snapshotId},${partIds[0]!},1,${artifactHash},${pulsePublicationHash(rendered.parts[0])},${pulsePublicationHash(route)},${pulsePublicationHash(provenance)})`;
        await tx`update survey_report_parts set attempt_token=1,status='attempt_started' where id=${partIds[0]!}`;
        if(scenario==='safe_delivered'||scenario==='unsafe_delivered'){
          await tx`update survey_report_attempts set state='dispatching' where id=${attemptId}`;
          await tx`insert into survey_report_receipts(attempt_id,tenant_id,snapshot_id,channel,provider_timestamp)values(${attemptId},${inventory.tenant_id},${snapshotId},${route.channelId},'1793350000.000091')`;
          await tx`update survey_report_attempts set state='delivered',resolved_at=clock_timestamp() where id=${attemptId}`;
          await tx`update survey_report_parts set status='delivered' where id=${partIds[0]!}`;
          await tx`update survey_report_obligations set status='delivered',delivered_at=clock_timestamp() where id=${obligationId}`;
        }else{
          await tx`update survey_report_attempts set state='unknown',reason='synthetic_0091_timeout' where id=${attemptId}`;
          await tx`update survey_report_parts set status='unknown' where id=${partIds[0]!}`;
          await tx`update survey_report_obligations set status='reconciliation_required' where id=${obligationId}`;
        }
      }

    });
    return {scenario,tenantId:String(inventory.tenant_id),cycleId:String(inventory.cycle_id),scopeId:String(inventory.scope_id),snapshotId,candidateId,obligationId,artifactHash,partIds};
  }finally{await raw.end({timeout:5});}
}
export function migrationAcceptanceManifest(root: string) {
  const folder = resolve(root, 'packages/database/migrations');
  const raw = readFileSync(join(folder, 'meta/_journal.json'));
  const journal = JSON.parse(raw.toString()) as { entries: Array<{ idx: number; tag: string; when: number }> };
  const rows = journal.entries.map((entry) => ({ ...entry,
    sha256: migrationHash(readFileSync(join(folder, entry.tag + '.sql'))) }));
  const prefix = { ...journal, entries: journal.entries.filter((e) => e.idx <= 91) };
  const prefixManifest = rows.filter((e) => e.idx <= 91).map(({ idx, when, tag, sha256 }) => ({ idx, when, tag, sha256 }));
  // 0000-0098 stay byte-pinned; later forward migrations may only be appended after them.
  const protectedRows = rows.filter((e) => e.idx <= 98).map(({ idx, when, tag, sha256 }) => ({ idx, when, tag, sha256 }));
  const appended = rows.filter((e) => e.idx > 98);
  if (appended.some((e, i) => e.idx !== 99 + i || e.when <= (i ? appended[i - 1]! : rows[98]!).when)) throw Error('migration_journal_not_append_only');
  const pins = { journal: migrationHash(canonicalMigrationValue({ ...journal, entries: protectedRows })), prefix: migrationHash(canonicalMigrationValue(prefix)),
    manifest: migrationHash(canonicalMigrationValue(prefixManifest)),
    snapshot91: migrationHash(readFileSync(join(folder, 'meta/0091_snapshot.json'))),
    snapshot98: migrationHash(readFileSync(join(folder, 'meta/0098_snapshot.json'))) };
  for (const key of Object.keys(RPT08_MIGRATION_PINS) as Array<keyof typeof RPT08_MIGRATION_PINS>)
    if (pins[key] !== RPT08_MIGRATION_PINS[key]) throw Error('protected_migration_pin_changed_' + key);
  if (protectedRows.length !== 99 || rows.length !== protectedRows.length + appended.length || prefix.entries.length !== 92) throw Error('migration_inventory_count_changed');
  return { folder, journal, prefix, rows, pins };
}
export async function migrateAcceptancePrefix(root: string, output: string, url: string) {
  const manifest = migrationAcceptanceManifest(root);
  const folder = join(output, 'prefix-0091');
  mkdirSync(join(folder, 'meta'), { recursive: true });
  writeFileSync(join(folder, 'meta/_journal.json'), JSON.stringify(manifest.prefix));
  for (const entry of manifest.prefix.entries) cpSync(join(manifest.folder, entry.tag + '.sql'), join(folder, entry.tag + '.sql'));
  const sql = postgres(url, { max: 1, onnotice: () => undefined });
  try {
    const inventory = await sql`select table_name from information_schema.tables where table_schema='public'`;
    if (inventory.length) throw Error('upgrade_requires_empty_task_database');
    await migrate(drizzle(sql), { migrationsFolder: folder });
    const ledger = await sql`select id,hash,created_at::text from drizzle.__drizzle_migrations order by id`;
    if (ledger.length !== 92 || ledger.some((r, i) => r.hash !== manifest.rows[i]!.sha256
      || String(r.created_at) !== String(manifest.rows[i]!.when))) throw Error('old_schema_ledger_mismatch');
    writeFileSync(join(output, 'migration-manifest.json'), JSON.stringify(manifest, null, 2));
    return { manifest, ledger };
  } finally { await sql.end({ timeout: 5 }); }
}
