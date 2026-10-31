import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, openSync, closeSync, realpathSync } from 'node:fs';
import { resolve, relative, join, dirname } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';

export const RPT08_BASE = '237d7075ff08f262ccf3cbe2bf7c36cb390d204e';
export interface AcceptanceConfig {
  runId: string; root: string; out: string;
  databaseUrl: string; freshDatabaseUrl: string; upgradeDatabaseUrl: string; redisUrl: string; ownerNonce:string;queuePrefix:string;
}
const local = new Set(['127.0.0.1', 'localhost']);

export function parseAcceptanceConfig(args: readonly string[], env: NodeJS.ProcessEnv, root: string): AcceptanceConfig {
  if(env.RPT08_LOCAL_ACCEPTANCE!=='1')throw Error('explicit_local_acceptance_opt_in_required');
  if (args.length !== 4 || args[0] !== '--mode' || args[1] !== 'local-synthetic' || args[2] !== '--out')
    throw Error('explicit_local_synthetic_mode_and_output_required');
  const runId = env.PULSE_ACCEPTANCE_RUN_ID ?? '';
  if (!/^[a-z0-9][a-z0-9_]{7,47}$/.test(runId) || env.CONFIRM_PULSE_ACCEPTANCE_RUN !== runId)
    throw Error('explicit_run_identity_confirmation_required');
  const databaseUrl = env.RPT08_CONNECTED_DATABASE_URL ?? env.PULSE_ACCEPTANCE_DATABASE_URL ?? '';
  const freshDatabaseUrl = env.RPT08_FRESH_DATABASE_URL ?? env.PULSE_ACCEPTANCE_FRESH_DATABASE_URL ?? '';
  const upgradeDatabaseUrl = env.RPT08_UPGRADE_DATABASE_URL ?? env.PULSE_ACCEPTANCE_UPGRADE_DATABASE_URL ?? '';
  const redisUrl = env.RPT08_REDIS_URL ?? env.PULSE_ACCEPTANCE_REDIS_URL ?? '';
  for (const [value, suffix] of [[databaseUrl, 'connected'], [freshDatabaseUrl, 'fresh'], [upgradeDatabaseUrl, 'upgrade']]) {
    let url: URL; try { url = new URL(value!); } catch { throw Error('invalid_explicit_postgres_target'); }
    if (url.protocol !== 'postgresql:' || !local.has(url.hostname) || !url.port || url.search || url.hash
      || url.pathname !== '/entalent_rpt08_' + runId + '_' + suffix
      || env.PULSE_ACCEPTANCE_POSTGRES_TARGET !== url.hostname + ':' + url.port)
      throw Error('postgres_target_not_explicit_task_database');
  }
  let redis: URL; try { redis = new URL(redisUrl); } catch { throw Error('invalid_explicit_redis_target'); }
  if (redis.protocol !== 'redis:' || !local.has(redis.hostname) || !redis.port || redis.search || redis.hash
    || redis.pathname !== '/15' || redis.username || redis.password
    || env.PULSE_ACCEPTANCE_REDIS_TARGET !== redis.hostname + ':' + redis.port + '/15')
    throw Error('redis_target_not_explicit_task_database');
  const out = resolve(root, args[3]!);
  const rel = relative(resolve(root, 'runs/rpt-08'), out);
  if (!rel || rel.startsWith('..') || rel.startsWith('/') || existsSync(out))
    throw Error('new_output_below_task_runs_required');
  if (existsSync(resolve(root, '.env'))) throw Error('root_env_file_forbidden_for_acceptance');
  const ownershipPath=resolve(env.RPT08_OWNERSHIP_MANIFEST??'');
  const ownedRelative=relative(resolve(root,'runs/rpt-08'),ownershipPath);
  if(!ownedRelative||ownedRelative.startsWith('..')||!existsSync(ownershipPath))throw Error('explicit_owned_manifest_required');
  const taskRoot=resolve(root,'runs/rpt-08'),realTaskRoot=realpathSync(taskRoot);
  if(realTaskRoot!==resolve(realpathSync(root),'runs/rpt-08'))throw Error('acceptance_task_root_realpath_escape');
  const inside=(path:string)=>{const rel=relative(realTaskRoot,path);return rel!==''&&!rel.startsWith('..')&&!rel.startsWith('/');};
  let parent=dirname(out);while(!existsSync(parent))parent=dirname(parent);
  if((realpathSync(parent)!==realTaskRoot&&!inside(realpathSync(parent)))||!inside(realpathSync(ownershipPath)))throw Error('acceptance_realpath_containment_failed');
  const ownership=JSON.parse(readFileSync(ownershipPath,'utf8'));
  if(ownership.schemaVersion!=='rpt08-ownership-v1'||ownership.runId!==runId||ownership.syntheticOnly!==true
    ||!/^[a-f0-9]{64}$/.test(ownership.ownerNonce)||ownership.queuePrefix!=='rpt08-'+runId+'-'+ownership.ownerNonce.slice(0,16)
    ||JSON.stringify(ownership.targets)!==JSON.stringify({connected:databaseUrl,fresh:freshDatabaseUrl,upgrade:upgradeDatabaseUrl,redis:redisUrl}))throw Error('acceptance_ownership_manifest_mismatch');
  return { runId, root, out, databaseUrl, freshDatabaseUrl, upgradeDatabaseUrl, redisUrl,ownerNonce:ownership.ownerNonce,queuePrefix:ownership.queuePrefix };
}

