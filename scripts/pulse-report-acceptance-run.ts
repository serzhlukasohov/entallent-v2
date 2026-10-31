import {createHash} from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { acceptanceChildEnvironment, acceptanceSourceManifest, runAcceptanceChild, RPT08_BASE,
  type AcceptanceConfig } from './run-pulse-report-acceptance';
import { RPT08_REGRESSION_SELECTION, nativeAcceptanceReporterModule, readAcceptanceTestEvidence, registerAcceptanceAssertions, verifyAcceptanceLowerCompanions,
  acceptanceEvidenceHash, type AcceptanceTestEvidence } from './pulse-report-acceptance-evidence';
import { exportAcceptancePreviews } from './report-acceptance-preview';
import { validateReportAcceptance,acceptanceLaneEvidence } from './report-acceptance-readiness';
import { PULSE_ACCEPTANCE_CASE_IDS, PULSE_ACCEPTANCE_LOCAL_OBLIGATIONS, PulseAcceptanceBundleSchema,
  type PulseAcceptanceLane } from '../packages/contracts/src/pulse-report-acceptance';

export function acceptanceProtectedManifestHash(root:string){
  const folder=resolve(root,'packages/database/migrations');
  const journal=JSON.parse(readFileSync(join(folder,'meta/_journal.json'),'utf8')) as {entries:Array<{idx:number;tag:string;when:number}>};
  const prefix=journal.entries.filter(entry=>entry.idx<=91).map(entry=>({idx:entry.idx,sha256:createHash('sha256').update(readFileSync(join(folder,entry.tag+'.sql'))).digest('hex'),tag:entry.tag,when:entry.when}));
  if(prefix.length!==92)throw Error('protected_migration_inventory_mismatch');
  return createHash('sha256').update(JSON.stringify(prefix)).digest('hex');
}
export function acceptanceTestInvocation(root: string, packageName: string, files: readonly string[], framework: 'vitest' | 'node:test', report: string) {
  const directory=packageName==='@entalent/worker'?'apps/worker':'packages/'+packageName.split('/')[1];
  const expected={framework,files:files.map(file=>resolve(root,directory,file))};
  if(framework==='node:test'){
    const reporter=report+'.reporter.cjs';writeFileSync(reporter,nativeAcceptanceReporterModule(root),{mode:0o600});
    return {command:process.execPath,args:['--import','tsx','--test','--test-concurrency=1','--test-reporter',reporter,'--test-reporter-destination',report,...expected.files],expected};
  }
  const args=['--filter',packageName,'exec','vitest','run'];
  if(packageName==='@entalent/database')args.push('--config','vitest.integration.config.ts');
  args.push(...files,'--reporter=json','--outputFile='+report);
  return {command:'pnpm',args,expected};
}

