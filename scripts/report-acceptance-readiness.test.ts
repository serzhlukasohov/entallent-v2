import assert from 'node:assert/strict';
import { PULSE_ACCEPTANCE_CASE_IDS, PULSE_ACCEPTANCE_LOCAL_OBLIGATIONS } from '../packages/contracts/src/pulse-report-acceptance';
import { validateReportAcceptance,acceptanceLaneEvidence } from './report-acceptance-readiness';

const h='a'.repeat(64),time='2026-10-30T10:00:00.000Z';
const laneIds=['connected','restart','migration','preview','regressions'];
function bundle(){
  return {schemaVersion:'pulse-acceptance-v1',mode:'local-synthetic',runId:'fixture',base:'b'.repeat(40),branch:'codex/pulse-check-reports',sourceHash:h,createdAt:time,runtimeMode:'explicit_test_constructors',transport:'synthetic',
    lanes:laneIds.map((id,index)=>{
      const hash=String(index+1).repeat(64);
      return {id,runId:'fixture',sourceHash:h,startedAt:time,finishedAt:time,status:'passed',cleanup:'passed',exitCode:0,tests:id==='preview'?12:1,skipped:0,artifactHashes:[hash],assertions:[{id,caseIds:PULSE_ACCEPTANCE_CASE_IDS,phase:'P07',status:'passed',dimension:'local',assertionCount:id==='preview'?12:1,skipped:0,evidenceHash:hash,testIds:[hash]},...(id==='regressions'?PULSE_ACCEPTANCE_LOCAL_OBLIGATIONS.map(([n,obligation,phase])=>({id:obligation,caseIds:['RPT-AC-'+n],phase,status:'passed',dimension:'local',assertionCount:1,skipped:0,evidenceHash:hash,testIds:[hash]})):[])]};
    }),migration:{ledgerCount:99,prefixLedgerCount:92,protectedManifestHash:h,baselineSchemaMigrated:'passed',fixtureInsertedWithGuards:'passed',suffixExecuted:'passed',postUpgradeAssertions:'passed',currentReaderOrDeliveryContinuation:'passed',historicalProducerExecuted:'blocked',historicalProducerReason:'not_provided'}};
}
const trusted=bundle();
const expected={runId:'fixture',sourceHash:h,base:trusted.base,now:time,artifactHashes:trusted.lanes.flatMap(lane=>lane.artifactHashes),testIds:trusted.lanes.flatMap(lane=>lane.assertions[0]!.testIds),requiredAssertionIds:PULSE_ACCEPTANCE_LOCAL_OBLIGATIONS.map(([,id])=>id),protectedManifestHash:h,laneEvidence:trusted.lanes.map(acceptanceLaneEvidence)};
const valid=validateReportAcceptance(bundle(),expected);
assert.equal(valid.validation,'passed');assert.equal(valid.pilotEligibility,'blocked');assert.equal(valid.activationExecuted,false);assert.equal(valid.gates.length,11);
for(const id of ['G03','G04','G05','G06','G07','G09','G10','G11'])assert.equal(valid.gates.find(g=>g.id===id)?.status,'blocked');
const negatives:Array<(b:ReturnType<typeof bundle>)=>void>=[
 b=>{for(const lane of b.lanes){lane.tests=999999;for(const assertion of lane.assertions)assertion.assertionCount=999999;}},
 b=>{const preview=b.lanes[3]!.assertions[0]!;for(const lane of b.lanes)for(const assertion of lane.assertions){assertion.testIds=[...preview.testIds];assertion.evidenceHash=preview.evidenceHash;}},
 b=>{b.lanes[0]!.artifactHashes=[...b.lanes[3]!.artifactHashes];},
 b=>{b.lanes[4]!.assertions[1]!.testIds=[...b.lanes[3]!.assertions[0]!.testIds];},
 b=>{b.lanes[4]!.assertions[1]!.assertionCount=2;},
 b=>{b.migration.protectedManifestHash='0'.repeat(64);},
 b=>{b.lanes=[];},b=>{b.lanes[0]!.tests=0;},b=>{b.lanes[0]!.skipped=1;},b=>{b.lanes[0]!.cleanup='failed';},b=>{b.lanes[0]!.exitCode=1;},b=>{b.lanes[0]!.sourceHash='c'.repeat(64);},b=>{b.sourceHash='c'.repeat(64);},b=>{b.runId='foreign';},b=>{b.createdAt='2020-01-01T00:00:00.000Z';},b=>{b.lanes[0]!.finishedAt='2030-01-01T00:00:00.000Z';},b=>{b.lanes.push(b.lanes[0]!);},b=>{b.lanes[0]!.assertions[0]!.id='restart';},b=>{b.lanes[4]!.assertions.splice(1,1);},b=>{b.lanes[0]!.artifactHashes=['c'.repeat(64)];},b=>{b.lanes[0]!.assertions[0]!.evidenceHash='c'.repeat(64);},b=>{b.migration.fixtureInsertedWithGuards='blocked';},b=>{Object.assign(b,{productionRegistration:'passed'});},b=>{Object.assign(b.lanes[0]!,{rawText:'forbidden'});},
];
for(const change of negatives){const candidate=bundle();change(candidate);const result=validateReportAcceptance(candidate,expected);assert.equal(result.validation,'failed');assert.equal(result.pilotEligibility,'blocked');}
assert.equal(validateReportAcceptance(bundle(),{...expected,requiredAssertionIds:[]}).validation,'failed');
assert.equal(validateReportAcceptance(bundle(),{...expected,artifactHashes:[]}).validation,'failed');
assert.equal(validateReportAcceptance(bundle(),{...expected,laneEvidence:[]}).validation,'failed');
assert.equal(validateReportAcceptance(bundle(),{...expected,protectedManifestHash:''}).validation,'failed');
console.log('report acceptance readiness: trusted lane/test/artifact/count and protected migration bindings passed');