export function acceptanceChildEnvironment(config: AcceptanceConfig, databaseUrl = config.databaseUrl): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'TMPDIR', 'TEMP', 'TMP', 'HOME', 'SystemRoot'])
    if (process.env[key]) env[key] = process.env[key];
  return { ...env, DATABASE_URL: databaseUrl, REDIS_URL: config.redisUrl,
    RPT08_FRESH_DATABASE_URL: config.freshDatabaseUrl, RPT08_UPGRADE_DATABASE_URL: config.upgradeDatabaseUrl,
    RPT08_RUN_ID: config.runId, RPT08_OUTPUT_DIR: config.out, RPT08_QUEUE_PREFIX:config.queuePrefix,RPT08_OWNER_NONCE:config.ownerNonce,
    PULSE_ACCEPTANCE_OPT_IN: 'local-synthetic',V2_CONVERSATION_QUEUE_TEST:'1',V2_BUNDLE_QUEUE_TEST:'1', NODE_ENV: 'test',
    FIELD_ENCRYPTION_KEY: '0'.repeat(64), ADMIN_API_KEY: 'synthetic-rpt08-only',
    npm_config_verify_deps_before_run: 'false', TURBO_TELEMETRY_DISABLED: '1', NEXT_TELEMETRY_DISABLED: '1' };
}

export function acceptanceSourceManifest(root: string) {
  const paths = execFileSync('git', ['ls-files', '-c', '-o', '--exclude-standard', '-z'], { cwd: root })
    .toString().split('\0').filter(Boolean).filter((p) => !p.startsWith('docs/')
      && !p.startsWith('_bmad-output/') && !p.startsWith('.agents/') && !p.startsWith('_bmad/'));
  const files = [...new Set(paths)].sort().map((path) => ({ path,
    sha256: createHash('sha256').update(readFileSync(join(root, path))).digest('hex') }));
  return { files, sha256: createHash('sha256').update(JSON.stringify(files)).digest('hex') };
}

export async function runAcceptanceChild(
  command: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv, logFile: string, timeoutMs: number,
): Promise<{ exitCode: number; timedOut: boolean; cancelledSignal?: 'SIGINT'|'SIGTERM' }> {
  if(timeoutMs<1||timeoutMs>3_600_000)throw Error('invalid_child_timeout');
  const fd=openSync(logFile,'wx',0o600);
  return new Promise((done,reject)=>{
    let timedOut=false,settled=false,hardKilled=false,observedExit:number|null=null;
    let cancelledSignal:'SIGINT'|'SIGTERM'|undefined;
    const onInterrupt=()=>{cancelledSignal='SIGINT';terminate();};
    const onTerminate=()=>{cancelledSignal='SIGTERM';terminate();};
    const removeSignals=()=>{process.off('SIGINT',onInterrupt);process.off('SIGTERM',onTerminate);};
    let killTimer:ReturnType<typeof setTimeout>|undefined;
    let finalTimer:ReturnType<typeof setTimeout>|undefined;
    let markerWatcher:ReturnType<typeof setInterval>|undefined;
    const child=spawn(command,[...args],{cwd,env,detached:true,stdio:['ignore',fd,fd]});
    const finish=(exitCode:number)=>{
      if(settled)return;
      settled=true;clearTimeout(timer);clearTimeout(killTimer);clearTimeout(finalTimer);clearInterval(markerWatcher);removeSignals();closeSync(fd);
      if(cancelledSignal&&env.RPT08_OUTPUT_DIR)writeFileSync(join(env.RPT08_OUTPUT_DIR,'cancellation.json'),JSON.stringify({schemaVersion:'rpt08-cancellation-v1',runId:env.RPT08_RUN_ID,sourceHash:env.RPT08_SOURCE_HASH,status:'failed',signal:cancelledSignal,ownedGroupCleanup:'completed',pilotEligibility:'blocked',activationExecuted:false}),{mode:0o600});
      done(cancelledSignal?{exitCode:1,timedOut:false,cancelledSignal}:{exitCode,timedOut});
    };
    const terminate=()=>{
      if(timedOut||settled)return;
      timedOut=true;
      try{process.kill(-child.pid!,'SIGTERM');}catch{/* already exited */}
      killTimer=setTimeout(()=>{
        try{process.kill(-child.pid!,'SIGKILL');}catch{/* group has exited */}
        hardKilled=true;
        if(observedExit!==null)finish(observedExit);
        else finalTimer=setTimeout(()=>finish(1),1_000);
      },1_000);
    };
    const timer=setTimeout(terminate,timeoutMs);
    process.on('SIGINT',onInterrupt);process.on('SIGTERM',onTerminate);
    if(env.RPT08_OUTPUT_DIR)markerWatcher=setInterval(()=>{
      const marker=join(env.RPT08_OUTPUT_DIR!,'cleanup-failure.json');
      if(existsSync(marker))terminate();
    },50);
    child.on('error',error=>{
      if(settled)return;
      settled=true;clearTimeout(timer);clearTimeout(killTimer);clearTimeout(finalTimer);clearInterval(markerWatcher);removeSignals();closeSync(fd);reject(error);
    });
    child.on('close',code=>{
      observedExit=code??1;
      if(!timedOut||hardKilled)finish(observedExit);
    });
  });
}