export async function executeAcceptanceLanes(config: AcceptanceConfig, sourceHash: string, createdAt: string,aggregateDeadline=Date.now()+3_600_000) {
  const env = { ...acceptanceChildEnvironment(config), RPT08_SOURCE_HASH: sourceHash };
  const lanes: PulseAcceptanceLane[] = [], tests: AcceptanceTestEvidence[] = [], artifactHashes: string[] = [];
  const deadline = aggregateDeadline;
  const child = async (label: string, command: string, args: string[], childEnv = env, timeoutMs = 600_000) => {
    if (Date.now() >= deadline) throw Error('acceptance_aggregate_timeout');
    process.stdout.write(JSON.stringify({ phase: label, status: 'started' }) + '\n');
    const result = await runAcceptanceChild(command, args, config.root, childEnv,
      join(config.out, label + '.log'), Math.min(timeoutMs, deadline - Date.now()));
    if (result.exitCode !== 0 || result.timedOut) throw Error('acceptance_child_failed_' + label.replaceAll('-', '_'));
  };
  const runTests = async (lane: 'connected' | 'restart' | 'migration' | 'regressions', label: string,
    packageName: string, files: readonly string[], databaseUrl = config.databaseUrl, framework: 'vitest' | 'node:test' = 'vitest'): Promise<PulseAcceptanceLane> => {
    const startedAt = new Date().toISOString(), report = join(config.out, label + '.json');
    const invocation=acceptanceTestInvocation(config.root,packageName,files,framework,report);
    await child(label, invocation.command, invocation.args, { ...acceptanceChildEnvironment(config, databaseUrl), RPT08_SOURCE_HASH: sourceHash }, 1_200_000);
    const evidence = readAcceptanceTestEvidence(report,invocation.expected);
    tests.push(...evidence);
    const evidenceHash = acceptanceEvidenceHash(evidence);
    artifactHashes.push(evidenceHash);
    return { id: lane, runId: config.runId, sourceHash, startedAt,
      finishedAt: new Date().toISOString(), status: 'passed', cleanup: 'passed',
      exitCode: 0, tests: evidence.length, skipped: 0, artifactHashes: [evidenceHash], assertions: [{
        id: label, caseIds: PULSE_ACCEPTANCE_CASE_IDS, phase: 'P07', status: 'passed',
        dimension: 'local', assertionCount: evidence.length, skipped: 0, evidenceHash,testIds:evidence.map(test=>test.testId) }] };
  };
  const migrateDatabase=async(label:string,databaseUrl:string)=>child(label,'pnpm',['--filter','@entalent/database','exec','node','-e',
    "const postgres=require('postgres'),{drizzle}=require('drizzle-orm/postgres-js'),{migrate}=require('drizzle-orm/postgres-js/migrator');const s=postgres(process.env.DATABASE_URL,{max:1,onnotice:()=>{}});migrate(drizzle(s),{migrationsFolder:'migrations'}).finally(()=>s.end({timeout:5})).catch(()=>{process.exitCode=1})"],{...acceptanceChildEnvironment(config,databaseUrl),RPT08_SOURCE_HASH:sourceHash});
  try {
    await child('shared-build', 'pnpm', ['--filter', './packages/*', 'build']);
    await child('pure-runner', process.execPath, ['--import', 'tsx', 'scripts/run-pulse-report-acceptance.test.ts']);
    await child('pure-readiness', process.execPath, ['--import', 'tsx', 'scripts/report-acceptance-readiness.test.ts']);
    await child('pure-preview',process.execPath,['--import','tsx','scripts/report-acceptance-preview.test.ts']);
    // Migration acceptance owns the pristine fresh schema; lower regressions consume it afterward.
    lanes.push(await runTests('migration', 'migration', '@entalent/database', ['src/__tests__/pulse-report-migration-acceptance.integration.test.ts'], config.upgradeDatabaseUrl));
    await migrateDatabase('fresh-migrate',config.freshDatabaseUrl);
    const regressionLanes: PulseAcceptanceLane[] = [];
    for (const [index, selection] of RPT08_REGRESSION_SELECTION.entries())
      regressionLanes.push(await runTests('regressions', 'regression-' + index, selection.package, selection.files, config.freshDatabaseUrl,selection.framework));
    verifyAcceptanceLowerCompanions(tests);
    await migrateDatabase('connected-migrate',config.databaseUrl);
    lanes.push(await runTests('connected', 'connected', '@entalent/database', ['src/__tests__/pulse-report-connected-acceptance.integration.test.ts']));
    lanes.push(await runTests('restart', 'restart', '@entalent/database', ['src/__tests__/pulse-report-restart-acceptance.integration.test.ts']));
    const combinedHash = acceptanceEvidenceHash(tests);
    artifactHashes.push(combinedHash);
    writeFileSync(join(config.out, 'executed-case-inventory.json'), JSON.stringify({ runId: config.runId,
      sourceHash, evidenceHash: combinedHash, tests }, null, 2), { mode: 0o600 });
    lanes.push({ ...regressionLanes[0]!, finishedAt: new Date().toISOString(),
      tests: regressionLanes.reduce((sum, lane) => sum + lane.tests, 0),
      assertions: registerAcceptanceAssertions(tests, combinedHash),
      artifactHashes: regressionLanes.flatMap(lane => lane.artifactHashes).concat(combinedHash) });
    const previewStart = new Date().toISOString();
    const preview = exportAcceptancePreviews(JSON.parse(readFileSync(join(config.out, 'connected-preview-input.json'), 'utf8')),
      sourceHash, join(config.out, 'previews'));
    const previewHash = acceptanceEvidenceHash(preview);
    artifactHashes.push(previewHash);
    lanes.push({ id: 'preview', runId: config.runId, sourceHash, startedAt: previewStart,
      finishedAt: new Date().toISOString(), status: 'passed', cleanup: 'passed', exitCode: 0,
      tests: preview.parts.length, skipped: 0, artifactHashes: [previewHash], assertions: [{
        id: 'preview', caseIds: ['RPT-AC-29'], phase: 'P07', status: 'passed', dimension: 'local',
        assertionCount: preview.parts.length, skipped: 0, evidenceHash: previewHash,testIds:[previewHash] }] });
    if (acceptanceSourceManifest(config.root).sha256 !== sourceHash) throw Error('acceptance_source_changed_during_run');
    const migration = JSON.parse(readFileSync(join(config.out, 'migration', 'guarded-fixture.json'), 'utf8'));
    const migrationManifest = JSON.parse(readFileSync(join(config.out, 'migration', 'migration-manifest.json'), 'utf8'));
    const bundle = PulseAcceptanceBundleSchema.parse({ schemaVersion: 'pulse-acceptance-v1', mode: 'local-synthetic',
      runId: config.runId, base: RPT08_BASE, branch: 'codex/pulse-check-reports', sourceHash, createdAt,
      runtimeMode: 'explicit_test_constructors', transport: 'synthetic', lanes,
      migration: { ledgerCount: migrationManifest.rows.length, prefixLedgerCount: 92, protectedManifestHash: migrationManifest.pins.manifest,
        baselineSchemaMigrated: migration.baselineSchemaMigrated, fixtureInsertedWithGuards: 'passed', suffixExecuted: 'passed',
        postUpgradeAssertions: 'passed', currentReaderOrDeliveryContinuation: migration.currentReaderOrDeliveryContinuation,
        historicalProducerExecuted: 'blocked', historicalProducerReason: 'not_provided' } });
    const readiness = validateReportAcceptance(bundle, { runId: config.runId, sourceHash,
      base: RPT08_BASE, now: new Date().toISOString(), artifactHashes,
      protectedManifestHash:acceptanceProtectedManifestHash(config.root),laneEvidence:lanes.map(acceptanceLaneEvidence),
      testIds:tests.map(test=>test.testId).concat(previewHash),
      requiredAssertionIds: PULSE_ACCEPTANCE_LOCAL_OBLIGATIONS.map(([, id]) => id) });
    writeFileSync(join(config.out, 'acceptance-bundle.json'), JSON.stringify(bundle, null, 2), { mode: 0o600 });
    writeFileSync(join(config.out, 'readiness.json'), JSON.stringify(readiness, null, 2), { mode: 0o600 });
    if (readiness.validation !== 'passed') throw Error('acceptance_accounting_failed');
    return { status: 'passed' as const, pilotEligibility: 'blocked' as const, activationExecuted: false };
  } catch (error) {
    const reason = error instanceof Error && /^[A-Za-z0-9_]+$/.test(error.message) ? error.message : 'acceptance_execution_failed';
    writeFileSync(join(config.out, 'failed-receipt.json'), JSON.stringify({ runId: config.runId,
      sourceHash, status: 'failed', reason, completedLanes: lanes.map(lane => lane.id),
      pilotEligibility: 'blocked', activationExecuted: false }), { mode: 0o600 });
    throw error;
  }
}
