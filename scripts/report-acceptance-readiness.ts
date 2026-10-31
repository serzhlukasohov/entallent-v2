import {
  PULSE_ACCEPTANCE_CASE_IDS, PULSE_ACCEPTANCE_LOCAL_OBLIGATIONS, PulseAcceptanceBundleSchema,
  PulseAcceptanceReadinessSchema, type PulseAcceptanceReadiness,
} from '../packages/contracts/src/pulse-report-acceptance';

export type AcceptanceLaneEvidence={id:string;tests:number;artifactHashes:readonly string[];assertions:readonly {id:string;testIds:readonly string[];evidenceHash:string;assertionCount:number}[]};
export function acceptanceLaneEvidence(lane:AcceptanceLaneEvidence):AcceptanceLaneEvidence{
  return {id:lane.id,tests:lane.tests,artifactHashes:[...lane.artifactHashes],assertions:lane.assertions.map(assertion=>({id:assertion.id,testIds:[...assertion.testIds],evidenceHash:assertion.evidenceHash,assertionCount:assertion.assertionCount}))};
}
const sameIds=(a:readonly string[],b:readonly string[])=>new Set(a).size===a.length&&new Set(b).size===b.length&&JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
export interface AcceptanceExpectation {
  runId: string;
  sourceHash: string;
  base: string;
  now: string;
  artifactHashes: readonly string[];
  requiredAssertionIds: readonly string[];testIds:readonly string[];
  protectedManifestHash:string;
  laneEvidence:readonly AcceptanceLaneEvidence[];
}

