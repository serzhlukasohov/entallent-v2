import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, realpathSync, symlinkSync } from 'node:fs';
import {spawn} from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseAcceptanceConfig, acceptanceChildEnvironment, runAcceptanceChild,boundedAcceptanceResource } from './run-pulse-report-acceptance';
import {readAcceptanceTestEvidence,registerAcceptanceAssertions,RPT08_COMPANION_TESTS,acceptanceEvidenceHash,acceptanceCalendarClose,isPrivateAcceptanceSql,orderedAcceptanceClosers} from './pulse-report-acceptance-evidence';
import {acceptanceTestInvocation} from './pulse-report-acceptance-run';

async function verifyParentSignals(root:string){
  for(const signal of ['SIGINT','SIGTERM'] as const){
    const out=join(root,signal);mkdirSync(out);
    const parentFile=join(out,'parent.cjs');
    const ownedCode="const{spawn}=require('node:child_process'),fs=require('node:fs');const p=spawn(process.execPath,['-e',\"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)\"],{stdio:'ignore'});fs.writeFileSync(process.argv[1],JSON.stringify([process.pid,p.pid]));process.on('SIGTERM',()=>{});setInterval(()=>{},1000)";
    writeFileSync(parentFile,`const fs=require('node:fs'),load=require('node:module').createRequire(process.argv[2]+'/package.json');load('tsx/cjs');const{runAcceptanceChild}=load(process.argv[2]+'/scripts/run-pulse-report-acceptance.ts');runAcceptanceChild(process.execPath,['-e',${JSON.stringify(ownedCode)},process.argv[3]+'/pids.json'],process.argv[2],{PATH:process.env.PATH,RPT08_OUTPUT_DIR:process.argv[3]},process.argv[3]+'/child.log',20000).then(result=>{fs.writeFileSync(process.argv[3]+'/result.json',JSON.stringify(result));process.exitCode=result.exitCode;});`);
    const parent=spawn(process.execPath,[parentFile,process.cwd(),out],{stdio:'ignore'});
    const exited=new Promise<number|null>((resolve,reject)=>{const timeout=setTimeout(()=>{parent.kill('SIGKILL');reject(Error('signal_parent_cleanup_timeout'));},5_000);parent.once('exit',code=>{clearTimeout(timeout);resolve(code);});});
    const until=Date.now()+3_000;while(Date.now()<until){try{readFileSync(join(out,'pids.json'));break;}catch{await new Promise(resolve=>setTimeout(resolve,10));}}
    const pids=JSON.parse(readFileSync(join(out,'pids.json'),'utf8')) as number[];
    parent.kill(signal);assert.equal(await exited,1);
    assert.equal(JSON.parse(readFileSync(join(out,'result.json'),'utf8')).cancelledSignal,signal);
    assert.deepEqual(JSON.parse(readFileSync(join(out,'cancellation.json'),'utf8')),{schemaVersion:'rpt08-cancellation-v1',status:'failed',signal,ownedGroupCleanup:'completed',pilotEligibility:'blocked',activationExecuted:false});
    await new Promise(resolve=>setTimeout(resolve,100));for(const pid of pids)assert.throws(()=>process.kill(pid,0));
  }
}

