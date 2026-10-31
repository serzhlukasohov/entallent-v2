import {describe,it,expect} from 'vitest';
import {surveyReportObligations} from '../schema';
import type {PulseBaseline} from '../../../contracts/src/pulse-report-inputs';
import {resolve,join} from 'node:path';
import {mkdirSync,writeFileSync} from 'node:fs';
import postgres from 'postgres';
import {drizzle} from 'drizzle-orm/postgres-js';
import {migrate} from 'drizzle-orm/postgres-js/migrator';
import {migrateAcceptancePrefix,migrationAcceptanceManifest,seedAcceptanceOldSchema,seedAcceptanceOldLanguageSources,canonicalMigrationValue,migrationHash,acceptanceObligationIndexKey} from './pulse-report-migration-acceptance.fixture';
import {acceptanceSeedSuite,closeAcceptanceResources,acceptanceNativeDriver} from './pulse-report-acceptance.fixture';

describe('RPT08 migration fixture construction',()=>{
  it('matches production final and intermediate obligation index sentinels',()=>{
    expect(acceptanceObligationIndexKey('final')).toBe(surveyReportObligations.indexKey.default);
    expect(acceptanceObligationIndexKey('intermediate')).toBe('autonomy');
  });
});

describe.runIf(process.env.PULSE_ACCEPTANCE_OPT_IN==='local-synthetic')('RPT08 actual old-schema migration acceptance',()=>{
  it('runs unchanged0091 schema guards then0092 through0098 preserving safe native bytes and current delivery',async()=>{
    const root=resolve(__dirname,'../../../..'),output=process.env.RPT08_OUTPUT_DIR!,runId=process.env.RPT08_RUN_ID!;
    const upgrade=process.env.RPT08_UPGRADE_DATABASE_URL!,fresh=process.env.RPT08_FRESH_DATABASE_URL!;
    for(const [target,suffix] of [[upgrade,'upgrade'],[fresh,'fresh']]){
      const url=new URL(target!);expect(url.hostname).toMatch(/^(127\.0\.0\.1|localhost)$/);
      expect(url.pathname).toBe('/entalent_rpt08_'+runId+'_'+suffix);
    }
    if(!output||!runId)throw Error('acceptance_run_output_required');
    const out=join(output,'migration');mkdirSync(out,{recursive:true});
    const manifest=migrationAcceptanceManifest(root);
    const before=await migrateAcceptancePrefix(root,out,upgrade);
    const sql=postgres(upgrade,{max:1,onnotice:()=>undefined});
    const freshSql=postgres(fresh,{max:1,onnotice:()=>undefined});
    const original=process.env.DATABASE_URL;
    let seed:ReturnType<typeof acceptanceSeedSuite>|undefined,native:Awaited<ReturnType<typeof acceptanceNativeDriver>>|undefined;
    try{
      const [shape]=await sql`select pg_get_constraintdef(oid) definition from pg_constraint where conname='report_obligation_shape'`;
      expect(shape!.definition).toContain("index_key = '"+acceptanceObligationIndexKey('final')+"'");
      expect(shape!.definition).toContain("'"+acceptanceObligationIndexKey('intermediate')+"'::text");
      await sql`create schema rpt08_fixture`;
      await sql`create table rpt08_fixture.inventory(kind text not null,id uuid not null,tenant_id uuid not null,primary key(kind,id))`;
      const languageSources=await seedAcceptanceOldLanguageSources(root,upgrade);
      expect(languageSources).toHaveLength(5);
      expect(languageSources.find(row=>row.kind==='native_retained')).toMatchObject({score:70,receipts:1,watermarks:1});
      expect(languageSources.filter(row=>row.kind!=='native_retained').every(row=>row.receipts===0&&row.watermarks===0)).toBe(true);
      const artifacts=await Promise.all((['safe_first_cycle','safe_delivered','unsafe_untracked_history','unsafe_unknown','safe_cache','history_source'] as const).map(scenario=>seedAcceptanceOldSchema(root,upgrade,scenario)));
      const artifact=artifacts.find(row=>row.scenario==='safe_first_cycle')!;
      const historySource=artifacts.find(row=>row.scenario==='history_source')!;
      const independentHistorySources=[historySource,...await Promise.all([1,2,3,4].map(()=>seedAcceptanceOldSchema(root,upgrade,'history_source')))];
      artifacts.push(...independentHistorySources.slice(1));
      artifacts.push(...await Promise.all([
       seedAcceptanceOldSchema(root,upgrade,'safe_selected_history',artifact),
       ...(['unsafe_extra_metric','unsafe_delivered','unsafe_intermediate','unsafe_insufficient_final','unsafe_cache'] as const).map((scenario,index)=>seedAcceptanceOldSchema(root,upgrade,scenario,independentHistorySources[index]!))
      ]));
      expect(new Set(artifacts.map(row=>row.scenario)).size).toBe(12);
      expect(artifacts).toHaveLength(16);
      const selectedHistory=artifacts.find(row=>row.scenario==='safe_selected_history')!;
      const unsafeSnapshots=artifacts.filter(row=>row.scenario.startsWith('unsafe_')&&!row.scenario.endsWith('_cache'));
      for(const prior of independentHistorySources){
        const historySupports=await sql`select metric_key,candidate_id,cycle_id from survey_report_completion_supports where snapshot_id=${prior.snapshotId}`;
        expect(historySupports.map(row=>row.metric_key).sort()).toEqual(['autonomy','engagement']);
        expect(historySupports.every(row=>row.candidate_id===prior.candidateId&&row.cycle_id===prior.cycleId)).toBe(true);
      }
      const unsafeEvidence=async(id:string)=>canonicalMigrationValue(await sql`select
       (select jsonb_agg(jsonb_build_object('id',p.id,'ordinal',p.ordinal,'hash',p.body_hash) order by p.ordinal) from survey_report_parts p where p.snapshot_id=${id}) parts,
       (select jsonb_agg(to_jsonb(a) order by a.id) from survey_report_attempts a where a.snapshot_id=${id}) attempts,
       (select jsonb_agg(to_jsonb(r) order by r.attempt_id) from survey_report_receipts r where r.snapshot_id=${id}) receipts`);
      const oldUnsafeEvidence=new Map(await Promise.all(unsafeSnapshots.map(async row=>[row.snapshotId,await unsafeEvidence(row.snapshotId)] as const)));
      const cacheIdentity=async(id:string)=>canonicalMigrationValue(await sql`select id,tenant_id,cycle_id,scope_id,audience,purpose,index_key,frontier::text from survey_report_obligations where id=${id}`);
      const cacheIdentities=new Map(await Promise.all(artifacts.filter(row=>row.scenario.endsWith('_cache')).map(async row=>[row.obligationId,await cacheIdentity(row.obligationId)] as const)));
      const selectedSignature=async()=>canonicalMigrationValue(await sql`select s.*,p.* from survey_report_native_snapshots s join survey_report_snapshot_payloads p on p.snapshot_id=s.id where s.id=${selectedHistory.snapshotId}`);
      const selectedBytes=await selectedSignature();
      const [selectedPayload]=await sql`select contracts,provenance from survey_report_snapshot_payloads where snapshot_id=${selectedHistory.snapshotId}`;
      expect(selectedPayload!.contracts.sourceCandidateIds).toEqual([selectedHistory.candidateId,artifact.candidateId]);
      expect(selectedPayload!.provenance.sections[0].baselineInventory[0].candidateId).toBe(artifact.candidateId);
      const priorProof=await sql`select candidate_id from survey_report_completion_supports where snapshot_id=${artifact.snapshotId}`;
      expect(priorProof.map(p=>p.candidate_id)).toEqual([artifact.candidateId]);
      expect(selectedBytes.length).toBeGreaterThan(100);
      const oldDelivered=artifacts.find(row=>row.scenario==='safe_delivered')!;
      const oldDeliveredSignature=async()=>canonicalMigrationValue(await sql`select s.*,p.contracts,p.presentation,p.provenance,p.manifest,p.route,
       (select jsonb_agg(to_jsonb(x) order by x.ordinal) from survey_report_parts x where x.snapshot_id=s.id) parts,
       (select jsonb_agg(to_jsonb(x) order by x.id) from survey_report_attempts x where x.snapshot_id=s.id) attempts,
       (select jsonb_agg(to_jsonb(x) order by x.attempt_id) from survey_report_receipts x where x.snapshot_id=s.id) receipts
       from survey_report_native_snapshots s join survey_report_snapshot_payloads p on p.snapshot_id=s.id where s.id=${oldDelivered.snapshotId}`);
      const deliveredBytes=await oldDeliveredSignature();
      const [live]=await sql`select count(*)::int n from survey_report_native_snapshots where expires_at>clock_timestamp()`;
      expect(live!.n).toBe(14);
      const [oldColumns]=await sql`select count(*)::int n from information_schema.columns where (table_name='survey_report_assembly_inputs' and column_name='source_candidate_ids') or (table_name='survey_question_insights' and column_name='prose_provenance')`;
      expect(oldColumns!.n).toBe(0);
      const signature=async()=>canonicalMigrationValue(await sql`select s.*,p.contracts,p.presentation,p.provenance,p.manifest,p.route,
        (select jsonb_agg(to_jsonb(x) order by x.ordinal) from survey_report_parts x where x.snapshot_id=s.id) parts,
        (select jsonb_agg(to_jsonb(x) order by x.metric_key) from survey_report_completion_supports x where x.snapshot_id=s.id) supports,
        (select jsonb_agg(to_jsonb(x) order by x.candidate_id) from survey_report_final_completions x where x.canonical_snapshot_id=s.id) completions
        from survey_report_native_snapshots s join survey_report_snapshot_payloads p on p.snapshot_id=s.id where s.id=${artifact.snapshotId}`);
      const [configuration]=await sql`select calendar from tenant_report_config_revisions where tenant_id=${artifact.tenantId}`;
      expect(configuration!.calendar).toMatchObject({timezone:'UTC',workStart:'00:00'});
      const oldBytes=await signature();
      expect(oldBytes.length).toBeGreaterThan(100);
      const guardState=await sql`select tgname from pg_trigger where not tgisinternal and tgenabled<>'O'`;
      expect(guardState).toHaveLength(0);
      await migrate(drizzle(sql),{migrationsFolder:manifest.folder});
      const ledger=await sql`select id,hash,created_at::text from drizzle.__drizzle_migrations order by id`;
      expect(ledger).toHaveLength(manifest.rows.length);
      expect(ledger.slice(0,92)).toEqual(before.ledger);
      for(const [i,row]of ledger.entries()){
        expect(row.hash).toBe(manifest.rows[i]!.sha256);
        expect(String(row.created_at)).toBe(String(manifest.rows[i]!.when));
      }
      expect(await signature()).toBe(oldBytes);
      expect(await oldDeliveredSignature()).toBe(deliveredBytes);
      expect(await selectedSignature()).toBe(selectedBytes);
      for(const unsafe of unsafeSnapshots){
       const [state]=await sql`select s.purged_at,s.artifact_hash,o.id obligation_id,o.status,o.disposition,
        (select count(*)::int from survey_report_snapshot_payloads where snapshot_id=s.id) payloads,
        (select count(*)::int from survey_report_part_payloads b join survey_report_parts p on p.id=b.part_id where p.snapshot_id=s.id) bodies,
        (select count(*)::int from survey_report_attempts where snapshot_id=s.id and state='unknown') unknowns
        from survey_report_native_snapshots s join survey_report_obligations o on o.id=s.obligation_id where s.id=${unsafe.snapshotId}`;
       expect(state).toMatchObject({artifact_hash:unsafe.artifactHash,obligation_id:unsafe.obligationId,payloads:0,bodies:0});
       expect(state!.purged_at).toBeTruthy();
        expect(state!.disposition).toBe(unsafe.scenario==='unsafe_untracked_history'||unsafe.scenario==='unsafe_unknown'?'historical_inventory_minimized':'historical_variant_content_purged');
       expect(state!.status).toBe(unsafe.scenario==='unsafe_unknown'?'reconciliation_required':unsafe.scenario==='unsafe_delivered'?'delivered':'canceled');
       expect(await unsafeEvidence(unsafe.snapshotId)).toBe(oldUnsafeEvidence.get(unsafe.snapshotId));
       expect(state!.unknowns).toBe(unsafe.scenario==='unsafe_unknown'?1:0);
      }
      const [newColumns]=await sql`select count(*)::int n from information_schema.columns where (table_name='survey_report_assembly_inputs' and column_name='source_candidate_ids') or (table_name='survey_question_insights' and column_name='prose_provenance')`;
      expect(newColumns!.n).toBe(2);
      const guards=await sql`select tgname from pg_trigger where not tgisinternal and tgenabled<>'O'`;
      expect(guards).toHaveLength(0);
      expect(await signature()).toBe(oldBytes);
      for(const cache of artifacts.filter(row=>row.scenario.endsWith('_cache'))){
       const [owner]=await sql`select id,frontier,assembly_token,index_key,status from survey_report_obligations where id=${cache.obligationId}`;
       expect(owner!.id).toBe(cache.obligationId);expect(Number(owner!.assembly_token)).toBeGreaterThanOrEqual(1);
       expect(await cacheIdentity(cache.obligationId)).toBe(cacheIdentities.get(cache.obligationId));
       const [storedCache]=await sql`select sections,source_candidate_ids,expires_at from survey_report_assembly_inputs where obligation_id=${cache.obligationId}`;
       if(storedCache){
        if(cache.scenario==='safe_cache'){
          expect(storedCache.source_candidate_ids).toEqual([cache.candidateId]);
          expect(JSON.stringify(storedCache.sections)).not.toContain('priorRawMean');
        }else{
          const prior=independentHistorySources[4]!;
          expect([...storedCache.source_candidate_ids].sort()).toEqual([cache.candidateId,prior.candidateId].sort());
          expect(storedCache.sections[0].baselineInventory).toHaveLength(1);
          expect(storedCache.sections[0].baselineInventory[0]).toMatchObject({candidateId:prior.candidateId,cycleId:prior.cycleId,metrics:[{metricKey:'engagement',rawMean:8}]});
          expect(storedCache.sections[0].baselineInventory[0].metrics).toHaveLength(1);
          const selectedBaseline={status:'comparable',priorCycleId:prior.cycleId,previousRawMean:8,rawDelta:0,direction:'stable',compositionChanged:false} satisfies PulseBaseline;
          expect(storedCache.sections[0].baselines).toMatchObject({engagement:selectedBaseline});
        }
        expect(new Date(storedCache.expires_at).getTime()).toBeGreaterThan(Date.now());
       }else expect(owner!.status).toMatch(/^(pending|assembling|canceled)$/);
      }
      for(const source of languageSources){
       const [authority]=await sql`select a.source_kind,a.native_expires_at,a.dependency_lost_at,q.score::float8 score,exists(select 1 from pulse_language_permitted_source(q.tenant_id,q.id)) permitted from pulse_analytical_source_authorities a join survey_question_insights q on q.id=a.analytical_id where a.analytical_id=${source.id}`;
       expect(authority!.score).toBe(source.score);
       expect(authority!.source_kind).toBe(source.kind==='native_retained'||source.kind==='native_missing'?'native':source.kind==='legacy_opened'?'approved_legacy':'unknown');
       expect(authority!.permitted).toBe(source.kind==='native_retained'||source.kind==='legacy_opened');
       if(source.kind==='native_retained')expect(new Date(authority!.native_expires_at).getTime()).toBeGreaterThan(Date.now());
       if(source.kind==='native_missing')expect(authority!.dependency_lost_at).toBeTruthy();
      }
      const empty=await freshSql`select table_name from information_schema.tables where table_schema='public'`;
      expect(empty).toHaveLength(0);
      await migrate(drizzle(freshSql),{migrationsFolder:manifest.folder});
      expect(await freshSql`select id from drizzle.__drizzle_migrations`).toHaveLength(manifest.rows.length);
      expect(migrationAcceptanceManifest(root).pins).toEqual(manifest.pins);
      process.env.DATABASE_URL=upgrade;
      seed=acceptanceSeedSuite();native=await acceptanceNativeDriver(seed);
      const cache=artifacts.find(row=>row.scenario==='unsafe_cache')!;
      const [preRebuild]=await sql`select expires_at from survey_report_assembly_inputs where obligation_id=${cache.obligationId}`;
      const [beforeRebuild]=await sql`select count(*)::int n from survey_report_native_snapshots where obligation_id=${cache.obligationId}`;
      expect(beforeRebuild!.n).toBe(0);
      const observedCache=await native.lifecycle.observe({tenantId:cache.tenantId,cycleId:cache.cycleId,overallScopeId:cache.scopeId,audience:'manager',purpose:'final'});
      expect(observedCache).toMatchObject({status:'observing',obligationId:cache.obligationId});
      const [rebuiltInputs]=await sql`select source_candidate_ids,expires_at,expires_at=pulse_candidate_content_deadline(tenant_id,source_candidate_ids) exact_deadline from survey_report_assembly_inputs where obligation_id=${cache.obligationId}`;
      expect([...rebuiltInputs!.source_candidate_ids].sort()).toEqual([cache.candidateId,independentHistorySources[4]!.candidateId].sort());
      expect(rebuiltInputs!.exact_deadline).toBe(true);
      expect(new Date(rebuiltInputs!.expires_at).getTime()).toBeLessThanOrEqual(new Date(preRebuild!.expires_at).getTime());
      const rebuiltCache=await native.form.execute(cache.tenantId,cache.obligationId);
      expect(rebuiltCache.status).toBe('snapshot_ready');
      expect(await cacheIdentity(cache.obligationId)).toBe(cacheIdentities.get(cache.obligationId));
      const [remainingCache]=await sql`select count(*)::int n from survey_report_assembly_inputs where obligation_id=${cache.obligationId}`;
      expect(remainingCache!.n).toBe(0);
      const [rebuiltSnapshot]=await sql`select s.id,s.expires_at,p.contracts from survey_report_native_snapshots s join survey_report_snapshot_payloads p on p.snapshot_id=s.id where s.obligation_id=${cache.obligationId}`;
      expect(new Date(rebuiltSnapshot!.expires_at).getTime()).toBeLessThanOrEqual(new Date(rebuiltInputs!.expires_at).getTime());
      expect(rebuiltSnapshot!.contracts.sourceCandidateIds.sort()).toEqual([...rebuiltInputs!.source_candidate_ids].sort());
      const cacheContinuation={status:'passed',obligationId:cache.obligationId,snapshotId:rebuiltSnapshot!.id,sourceCandidateIds:rebuiltInputs!.source_candidate_ids,exactDeadline:true};

      const result=await native.delivery.deliverNext(artifact.tenantId,artifact.snapshotId);
      expect(result.status).toMatch(/^(delivered|part_delivered)$/);
      expect(native.posted).toHaveLength(1);
      expect((await native.delivery.deliverNext(selectedHistory.tenantId,selectedHistory.snapshotId)).status).toBe('delivered');
      expect(native.posted).toHaveLength(2);
      const [stored]=await sql`select b.payload from survey_report_part_payloads b join survey_report_parts p on p.id=b.part_id where p.snapshot_id=${artifact.snapshotId}`;
      expect(native.posted[0]!.body).toEqual(stored!.payload);
      expect((await native.delivery.deliverNext(oldDelivered.tenantId,oldDelivered.snapshotId)).status).toBe('not_claimed');
      for(const unsafe of unsafeSnapshots)expect((await native.delivery.deliverNext(unsafe.tenantId,unsafe.snapshotId)).status).toBe('not_claimed');
      expect(native.posted).toHaveLength(2);
      const [receipt]=await sql`select r.snapshot_id,a.body_hash from survey_report_receipts r join survey_report_attempts a on a.id=r.attempt_id where r.snapshot_id=${artifact.snapshotId}`;
      expect(receipt?.snapshot_id).toBe(artifact.snapshotId);
      writeFileSync(join(out,'guarded-fixture.json'),JSON.stringify({schemaVersion:'rpt08-upgrade-v1',runId,
        schema:'0091',suffix:[92,93,94,95,96,97,98],ledgerCount:manifest.rows.length,prefixLedgerCount:92,
        artifactHash:artifact.artifactHash,fixtureHash:migrationHash(oldBytes),deliveredFixtureHash:migrationHash(deliveredBytes),fixtureScenarios:[...new Set(artifacts.map(a=>a.scenario))],cacheContinuation,primaryOutcomeCount:12,fixtureCount:artifacts.length,additionalPrerequisiteFixtureCount:4,prerequisitePriorSources:[artifact,...independentHistorySources].map(row=>({tenantId:row.tenantId,cycleId:row.cycleId,snapshotId:row.snapshotId,candidateId:row.candidateId})),baselineSchemaMigrated:'passed',
        fixtureInsertedWithGuards:'passed',suffixExecuted:'passed',postUpgradeAssertions:'passed',
        currentReaderOrDeliveryContinuation:'passed',historicalProducerExecuted:'blocked',historicalProducerReason:'not_provided'},null,2));
    }finally{
      try{await closeAcceptanceResources([...(native?[()=>native!.close()]:[]),...(seed?[()=>seed!.cleanup()]:[]),()=>sql.end({timeout:5}),()=>freshSql.end({timeout:5})]);}finally{process.env.DATABASE_URL=original;}
    }
  },900_000);
});