export async function runPulseReportAcceptance(config: AcceptanceConfig) {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: config.root }).toString().trim();
  const branch = execFileSync('git', ['branch', '--show-current'], { cwd: config.root }).toString().trim();
  if (head !== RPT08_BASE || branch !== 'codex/pulse-check-reports') throw Error('acceptance_git_identity_mismatch');
  mkdirSync(config.out, { recursive: false, mode: 0o700 });
  const aggregateDeadline=Date.now()+3_600_000;
  const manifest = acceptanceSourceManifest(config.root);
  writeFileSync(join(config.out, 'source-manifest.json'), JSON.stringify(manifest, null, 2));
  const env = {...acceptanceChildEnvironment(config),RPT08_SOURCE_HASH:manifest.sha256};
  try {
  const preflight = await runAcceptanceChild('pnpm', ['harness:preflight'], config.root, env,
    join(config.out, 'preflight.log'), 20_000);
  if (preflight.exitCode || preflight.timedOut) throw Error('acceptance_preflight_failed');
  await claimAcceptanceResources(config,manifest.sha256);
  const {executeAcceptanceLanes}=await import('./pulse-report-acceptance-run');
  return await executeAcceptanceLanes(config,manifest.sha256,new Date().toISOString(),aggregateDeadline);
  }catch(error){
    if(!existsSync(join(config.out,'failed-receipt.json')))writeFileSync(join(config.out,'failed-receipt.json'),JSON.stringify({runId:config.runId,sourceHash:manifest.sha256,status:'failed',reason:'preflight_or_resource_ownership_failed',pilotEligibility:'blocked',activationExecuted:false}),{mode:0o600});
    throw error;
  }
}

export async function boundedAcceptanceResource<T>(operation:()=>Promise<T>,close:()=>Promise<unknown>|void,timeoutMs=15_000):Promise<T>{
  if(timeoutMs<1||timeoutMs>15_000)throw Error('invalid_resource_timeout');
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([Promise.resolve().then(operation),new Promise<never>((_resolve,reject)=>{
    timer=setTimeout(()=>reject(Error('acceptance_resource_ownership_timeout')),timeoutMs);
  })]);}finally{clearTimeout(timer);await close();}
}

export async function claimAcceptanceResources(config: AcceptanceConfig, sourceHash: string) {
  const postgres = (await import('postgres')).default;
  const Redis = (await import('ioredis')).default;
  for (const url of [config.databaseUrl,config.freshDatabaseUrl,config.upgradeDatabaseUrl]) {
    const sql=postgres(url,{max:1,connect_timeout:5,connection:{statement_timeout:5_000},onnotice:()=>undefined});
    await boundedAcceptanceResource(async()=>{
      const inventory=await sql`select table_name from information_schema.tables where table_schema='public'`;
      const schema=await sql`select schema_name from information_schema.schemata where schema_name='rpt08_acceptance'`;
      if(inventory.length||schema.length)throw Error('acceptance_database_must_be_new_and_empty');
      await sql`create schema rpt08_acceptance`;
      await sql`create table rpt08_acceptance.owner(run_id text primary key,source_hash text not null,owner_nonce text not null,queue_prefix text not null)`;
      await sql`create table rpt08_acceptance.fixtures(tenant_id uuid primary key,run_id text not null,kind text not null)`;
      await sql`insert into rpt08_acceptance.owner values(${config.runId},${sourceHash},${config.ownerNonce},${config.queuePrefix})`;
    },()=>sql.end({timeout:1}));
  }
  const redis=new Redis(config.redisUrl,{maxRetriesPerRequest:1,connectTimeout:5_000,commandTimeout:5_000});
  await boundedAcceptanceResource(async()=>{
    const inventory=await redis.scan('0','COUNT',1000);
    if(inventory[0]!=='0'||inventory[1].length)throw Error('acceptance_redis_database_must_be_empty');
    if(await redis.set('rpt08:owner:'+config.runId,config.ownerNonce+':'+sourceHash,'NX')!=='OK')throw Error('acceptance_redis_owner_conflict');
  },()=>redis.disconnect(false));
}

if (require.main === module) {
  Promise.resolve().then(() => parseAcceptanceConfig(process.argv.slice(2), process.env, resolve(__dirname, '..')))
    .then(runPulseReportAcceptance)
    .then((result) => { process.stdout.write(JSON.stringify(result) + '\n'); process.exitCode = result.status === 'passed' ? 0 : 1; })
    .catch(() => { process.stderr.write('pulse_acceptance_failed\n'); process.exitCode = 1; });
}