async function verifyNativeNodeReports(root: string) {
  const first=join(root,'native-first.test.mjs'),second=join(root,'native-second.test.mjs');
  writeFileSync(first,"import {test,describe} from 'node:test';import assert from 'node:assert/strict';describe('actual suite',()=>{test('actual first',()=>assert.equal(1,1));});");
  writeFileSync(second,"import {test} from 'node:test';test('actual second',()=>{});");
  const execute=async(label:string,files:string[])=>{
    const report=join(root,label+'.json');
    const invocation=acceptanceTestInvocation(process.cwd(),'@entalent/channel-slack',files,'node:test',report);
    const result=await runAcceptanceChild(invocation.command,invocation.args,process.cwd(),{},join(root,label+'.log'),15_000);
    return {report,result,expected:invocation.expected};
  };
  const passed=await execute('native-pass',[first,second]);
  assert.deepEqual(passed.result,{exitCode:0,timedOut:false});
  const observed=readAcceptanceTestEvidence(passed.report,passed.expected);
  assert.deepEqual(observed.map(test=>[test.file,test.name]),[[realpathSync(first).replaceAll('\\','/'),'actual suite > actual first'],[realpathSync(second).replaceAll('\\','/'),'actual second']]);
  assert.equal(new Set(observed.map(test=>test.testId)).size,2);
  const valid=JSON.parse(readFileSync(passed.report,'utf8'));
  assert.equal(valid.schemaVersion,'rpt08-node-test-report-v1');
  assert.equal(valid.framework,'node:test');
  assert.throws(()=>readAcceptanceTestEvidence(passed.report,{...passed.expected,framework:'vitest'}));
  assert.throws(()=>readAcceptanceTestEvidence(passed.report,{...passed.expected,files:[first]}));
  for(const [label,source,exitCode]of [
    ['failure',"test('actual failure',()=>{throw Error('synthetic assertion');});",1],
    ['skip',"test('actual skipped',{skip:true},()=>{});",0],
    ['todo',"test('actual todo',{todo:true},()=>{});",0],
  ] as const){
    const file=join(root,'native-'+label+'.test.mjs');writeFileSync(file,"import {test} from 'node:test';"+source);
    const actual=await execute('native-'+label,[file]);assert.equal(actual.result.exitCode,exitCode);assert.equal(actual.result.timedOut,false);
    assert.throws(()=>readAcceptanceTestEvidence(actual.report));
  }
  const bad=join(root,'native-invalid.json');
  for(const mutate of [
    (report:typeof valid)=>{delete report.summary;},
    (report:typeof valid)=>{report.summary.success=false;},
    (report:typeof valid)=>{report.framework='vitest';},
    (report:typeof valid)=>{report.summary.counts.cancelled=1;},
    (report:typeof valid)=>{report.summary.counts.tests++;},
    (report:typeof valid)=>{report.tests.push({...report.tests[0]});report.summary.counts.tests++;report.summary.counts.passed++;},
    (report:typeof valid)=>{report.tests[0].file='/foreign.test.mjs';},
    (report:typeof valid)=>{report.tests[0].status='skipped';},
    (report:typeof valid)=>{report.tests[0].rawText='SYNTHETIC_POISON_METADATA';},
    (report:typeof valid)=>{report.rawText='SYNTHETIC_POISON_METADATA';},
    (report:typeof valid)=>{report.summary.error={message:'SYNTHETIC_POISON_METADATA'};},
    (report:typeof valid)=>{report.fileSummaries[0].counts.environment='SYNTHETIC_POISON_METADATA';},
    (report:typeof valid)=>{
      const file=report.tests[0].file,slash=file.lastIndexOf('/'),alias=file.slice(0,slash+1)+'./'+file.slice(slash+1);
      const duplicates=report.tests.filter((test:{file:string})=>test.file===file).map((test:object)=>({...test,file:alias}));
      report.tests.push(...duplicates);report.fileSummaries.push({...structuredClone(report.fileSummaries.find((summary:{file:string})=>summary.file===file)),file:alias});
      report.summary.counts.tests+=duplicates.length;report.summary.counts.passed+=duplicates.length;
    },
  ]){
    const candidate=structuredClone(valid);mutate(candidate);writeFileSync(bad,JSON.stringify(candidate));assert.throws(()=>readAcceptanceTestEvidence(bad,passed.expected));
  }
}