/** Pure accounting. Synthetic input can never grant external rollout authority. */
export function validateReportAcceptance(
  input: unknown, expected: AcceptanceExpectation,
): PulseAcceptanceReadiness {
  const parsed = PulseAcceptanceBundleSchema.safeParse(input);
  const failures = new Set<string>();
  const bundle = parsed.success ? parsed.data : null;
  if (!bundle) failures.add('invalid_bundle_schema');
  if (bundle && (bundle.runId !== expected.runId || bundle.sourceHash !== expected.sourceHash
    || bundle.base !== expected.base)) failures.add('foreign_or_stale_source');
  const now = Date.parse(expected.now);
  if (!Number.isFinite(now)) failures.add('invalid_validation_clock');
  if (bundle && (Date.parse(bundle.createdAt) > now || now - Date.parse(bundle.createdAt) > 86_400_000))
    failures.add('stale_or_future_bundle');
  const lanes = bundle?.lanes ?? [];
  if (new Set(lanes.map((l) => l.id)).size !== lanes.length) failures.add('duplicate_lane');
  for (const id of ['connected', 'restart', 'migration', 'preview', 'regressions']) {
    if (!lanes.some((l) => l.id === id)) failures.add('missing_lane_' + id);
  }
  const trustedLanes=new Map((expected.laneEvidence??[]).map(lane=>[lane.id,lane]));
  if(trustedLanes.size!==5||trustedLanes.size!==expected.laneEvidence?.length)failures.add('invalid_trusted_lane_inventory');
  const observedIds = new Set<string>();
  const required = new Map<string,{caseId:string;phase:string}>(PULSE_ACCEPTANCE_LOCAL_OBLIGATIONS.map(([n,id,phase])=>[id,{caseId:'RPT-AC-'+n,phase}]));
  const observedHashes = new Set(expected.artifactHashes);
  for (const lane of lanes) {
    const trusted=trustedLanes.get(lane.id);
    if(!trusted||lane.tests!==trusted.tests||!sameIds(lane.artifactHashes,trusted.artifactHashes)||lane.assertions.length!==trusted.assertions.length)failures.add('lane_evidence_mismatch_'+lane.id);
    if (lane.status !== 'passed' || lane.cleanup !== 'passed') failures.add('incomplete_lane_' + lane.id);
    if (lane.runId !== expected.runId || lane.sourceHash !== expected.sourceHash)
      failures.add('foreign_lane_' + lane.id);
    if (Date.parse(lane.finishedAt) > now || (bundle && Date.parse(lane.startedAt) < Date.parse(bundle.createdAt)))
      failures.add('invalid_lane_clock_' + lane.id);
    if (lane.artifactHashes.some((h) => !observedHashes.has(h))) failures.add('unverified_artifact_' + lane.id);
    for (const assertion of lane.assertions) {
      const binding=trusted?.assertions.find(item=>item.id===assertion.id);
      if(!binding||!sameIds(assertion.testIds,binding.testIds)||assertion.evidenceHash!==binding.evidenceHash||assertion.assertionCount!==binding.assertionCount||(lane.id!=='preview'&&assertion.assertionCount!==assertion.testIds.length))failures.add('assertion_evidence_mismatch_'+assertion.id);
      if (observedIds.has(assertion.id)) failures.add('duplicate_assertion');
      observedIds.add(assertion.id);
      const obligation=required.get(assertion.id);
      if(obligation && (assertion.caseIds.length!==1||assertion.caseIds[0]!==obligation.caseId||assertion.phase!==obligation.phase))
        failures.add('assertion_obligation_mismatch');
      if(assertion.testIds.some(id=>!expected.testIds.includes(id)))failures.add('unverified_assertion_test_identity');
      if (!observedHashes.has(assertion.evidenceHash)) failures.add('unverified_assertion_artifact');
    }
  }
  for (const id of expected.requiredAssertionIds)
    if (!observedIds.has(id)) failures.add('missing_required_assertion');
  for(const id of required.keys())if(!observedIds.has(id))failures.add('missing_local_obligation');
  if (expected.requiredAssertionIds.length === 0) failures.add('empty_expected_assertions');
  const cases = PULSE_ACCEPTANCE_CASE_IDS.map((id) => {
    const obligation=PULSE_ACCEPTANCE_LOCAL_OBLIGATIONS.find(([n])=>'RPT-AC-'+n===id)![1];
    const assertions = lanes.flatMap((l) => l.assertions.filter((a) => a.caseIds.includes(id)&&a.id===obligation));
    const passed = assertions.length > 0 && assertions.every((a) => a.status === 'passed'
      && a.dimension === 'local' && a.assertionCount > 0 && a.skipped === 0);
    if (!passed) failures.add('incomplete_' + id);
    return {
      id, local: passed ? 'passed' as const : 'failed' as const,
      assertionIds: assertions.map((a) => a.id), semantic: 'not_run' as const,
      nativeClient: 'not_run' as const, publicIngress: 'blocked' as const, production: 'not_run' as const,
    };
  });
  const migration = bundle?.migration;
  const upgradePassed = migration && [migration.baselineSchemaMigrated,
    migration.fixtureInsertedWithGuards, migration.suffixExecuted, migration.postUpgradeAssertions,
    migration.currentReaderOrDeliveryContinuation].every((s) => s === 'passed');
  const protectedPassed=/^[a-f0-9]{64}$/.test(expected.protectedManifestHash??'')&&migration?.protectedManifestHash===expected.protectedManifestHash;
  if(!protectedPassed)failures.add('protected_migration_manifest_mismatch');
  if (!upgradePassed) failures.add('incomplete_migration');
  const lanePassed = (id: string) => lanes.some((l) => l.id === id && l.status === 'passed'
    && l.cleanup === 'passed');
  const gates: PulseAcceptanceReadiness['gates'] = [
    { id: 'G01', status: failures.size === 0 ? 'passed' : 'failed', reason: 'local_assertion_accounting' },
    { id: 'G02', status: lanePassed('preview') ? 'passed' : 'failed', reason: 'synthetic_shape_only' },
    { id: 'G03', status: 'blocked', reason: 'public_rights_ingress_absent' },
    { id: 'G04', status: 'blocked', reason: 'production_drivers_unregistered' },
    { id: 'G05', status: 'blocked', reason: 'live_resources_not_run' },
    { id: 'G06', status: 'blocked', reason: 'semantic_acceptance_not_run' },
    { id: 'G07', status: 'blocked', reason: 'native_slack_acceptance_not_run' },
    { id: 'G08', status: upgradePassed && protectedPassed && lanePassed('migration') ? 'passed' : 'failed', reason: 'local_schema_fixture_only' },
    { id: 'G09', status: 'blocked', reason: 'production_inventory_not_run' },
    { id: 'G10', status: 'blocked', reason: 'rollout_not_authorized' },
    { id: 'G11', status: 'blocked', reason: 'activation_not_executed' },
  ];
  return PulseAcceptanceReadinessSchema.parse({
    schemaVersion: 'pulse-readiness-v1', runId: expected.runId,
    validation: failures.size === 0 ? 'passed' : 'failed',
    pilotEligibility: 'blocked', activationExecuted: false, gates, cases,
    failures: [...failures].sort(),
  });
}