async function test() {
  const root = mkdtempSync(join(tmpdir(), 'rpt08-unit-'));
  try {
    await verifyNativeNodeReports(root);
await verifyParentSignals(root);
const closeOrder:string[]=[];
const closed=await orderedAcceptanceClosers([async()=>{closeOrder.push('worker-start');await new Promise(resolve=>setTimeout(resolve,10));closeOrder.push('worker-drained');},async()=>{closeOrder.push('queue');throw Error('synthetic_close_failure');},async()=>{closeOrder.push('database');}]);
assert.deepEqual(closeOrder,['worker-start','worker-drained','queue','database']);assert.deepEqual(closed.map(row=>row.status),['fulfilled','rejected','fulfilled']);
for(const query of ['select id from messages','select id from public.messages','select id from "public"."messages"','select id from public."survey_question_working_insights"','select id from "public".memories','select id from a join "public"."conversation_summaries" on true'])assert.equal(isPrivateAcceptanceSql(query),true,query);
for(const query of ['select id from public.survey_report_scopes','select \'from public.messages\'','select id from report_messages'])assert.equal(isPrivateAcceptanceSql(query),false,query);
assert.equal(acceptanceCalendarClose(Date.parse('2026-10-30T12:00:30Z'),4).toISOString(),'2026-10-30T12:05:00.000Z');
for(const now of ['2026-10-30T23:55:30Z','2026-10-30T23:58:30Z'])assert.throws(()=>acceptanceCalendarClose(Date.parse(now),4),/calendar_crosses_utc_day/);
const synthetic=(file:string,name:string)=>({file:'/synthetic/'+file,name,status:'passed',ordinal:1,testId:acceptanceEvidenceHash([file,name])});
const mainTest=synthetic('pulse-report-connected-acceptance.integration.test.ts','produces native shown confirmation');
const registered=registerAcceptanceAssertions([mainTest,synthetic('pulse-report-connected-acceptance.integration.test.ts','exactly one two three or four changed contributors'),synthetic('pulse-report-restart-acceptance.integration.test.ts','recovers lost dispatch hints for a committed turn'),synthetic('pulse-report-restart-acceptance.integration.test.ts','recovers exhausted evidence'),...Object.values(RPT08_COMPANION_TESTS).flat().map(([file,name])=>synthetic(file,name))],'a'.repeat(64));
assert.ok(registered.find(item=>item.caseIds.includes('RPT-AC-06'))!.testIds.includes(mainTest.testId));
    mkdirSync(join(root, 'runs/rpt-08'), { recursive: true });
    const env = { PULSE_ACCEPTANCE_RUN_ID: 'fixture01', RPT08_LOCAL_ACCEPTANCE:'1', RPT08_OWNERSHIP_MANIFEST:join(root,'runs/rpt-08/ownership.json'), CONFIRM_PULSE_ACCEPTANCE_RUN: 'fixture01',
      PULSE_ACCEPTANCE_POSTGRES_TARGET: '127.0.0.1:55444', PULSE_ACCEPTANCE_REDIS_TARGET: '127.0.0.1:56386/15',
      PULSE_ACCEPTANCE_DATABASE_URL: 'postgresql://postgres@127.0.0.1:55444/entalent_rpt08_fixture01_connected',
      PULSE_ACCEPTANCE_FRESH_DATABASE_URL: 'postgresql://postgres@127.0.0.1:55444/entalent_rpt08_fixture01_fresh',
      PULSE_ACCEPTANCE_UPGRADE_DATABASE_URL: 'postgresql://postgres@127.0.0.1:55444/entalent_rpt08_fixture01_upgrade',
      PULSE_ACCEPTANCE_REDIS_URL: 'redis://127.0.0.1:56386/15' };
    const args = ['--mode', 'local-synthetic', '--out', 'runs/rpt-08/fixture01'];
  writeFileSync(env.RPT08_OWNERSHIP_MANIFEST,JSON.stringify({schemaVersion:'rpt08-ownership-v1',runId:'fixture01',syntheticOnly:true,ownerNonce:'a'.repeat(64),queuePrefix:'rpt08-fixture01-'+ 'a'.repeat(16),targets:{connected:env.PULSE_ACCEPTANCE_DATABASE_URL,fresh:env.PULSE_ACCEPTANCE_FRESH_DATABASE_URL,upgrade:env.PULSE_ACCEPTANCE_UPGRADE_DATABASE_URL,redis:env.PULSE_ACCEPTANCE_REDIS_URL}}));

    const config = parseAcceptanceConfig(args, env, root);
const escaped=mkdtempSync(join(tmpdir(),'rpt08-outside-'));
try{
 symlinkSync(escaped,join(root,'runs/rpt-08/link'));
 assert.throws(()=>parseAcceptanceConfig(['--mode','local-synthetic','--out','runs/rpt-08/link/new'],env,root),/realpath|containment/);
 writeFileSync(join(escaped,'ownership.json'),readFileSync(env.RPT08_OWNERSHIP_MANIFEST));
 assert.throws(()=>parseAcceptanceConfig(args,{...env,RPT08_OWNERSHIP_MANIFEST:join(root,'runs/rpt-08/link/ownership.json')},root),/realpath|containment/);
}finally{rmSync(join(root,'runs/rpt-08/link'));rmSync(escaped,{recursive:true,force:true});}

    for (const key of Object.keys(env)) assert.throws(() => parseAcceptanceConfig(args, { ...env, [key]: '' }, root));
    for (const args2 of [[], ['--mode', 'live'], [...args, '--force'], ['--mode', 'local-synthetic', '--out', '../escape']])
      assert.throws(() => parseAcceptanceConfig(args2, env, root));
    for (const url of ['postgresql://localhost:55444/entalent', 'postgresql://remote:55444/entalent_rpt08_fixture01_connected',
      'postgresql://127.0.0.1:55444/entalent_rpt08_fixture01_connected?sslmode=require'])
      assert.throws(() => parseAcceptanceConfig(args, { ...env, PULSE_ACCEPTANCE_DATABASE_URL: url }, root));
    for (const url of ['redis://127.0.0.1:56386/0', 'redis://remote:56386/15', 'rediss://127.0.0.1:56386/15'])
      assert.throws(() => parseAcceptanceConfig(args, { ...env, PULSE_ACCEPTANCE_REDIS_URL: url }, root));
    const ownership=readFileSync(env.RPT08_OWNERSHIP_MANIFEST,'utf8');
    writeFileSync(env.RPT08_OWNERSHIP_MANIFEST,ownership.replace('fixture01','foreign_run'));
    assert.throws(()=>parseAcceptanceConfig(args,env,root),/ownership_manifest_mismatch/);
    writeFileSync(env.RPT08_OWNERSHIP_MANIFEST,ownership);
    const inventoryPath=join(root,'vitest.json');
    const physicalTest=join(root,'physical.test.ts');writeFileSync(physicalTest,'// synthetic physical identity\n');
const inventory={success:true,numTotalTests:2,numPassedTests:2,numFailedTests:0,numPendingTests:0,testResults:[{name:realpathSync(physicalTest),status:'passed',assertionResults:[{fullName:'same parameterized title',status:'passed'},{fullName:'same parameterized title',status:'passed'}]}]};
    writeFileSync(inventoryPath,JSON.stringify(inventory));
    const canonicalReport=structuredClone(inventory);
const alias=realpathSync(physicalTest).replace('/physical.test.ts','/./physical.test.ts');
const duplicateReport={...inventory,numTotalTests:4,numPassedTests:4,testResults:[...inventory.testResults,{...inventory.testResults[0]!,name:alias}]};
writeFileSync(inventoryPath,JSON.stringify(duplicateReport));
assert.throws(()=>readAcceptanceTestEvidence(inventoryPath),/noncanonical|inventory_mismatch/);
writeFileSync(inventoryPath,JSON.stringify(canonicalReport));
const identities=readAcceptanceTestEvidence(inventoryPath);
    assert.equal(new Set(identities.map(test=>test.testId)).size,2);
    assert.throws(()=>registerAcceptanceAssertions(identities,'a'.repeat(64)),/required_cases_missing/);
    for(const bad of [{...inventory,numPendingTests:1},{...inventory,numTotalTests:0},{...inventory,testResults:[]},{...inventory,testResults:[{name:realpathSync(physicalTest),status:'passed',assertionResults:[]}]}]){
      writeFileSync(inventoryPath,JSON.stringify(bad));assert.throws(()=>readAcceptanceTestEvidence(inventoryPath));
    }
    const inheritedSecrets=['OPENAI_API_KEY','AZURE_OPENAI_API_KEY','SLACK_BOT_TOKEN'] as const;
    const originalSecrets=inheritedSecrets.map(key=>process.env[key]);
    let childEnv:ReturnType<typeof acceptanceChildEnvironment>;
    try{
      for(const key of inheritedSecrets)process.env[key]='synthetic-must-not-inherit';
      childEnv=acceptanceChildEnvironment(config);
    }finally{inheritedSecrets.forEach((key,index)=>{if(originalSecrets[index]===undefined)delete process.env[key];else process.env[key]=originalSecrets[index];});}
    assert.equal(childEnv.V2_CONVERSATION_QUEUE_TEST,'1');
    assert.equal(childEnv.V2_BUNDLE_QUEUE_TEST,'1');
    for (const key of ['OPENAI_API_KEY', 'AZURE_OPENAI_API_KEY', 'SLACK_BOT_TOKEN', 'TENANT_ID', 'DEFAULT_TENANT_ID', 'CODEX_HOME'])
      assert.equal(childEnv[key], undefined);
    writeFileSync(join(root, '.env'), 'SECRET=synthetic\n');
    assert.throws(() => parseAcceptanceConfig(args, env, root), /env_file_forbidden/);
    rmSync(join(root, '.env'));
    mkdirSync(config.out);
    assert.throws(() => parseAcceptanceConfig(args, env, root), /new_output/);
    let stalledResourceClosed=false;
    const stalledStarted=Date.now();
    await assert.rejects(boundedAcceptanceResource(()=>new Promise<never>(()=>{}),()=>{stalledResourceClosed=true;},25),/acceptance_resource_ownership_timeout/);
    assert.equal(stalledResourceClosed,true);assert.ok(Date.now()-stalledStarted<1_000);
    let failedResourceClosed=false;
    await assert.rejects(boundedAcceptanceResource(async()=>{throw Error('synthetic_io_failure');},()=>{failedResourceClosed=true;}),/synthetic_io_failure/);
    assert.equal(failedResourceClosed,true);
    const ok = await runAcceptanceChild(process.execPath, ['-e', 'process.exit(0)'], root, {}, join(root, 'ok.log'), 1000);
    assert.deepEqual(ok, { exitCode: 0, timedOut: false });
    const fail = await runAcceptanceChild(process.execPath, ['-e', 'process.exit(7)'], root, {}, join(root, 'fail.log'), 1000);
    assert.deepEqual(fail, { exitCode: 7, timedOut: false });
    const timeout = await runAcceptanceChild(process.execPath, ['-e', 'setInterval(()=>{},1000)'], root, {}, join(root, 'timeout.log'), 25);
    assert.equal(timeout.timedOut, true); assert.notEqual(timeout.exitCode, 0);
    const descendantPidFile=join(root,'descendant.pid');
    const descendantCode="const {spawn}=require('node:child_process'),fs=require('node:fs');const p=spawn(process.execPath,['-e',\"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)\"],{stdio:'ignore'});fs.writeFileSync(process.argv[1],String(p.pid));setInterval(()=>{},1000)";
    const descendantTimeout=await runAcceptanceChild(process.execPath,['-e',descendantCode,descendantPidFile],root,{},join(root,'descendant.log'),500);
    assert.equal(descendantTimeout.timedOut,true);
    const descendantPid=Number(readFileSync(descendantPidFile,'utf8'));
    await new Promise(resolve=>setTimeout(resolve,100));
    assert.throws(()=>process.kill(descendantPid,0));

    const cleanupOutput=join(root,'cleanup-output');mkdirSync(cleanupOutput);
    const cleanupStarted=Date.now();
    const cleanupCode="require('node:fs').writeFileSync(process.env.RPT08_OUTPUT_DIR+'/cleanup-failure.json','{}');process.on('SIGTERM',()=>{});setInterval(()=>{},1000)";
    const cleanupFailure=await runAcceptanceChild(process.execPath,['-e',cleanupCode],root,{RPT08_OUTPUT_DIR:cleanupOutput},join(root,'cleanup.log'),20_000);
    assert.equal(cleanupFailure.timedOut,true);assert.notEqual(cleanupFailure.exitCode,0);
    assert.ok(Date.now()-cleanupStarted<4_000,'cleanup marker must terminate the process before the long lane timeout');
    await assert.rejects(runAcceptanceChild('nonexistent-rpt08-binary', [], root, {}, join(root, 'spawn.log'), 1000));
    assert.equal(readFileSync(join(root, 'ok.log'), 'utf8'), '');
  } finally { rmSync(root, { recursive: true, force: true }); }
}
test().then(() => console.log('report acceptance runner guards passed')).catch((error) => { console.error(error); process.exitCode = 1; });
